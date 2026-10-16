"""Reporting is an executable SQL read contract, isolated from raw payloads and writes."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from psycopg import sql
from psycopg.errors import InsufficientPrivilege, ObjectNotInPrerequisiteState

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import get_netskope_source_evidence
from app.netskope.sse.device_evidence import SOURCE_FRESHNESS_HOURS, device_evidence
from tests.support.netskope_pg_fixtures import (
    insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device, seed_device_review,
)
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class ReportingViewsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self._clean()
        self.addAsyncCleanup(self._clean)

    async def _clean(self):
        await fetch_all(self.pool, "DELETE FROM public.access_audit_log WHERE entity_type = 'netskope_device_review' RETURNING 1")
        await reset_netskope(self.pool)
        await reset_netskope_runs(self.pool)

    async def test_device_projection_has_valid_event_dates_and_only_active_netskope_devices(self):
        timestamp = int((datetime.now(timezone.utc) - timedelta(days=31)).timestamp())
        device = await seed_device(self.pool, "reporting-device", {
            "hostname": "example", "username": "ops@example.test", "os": "Windows",
            "last_event_timestamp": timestamp, "last_seen_event": "Tunnel Down",
            "heart_beat": True, "raw_private_field": "not exposed",
        })
        await seed_device(self.pool, "retired", {}, lifecycle_status="retired")
        await seed_device(self.pool, "user", {}, object_type="user")
        async with self.pool.connection() as conn:
            async with conn.transaction(force_rollback=True):
                await conn.execute("""INSERT INTO public.cyberark_inventory_objects
                    (source_system, object_type, source_id, display_name)
                    VALUES ('cyberark', 'device', 'reporting-pam', 'Other source')""")
                rows = await fetch_all(self.pool, "SELECT * FROM reporting.netskope_devices WHERE object_id = %s", (device,))
                row = rows[0]
                self.assertEqual((row["device_id"], row["company"], row["os"]), ("reporting-device", "EXAMPLE", "Windows"))
                self.assertEqual(row["last_event_at"], datetime.fromtimestamp(timestamp, timezone.utc))
                self.assertGreater(row["event_age_days"], 30)
                self.assertNotEqual(row["inventory_observed_at"], row["last_event_at"])
                self.assertTrue({"attributes", "heart_beat", "raw_private_field", "guid", "user_key"}.isdisjoint(row))
                # Query in the same transaction to include the other-source negative control.
                result = await conn.execute("SELECT object_id FROM reporting.netskope_devices")
                self.assertEqual([r["object_id"] for r in await result.fetchall()], [device])
        for name, value in (("missing", None), ("text", "123"), ("zero", 0), ("negative", -1), ("bool", True), ("future", timestamp + 32 * 86400)):
            with self.subTest(name=name):
                attrs = {} if value is None else {"last_event_timestamp": value}
                object_id = await seed_device(self.pool, name, attrs)
                row = await fetch_one(self.pool, "SELECT last_event_at, event_age_days FROM reporting.netskope_devices WHERE object_id = %s", (object_id,))
                self.assertIsNone(row["last_event_at"])
                self.assertIsNone(row["event_age_days"])
                self.assertIsNone(device_evidence({"attributes": attrs})["last_signal_at"])

    async def test_review_projection_keeps_unclassified_devices_and_effective_expired_status(self):
        plain = await seed_device(self.pool, "plain", {})
        expired = await seed_device(self.pool, "expired", {})
        expiry = datetime.now(timezone.utc) + timedelta(hours=1)
        await seed_device_review(self.pool, expired, {
            "diagnosis": "temporary_exception", "status": "resolved", "owner": "Ops",
            "reference": "CHG-EXAMPLE", "note": "Review evidence", "exception_expires_at": expiry,
        }, "reviewer")
        # A valid saved exception later expires; do not bypass the API's future-date validation.
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.netskope_device_reviews SET exception_expires_at = now() - interval '1 hour' WHERE object_id = %s", (expired,))
        row = await fetch_one(self.pool, "SELECT * FROM reporting.netskope_device_reviews WHERE object_id = %s", (plain,))
        self.assertEqual((row["review_saved"], row["diagnosis"], row["effective_status"]), (False, "undetermined", None))
        row = await fetch_one(self.pool, "SELECT * FROM reporting.netskope_device_reviews WHERE object_id = %s", (expired,))
        self.assertEqual((row["stored_status"], row["effective_status"], row["exception_expired"]), ("resolved", "pending", True))
        self.assertEqual((row["owner"], row["reference"], row["decided_by"]), ("Ops", "CHG-EXAMPLE", "reviewer"))
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE public.cyberark_inventory_objects SET lifecycle_status = 'retired' WHERE object_id = %s", (expired,))
        self.assertIsNone(await fetch_one(self.pool, "SELECT object_id FROM reporting.netskope_device_reviews WHERE object_id = %s", (expired,)))
        self.assertIsNotNone(await fetch_one(self.pool, "SELECT object_id FROM public.netskope_device_reviews WHERE object_id = %s", (expired,)))

    async def test_sync_projection_matches_api_and_does_not_hide_failed_runs_with_other_flows(self):
        missing = await fetch_one(self.pool, "SELECT * FROM reporting.source_sync_status WHERE source_system = 'netskope' AND source_file = 'netskope-api'")
        self.assertEqual((missing["run_id"], missing["source_fresh"]), (None, False))
        for status, hours, fresh in (("completed", 48, False), ("completed", 23.999, True), ("completed", 24.001, False), ("completed", 1, True), ("partial", .8, False), ("failed", .6, False), ("running", .4, False), ("completed", -.1, False)):
            with self.subTest(status=status, hours=hours):
                await reset_netskope_runs(self.pool)
                run_id = await insert_netskope_run(self.pool, status, hours=hours)
                await insert_netskope_run(self.pool, "completed", hours=hours - .01, source_file="reporting-other-flow")
                row = await fetch_one(self.pool, "SELECT * FROM reporting.source_sync_status WHERE source_system = 'netskope' AND source_file = 'netskope-api'")
                evidence = await get_netskope_source_evidence(self.pool)
                self.assertEqual((row["run_id"], row["status"], row["source_fresh"]), (run_id, status, fresh))
                self.assertEqual(row["freshness_hours"], SOURCE_FRESHNESS_HOURS)
                self.assertEqual((row["source_fresh"], row["completed_at"]), (evidence["source_fresh"], evidence["source_completed_at"]))
                other = await fetch_one(self.pool, "SELECT * FROM reporting.source_sync_status WHERE source_system = 'netskope' AND source_file = 'reporting-other-flow'")
                self.assertIsNone(other["source_fresh"])
                self.assertIsNone(other["freshness_hours"])

    async def test_sql_reader_needs_explicit_grants_and_cannot_read_base_tables_or_write_views(self):
        await seed_device(self.pool, "readonly", {})
        role = sql.Identifier("reporting_test_" + uuid4().hex)
        async with self.pool.connection() as conn:
            async with conn.transaction(force_rollback=True):
                await conn.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(role))
                await conn.execute(sql.SQL("SET LOCAL ROLE {}").format(role))
                with self.assertRaises(InsufficientPrivilege):
                    async with conn.transaction():
                        await conn.execute("SELECT * FROM reporting.netskope_devices")
                await conn.execute("RESET ROLE")
                await conn.execute(sql.SQL("GRANT USAGE ON SCHEMA reporting TO {}").format(role))
                await conn.execute(sql.SQL("GRANT SELECT ON reporting.netskope_devices TO {}").format(role))
                await conn.execute(sql.SQL("SET LOCAL ROLE {}").format(role))
                result = await conn.execute("SELECT device_id FROM reporting.netskope_devices")
                self.assertEqual([r["device_id"] for r in await result.fetchall()], ["readonly"])
                for query in ("SELECT * FROM public.cyberark_inventory_objects", "SELECT * FROM reporting.netskope_device_reviews"):
                    with self.subTest(query=query), self.assertRaises(InsufficientPrivilege):
                        async with conn.transaction():
                            await conn.execute(query)
                result = await conn.execute("SELECT has_table_privilege(current_user, 'reporting.netskope_devices', 'UPDATE') AS writable")
                self.assertFalse((await result.fetchone())["writable"])
                with self.assertRaises(ObjectNotInPrerequisiteState):
                    async with conn.transaction():
                        await conn.execute("UPDATE reporting.netskope_devices SET hostname = 'changed'")
                await conn.execute("RESET ROLE")
                # The owner cannot accidentally bypass audited mutation routes through a view either.
                for view, column in (("netskope_devices", "hostname"), ("netskope_device_reviews", "note"), ("source_sync_status", "status")):
                    with self.subTest(view=view), self.assertRaises(ObjectNotInPrerequisiteState):
                        async with conn.transaction():
                            await conn.execute(sql.SQL("UPDATE reporting.{} SET {} = 'changed'").format(sql.Identifier(view), sql.Identifier(column)))
