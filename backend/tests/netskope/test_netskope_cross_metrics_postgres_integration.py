"""NSK-XMET-001: cross user-device KPIs over the exact NSK-DEV-001 match.

Runs against the disposable Postgres database (tests/support/pg_integration_base.py).
The fixture builds one of every match state plus the edge cases the tracker
asks for: a user whose id and email are the same key (must count once), two
users sharing an email (ambiguous), a device with no user (unmatched), a user
with zero devices, and devices from the whole active inventory for the age
and coverage-risk groupings.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.netskope.sse.repositories import netskope_cross_metrics, netskope_metrics
from app.netskope.sse.repositories.netskope_cross_metrics import (
    get_netskope_cross_metrics, list_user_ids_by_device_stats,
)
from app.netskope.sse.repositories.netskope_inventory import list_netskope_objects
from app.netskope.sse.repositories.netskope_queries import get_netskope_metrics
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase


def _event_seconds(moment: datetime) -> int:
    return int(moment.timestamp())


class NetskopeCrossMetricsPostgresTests(PostgresIntegrationTestCase):
    async def test_widget_selection_preserves_scopes_and_reduces_real_sql(self):
        full = await get_netskope_metrics(self.pool)
        cases = (
            (None, 4, {"devices_total": 5, "devices_active_total": 8}),  # NSK-INV-002: the diagnosis split query is gone
            (["devices_total"], 1, {"devices_total": 5}),
            (["users_total"], 2, {"users_total": 5, "users_with_device_activity_7d": 2}),
            (["devices_by_os"], 2, {"devices_total": 5}),
            (["devices_by_os", "users_by_company"], 2, {"devices_total": 5, "users_total": 5}),
            (["devices_observed_user_matched"], 2, {"devices_observed_user_matched": 2, "devices_observed_user_ambiguous": 1}),
            (["users_recent_activity"], 2, {"users_with_device_activity_7d": 2}),
            (["devices_observed_user_matched", "users_recent_activity", "coverage_risk_devices_by_user"], 2, {"devices_observed_user_matched": 2, "users_with_device_activity_7d": 2, "devices_active_total": 8}),
            (["coverage_risk_devices_by_user"], 2, {"devices_active_total": 8}),
            (["devices_total", "devices_with_observed_user", "devices_by_os", "devices_by_user_status"], 2, {"devices_total": 5}),
            (["users_recent_activity", "devices_total", "devices_by_company", "users_by_company", "devices_by_os"], 3, {"devices_total": 5}),
        )
        for widgets, budget, expected in cases:
            with self.subTest(widgets=widgets), patch.object(
                netskope_metrics, "fetch_one", wraps=netskope_metrics.fetch_one,
            ) as base, patch.object(
                netskope_metrics, "fetch_all", wraps=netskope_metrics.fetch_all,
            ) as distributions, patch.object(
                netskope_cross_metrics, "fetch_one", wraps=netskope_cross_metrics.fetch_one,
            ) as cross_counts, patch.object(
                netskope_cross_metrics, "fetch_all", wraps=netskope_cross_metrics.fetch_all,
            ) as risk:
                selected = await get_netskope_metrics(self.pool, widgets=widgets)
                self.assertEqual(sum(query.await_count for query in (base, distributions, cross_counts, risk)), budget)
                for key, value in expected.items():
                    self.assertEqual(selected[key], value)
                for key, value in selected.items():
                    # The sync evidence carries the instant it was read at, so it differs between calls.
                    if key != "source_evidence":
                        self.assertEqual(value, full[key])
        # Selection and full response use the same parameterized filters.
        filtered_full = await get_netskope_metrics(self.pool, {"company": "example.com"})
        filtered = await get_netskope_metrics(self.pool, {"company": "example.com"}, widgets=["users_recent_activity", "users_by_company"])
        for key, value in filtered.items():
            if key != "source_evidence":
                self.assertEqual(value, filtered_full[key])

        # Independent bucket values catch crossed labels, lost scope and
        # per-metric Top-N errors that comparing selected/full alone cannot.
        for index in range(9):
            await seed_device(self.pool, f"distribution-{index}", {
                "last_event_timestamp": self.recent, "company": "distribution-only",
                "os": f"OS-{index}", "client_version": f"Client-{8 - index}",
            })
        await seed_device(self.pool, "distribution-old", {
            "last_event_timestamp": self.old, "company": "distribution-only", "os": "Excluded",
        })
        await seed_device(self.pool, "distribution-retired", {
            "last_event_timestamp": self.recent, "company": "distribution-only", "os": "Excluded",
        }, lifecycle_status="retired")
        await seed_netskope_user(self.pool, "distribution-user", "Distribution user", extra={"company": "distribution-only"})
        selected = await get_netskope_metrics(self.pool, {"company": "distribution-only"}, widgets=[
            "devices_by_os", "devices_by_client", "devices_by_company", "users_by_company",
        ])
        self.assertEqual(selected["devices_by_os"], [{"key": f"OS-{index}", "count": 1} for index in range(8)])
        self.assertEqual(selected["devices_by_client"], [{"key": f"Client-{index}", "count": 1} for index in range(8)])
        self.assertEqual(selected["devices_by_company"], [{"key": "distribution-only", "count": 9}])
        self.assertEqual(selected["users_by_company"], [{"key": "distribution-only", "count": 1}])
        for index in range(42):
            await seed_netskope_user(self.pool, f"company-user-{index}", "Company user", extra={"company": f"Company-{index:02d}"})
        companies = await get_netskope_metrics(self.pool, widgets=["users_by_company"])
        self.assertEqual(companies["users_by_company"], [{"key": "EXAMPLE", "count": 5}] + [
            {"key": f"Company-{index:02d}", "count": 1} for index in range(39)
        ])

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        now = datetime.now(timezone.utc)
        self.recent = _event_seconds(now - timedelta(hours=2))
        self.old = _event_seconds(now - timedelta(days=45))
        # Identities.
        self.user_a = await seed_netskope_user(self.pool, "uid-a", "Ada López", "ada@example.com")
        self.user_b = await seed_netskope_user(self.pool, "b@example.com", "Bruno Díaz", "b@example.com")
        self.user_c = await seed_netskope_user(self.pool, "uid-c", "Carla Ruiz", "shared@example.com")
        self.user_d = await seed_netskope_user(self.pool, "uid-d", "Diego Sosa", "shared@example.com")
        self.user_e = await seed_netskope_user(self.pool, "uid-e", "Elena Paz", "elena@example.com")
        # Devices: two matched, one ambiguous, two unmatched, plus inventory-wide
        # rows (old event, coverage-risk event) outside the recent scope.
        await seed_device(self.pool, "dev-a", {"hostname": "a-1", "username": "uid-a", "last_event_timestamp": self.recent})
        await seed_device(self.pool, "dev-b", {"hostname": "b-1", "username": "b@example.com", "last_event_timestamp": self.recent})
        await seed_device(self.pool, "dev-amb", {"hostname": "amb-1", "username": "shared@example.com", "last_event_timestamp": self.recent})
        await seed_device(self.pool, "dev-ghost", {"hostname": "ghost-1", "username": "ghost@example.com", "last_event_timestamp": self.recent})
        await seed_device(self.pool, "dev-empty", {"hostname": "empty-1", "username": "", "last_event_timestamp": self.recent})
        await seed_device(self.pool, "dev-old", {"hostname": "a-2", "username": "uid-a", "last_event_timestamp": self.old})
        await seed_device(self.pool, "dev-risk", {"hostname": "e-1", "username": "uid-e", "last_event_timestamp": self.old, "last_seen_event": "Uninstalled"})
        await seed_device(self.pool, "dev-unknown", {"hostname": "c-1", "username": "uid-c", "last_seen_event": "Admin Disabled"})

    async def test_distributions_share_one_observation_when_inventory_changes(self):
        original = netskope_metrics.fetch_all
        sync_started = False
        committed = asyncio.Event()

        async def read_then_sync(pool, query, params=()):
            nonlocal sync_started
            if sync_started:
                await committed.wait()
                return await original(pool, query, params)
            sync_started = True
            rows = await original(pool, query, params)
            await seed_device(self.pool, "distribution-later", {
                "last_event_timestamp": self.recent, "os": "Later OS",
                "client_version": "Later client", "company": "later-company",
            })
            committed.set()
            return rows

        with patch.object(netskope_metrics, "fetch_all", side_effect=read_then_sync):
            metrics = await get_netskope_metrics(self.pool, widgets=["devices_by_os", "devices_by_client", "devices_by_company"])
        self.assertTrue(committed.is_set())
        for field in ("devices_by_os", "devices_by_client", "devices_by_company"):
            expected = [{"key": "EXAMPLE", "count": 3}, {"key": "Sin dato", "count": 2}] if field == "devices_by_company" else [{"key": "Sin dato", "count": 5}]
            self.assertEqual(metrics[field], expected)
        next_observation = await get_netskope_metrics(self.pool, widgets=["devices_by_client"])
        self.assertEqual(sum(bucket["count"] for bucket in next_observation["devices_by_client"]), 6)

    async def test_cross_metrics_share_one_observation_when_inventory_changes(self):
        original = netskope_cross_metrics.fetch_one
        committed = False

        async def read_then_sync(pool, query, params=()):
            nonlocal committed
            result = await original(pool, query, params)
            if not committed:
                committed = True
                await seed_device(pool, "dev-new-sync", {
                    "username": "uid-a", "last_event_timestamp": self.recent,
                })
            return result

        with patch.object(netskope_cross_metrics, "fetch_one", new=read_then_sync):
            metrics = await get_netskope_cross_metrics(self.pool)

        self.assertEqual(metrics["devices_observed_user_matched"], 2)
        self.assertEqual(metrics["devices_active_total"], 8)
        self.assertEqual(metrics["users_by_device_count"], [
            {"key": "0", "count": 1}, {"key": "1", "count": 3}, {"key": "2plus", "count": 1},
        ])

    async def test_device_coverage_counts_the_three_match_states(self):
        metrics = await get_netskope_cross_metrics(self.pool)
        # Recent scope: dev-a, dev-b (matched), dev-amb (ambiguous), dev-ghost
        # and dev-empty (unmatched).
        self.assertEqual(metrics["devices_observed_user_matched"], 2)
        self.assertEqual(metrics["devices_observed_user_ambiguous"], 1)
        self.assertEqual(metrics["devices_observed_user_unmatched"], 2)
        self.assertEqual(metrics["devices_by_observed_user_status"], [
            {"key": "matched", "count": 2},
            {"key": "ambiguous", "count": 1},
            {"key": "unmatched", "count": 2},
        ])
        # Denominator of the whole-inventory groupings, not the recent scope.
        self.assertEqual(metrics["devices_active_total"], 8)

    async def test_users_by_device_count_and_newest_device_age(self):
        metrics = await get_netskope_cross_metrics(self.pool)
        # Whole active inventory: Ada (uid-a) has dev-a + dev-old, Bruno has
        # dev-b, Carla dev-unknown, Elena dev-risk; Diego has none and the
        # ambiguous shared@example.com device resolves to no one.
        self.assertEqual(metrics["users_by_device_count"], [
            {"key": "0", "count": 1},
            {"key": "1", "count": 3},
            {"key": "2plus", "count": 1},
        ])
        self.assertEqual(metrics["users_without_observed_devices"], 1)

    async def test_users_by_recent_device_age_uses_the_newest_event(self):
        metrics = await get_netskope_cross_metrics(self.pool)
        by_key = {bucket["key"]: bucket["count"] for bucket in metrics["users_by_recent_device_age"]}
        self.assertEqual(by_key["lt_24h"], 2)   # Ada and Bruno (recent events)
        self.assertEqual(by_key["gt_30d"], 1)   # Elena (45-day-old event)
        self.assertEqual(by_key["unknown"], 1)  # Carla (no numeric timestamp)
        self.assertEqual(by_key["d1_7"], 0)
        self.assertEqual(by_key["d7_30"], 0)

    async def test_metrics_count_users_with_device_activity_in_7_14_and_30_days(self):
        await seed_netskope_user(self.pool, "uid-14d", "Usuario 14 días", "14d@example.com")
        await seed_netskope_user(self.pool, "uid-30d", "Usuario 30 días", "30d@example.com")
        await seed_device(self.pool, "dev-14d", {
            "hostname": "device-14d", "username": "uid-14d",
            "last_event_timestamp": _event_seconds(datetime.now(timezone.utc) - timedelta(days=10)),
        })
        await seed_device(self.pool, "dev-30d", {
            "hostname": "device-30d", "username": "uid-30d",
            "last_event_timestamp": _event_seconds(datetime.now(timezone.utc) - timedelta(days=20)),
        })

        metrics = await get_netskope_metrics(self.pool)

        self.assertEqual(metrics["users_with_device_activity_7d"], 2)
        self.assertEqual(metrics["users_with_device_activity_14d"], 3)
        self.assertEqual(metrics["users_with_device_activity_30d"], 4)

    async def test_activity_list_matches_every_card_window_and_orders_by_newest(self):
        now = datetime.now(timezone.utc)
        await seed_netskope_user(self.pool, "uid-14d", "Usuario 14 días", "14d@example.com")
        await seed_netskope_user(self.pool, "uid-30d", "Usuario 30 días", "30d@example.com")
        await seed_device(self.pool, "dev-14d", {"hostname": "device-14d", "username": "uid-14d", "last_event_timestamp": _event_seconds(now - timedelta(days=10))})
        await seed_device(self.pool, "dev-30d", {"hostname": "device-30d", "username": "30d@example.com", "last_event_timestamp": _event_seconds(now - timedelta(days=20))})
        metrics = await get_netskope_metrics(self.pool)

        for days in (7, 14, 30):
            with self.subTest(days=days):
                result = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=days)
                self.assertEqual(result["total"], metrics[f"users_with_device_activity_{days}d"])
                self.assertEqual(len(result["rows"]), result["total"])
                self.assertEqual(result["activity_days"], days)
        ordered = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=30)
        self.assertEqual([row["display_name"] for row in ordered["rows"]], ["Ada López", "Bruno Díaz", "Usuario 14 días", "Usuario 30 días"])  # Ada/Bruno tie on event: object_id
        # No duplicates, and paging keeps the activity order.
        page = await list_netskope_objects(self.pool, "user", "", 2, 2, activity_days=30)
        self.assertEqual([row["display_name"] for row in page["rows"]], ["Usuario 14 días", "Usuario 30 días"])
        self.assertEqual(page["total"], 4)

    async def test_activity_list_reports_devices_latest_device_and_exact_match_basis(self):
        result = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=7)
        rows = {row["display_name"]: row["device_activity"] for row in result["rows"]}
        # Ada matches by source_id with two devices (recent + 45 days old).
        self.assertEqual(rows["Ada López"]["device_count"], 2)
        self.assertEqual(rows["Ada López"]["latest_device"], "a-1")
        self.assertEqual(rows["Ada López"]["match_basis"], ["source_id"])
        self.assertIsNotNone(rows["Ada López"]["latest_event"])
        # Bruno's source_id and email are the same key: one device, both bases.
        self.assertEqual(rows["Bruno Díaz"]["device_count"], 1)
        self.assertEqual(rows["Bruno Díaz"]["match_basis"], ["source_id", "email"])

    async def test_activity_list_excludes_missing_timestamp_ambiguous_and_stale_users(self):
        result = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=30)
        names = {row["display_name"] for row in result["rows"]}
        self.assertEqual(names, {"Ada López", "Bruno Díaz"})  # Carla: no timestamp; Elena: 45 days; Carla/Diego: ambiguous email
        with self.assertRaises(ValueError):
            await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=5)
        with self.assertRaises(ValueError):
            await list_netskope_objects(self.pool, "device", "", 50, 0, activity_days=7)

    async def test_activity_list_respects_the_boundary_and_search(self):
        now = datetime.now(timezone.utc)
        await seed_netskope_user(self.pool, "uid-edge", "Usuario borde", "edge@example.com")
        await seed_device(self.pool, "dev-edge", {"hostname": "edge-1", "username": "uid-edge", "last_event_timestamp": _event_seconds(now - timedelta(days=7, minutes=1))})
        seven = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=7)
        fourteen = await list_netskope_objects(self.pool, "user", "", 50, 0, activity_days=14)
        self.assertNotIn("Usuario borde", {row["display_name"] for row in seven["rows"]})
        self.assertIn("Usuario borde", {row["display_name"] for row in fourteen["rows"]})
        searched = await list_netskope_objects(self.pool, "user", "borde", 50, 0, activity_days=14)
        self.assertEqual([row["display_name"] for row in searched["rows"]], ["Usuario borde"])

    async def test_coverage_risk_devices_grouped_by_resolved_user(self):
        metrics = await get_netskope_cross_metrics(self.pool)
        self.assertEqual(metrics["coverage_risk_devices_by_user"], [
            {"key": "Carla Ruiz", "count": 1, "filter_value": "uid-c"},
            {"key": "Elena Paz", "count": 1, "filter_value": "uid-e"},
        ])

    async def test_user_filters_resolve_to_the_same_users_the_kpi_counts(self):
        self.assertEqual(await list_user_ids_by_device_stats(self.pool, device_count="0"), [self.user_d])
        self.assertEqual(await list_user_ids_by_device_stats(self.pool, device_count="1"), [self.user_b, self.user_c, self.user_e])
        self.assertEqual(await list_user_ids_by_device_stats(self.pool, device_count="2plus"), [self.user_a])
        self.assertEqual(await list_user_ids_by_device_stats(self.pool, recent_device_age="gt_30d"), [self.user_e])
        self.assertEqual(await list_user_ids_by_device_stats(self.pool, recent_device_age="unknown"), [self.user_c])

    async def test_inventory_filters_show_the_same_rows_as_the_kpis(self):
        matched = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"observed_user_status": "matched"})
        self.assertEqual(matched["total"], 2)
        self.assertEqual({row["source_id"] for row in matched["rows"]}, {"dev-a", "dev-b"})

        ambiguous = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"observed_user_status": "ambiguous"})
        self.assertEqual([row["source_id"] for row in ambiguous["rows"]], ["dev-amb"])

        ada_all = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"observed_user": "uid-a"}, freshness="all")
        self.assertEqual({row["source_id"] for row in ada_all["rows"]}, {"dev-a", "dev-old"})
        ada_recent = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"observed_user": "uid-a"})
        self.assertEqual([row["source_id"] for row in ada_recent["rows"]], ["dev-a"])

        risk = await list_netskope_objects(self.pool, "device", "", 50, 0, coverage_risk="1", freshness="all")
        self.assertEqual([row["source_id"] for row in risk["rows"]], ["dev-unknown", "dev-risk"])

        without_devices = await list_netskope_objects(self.pool, "user", "", 50, 0, device_count="0")
        self.assertEqual([row["source_id"] for row in without_devices["rows"]], ["uid-d"])
        old_devices = await list_netskope_objects(self.pool, "user", "", 50, 0, recent_device_age="gt_30d")
        self.assertEqual([row["source_id"] for row in old_devices["rows"]], ["uid-e"])

    async def test_filters_support_the_metrics_widget_filters(self):
        metrics = await get_netskope_cross_metrics(self.pool, {"os": "Windows"})
        # No device carries an OS attribute in this fixture: every count is 0,
        # which proves the filter reached the device side of the match.
        self.assertEqual(metrics["devices_observed_user_matched"], 0)
        self.assertEqual(metrics["users_without_observed_devices"], 5)

    async def test_cross_metrics_avoid_quadratic_user_device_plan_at_inventory_scale(self):
        """A few fixture rows cannot expose PostgreSQL's former nested loop.

        The regression was 8.9k users x a repeated device-table scan, making
        the summary take minutes. This scaled, set-based fixture protects the
        observable endpoint budget without asserting a particular SQL string
        or planner node.
        """
        async with self.pool.connection() as conn:
            await conn.execute("""
                INSERT INTO public.cyberark_inventory_objects
                    (source_system, object_type, source_id, display_name,
                     lifecycle_status, data_quality_status, attributes)
                SELECT 'netskope', 'user', 'perf-user-' || n,
                       'Performance user ' || n, 'active', 'clean',
                       jsonb_build_object('email', 'perf-user-' || n || '@example.com')
                FROM generate_series(1, 4000) AS n
            """)
            await conn.execute("""
                INSERT INTO public.cyberark_inventory_objects
                    (source_system, object_type, source_id, display_name,
                     lifecycle_status, data_quality_status, attributes)
                SELECT 'netskope', 'device', 'perf-device-' || n,
                       'Performance device ' || n, 'active', 'clean',
                       jsonb_build_object(
                           'username', 'perf-user-' || n,
                           'last_event_timestamp', extract(epoch FROM now())::bigint,
                           'last_seen_event', CASE WHEN n <= 200 THEN 'Uninstalled' ELSE 'Connected' END
                       )
                FROM generate_series(1, 4000) AS n
            """)
            await conn.execute("ANALYZE public.cyberark_inventory_objects")

        metrics = await asyncio.wait_for(get_netskope_cross_metrics(self.pool), timeout=4.0)

        self.assertEqual(len(metrics["coverage_risk_devices_by_user"]), 10)
