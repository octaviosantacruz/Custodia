"""NSK-EXP-ONPREM-001 on real PostgreSQL: presence counts equal the inventory lists their drills open,
only recent active devices count, and a device without the field is "Sin dato", never remote.
Opt-in; see tests/support/pg_integration_base.py."""

from datetime import datetime, timedelta, timezone

from app.netskope.sse.repositories.netskope_presence import get_netskope_presence, get_users_presence
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from app.netskope.sse.repositories.netskope_mutations import PRESENCE_RETENTION_DAYS, record_device_snapshots
from tests.support.netskope_pg_fixtures import insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device
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

    async def test_sync_records_event_days_and_presence_counts_office_and_remote_days_of_the_week(self):
        """NSK-EXP-PRESENCE-001 through the real sync writer: a hybrid week counts its office day, a
        switched-off device repeating an old event adds no later day, and retired devices do not count."""
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        now = datetime.now(timezone.utc)
        await seed_device(self.pool, "hyb", {"username": " Hybrid@Acme.test ", "onprem_status": "off-prem"})
        await seed_device(self.pool, "rem", {"username": "remote@acme.test", "onprem_status": "off-prem"})
        await seed_device(self.pool, "old", {"username": "old@acme.test", "onprem_status": "off-prem"})
        await seed_device(self.pool, "gone", {"username": "gone@acme.test"}, lifecycle_status="retired")
        await seed_device(self.pool, "future", {"username": "future@acme.test"})

        def device(source_id, status, days_ago):
            return {"source_id": source_id, "attributes": {
                "last_event_timestamp": (now - timedelta(days=days_ago)).timestamp(), **({"onprem_status": status} if status else {}),
            }}

        # Each sync run holds a device once, as the inventory sync writes them.
        runs = [
            [device("hyb", "on-prem", 4), device("rem", "off-prem", 1), device("old", "on-prem", 10), device("gone", "on-prem", 1),
             device("future", "on-prem", -1)],  # an event a day ahead of the capture is not trusted
            [device("hyb", "on-prem", 4)],  # the same office event seen again counts once
            [device("hyb", "off-prem", 1)], [device("hyb", "off-prem", 2)], [device("hyb", "off-prem", 3)],
            [device("hyb", "Unknown", 2)],  # unclassified status is not a day
        ]
        for devices in runs:
            await record_device_snapshots(self.pool, await insert_netskope_run(self.pool), devices)

        emails = ["hybrid@acme.test", "remote@acme.test", "old@acme.test", "gone@acme.test", "future@acme.test", "absent@acme.test"]
        self.assertEqual(await get_users_presence(self.pool, emails), {
            "hybrid@acme.test": {"office_days": 1, "remote_days": 3},
            "remote@acme.test": {"office_days": 0, "remote_days": 1},
        })
        self.assertEqual(await get_users_presence(self.pool, []), {})

    async def test_presence_days_older_than_retention_are_purged_by_the_next_sync(self):
        self.addAsyncCleanup(reset_netskope_runs, self.pool)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO public.netskope_device_presence_days (device_id, event_day, onprem_status)
                   VALUES ('kept', (now() AT TIME ZONE 'UTC')::date - %s, 'on-prem'),
                          ('purged', (now() AT TIME ZONE 'UTC')::date - %s, 'on-prem')""",
                (PRESENCE_RETENTION_DAYS, PRESENCE_RETENTION_DAYS + 1),
            )
        await record_device_snapshots(self.pool, await insert_netskope_run(self.pool), [
            {"source_id": "any", "attributes": {"onprem_status": "off-prem", "last_event_timestamp": datetime.now(timezone.utc).timestamp()}},
        ])
        async with self.pool.connection() as conn:
            cursor = await conn.execute("SELECT device_id FROM public.netskope_device_presence_days ORDER BY device_id")
            self.assertEqual([row["device_id"] for row in await cursor.fetchall()], ["any", "kept"])

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
