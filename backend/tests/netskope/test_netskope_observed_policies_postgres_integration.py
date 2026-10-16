"""NSK-POL-001 against real PostgreSQL.

Only completed Netskope runs publish observed policies, the latest completed
cohort per window wins, first/last capture use snapshot captured_at (never
event time), the source_system is isolated and no personal field is exposed.
The policy dimension insert also proves migration 075 widened the CHECK.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4
import unittest

from app.netskope.sse.repositories.netskope_observed_policies import fetch_observed_policy_rows
from app.netskope.sse.services.netskope_observed_policies import get_observed_policies
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_run as seed_ingestion_run
from tests.support.pg_integration_base import PostgresIntegrationTestCase


async def _seed_run(pool, run_id, status, started_at, *, completed_at=None, source_system="netskope") -> None:
    if source_system == "netskope":
        await seed_ingestion_run(pool, run_id, status, started_at)
        if completed_at is not None or status == "completed":
            async with pool.connection() as conn:
                await conn.execute(
                    "UPDATE public.cyberark_ingestion_runs SET completed_at = %s WHERE run_id = %s",
                    (completed_at or started_at, run_id),
                )
    else:
        async with pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                       (run_id, status, source_system, started_at, completed_at, triggered_by)
                   VALUES (%s, %s, %s, %s, %s, 'observed-policies-test')""",
                (run_id, status, source_system, started_at, completed_at or started_at),
            )


async def _seed_aggregate(pool, run_id, *, window_days, dimension, dimension_value, alert_count, captured_at) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_alert_aggregates
                   (source_run_id, window_days, window_start, window_end, dimension, dimension_value, alert_count, captured_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (run_id, window_days, captured_at - timedelta(days=window_days), captured_at, dimension, dimension_value, alert_count, captured_at),
        )


async def _delete_run(pool, run_id) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_alert_aggregates WHERE source_run_id = %s", (run_id,))
        await conn.execute("DELETE FROM public.cyberark_ingestion_runs WHERE run_id = %s", (run_id,))


class NetskopeObservedPoliciesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_latest_completed_cohort_wins_and_capture_bounds_span_runs(self):
        now = datetime.now(timezone.utc)
        old_capture = now - timedelta(hours=4)
        old_run = uuid4()
        new_run = uuid4()
        await _seed_run(self.pool, old_run, "completed", old_capture)
        await _seed_run(self.pool, new_run, "completed", now)
        for run_id, captured_at in ((old_run, old_capture), (new_run, now)):
            await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=0, captured_at=captured_at)
        await _seed_aggregate(self.pool, old_run, window_days=7, dimension="policy", dimension_value="Alta", alert_count=100, captured_at=old_capture)
        await _seed_aggregate(self.pool, old_run, window_days=7, dimension="policy", dimension_value="SóloVieja", alert_count=99, captured_at=old_capture)
        await _seed_aggregate(self.pool, new_run, window_days=7, dimension="policy", dimension_value="Alta", alert_count=10, captured_at=now)
        await _seed_aggregate(self.pool, new_run, window_days=7, dimension="policy", dimension_value="Nueva", alert_count=5, captured_at=now)

        window = (await get_observed_policies(self.pool))["windows"][0]

        self.assertEqual([policy["policy"] for policy in window["policies"]], ["Alta", "Nueva"])
        self.assertEqual([policy["volume"] for policy in window["policies"]], [10, 5])
        # Latest cohort for volume; capture bounds span every retained completed
        # policy snapshot, and never fall back to an event timestamp.
        high = window["policies"][0]
        self.assertEqual(high["first_captured_at"], old_capture)
        self.assertEqual(high["last_captured_at"], now)
        self.assertEqual(window["captured_at"], now)
        self.assertEqual(window["availability"], "complete")

    async def test_running_partial_and_failed_runs_never_publish_policies(self):
        now = datetime.now(timezone.utc)
        complete = uuid4()
        await _seed_run(self.pool, complete, "completed", now)
        await _seed_aggregate(self.pool, complete, window_days=7, dimension="total", dimension_value="", alert_count=1, captured_at=now)
        await _seed_aggregate(self.pool, complete, window_days=7, dimension="policy", dimension_value="Real", alert_count=1, captured_at=now)
        for offset, status in enumerate(("running", "partial", "failed"), start=1):
            run_id = uuid4()
            started_at = now + timedelta(minutes=offset)
            await _seed_run(self.pool, run_id, status, started_at, completed_at=started_at if status != "running" else None)
            await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=999, captured_at=started_at)
            await _seed_aggregate(self.pool, run_id, window_days=7, dimension="policy", dimension_value="Fantasma", alert_count=999, captured_at=started_at)

        window = (await get_observed_policies(self.pool))["windows"][0]

        self.assertEqual([policy["policy"] for policy in window["policies"]], ["Real"])
        self.assertEqual(window["captured_at"], now)

    async def test_policies_from_another_source_system_are_isolated(self):
        now = datetime.now(timezone.utc)
        netskope_run = uuid4()
        foreign_run = uuid4()
        await _seed_run(self.pool, netskope_run, "completed", now)
        await _seed_run(self.pool, foreign_run, "completed", now, source_system="cyberark")
        self.addAsyncCleanup(_delete_run, self.pool, foreign_run)
        await _seed_aggregate(self.pool, netskope_run, window_days=7, dimension="total", dimension_value="", alert_count=1, captured_at=now)
        await _seed_aggregate(self.pool, netskope_run, window_days=7, dimension="policy", dimension_value="Netskope", alert_count=1, captured_at=now)
        await _seed_aggregate(self.pool, foreign_run, window_days=7, dimension="total", dimension_value="", alert_count=1, captured_at=now)
        await _seed_aggregate(self.pool, foreign_run, window_days=7, dimension="policy", dimension_value="Ajena", alert_count=1, captured_at=now)

        window = (await get_observed_policies(self.pool))["windows"][0]

        self.assertEqual([policy["policy"] for policy in window["policies"]], ["Netskope"])

    async def test_rows_expose_no_personal_or_event_fields(self):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=30, dimension="total", dimension_value="", alert_count=1, captured_at=now)
        await _seed_aggregate(self.pool, run_id, window_days=30, dimension="policy", dimension_value="Política X", alert_count=4, captured_at=now)

        rows = await fetch_observed_policy_rows(self.pool)

        self.assertEqual(len(rows), 1)
        self.assertEqual(
            set(rows[0]),
            {"window_days", "policy", "alert_count", "window_start", "window_end", "captured_at", "policy_captured", "first_captured_at", "last_captured_at"},
        )
        window = (await get_observed_policies(self.pool))["windows"][0]
        self.assertEqual(
            set(window["policies"][0]),
            {"policy", "volume", "first_captured_at", "last_captured_at", "dominant_action"},
        )

    async def test_cohort_without_policy_dimension_is_missing_not_empty(self):
        # NSK-POL-002: a capture that predates migration 075 has the other
        # dimensions but no policy evidence at all.
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=40, captured_at=now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="action", dimension_value="alert", alert_count=40, captured_at=now)

        result = await get_observed_policies(self.pool)

        window = result["windows"][0]
        self.assertEqual((window["days"], window["policy_capture"], window["policies"]), (7, "missing", []))

    async def test_cohort_with_the_capture_marker_and_zero_policies_is_really_empty(self):
        now = datetime.now(timezone.utc)
        run_id = uuid4()
        await _seed_run(self.pool, run_id, "completed", now)
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="total", dimension_value="", alert_count=0, captured_at=now)
        # Proves migration 081 widened the dimension CHECK.
        await _seed_aggregate(self.pool, run_id, window_days=7, dimension="policy_capture", dimension_value="captured", alert_count=0, captured_at=now)

        window = (await get_observed_policies(self.pool))["windows"][0]

        self.assertEqual((window["policy_capture"], window["policies"]), ("captured", []))
        self.assertEqual(window["captured_at"], now)

    async def test_a_newer_capture_without_the_dimension_does_not_inherit_older_policies(self):
        now = datetime.now(timezone.utc)
        old_run, new_run = uuid4(), uuid4()
        old_capture = now - timedelta(hours=3)
        await _seed_run(self.pool, old_run, "completed", old_capture)
        await _seed_run(self.pool, new_run, "completed", now)
        await _seed_aggregate(self.pool, old_run, window_days=7, dimension="total", dimension_value="", alert_count=1, captured_at=old_capture)
        await _seed_aggregate(self.pool, old_run, window_days=7, dimension="policy", dimension_value="Vieja", alert_count=1, captured_at=old_capture)
        await _seed_aggregate(self.pool, new_run, window_days=7, dimension="total", dimension_value="", alert_count=1, captured_at=now)

        window = (await get_observed_policies(self.pool))["windows"][0]

        self.assertEqual((window["policy_capture"], window["policies"]), ("missing", []))

    async def test_first_capture_is_bounded_by_retention_and_reported_as_such(self):
        # A policy first seen before the retention window can only show the
        # oldest snapshot still kept; the response says so.
        now = datetime.now(timezone.utc)
        oldest_kept = now - timedelta(days=179)
        old_run, new_run = uuid4(), uuid4()
        await _seed_run(self.pool, old_run, "completed", oldest_kept)
        await _seed_run(self.pool, new_run, "completed", now)
        for run_id, captured_at in ((old_run, oldest_kept), (new_run, now)):
            await _seed_aggregate(self.pool, run_id, window_days=90, dimension="total", dimension_value="", alert_count=1, captured_at=captured_at)
            await _seed_aggregate(self.pool, run_id, window_days=90, dimension="policy", dimension_value="Antigua", alert_count=1, captured_at=captured_at)

        result = await get_observed_policies(self.pool)

        policy = result["windows"][0]["policies"][0]
        self.assertEqual(policy["first_captured_at"], oldest_kept)
        self.assertEqual(result["retention_days"], 180)


if __name__ == "__main__":
    unittest.main()
