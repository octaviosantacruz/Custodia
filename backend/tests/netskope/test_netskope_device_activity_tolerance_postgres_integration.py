"""Recent-device count: DEM heartbeats stamped slightly ahead count, far-future stamps do not, and the
heartbeat share is reported beside the total (NSK-HB-001 follow-up)."""

import time

from app.netskope.sse.repositories.netskope_queries import get_netskope_metrics
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class DeviceActivityToleranceTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_recent_count_accepts_events_up_to_an_hour_ahead_and_splits_heartbeats(self):
        now = int(time.time())
        await seed_device(self.pool, "past-heartbeat", {"last_event_timestamp": now - 3600, "last_seen_event": "Dem Heartbeat"})
        await seed_device(self.pool, "tunnel", {"last_event_timestamp": now - 7200, "last_seen_event": "Tunnel Up"})
        await seed_device(self.pool, "ahead-heartbeat", {"last_event_timestamp": now + 30 * 60, "last_seen_event": "Dem Heartbeat"})
        await seed_device(self.pool, "far-future", {"last_event_timestamp": now + 2 * 3600, "last_seen_event": "Dem Heartbeat"})
        await seed_device(self.pool, "old", {"last_event_timestamp": now - 9 * 86400, "last_seen_event": "Dem Heartbeat"})

        metrics = await get_netskope_metrics(self.pool)

        self.assertEqual(metrics["devices_total"], 3)
        self.assertEqual(metrics["devices_last_event_dem"], 2)
