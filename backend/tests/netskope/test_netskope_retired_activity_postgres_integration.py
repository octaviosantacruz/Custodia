"""Retired users whose devices still report: the gap between the console's user count and the inventory's."""

import time

from app.netskope.sse.repositories.netskope_cross_metrics import list_retired_users_with_device_activity
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device, seed_netskope_user
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class RetiredUsersActivityTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_lists_only_retired_users_with_a_recent_exact_matched_device(self):
        now = int(time.time())
        retired = await seed_netskope_user(self.pool, "gone@example.com", "Gone", "gone@example.com", lifecycle_status="retired")
        await seed_netskope_user(self.pool, "quiet@example.com", "Quiet", "quiet@example.com", lifecycle_status="retired")
        await seed_netskope_user(self.pool, "live@example.com", "Live", "live@example.com")
        await seed_netskope_user(self.pool, "both-old", "Both retired", "both@example.com", lifecycle_status="retired")
        await seed_netskope_user(self.pool, "both-new", "Both active", "both@example.com")
        await seed_device(self.pool, "d1", {"username": "Gone@Example.com", "hostname": "gone-pc", "last_event_timestamp": now - 3600})
        await seed_device(self.pool, "d2", {"username": "quiet@example.com", "last_event_timestamp": now - 20 * 86400})
        await seed_device(self.pool, "d3", {"username": "live@example.com", "last_event_timestamp": now - 3600})
        await seed_device(self.pool, "d4", {"username": "both@example.com", "last_event_timestamp": now - 3600})
        await seed_device(self.pool, "d5", {"username": "nobody@example.com", "last_event_timestamp": now - 3600})

        rows = await list_retired_users_with_device_activity(self.pool, 7)

        self.assertEqual([(row["object_id"], row["device_count"], row["latest_device"]) for row in rows], [(retired, 1, "gone-pc")])
        wider = await list_retired_users_with_device_activity(self.pool, 30)
        self.assertEqual(len(wider), 2)

    async def test_rejects_an_unsupported_window(self):
        with self.assertRaises(ValueError):
            await list_retired_users_with_device_activity(self.pool, 5)
