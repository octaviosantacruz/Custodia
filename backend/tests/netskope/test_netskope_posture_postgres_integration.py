"""NSK-POSTURE-001 on real PostgreSQL: every posture check counts exactly the
devices its inventory drill opens, and a human diagnosis takes a stale device
out of its check. Opt-in; see tests/support/pg_integration_base.py."""

from datetime import datetime, timezone

from app.netskope.sse.repositories.netskope_baselines import save_netskope_baseline
from app.netskope.sse.repositories.netskope_queries import list_netskope_objects
from app.netskope.sse.services.netskope_posture import DEFERRED_POLICY_CHECKS, DEVICE_CHECKS, get_netskope_posture
from tests.support.netskope_pg_fixtures import insert_netskope_run, reset_netskope, reset_netskope_runs, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase

DAY = 86400


async def reset_baselines(pool) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_baselines")
        await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'netskope_baseline'")


class NetskopePosturePostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        for reset in (reset_netskope, reset_netskope_runs, reset_baselines):
            await reset(self.pool)
            self.addAsyncCleanup(reset, self.pool)

    async def seed_inventory(self):
        now = datetime.now(timezone.utc).timestamp()
        recent, stale = now - 3600, now - 45 * DAY
        await seed_device(self.pool, "off-1", {"hostname": "OFF-1", "last_seen_event": "Uninstalled", "last_event_timestamp": recent, "client_version": "141.0.0"})
        await seed_device(self.pool, "off-2", {"hostname": "OFF-2", "last_seen_event": "Admin Disabled", "last_event_timestamp": stale, "client_version": "141.0.0"})
        await seed_device(self.pool, "old-client", {"hostname": "OLD", "client_version": "135.0.0", "os": "Windows", "os_version": "10.0.19041", "last_event_timestamp": recent})
        await seed_device(self.pool, "one-behind", {"hostname": "ONE", "client_version": "138.5.0", "os": "Windows", "os_version": "10.0.19045", "last_event_timestamp": recent})
        await seed_device(self.pool, "dup-a", {"hostname": "DUP", "client_version": "141.0.0", "last_event_timestamp": recent})
        await seed_device(self.pool, "dup-b", {"hostname": "DUP", "client_version": "141.0.0", "last_event_timestamp": stale})
        await seed_device(self.pool, "healthy", {"hostname": "OK", "client_version": "141.2.0", "os": "Windows", "os_version": "10.0.22631", "last_event_timestamp": recent})
        await insert_netskope_run(self.pool, "completed", hours=1)

    async def test_every_check_counts_exactly_its_inventory_drill(self):
        await self.seed_inventory()
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.1.0"]}, None, "admin")
        await save_netskope_baseline(self.pool, "os_minimum_versions", {"minimums": {"Windows": "10.0.19045"}}, None, "admin")
        posture = await get_netskope_posture(self.pool, frozenset({"netskope:read"}))
        by_id = {check["id"]: check for check in posture["checks"]}
        for check in DEVICE_CHECKS:
            with self.subTest(check=check["id"]):
                drill = await list_netskope_objects(self.pool, "device", "", 500, 0, None, freshness="all", **check["query"])
                self.assertEqual(by_id[check["id"]]["status"], "evaluated")
                self.assertEqual(by_id[check["id"]]["count"], drill["total"])
                self.assertEqual({row["object_id"] for row in drill["rows"]}, {row["object_id"] for row in by_id[check["id"]]["findings"]})
        counts = {check_id: by_id[check_id]["count"] for check_id in by_id if by_id[check_id]["entity"] == "device"}
        self.assertEqual(counts, {
            "client_protection_off": 2, "stale_undiagnosed": 2, "duplicate_hostname": 2,
        })
        # NSK-POLICY-001: the version-policy checks are deferred, so Postura does not list them even with baselines set,
        # while their inventory drills (same definitions, kept ready) still count what they used to.
        self.assertFalse({check["id"] for check in DEFERRED_POLICY_CHECKS} & set(by_id))
        for check in DEFERRED_POLICY_CHECKS:
            with self.subTest(deferred=check["id"]):
                drill = await list_netskope_objects(self.pool, "device", "", 500, 0, None, freshness="all", **check["query"])
                self.assertEqual(drill["total"], 1)
        self.assertTrue(posture["source_evidence"]["source_fresh"])

    async def test_a_diagnosis_takes_a_stale_device_out_of_its_check(self):
        await self.seed_inventory()
        posture = await get_netskope_posture(self.pool, frozenset())
        stale = next(check for check in posture["checks"] if check["id"] == "stale_undiagnosed")
        self.assertEqual(stale["count"], 2)
        async with self.pool.connection() as conn:
            await conn.execute("""INSERT INTO public.netskope_device_reviews (object_id, diagnosis, status, reference, decided_by, decided_at)
                SELECT object_id, 'decommissioned', 'resolved', 'CHG-1', 'admin', now() FROM public.cyberark_inventory_objects
                WHERE source_system = 'netskope' AND source_id = 'off-2'""")
        posture = await get_netskope_posture(self.pool, frozenset())
        stale = next(check for check in posture["checks"] if check["id"] == "stale_undiagnosed")
        self.assertEqual(stale["count"], 1)
        statuses = {check["id"]: check["status"] for check in posture["checks"]}
        self.assertNotIn("client_two_plus_behind", statuses)
        self.assertEqual(statuses["uci_poor"], "not_permitted")
