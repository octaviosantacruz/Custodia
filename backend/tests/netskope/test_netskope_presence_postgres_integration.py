"""NSK-EXP-ONPREM-001 on real PostgreSQL: presence counts equal the inventory lists their drills open,
only recent active devices count, and a device without the field is "Sin dato", never remote.
Opt-in; see tests/support/pg_integration_base.py."""

from datetime import datetime, timezone

from app.netskope.sse.repositories.netskope_presence import get_netskope_presence
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase

DAY = 86400


class NetskopePresencePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def seed(self):
        now = datetime.now(timezone.utc).timestamp()
        recent, stale = now - 3600, now - 40 * DAY
        rows = [
            ("a", {"onprem_status": "on-prem", "onprem_method": "Egress_IP", "client_config": "Default tenant config", "username": "a@acme.test"}, recent),
            ("b", {"onprem_status": "on-prem", "onprem_method": "Egress_IP", "client_config": "TestCiber", "username": "b@acme.test"}, recent),
            ("c", {"onprem_status": "off-prem", "onprem_method": "Egress_IP", "client_config": "Default tenant config", "username": "c@beta.test"}, recent),
            ("d", {"onprem_status": "off-prem", "onprem_method": "Egress_IP", "client_config": "Default tenant config", "username": "d@beta.test"}, recent),
            ("e", {"onprem_status": "Unknown", "client_config": "Default tenant config", "username": "e@beta.test"}, recent),
            ("f", {"username": "f@beta.test"}, recent),  # synced before the field existed
            ("g", {"onprem_status": "off-prem", "client_config": "Default tenant config"}, stale),  # not recent: out of the population
        ]
        for source_id, attributes, timestamp in rows:
            await seed_device(self.pool, source_id, {**attributes, "last_event_timestamp": timestamp})
        await seed_device(self.pool, "gone", {"onprem_status": "on-prem", "last_event_timestamp": recent}, lifecycle_status="retired")

    async def test_counts_cover_recent_active_devices_and_missing_is_not_remote(self):
        await self.seed()
        presence = await get_netskope_presence(self.pool)
        self.assertEqual(presence["total"], 6)
        self.assertEqual(presence["reported"], 5)
        self.assertEqual({row["key"]: row["count"] for row in presence["statuses"]}, {"off-prem": 2, "on-prem": 2, "Unknown": 1, "Sin dato": 1})
        configs = {group["key"]: group for group in presence["by_client_config"]}
        self.assertEqual(configs["Default tenant config"]["statuses"], {"off-prem": 2, "Unknown": 1, "on-prem": 1})
        self.assertEqual(configs["TestCiber"]["total"], 1)
        self.assertEqual(configs["Sin dato"]["statuses"], {"Sin dato": 1})
        companies = {group["key"]: group["statuses"] for group in presence["by_company"]}
        self.assertEqual(companies["ACME"], {"on-prem": 2})

    async def test_every_count_equals_the_inventory_list_its_drill_opens(self):
        await self.seed()
        presence = await get_netskope_presence(self.pool)
        for status in presence["statuses"]:
            drill = await list_netskope_objects(self.pool, "device", "", 500, 0, {"onprem_status": status["key"]})
            self.assertEqual(drill["total"], status["count"], status["key"])
        for group in presence["by_client_config"]:
            for key, count in group["statuses"].items():
                drill = await list_netskope_objects(self.pool, "device", "", 500, 0, {"client_config": group["key"], "onprem_status": key})
                self.assertEqual(drill["total"], count, (group["key"], key))
