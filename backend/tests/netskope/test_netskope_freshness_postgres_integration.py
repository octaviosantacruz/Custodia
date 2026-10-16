"""NSK-DEV-003: report-freshness buckets evaluated by real PostgreSQL, so
the bucket edges, the epoch-seconds conversion and the missing/non-numeric
cases are proven instead of inferred from an SQL string. Opt-in; see
tests/support/pg_integration_base.py."""

from datetime import datetime, timedelta, timezone

from app.netskope.sse.repositories.netskope_queries import get_netskope_device_freshness, list_netskope_objects
from tests.support.netskope_pg_fixtures import insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase

AS_OF = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)


def epoch(delta: timedelta) -> int:
    return int((AS_OF - delta).timestamp())


class NetskopeFreshnessPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_bucket_edges_classification_and_untrusted_timestamps(self):
        cases = {
            "exactly-24h": ({"last_event_timestamp": epoch(timedelta(hours=24)), "heartbeat": True}, "lt_24h"),
            "just-over-24h": ({"last_event_timestamp": epoch(timedelta(hours=24, seconds=1)), "heartbeat": True}, "d1_7"),
            "exactly-7d": ({"last_event_timestamp": epoch(timedelta(days=7)), "heartbeat": False}, "d1_7"),
            "exactly-30d": ({"last_event_timestamp": epoch(timedelta(days=30)), "heartbeat": False}, "d7_30"),
            "over-30d": ({"last_event_timestamp": epoch(timedelta(days=45)), "heartbeat": False, "classification_status": "managed"}, "gt_30d"),
            "over-30d-heartbeat-true": ({"last_event_timestamp": epoch(timedelta(days=90)), "heartbeat": True}, "gt_30d"),
            "missing": ({"heartbeat": False}, "unknown"),
            "json-null": ({"last_event_timestamp": None}, "unknown"),
            "string": ({"last_event_timestamp": "1758000000"}, "unknown"),
            # NSK-HB-001: a timestamp that cannot be trusted is unknown, never fresh or stale.
            # DEM heartbeats are stamped slightly ahead: up to one hour counts as reported now, beyond it is untrusted.
            "future-within-tolerance": ({"last_event_timestamp": epoch(-timedelta(minutes=50))}, "lt_24h"),
            "future-beyond-tolerance": ({"last_event_timestamp": epoch(-timedelta(hours=1, seconds=5))}, "unknown"),
            "zero": ({"last_event_timestamp": 0}, "unknown"),
            "negative": ({"last_event_timestamp": -5}, "unknown"),
        }
        for source_id, (attributes, _) in cases.items():
            await seed_device(self.pool, source_id, attributes)
        # Retired devices and users never count.
        await seed_device(self.pool, "retired", {"last_event_timestamp": epoch(timedelta(days=90))}, lifecycle_status="retired")
        await seed_device(self.pool, "a-user", {"email": "a@example.com"}, object_type="user")

        result = await get_netskope_device_freshness(self.pool, as_of=AS_OF)

        by_key = {bucket["key"]: bucket for bucket in result["buckets"]}
        self.assertEqual([bucket["key"] for bucket in result["buckets"]], ["lt_24h", "d1_7", "d7_30", "gt_30d", "unknown"])
        expected_counts = {"lt_24h": 2, "d1_7": 2, "d7_30": 1, "gt_30d": 2, "unknown": 6}
        self.assertEqual({key: bucket["count"] for key, bucket in by_key.items()}, expected_counts)
        self.assertEqual(result["total"], 13)
        for bucket in result["buckets"]:
            self.assertEqual(set(bucket), {"key", "label", "count", "by_classification"}, "no heartbeat series in the buckets")
        self.assertIn({"key": "managed", "count": 1}, by_key["gt_30d"]["by_classification"])
        self.assertEqual(result["thresholds"], {"recent_hours": 24, "week_days": 7, "stale_days": 30})
        # No Netskope run has been recorded: the evaluation is unavailable, not a count.
        self.assertFalse(result["source_evidence"]["source_fresh"])
        self.assertIsNone(result["review_candidates"])

    async def test_review_candidates_need_a_complete_recent_sync(self):
        now = datetime.now(timezone.utc)
        await seed_device(self.pool, "stale-a", {"last_event_timestamp": int((now - timedelta(days=40)).timestamp())})
        await seed_device(self.pool, "stale-b", {"last_event_timestamp": int((now - timedelta(days=200)).timestamp()), "heartbeat": True})
        await seed_device(self.pool, "recent", {"last_event_timestamp": int(now.timestamp()) - 60})
        for status, hours, fresh in (("completed", 1, True), ("completed", 25, False), ("partial", 1, False), ("failed", 1, False), ("running", 1, False)):
            with self.subTest(status=status, hours=hours):
                await reset_netskope_runs(self.pool)
                await insert_netskope_run(self.pool, status, hours=hours)
                result = await get_netskope_device_freshness(self.pool)
                self.assertEqual(result["source_evidence"]["source_fresh"], fresh)
                self.assertEqual(result["source_evidence"]["source_status"], status)
                # The age buckets stay visible as an observation either way.
                self.assertEqual({b["key"]: b["count"] for b in result["buckets"]}["gt_30d"], 2)
                self.assertEqual(result["review_candidates"], 2 if fresh else None)
                # The callout number and the inventory it opens are the same population, or the review is unavailable.
                review = await list_netskope_objects(self.pool, "device", "", 50, 0, evidence_state="review", freshness="all")
                self.assertEqual(review["total"], result["review_candidates"] or 0)

    async def test_event_age_filter_returns_the_same_devices_as_the_bucket(self):
        now = datetime.now(timezone.utc)
        await seed_device(self.pool, "fresh", {"last_event_timestamp": int(now.timestamp()) - 60})
        await seed_device(self.pool, "stale", {"last_event_timestamp": int((now - timedelta(days=40)).timestamp()), "heartbeat": False})
        await seed_device(self.pool, "unknown", {})

        stale = await list_netskope_objects(self.pool, "device", "", 50, 0, None, "gt_30d", freshness="all")
        unknown = await list_netskope_objects(self.pool, "device", "", 50, 0, None, "unknown", freshness="all")

        self.assertEqual([row["source_id"] for row in stale["rows"]], ["stale"])
        self.assertEqual([row["source_id"] for row in unknown["rows"]], ["unknown"])
