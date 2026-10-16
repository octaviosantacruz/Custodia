"""NSK-DLP-001: minimal DLP alert queries, retention and capture state,
evaluated by real PostgreSQL. Opt-in; see tests/support/pg_integration_base.py."""

import uuid

from psycopg.errors import CheckViolation
from datetime import datetime, timedelta, timezone

from app.netskope.sse.repositories.netskope_dlp_mutations import (
    persist_netskope_dlp_page,
    purge_netskope_dlp_alerts,
    record_netskope_dlp_capture_state,
    upsert_netskope_dlp_alerts,
)
from app.netskope.sse.api.routes.netskope_dlp_models import NetskopeDlpAlertRow
from app.netskope.sse.repositories.netskope_dlp_queries import (
    get_netskope_dlp_capture_state,
    get_netskope_dlp_policies,
    list_netskope_dlp_alerts,
)
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_dlp_alert, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase

T0 = datetime.now(timezone.utc).replace(microsecond=0)


class NetskopeDlpPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope_runs(self.pool)
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)

    async def test_user_resolution_is_exact_and_never_by_email_or_name(self):
        ada = await seed_netskope_user(self.pool, "u-1", "Ada", "ada@example.test")
        # Same tenant, different opaque ID: the email matching the event ID
        # must not resolve it.
        await seed_netskope_user(self.pool, "u-9", "Otro", "u-2@example.test")
        # Another source's object with the same source_id must never resolve.
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.cyberark_inventory_objects
                       (source_system, object_type, source_id, display_name, lifecycle_status, attributes)
                   VALUES ('cyberark', 'user', 'u-4', 'PAM u-4', 'active', '{}'::jsonb)"""
            )
        await seed_dlp_alert(self.pool, "7", T0, user_id="u-1")
        await seed_dlp_alert(self.pool, "8", T0, user_id="u-2")
        await seed_dlp_alert(self.pool, "9", T0, user_id="u-4")
        await seed_dlp_alert(self.pool, "10", T0, user_id="")

        result = await list_netskope_dlp_alerts(self.pool)
        by_id = {row["incident_id"]: row for row in result["rows"]}
        # The resolved user is nested exactly as the API contract (NetskopeDlpAlertRow) expects; no flat user_* leftovers.
        self.assertEqual(by_id["7"]["user"], {"object_id": ada, "display_name": "Ada", "email": "ada@example.test"})
        for row in result["rows"]:
            self.assertFalse({"user_object_id", "user_display_name", "user_email"} & set(row))
            NetskopeDlpAlertRow.model_validate(row)
        self.assertIsNone(by_id["8"]["user"])
        self.assertIsNone(by_id["9"]["user"])
        self.assertIsNone(by_id["10"]["user"])

    async def test_pagination_filters_and_resolution_split(self):
        await seed_netskope_user(self.pool, "u-1", "Ada", "ada@example.test")
        await seed_dlp_alert(self.pool, "1", T0 - timedelta(hours=3), severity="High", status="open", action="alert", policy="Policy A", user_id="u-1")
        await seed_dlp_alert(self.pool, "2", T0 - timedelta(hours=2), severity="Low", status="closed", action="block", policy="Policy B", user_id="u-1")
        await seed_dlp_alert(self.pool, "3", T0 - timedelta(hours=1), severity="High", status="open", action="alert", policy="Policy A", user_id="ghost")

        first = await list_netskope_dlp_alerts(self.pool, limit=2, offset=0)
        self.assertEqual(first["total"], 3)
        self.assertEqual([row["incident_id"] for row in first["rows"]], ["3", "2"])
        second = await list_netskope_dlp_alerts(self.pool, limit=2, offset=2)
        self.assertEqual([row["incident_id"] for row in second["rows"]], ["1"])

        severity = await list_netskope_dlp_alerts(self.pool, severity="High")
        self.assertEqual({row["incident_id"] for row in severity["rows"]}, {"1", "3"})
        policy = await list_netskope_dlp_alerts(self.pool, policy="Policy B")
        self.assertEqual([row["incident_id"] for row in policy["rows"]], ["2"])
        resolved = await list_netskope_dlp_alerts(self.pool, resolution="resolved")
        self.assertEqual({row["incident_id"] for row in resolved["rows"]}, {"1", "2"})
        unresolved = await list_netskope_dlp_alerts(self.pool, resolution="unresolved")
        self.assertEqual([row["incident_id"] for row in unresolved["rows"]], ["3"])
        exact_user = await list_netskope_dlp_alerts(self.pool, user_id="ghost")
        self.assertEqual([row["incident_id"] for row in exact_user["rows"]], ["3"])
        with self.assertRaises(ValueError):
            await list_netskope_dlp_alerts(self.pool, resolution="similar")

    async def test_policies_aggregate_volume_trend_and_mix_per_policy_name(self):
        await seed_dlp_alert(self.pool, "1", T0 - timedelta(days=1), severity="High", action="block", policy="Policy A", user_id="u-1")
        await seed_dlp_alert(self.pool, "2", T0 - timedelta(days=3), severity="High", action="alert", policy="Policy A", user_id="u-2")
        await seed_dlp_alert(self.pool, "3", T0 - timedelta(days=10), severity="Low", action="alert", policy="Policy A", user_id="u-3")
        await seed_dlp_alert(self.pool, "4", T0 - timedelta(days=2), severity="Low", action="alert", policy="Policy B", user_id="u-1")
        await seed_dlp_alert(self.pool, "5", T0 - timedelta(days=2), severity="Low", action="alert", policy="  ", user_id="u-1")
        # Outside the 30-day window: never counted.
        await seed_dlp_alert(self.pool, "old", T0 - timedelta(days=40), severity="High", policy="Policy A", user_id="u-1")

        result = await get_netskope_dlp_policies(self.pool)
        self.assertEqual(result["total_policies"], 2)
        self.assertEqual(result["unnamed_alerts"], 1)
        first, second = result["policies"]
        self.assertEqual((first["policy"], first["alert_count"], first["last_7d"], first["previous_7d"]), ("Policy A", 3, 2, 1))
        self.assertEqual(first["by_severity"], [{"key": "High", "count": 2}, {"key": "Low", "count": 1}])
        self.assertEqual(first["by_action"], [{"key": "alert", "count": 2}, {"key": "block", "count": 1}])
        self.assertEqual((second["policy"], second["alert_count"]), ("Policy B", 1))
        # The row carries no user or incident detail: only the policy name and counts.
        self.assertNotIn("user_id", first)
        self.assertNotIn("incident_id", first)

    async def test_policies_empty_when_nothing_was_captured(self):
        result = await get_netskope_dlp_policies(self.pool)
        self.assertEqual(result["policies"], [])
        self.assertEqual((result["total_policies"], result["unnamed_alerts"]), (0, 0))

    async def test_upsert_is_idempotent_and_an_older_event_never_overwrites(self):
        run_id = uuid.uuid4()
        newer = {
            "incident_id": "7", "event_timestamp": T0, "status": "open",
            "severity": "High", "policy": "Policy A", "action": "alert", "user_id": "u-1",
        }
        older = {**newer, "event_timestamp": T0 - timedelta(hours=2), "severity": "Low", "status": "closed"}
        await upsert_netskope_dlp_alerts(self.pool, run_id, [newer])
        await upsert_netskope_dlp_alerts(self.pool, run_id, [newer, older])

        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT incident_id, event_timestamp, severity, status FROM public.netskope_dlp_alerts"
            )
            rows = await cursor.fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["severity"], "High")
        self.assertEqual(rows[0]["status"], "open")
        self.assertEqual(rows[0]["event_timestamp"], T0)

        # A newer event for the same incident updates the row in place.
        refreshed = {**newer, "event_timestamp": T0 + timedelta(hours=1), "status": "closed"}
        await upsert_netskope_dlp_alerts(self.pool, run_id, [refreshed])
        result = await list_netskope_dlp_alerts(self.pool)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["status"], "closed")

    async def test_purge_removes_only_rows_older_than_retention(self):
        current = datetime.now(timezone.utc)
        await seed_dlp_alert(self.pool, "old", current - timedelta(days=31))
        await seed_dlp_alert(self.pool, "fresh", current - timedelta(days=29))
        deleted = await purge_netskope_dlp_alerts(self.pool, 30)
        self.assertEqual(deleted, 1)
        result = await list_netskope_dlp_alerts(self.pool)
        self.assertEqual([row["incident_id"] for row in result["rows"]], ["fresh"])

    async def test_capture_state_round_trip_and_update(self):
        run_id = uuid.uuid4()
        self.assertIsNone(await get_netskope_dlp_capture_state(self.pool))
        await record_netskope_dlp_capture_state(
            self.pool, iterator_index="index-1", coverage_start=T0 - timedelta(days=30),
            coverage_end=T0 - timedelta(hours=1), partial=True, scanned_events=25,
            captured_alerts=19, captured_at=T0, run_id=run_id,
        )
        state = await get_netskope_dlp_capture_state(self.pool)
        self.assertEqual(state["iterator_index"], "index-1")
        self.assertTrue(state["partial"])
        self.assertEqual(state["captured_alerts"], 19)

        await record_netskope_dlp_capture_state(
            self.pool, iterator_index="index-1", coverage_start=T0 - timedelta(days=30),
            coverage_end=T0, partial=False, scanned_events=10, captured_alerts=2,
            captured_at=T0 + timedelta(minutes=5), run_id=uuid.uuid4(),
        )
        state = await get_netskope_dlp_capture_state(self.pool)
        self.assertFalse(state["partial"])
        self.assertEqual(state["captured_alerts"], 2)
        self.assertEqual(state["coverage_end"], T0)

    async def test_page_and_checkpoint_commit_or_rollback_together(self):
        run_id = uuid.uuid4()
        alert = {
            "incident_id": "7", "event_timestamp": T0, "status": "open",
            "severity": "High", "policy": "Policy A", "action": "alert", "user_id": "u-1",
        }
        state = dict(iterator_index="atomic-index", coverage_start=T0 - timedelta(days=30),
                     coverage_end=T0, partial=True, scanned_events=1,
                     captured_alerts=1, captured_at=T0)
        # A real database constraint rejects the checkpoint after the upsert.
        with self.assertRaises(CheckViolation):
            await persist_netskope_dlp_page(self.pool, run_id, [alert], **{**state, "scanned_events": -1})
        self.assertEqual((await list_netskope_dlp_alerts(self.pool))["total"], 0)
        self.assertIsNone(await get_netskope_dlp_capture_state(self.pool))
        await persist_netskope_dlp_page(self.pool, run_id, [alert], **state)
        self.assertEqual((await list_netskope_dlp_alerts(self.pool))["total"], 1)
        self.assertEqual((await get_netskope_dlp_capture_state(self.pool))["coverage_end"], T0)

    async def test_inventory_listings_never_expose_dlp_alert_data(self):
        # The alert table is a separate concern: listing devices/users must not
        # join it (regression for the retired correlation).
        await seed_dlp_alert(self.pool, "7", T0, user_id="u-1")
        await seed_netskope_user(self.pool, "u-1", "Ada", "ada@example.test")
        from app.netskope.sse.repositories.netskope_queries import list_netskope_objects

        users = await list_netskope_objects(self.pool, "user", "", 50, 0)
        self.assertEqual(len(users["rows"]), 1)
        self.assertNotIn("alerts", users["rows"][0])
        self.assertNotIn("dlp", repr(users["rows"][0]))
