"""NSK-MET-COHORT-001: cohort availability and retention for alert snapshots.

Runs against the disposable Postgres database (tests/support/pg_integration_base.py).
Seeds snapshots through raw SQL because ``captured_at`` is deliberately not
writable through ``record_alert_aggregates`` (the column defaults to now() on
insert and is refreshed on conflict).
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.netskope.sse.repositories.netskope_metrics import get_netskope_alert_aggregates
from app.netskope.sse.repositories.netskope_mutations import purge_netskope_alert_aggregates, record_alert_aggregates
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_run as seed_ingestion_run
from tests.support.pg_integration_base import PostgresIntegrationTestCase


async def _seed_aggregate(pool, run_id, *, window_days: int, dimension: str, dimension_value: str, alert_count: int, captured_at: datetime) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_alert_aggregates
                   (source_run_id, window_days, window_start, window_end, dimension, dimension_value, alert_count, captured_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (run_id, window_days, captured_at - timedelta(days=window_days), captured_at, dimension, dimension_value, alert_count, captured_at),
        )


async def _seed_run(pool, run_id, status: str, started_at: datetime, *, completed_at: datetime | None = None) -> None:
    await seed_ingestion_run(pool, run_id, status, started_at)
    if completed_at is not None or status == "completed":
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE public.cyberark_ingestion_runs SET completed_at = %s WHERE run_id = %s",
                (completed_at or started_at, run_id),
            )


class NetskopeAlertAggregatePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)
        # LIFO: reset_netskope (deletes the run children, including the
        # aggregates) before reset_netskope_runs (deletes the test runs).
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        now = datetime.now(timezone.utc)
        self.run_id = uuid4()
        await _seed_run(self.pool, self.run_id, "completed", now - timedelta(seconds=1))
        self.fresh_run_id = uuid4()
        await _seed_run(self.pool, self.fresh_run_id, "completed", now)

    async def test_purge_removes_only_snapshots_older_than_retention(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=181)
        fresh = now - timedelta(days=179)
        # Each (run, window, dimension, value) is unique, so expired and fresh
        # rows for the same bucket live in different runs on purpose.
        await _seed_aggregate(self.pool, self.run_id, window_days=7, dimension="total", dimension_value="", alert_count=5, captured_at=old)
        await _seed_aggregate(self.pool, self.run_id, window_days=30, dimension="severity", dimension_value="High", alert_count=3, captured_at=old)
        await _seed_aggregate(self.pool, self.run_id, window_days=90, dimension="alert_type", dimension_value="DLP", alert_count=9, captured_at=now - timedelta(days=200))
        await _seed_aggregate(self.pool, self.fresh_run_id, window_days=7, dimension="total", dimension_value="", alert_count=2, captured_at=fresh)
        await _seed_aggregate(self.pool, self.fresh_run_id, window_days=30, dimension="action", dimension_value="alert", alert_count=1, captured_at=now)

        self.assertEqual(await purge_netskope_alert_aggregates(self.pool, 180), 3)

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT window_days, dimension, dimension_value, alert_count FROM public.netskope_alert_aggregates ORDER BY aggregate_id"
            )
            survivors = await cursor.fetchall()
            run_cursor = await conn.execute(
                "SELECT count(*)::int AS total FROM public.cyberark_ingestion_runs WHERE run_id = ANY(%s)",
                ([self.run_id, self.fresh_run_id],),
            )
            run_row = await run_cursor.fetchone()
        self.assertEqual(
            [(row["window_days"], row["dimension"], row["dimension_value"], row["alert_count"]) for row in survivors],
            [(7, "total", "", 2), (30, "action", "alert", 1)],
        )
        # The FK parents (both runs) are never touched by aging out children.
        self.assertEqual(run_row["total"], 2)

    async def test_purge_is_idempotent_and_recording_still_works_afterwards(self):
        now = datetime.now(timezone.utc)
        await _seed_aggregate(self.pool, self.run_id, window_days=7, dimension="total", dimension_value="", alert_count=4, captured_at=now - timedelta(days=400))

        self.assertEqual(await purge_netskope_alert_aggregates(self.pool, 180), 1)
        self.assertEqual(await purge_netskope_alert_aggregates(self.pool, 180), 0)

        # The run and its remaining references keep working: a new snapshot
        # for the same run inserts and survives the retention window.
        await record_alert_aggregates(self.pool, self.run_id, [{
            "window_days": 90, "window_start": now - timedelta(days=90), "window_end": now,
            "dimension": "total", "dimension_value": "", "alert_count": 7,
        }])
        self.assertEqual(await purge_netskope_alert_aggregates(self.pool, 180), 0)
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT alert_count, captured_at >= now() - make_interval(days => 180) AS fresh FROM public.netskope_alert_aggregates"
            )
            rows = await cursor.fetchall()
        self.assertEqual([(row["alert_count"], row["fresh"]) for row in rows], [(7, True)])


    async def test_legacy_severity_never_reappears_in_current_local_metric_windows(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=1)
        await _seed_aggregate(self.pool, self.run_id, window_days=7, dimension="severity", dimension_value="High", alert_count=99, captured_at=old)
        await _seed_aggregate(self.pool, self.run_id, window_days=30, dimension="severity", dimension_value="Low", alert_count=77, captured_at=old)
        await _seed_aggregate(self.pool, self.fresh_run_id, window_days=7, dimension="total", dimension_value="", alert_count=3, captured_at=now)
        result = await get_netskope_alert_aggregates(self.pool)
        self.assertEqual([window["days"] for window in result["windows"]], [7])
        self.assertEqual(result["windows"][0]["by_severity"], [])
        self.assertEqual(result["windows"][0]["total"], 3)
        self.assertEqual(result["windows"][0]["captured_at"], now)
        self.assertEqual(result["windows"][0]["availability"], "complete")
        async with self.pool.connection() as conn:
            rows = await conn.execute("SELECT count(*)::int AS count FROM public.netskope_alert_aggregates WHERE dimension = %s", ("severity",))
            self.assertEqual((await rows.fetchone())["count"], 2)  # History is retained.

    async def test_latest_completed_window_cohort_drops_old_buckets_and_owns_its_dates(self):
        now = datetime.now(timezone.utc)
        old_capture = now - timedelta(hours=2)
        old_run = uuid4()
        new_run = uuid4()
        await _seed_run(self.pool, old_run, "completed", old_capture)
        await _seed_run(self.pool, new_run, "completed", now)
        for dimension, key, count in (("total", "", 100), ("alert_type", "A", 60), ("alert_type", "B", 40)):
            await _seed_aggregate(self.pool, old_run, window_days=7, dimension=dimension, dimension_value=key, alert_count=count, captured_at=old_capture)
        for dimension, key, count in (("total", "", 10), ("alert_type", "A", 10)):
            await _seed_aggregate(self.pool, new_run, window_days=7, dimension=dimension, dimension_value=key, alert_count=count, captured_at=now)

        result = await get_netskope_alert_aggregates(self.pool)

        self.assertEqual(len(result["windows"]), 1)
        window = result["windows"][0]
        self.assertEqual(window["total"], 10)
        self.assertEqual(window["by_alert_type"], [{"key": "A", "count": 10}])
        self.assertEqual(window["window_start"], now - timedelta(days=7))
        self.assertEqual(window["window_end"], now)
        self.assertEqual(window["captured_at"], now)
        self.assertEqual(window["availability"], "complete")

    async def test_running_partial_and_failed_runs_do_not_replace_completed_cohort(self):
        now = datetime.now(timezone.utc)
        completed_at = now - timedelta(hours=3)
        complete_run = uuid4()
        await _seed_run(self.pool, complete_run, "completed", completed_at)
        await _seed_aggregate(self.pool, complete_run, window_days=7, dimension="total", dimension_value="", alert_count=8, captured_at=completed_at)
        await _seed_aggregate(self.pool, complete_run, window_days=7, dimension="alert_type", dimension_value="accepted", alert_count=8, captured_at=completed_at)

        for index, status in enumerate(("running", "partial", "failed"), start=1):
            run_id = uuid4()
            started_at = now - timedelta(hours=3 - index)
            await _seed_run(
                self.pool, run_id, status, started_at,
                completed_at=started_at if status != "running" else None,
            )
            await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=100 + index, captured_at=started_at)
            await _seed_aggregate(self.pool, run_id, window_days=7, dimension="alert_type", dimension_value=status, alert_count=100 + index, captured_at=started_at)

        window = (await get_netskope_alert_aggregates(self.pool))["windows"][0]

        self.assertEqual(window["total"], 8)
        self.assertEqual(window["by_alert_type"], [{"key": "accepted", "count": 8}])
        self.assertEqual(window["captured_at"], completed_at)
        self.assertEqual(window["availability"], "complete")

    async def test_missing_total_is_incomplete_without_erasing_available_buckets(self):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="alert_type", dimension_value="DLP", alert_count=4, captured_at=now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="action", dimension_value="alert", alert_count=3, captured_at=now)

        window = (await get_netskope_alert_aggregates(self.pool))["windows"][0]

        self.assertIsNone(window["total"])
        self.assertEqual(window["availability"], "incomplete")
        self.assertEqual(window["by_alert_type"], [{"key": "DLP", "count": 4}])
        self.assertEqual(window["by_action"], [{"key": "alert", "count": 3}])

    async def test_present_zero_total_with_no_buckets_is_a_complete_empty_window(self):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=0, captured_at=now)

        window = (await get_netskope_alert_aggregates(self.pool))["windows"][0]

        self.assertEqual(window["total"], 0)
        self.assertEqual(window["availability"], "complete")
        self.assertEqual(window["by_alert_type"], [])
        self.assertEqual(window["by_action"], [])

    async def test_expired_snapshot_keeps_its_values_and_is_marked_stale(self):
        now = datetime.now(timezone.utc)
        captured_at = now - timedelta(hours=25)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=6, captured_at=captured_at)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="alert_type", dimension_value="DLP", alert_count=6, captured_at=captured_at)

        window = (await get_netskope_alert_aggregates(self.pool))["windows"][0]

        self.assertEqual(window["availability"], "stale")
        self.assertEqual(window["total"], 6)
        self.assertEqual(window["captured_at"], captured_at)
        self.assertEqual(window["by_alert_type"], [{"key": "DLP", "count": 6}])

    async def test_each_window_selects_its_own_completed_run_cohort(self):
        now = datetime.now(timezone.utc)
        seven_day_run = uuid4()
        thirty_day_run = uuid4()
        seven_capture = now - timedelta(hours=2)
        thirty_capture = now - timedelta(hours=1)
        await _seed_run(self.pool, seven_day_run, "completed", seven_capture)
        await _seed_run(self.pool, thirty_day_run, "completed", thirty_capture)
        await _seed_aggregate(self.pool, seven_day_run, window_days=7, dimension="total", dimension_value="", alert_count=7, captured_at=seven_capture)
        await _seed_aggregate(self.pool, seven_day_run, window_days=7, dimension="alert_type", dimension_value="seven", alert_count=7, captured_at=seven_capture)
        await _seed_aggregate(self.pool, thirty_day_run, window_days=30, dimension="total", dimension_value="", alert_count=30, captured_at=thirty_capture)
        await _seed_aggregate(self.pool, thirty_day_run, window_days=30, dimension="action", dimension_value="thirty", alert_count=30, captured_at=thirty_capture)

        windows = (await get_netskope_alert_aggregates(self.pool))["windows"]

        self.assertEqual([window["days"] for window in windows], [7, 30])
        self.assertEqual([(window["total"], window["captured_at"]) for window in windows], [(7, seven_capture), (30, thirty_capture)])
        self.assertEqual(windows[0]["by_alert_type"], [{"key": "seven", "count": 7}])
        self.assertEqual(windows[0]["by_action"], [])
        self.assertEqual(windows[1]["by_alert_type"], [])
        self.assertEqual(windows[1]["by_action"], [{"key": "thirty", "count": 30}])
