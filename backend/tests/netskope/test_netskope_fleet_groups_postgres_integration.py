"""NSK-FLEET-001 on real PostgreSQL: the grouped fleet reading counts recent active devices, leaves
compliance unevaluated without a baseline, and every cell equals the inventory list its drill opens.
Opt-in; see tests/support/pg_integration_base.py."""

from datetime import datetime, timezone

from app.netskope.sse.repositories.netskope_baselines import save_netskope_baseline
from app.netskope.sse.repositories.netskope_fleet_groups import get_netskope_fleet_groups
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase

DAY = 86400


async def reset_baselines(pool):
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_baselines")
        await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'netskope_baseline'")


class NetskopeFleetGroupsPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_baselines(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(reset_baselines, self.pool)

    async def seed(self):
        now = datetime.now(timezone.utc).timestamp()
        hour_ago, three_days, stale = now - 3600, now - 3 * DAY, now - 40 * DAY
        rows = [
            ("a", {"company": "ALFA", "os": "Windows", "os_version": "10.0.22631", "client_version": "141.0.0", "onprem_status": "on-prem"}, hour_ago),
            ("b", {"company": "ALFA", "os": "Windows", "os_version": "10.0.19041", "client_version": "138.1.0", "onprem_status": "off-prem"}, three_days),
            ("c", {"company": "ALFA", "os": "Mac", "os_version": "14.1", "client_version": "130.0.0"}, hour_ago),
            ("d", {"company": "BETA", "os": "Windows", "os_version": "10.0.22631", "client_version": "nope", "onprem_status": "Unknown"}, hour_ago),
            ("e", {"company": "BETA", "os": "Windows", "client_version": "141.0.0", "onprem_status": "on-prem"}, stale),  # out of the population
        ]
        for source_id, attributes, timestamp in rows:
            await seed_device(self.pool, source_id, {**attributes, "last_event_timestamp": timestamp})

    async def test_without_baselines_compliance_is_not_evaluated(self):
        await self.seed()
        fleet = await get_netskope_fleet_groups(self.pool, "company")
        self.assertFalse(fleet["client_baseline"])
        self.assertFalse(fleet["os_baseline"])
        self.assertEqual(fleet["summary"]["devices"], 4)
        self.assertEqual(fleet["summary"]["client_evaluated"], 0)
        self.assertEqual(fleet["summary"]["os_evaluated"], 0)
        groups = {group["key"]: group for group in fleet["groups"]}
        self.assertEqual(groups["ALFA"]["devices"], 3)
        self.assertEqual(groups["ALFA"]["signal_24h"], 2)
        self.assertEqual(groups["ALFA"]["on_prem"], 1)
        self.assertEqual(groups["ALFA"]["location_reported"], 2)
        self.assertEqual(groups["BETA"]["location_reported"], 0)

    async def test_every_cell_equals_the_inventory_list_its_drill_opens(self):
        await self.seed()
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.1.0"]}, None, "admin-1")
        await save_netskope_baseline(self.pool, "os_minimum_versions", {"minimums": {"Windows": "10.0.22000"}}, None, "admin-1")
        for group_by in ("company", "os"):
            fleet = await get_netskope_fleet_groups(self.pool, group_by)
            for group in fleet["groups"]:
                base = {group_by: group["key"]}
                async def total(base=base, **kwargs):
                    filters = kwargs.pop("filters", {})
                    result = await list_netskope_objects(self.pool, "device", "", 500, 0, {**base, **filters}, **kwargs)
                    return result["total"]
                self.assertEqual(await total(), group["devices"], group)
                self.assertEqual(await total(event_age="lt_24h"), group["signal_24h"], group)
                self.assertEqual(await total(client_compliance="current"), group["client_current"], group)
                self.assertEqual(await total(os_compliance="supported"), group["os_supported"], group)
                self.assertEqual(await total(filters={"onprem_status": "on-prem"}), group["on_prem"], group)
        by_company = {group["key"]: group for group in (await get_netskope_fleet_groups(self.pool, "company"))["groups"]}
        self.assertEqual(by_company["ALFA"]["client_current"], 1)
        self.assertEqual(by_company["ALFA"]["client_evaluated"], 3)
        self.assertEqual(by_company["BETA"]["client_evaluated"], 0)  # unrecognized version is not evaluated
        self.assertEqual(by_company["ALFA"]["os_supported"], 1)
        self.assertEqual(by_company["ALFA"]["os_evaluated"], 2)  # Mac has no minimum

    async def test_rejects_a_group_outside_the_allowlist(self):
        with self.assertRaises(ValueError):
            await get_netskope_fleet_groups(self.pool, "hostname")
