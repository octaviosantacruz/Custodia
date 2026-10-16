"""NSK-HB-001: one rule for "recent", "stale" and "unknown" on real PostgreSQL.

The Python evidence, the SQL state, the freshness buckets, the stale metric and the
listing filters must agree on every timestamp and on the 7- and 30-day boundaries,
and the stale card must count exactly the devices its drill opens. Opt-in; see
tests/support/pg_integration_base.py."""

from datetime import datetime, timedelta, timezone

from app.db import fetch_all
from app.netskope.sse.repositories.netskope_metrics import get_netskope_metrics
from app.netskope.sse.repositories.netskope_queries import get_netskope_device_freshness, list_netskope_objects
from app.netskope.sse.repositories.netskope_shared import (
    SOURCE_EVIDENCE_CTES, _event_age_case, device_evidence_state_sql, recent_device_condition, stale_device_condition,
)
from app.netskope.sse.device_evidence import device_evidence
from tests.support.netskope_pg_fixtures import insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase

AS_OF = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
DAY = 86400


def at(seconds_ago: float) -> float:
    return AS_OF.timestamp() - seconds_ago


# (source_id, last_event_timestamp, expected state, expected age bucket)
CASES = [
    ("exactly-7d", at(7 * DAY), "recent", "d1_7"),
    ("7d-and-1s", at(7 * DAY + 1), "not_recent", "d7_30"),
    ("exactly-30d", at(30 * DAY), "not_recent", "d7_30"),
    ("30d-and-1s", at(30 * DAY + 1), "review", "gt_30d"),
    ("90d", at(90 * DAY), "review", "gt_30d"),
    ("one-hour", at(3600), "recent", "lt_24h"),
    # Heartbeats are stamped slightly ahead of the clock: up to one hour still counts, beyond it is untrusted.
    ("slightly-ahead", at(-1800), "recent", "lt_24h"),
    ("future", at(-(3600 + 60)), "unknown", "unknown"),
    ("zero", 0, "unknown", "unknown"),
    ("negative", -10, "unknown", "unknown"),
    ("huge", 10**400, "unknown", "unknown"),
    ("string", "1758000000", "unknown", "unknown"),
    ("boolean", True, "unknown", "unknown"),
    ("json-null", None, "unknown", "unknown"),
]


class NetskopeStaleRulePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_real_inventory_and_user_activity_queries_exclude_invalid_event_dates(self):
        now = int(datetime.now(timezone.utc).timestamp())
        for timestamp, recent in ((now + 86400, False), (10**400, False), (0, False), (-1, False),
                                  (str(now - 60), False), (True, False), (None, False), (now - 60, True)):
            with self.subTest(timestamp=timestamp):
                await reset_netskope(self.pool)
                await seed_netskope_user(self.pool, "date-user", "Date User", "date@example.test")
                await seed_device(self.pool, "date-device", {"username": "date@example.test", "last_event_timestamp": timestamp})
                metrics = await get_netskope_metrics(self.pool, widgets=["devices_total", "users_recent_activity", "users_by_recent_device_age"])
                inventory = await list_netskope_objects(self.pool, "device", "", 50, 0)
                self.assertEqual(inventory["total"], int(recent))
                self.assertEqual(metrics["devices_total"], int(recent))
                self.assertEqual(metrics["users_with_device_activity_7d"], int(recent))
                ages = {bucket["key"]: bucket["count"] for bucket in metrics["users_by_recent_device_age"]}
                self.assertEqual(ages["unknown"], int(not recent))
                # Invalid dates do not erase the observed user-device relationship.
                all_devices = await list_netskope_objects(self.pool, "device", "", 50, 0, freshness="all")
                self.assertEqual(all_devices["total"], 1)
                self.assertEqual(all_devices["rows"][0]["observed_user_status"], "matched")

    async def test_python_and_sql_agree_on_every_timestamp_and_boundary(self):
        for source_id, timestamp, _, _ in CASES:
            await seed_device(self.pool, source_id, {"last_event_timestamp": timestamp, "heartbeat": True})
        await seed_device(self.pool, "missing", {"heartbeat": False})
        await insert_netskope_run(self.pool, "completed", hours=1)
        reference = "%(as_of)s::timestamptz"
        rows = await fetch_all(self.pool, f"""
            WITH {SOURCE_EVIDENCE_CTES}
            SELECT source_id,
                   ({recent_device_condition(reference)}) AS recent,
                   ({stale_device_condition(reference)}) AS stale,
                   {_event_age_case(reference)} AS bucket,
                   {device_evidence_state_sql(reference)} AS state
            FROM public.cyberark_inventory_objects
            WHERE source_system = 'netskope' AND object_type = 'device'
        """, {"as_of": AS_OF})
        by_id = {row["source_id"]: row for row in rows}
        expected = {source_id: (state, bucket) for source_id, _, state, bucket in CASES}
        expected["missing"] = ("unknown", "unknown")
        self.assertEqual(set(by_id), set(expected))
        attributes_by_id = {source_id: {"last_event_timestamp": timestamp} for source_id, timestamp, _, _ in CASES}
        for source_id, (state, bucket) in expected.items():
            row = by_id[source_id]
            with self.subTest(source_id=source_id):
                self.assertEqual((row["state"], row["bucket"]), (state, bucket))
                # The Python projection evaluates the same attributes against the same instant.
                python = device_evidence({
                    "attributes": attributes_by_id.get(source_id, {}), "evidence_as_of": AS_OF,
                    "source_status": "completed", "source_completed_at": AS_OF - timedelta(hours=1),
                })
                self.assertEqual(python["state"], state)
                # Stale only for review; recent only for recent; an untrusted value is neither.
                self.assertEqual(bool(row["stale"]), state == "review")
                self.assertEqual(bool(row["recent"]), state == "recent")
                self.assertIs(row["stale"] is None, state == "unknown")

    async def test_the_card_counts_exactly_the_devices_its_drill_opens_with_the_widget_filters(self):
        now = datetime.now(timezone.utc)
        old = int((now - timedelta(days=45)).timestamp())
        recent = int(now.timestamp()) - 60
        await seed_device(self.pool, "win-old-a", {"last_event_timestamp": old, "os": "Windows", "classification_status": "managed", "username": "a@itti.digital"})
        await seed_device(self.pool, "win-old-b", {"last_event_timestamp": old - 9 * DAY, "os": "Windows", "classification_status": "unmanaged", "heartbeat": True})
        await seed_device(self.pool, "mac-old", {"last_event_timestamp": old, "os": "Mac", "classification_status": "managed"})
        await seed_device(self.pool, "win-recent", {"last_event_timestamp": recent, "os": "Windows"})
        await seed_device(self.pool, "win-future", {"last_event_timestamp": int(now.timestamp()) + 3 * DAY, "os": "Windows"})
        await seed_device(self.pool, "win-nodate", {"os": "Windows"})
        await seed_device(self.pool, "win-retired", {"last_event_timestamp": old, "os": "Windows"}, lifecycle_status="retired")
        await insert_netskope_run(self.pool, "completed", hours=1)

        for widget_filters, expected in (({}, 3), ({"os": "Windows"}, 2), ({"os": "Windows", "classification_status": "managed"}, 1), ({"os": "Linux"}, 0)):
            with self.subTest(filters=widget_filters):
                metrics = await get_netskope_metrics(self.pool, widget_filters, widgets=["devices_stale_30d"])
                self.assertEqual(metrics["devices_stale_30d"], expected)
                self.assertTrue(metrics["source_evidence"]["source_fresh"])
                drill = await list_netskope_objects(self.pool, "device", "", 50, 0, widget_filters, "gt_30d", freshness="all")
                review = await list_netskope_objects(self.pool, "device", "", 50, 0, widget_filters, evidence_state="review", freshness="all")
                self.assertEqual(drill["total"], expected)
                self.assertEqual({r["object_id"] for r in drill["rows"]}, {r["object_id"] for r in review["rows"]})
        # The card does not depend on the recent-devices population used by the other cards
        # (7 days; a timestamp in the future is no longer "recent" there either).
        full = await get_netskope_metrics(self.pool, {})
        self.assertEqual(full["devices_total"], 1)
        self.assertEqual(full["devices_stale_30d"], 3)

    async def test_the_card_keeps_counting_without_a_current_sync_but_says_so_and_the_review_is_unavailable(self):
        now = datetime.now(timezone.utc)
        await seed_device(self.pool, "old", {"last_event_timestamp": int((now - timedelta(days=60)).timestamp()), "os": "Windows"})
        for status, hours, fresh in (("completed", 1, True), ("completed", 30, False), ("partial", 1, False), ("failed", 1, False), ("running", 1, False)):
            with self.subTest(status=status, hours=hours):
                await reset_netskope_runs(self.pool)
                await insert_netskope_run(self.pool, status, hours=hours)
                metrics = await get_netskope_metrics(self.pool, {}, widgets=["devices_stale_30d"])
                self.assertEqual(metrics["devices_stale_30d"], 1)
                self.assertEqual(metrics["source_evidence"]["source_fresh"], fresh)
                freshness = await get_netskope_device_freshness(self.pool)
                self.assertEqual(freshness["review_candidates"], 1 if fresh else None)
                review = await list_netskope_objects(self.pool, "device", "", 50, 0, evidence_state="review", freshness="all")
                self.assertEqual(review["total"], 1 if fresh else 0)
                self.assertEqual(review["source_evidence"]["source_fresh"], fresh)
        await reset_netskope_runs(self.pool)
        none = await get_netskope_metrics(self.pool, {}, widgets=["devices_stale_30d"])
        self.assertFalse(none["source_evidence"]["source_fresh"])
        self.assertIsNone(none["source_evidence"]["source_status"])

    async def test_heartbeat_stays_in_the_raw_data_and_snapshots_but_no_longer_in_any_filter(self):
        now = datetime.now(timezone.utc)
        device_id = await seed_device(self.pool, "kept", {"last_event_timestamp": int(now.timestamp()) - 60, "heartbeat": True})
        row = (await list_netskope_objects(self.pool, "device", "", 50, 0, device_object_id=device_id))["rows"][0]
        self.assertIs(row["attributes"]["heartbeat"], True, "the raw attribute is still persisted")
        self.assertNotIn("heartbeat", row["device_evidence"])
        with self.assertRaises(TypeError):
            await list_netskope_objects(self.pool, "device", "", 50, 0, heartbeat="active")
