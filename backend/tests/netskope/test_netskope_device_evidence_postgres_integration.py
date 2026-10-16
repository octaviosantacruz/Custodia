"""Inventory evidence, exact-user filters and reappearance on disposable PG."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.netskope.sse.repositories.netskope_inventory import list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_device, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeDeviceEvidencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.now = datetime.now(timezone.utc)
        self.user = await seed_netskope_user(self.pool, "evidence-user", "Test user", "evidence@example.test")
        self.old = await seed_device(self.pool, "evidence-old", {"hostname": "NB-OLD", "username": " evidence@example.test ", "heartbeat": False, "last_event_timestamp": int((self.now - timedelta(days=45)).timestamp())})
        self.recent = await seed_device(self.pool, "evidence-recent", {"hostname": "NB-RECENT", "username": "evidence@example.test", "heartbeat": False, "last_event_timestamp": int((self.now - timedelta(days=1)).timestamp())})
        self.unknown = await seed_device(self.pool, "evidence-unknown", {"hostname": "NB-UNKNOWN", "username": "else@example.test", "heartbeat": False, "last_event_timestamp": "invalid"})

    async def run_source(self, status="completed", *, hours=1, source_file="netskope-api"):
        async with self.pool.connection() as conn:
            await conn.execute("""INSERT INTO public.cyberark_ingestion_runs
                (run_id, status, source_system, source_file, started_at, completed_at, triggered_by)
                VALUES (%s, %s, 'netskope', %s, %s, %s, 'test-suite')""",
                (uuid4(), status, source_file, self.now - timedelta(hours=hours), self.now - timedelta(hours=hours)))

    async def listing(self, **kwargs):
        return await list_netskope_objects(self.pool, "device", "", 50, 0, freshness="all", **kwargs)

    async def test_exact_person_filter_includes_old_devices_but_never_ambiguous_links(self):
        await self.run_source()
        page = await self.listing(observed_user_id=self.user)
        self.assertEqual({row["object_id"] for row in page["rows"]}, {self.old, self.recent})
        self.assertEqual({row["device_evidence"]["state"] for row in page["rows"]}, {"review", "recent"})
        empty_email_user = await seed_netskope_user(self.pool, "empty-email-user", "No email")
        empty_username_device = await seed_device(self.pool, "empty-username", {"username": "  "})
        self.assertEqual((await self.listing(observed_user_id=empty_email_user))["total"], 0)
        empty_row = (await self.listing(device_object_id=empty_username_device))["rows"][0]
        self.assertEqual(empty_row["observed_user_status"], "unmatched")
        await seed_netskope_user(self.pool, "duplicate-user", "Test duplicate", "evidence@example.test")
        self.assertEqual((await self.listing(observed_user_id=self.user))["total"], 0)

    async def test_filtered_counts_empty_pages_and_stale_source_do_not_invent_abandonment(self):
        self.assertEqual((await self.listing(evidence_state="unknown"))["total"], 3)
        await self.run_source(hours=2)
        page = await self.listing(evidence_state="review")
        self.assertEqual([row["object_id"] for row in page["rows"]], [self.old])
        self.assertEqual(page["total"], 1)
        empty = await list_netskope_objects(self.pool, "device", "", 1, 99, freshness="all", evidence_state="review")
        self.assertEqual(empty["rows"], [])
        self.assertEqual(empty["total"], 1)
        self.assertTrue(empty["source_evidence"]["source_fresh"])
        await self.run_source(hours=1, source_file="other-contract")
        self.assertEqual((await self.listing(evidence_state="review"))["total"], 1)
        await self.run_source("partial", hours=0)
        self.assertEqual((await self.listing(evidence_state="review"))["total"], 0)
        unknown = await self.listing(evidence_state="unknown")
        self.assertEqual(unknown["total"], 3)
        self.assertFalse(unknown["source_evidence"]["source_fresh"])
        await reset_netskope_runs(self.pool)
        await self.run_source(hours=25)
        self.assertEqual((await self.listing(evidence_state="unknown"))["total"], 3)

    async def test_invalid_signals_never_become_review_candidates_and_heartbeat_plays_no_part(self):
        await self.run_source()
        future = await seed_device(self.pool, "future", {"last_event_timestamp": int((self.now + timedelta(days=1)).timestamp()), "heartbeat": False})
        missing = await seed_device(self.pool, "missing", {"heartbeat": False})
        zero = await seed_device(self.pool, "zero", {"last_event_timestamp": 0})
        # NSK-HB-001: 60 days silent is a review candidate whatever the flag says, even a non-boolean one.
        silent = [
            await seed_device(self.pool, f"silent-{value}", {"last_event_timestamp": int((self.now - timedelta(days=60)).timestamp()), "heartbeat": value})
            for value in ("false", True, None)
        ]
        unknown = await self.listing(evidence_state="unknown")
        self.assertEqual({row["object_id"] for row in unknown["rows"]}, {self.unknown, future, missing, zero})
        self.assertTrue(all(row["device_evidence"]["state"] == "unknown" for row in unknown["rows"]))
        review = await self.listing(evidence_state="review")
        self.assertEqual({row["object_id"] for row in review["rows"]}, {self.old, *silent})
        self.assertTrue(all(row["device_evidence"]["state"] == "review" and "heartbeat" not in row["device_evidence"] for row in review["rows"]))
        self.assertEqual((await self.listing(evidence_state="not_recent"))["total"], 0)

    async def test_reappearance_changes_evidence_without_detaching_or_retiring(self):
        await self.run_source()
        before = (await self.listing(device_object_id=self.old))["rows"][0]
        self.assertEqual(before["device_evidence"]["state"], "review")
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.cyberark_inventory_objects SET attributes=jsonb_set(attributes, '{last_event_timestamp}', to_jsonb(%s::bigint)) WHERE object_id=%s", (int(self.now.timestamp()), self.old))
        after = (await self.listing(device_object_id=self.old))["rows"][0]
        self.assertEqual(after["device_evidence"]["state"], "recent")
        self.assertEqual(after["observed_user"], before["observed_user"])
        self.assertEqual(after["attributes"]["username"], before["attributes"]["username"])
        self.assertEqual(after["last_seen_at"], before["last_seen_at"])
