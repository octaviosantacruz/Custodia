"""NSK-EXP-UCI-001 on real PostgreSQL: devices cross with the UCI of their user, the grouped fleet and the inventory
drill agree, and without a UCI capture the value is "Sin dato", never "Sin alerta". Opt-in; see
tests/support/pg_integration_base.py."""

from datetime import datetime, timezone

from app.netskope.sse.repositories.netskope_baselines import save_netskope_baseline
from app.netskope.sse.repositories.netskope_fleet_groups import get_netskope_fleet_groups
from app.netskope.sse.repositories.netskope_inventory import get_netskope_device_facets
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase

DAY = 86400


class NetskopeUciExperiencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await self._set_uci([])
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(self._set_uci, [])

    async def _set_uci(self, rows):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.netskope_user_uci")
            for email, rating, score in rows:
                await conn.execute(
                    "INSERT INTO public.netskope_user_uci (email_key, rating, score, scored_at) VALUES (%s, %s, %s, now())",
                    (email, rating, score),
                )

    async def seed(self):
        now = datetime.now(timezone.utc).timestamp()
        recent, stale = now - 3600, now - 40 * DAY
        rows = [
            ("a", {"onprem_status": "on-prem", "username": "Ana@acme.test"}, recent),    # office, Poor (case-insensitive match)
            ("b", {"onprem_status": "on-prem", "username": "bea@acme.test"}, recent),    # office, Moderate
            ("c", {"onprem_status": "on-prem", "username": "cris@acme.test"}, recent),   # office, no alert
            ("d", {"onprem_status": "off-prem", "username": "ana@acme.test"}, recent),   # remote, Poor (second device)
            ("e", {"onprem_status": "off-prem", "username": "eli@acme.test"}, recent),   # remote, no alert
            ("f", {"onprem_status": "on-prem"}, recent),                                 # no username: no alert, not a match
            ("g", {"onprem_status": "on-prem", "username": "ana@acme.test"}, stale),     # not recent: outside the population
        ]
        for source_id, attributes, timestamp in rows:
            await seed_device(self.pool, source_id, {**attributes, "last_event_timestamp": timestamp})
        await self._set_uci([("ana@acme.test", "Poor", 300), ("bea@acme.test", "Moderate", 500)])

    async def test_without_a_uci_capture_the_value_is_unknown_not_clean(self):
        await self.seed()
        await self._set_uci([])
        groups = await get_netskope_fleet_groups(self.pool, "uci_rating")
        self.assertEqual([(g["key"], g["devices"]) for g in groups["groups"]], [("Sin dato", 6)])
        self.assertEqual(groups["summary"]["uci_evaluated"], 0)
        self.assertEqual(groups["summary"]["on_prem_uci_low"], 0)

    async def test_the_crossing_counts_equal_the_inventory_drills(self):
        await self.seed()
        by_place = await get_netskope_fleet_groups(self.pool, "onprem_status")
        rows = {g["key"]: g for g in by_place["groups"]}
        self.assertEqual((rows["on-prem"]["devices"], rows["on-prem"]["uci_low"], rows["on-prem"]["uci_moderate"], rows["on-prem"]["on_prem_uci_low"]), (4, 1, 1, 1))
        self.assertEqual((rows["off-prem"]["devices"], rows["off-prem"]["uci_low"], rows["off-prem"]["on_prem_uci_low"]), (2, 1, 0))
        self.assertEqual(by_place["summary"]["uci_evaluated"], 6)
        self.assertEqual(by_place["summary"]["on_prem_uci_low"], 1)
        drill = await list_netskope_objects(self.pool, "device", "", 500, 0, {"onprem_status": "on-prem", "uci_rating": "Poor"})
        self.assertEqual(drill["total"], by_place["summary"]["on_prem_uci_low"])
        self.assertEqual([row["source_id"] for row in drill["rows"]], ["a"])

    async def test_grouping_by_uci_and_facets_use_the_same_buckets(self):
        await self.seed()
        by_uci = await get_netskope_fleet_groups(self.pool, "uci_rating")
        self.assertEqual({g["key"]: g["devices"] for g in by_uci["groups"]}, {"Sin alerta": 3, "Poor": 2, "Moderate": 1})
        facets = await get_netskope_device_facets(self.pool)
        self.assertEqual({b["key"]: b["count"] for b in facets["uci_rating"]}, {"Sin alerta": 3, "Poor": 2, "Moderate": 1})
        self.assertEqual({b["key"]: b["count"] for b in facets["onprem_status"]}, {"on-prem": 4, "off-prem": 2})
        for key in ("Poor", "Moderate", "Sin alerta"):
            drill = await list_netskope_objects(self.pool, "device", "", 500, 0, {"uci_rating": key})
            self.assertEqual(drill["total"], {g["key"]: g["devices"] for g in by_uci["groups"]}[key])

    async def test_golden_severity_columns_split_the_evaluated_devices_and_match_the_drills(self):
        now = datetime.now(timezone.utc).timestamp()
        for source_id, version in (("cur", "141.0.0"), ("one-a", "138.1.0"), ("one-b", "139.0.0"), ("two", "130.0.0"), ("odd", "beta")):
            await seed_device(self.pool, source_id, {"client_version": version, "username": f"{source_id}@acme.test", "last_event_timestamp": now - 60})
        groups = await get_netskope_fleet_groups(self.pool, "company")
        self.assertEqual(groups["summary"]["client_evaluated"], 0)  # no baseline: not evaluated, never zero-filled as current
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.1.0", "135.0.0"]}, None, "admin")
        try:
            summary = (await get_netskope_fleet_groups(self.pool, "company"))["summary"]
            self.assertEqual((summary["client_current"], summary["client_one_behind"], summary["client_two_plus_behind"], summary["client_evaluated"]), (1, 2, 1, 4))
            for key, field in (("one_behind", "client_one_behind"), ("two_plus_behind", "client_two_plus_behind")):
                drill = await list_netskope_objects(self.pool, "device", "", 50, 0, client_compliance=key)
                self.assertEqual(drill["total"], summary[field], key)
        finally:
            async with self.pool.connection() as conn:
                await conn.execute("DELETE FROM public.netskope_baselines")
                await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'netskope_baseline'")
