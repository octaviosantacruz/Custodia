"""NSK-CHG-001: the diff between the two latest completed Netskope runs,
evaluated by real PostgreSQL. Opt-in; see tests/support/pg_integration_base.py."""

import uuid
from datetime import datetime, timedelta, timezone

from app.netskope.sse.repositories.netskope_queries import get_netskope_device_changes, list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, reset_netskope_runs, seed_device, seed_run, seed_snapshot
from tests.support.pg_integration_base import PostgresIntegrationTestCase

T0 = datetime(2026, 9, 20, tzinfo=timezone.utc)


def device(hostname, version, os="Windows", os_version="11", classification="managed"):
    return {"hostname": hostname, "client_version": version, "os": os, "os_version": os_version, "classification_status": classification}


class NetskopeChangesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope_runs(self.pool)
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(reset_netskope_runs, self.pool)

    async def seed(self, status, when, devices):
        run_id = uuid.uuid4()
        await seed_run(self.pool, run_id, status, when)
        for device_id, attributes in devices.items():
            await seed_snapshot(self.pool, run_id, device_id, attributes, when)
        return run_id

    async def test_needs_two_completed_runs(self):
        await self.seed("completed", T0, {"d1": device("A", "141.0.0.1")})
        result = await get_netskope_device_changes(self.pool)
        self.assertFalse(result["available"])
        self.assertEqual(result["completed_runs"], 1)

    async def test_diff_between_the_two_latest_completed_runs(self):
        await self.seed("completed", T0 - timedelta(days=5), {"ancient": device("OLD", "1.0")})
        previous = await self.seed("completed", T0, {
            "same": device("SAME", "141.0.0.2792"),
            "suffix": device("SUFFIX", "141.0.0.2792"),
            "up": device("UP", "9.1.0"),
            "down": device("DOWN", "141.0.0.2792"),
            "odd": device("ODD", "beta"),
            "os": device("OS", "141.0.0.2792", os_version="10"),
            "class": device("CLASS", "141.0.0.2792", classification="unmanaged"),
            "gone": device("GONE", "141.0.0.2792"),
        })
        latest = await self.seed("completed", T0 + timedelta(days=1), {
            "same": device("SAME", "141.0.0.2792"),
            "suffix": device("SUFFIX", "141.0.0.2792 (64-bit)"),
            "up": device("UP", "10.0.0"),
            "down": device("DOWN", "138.1.12.2776"),
            "odd": device("ODD", "gamma"),
            "os": device("OS", "141.0.0.2792", os_version="11"),
            "class": device("CLASS", "141.0.0.2792"),
            "new": device("NEW", "141.0.0.2792"),
        })
        # A newer failed run (and one that is still running) is never compared.
        await self.seed("failed", T0 + timedelta(days=2), {"same": device("SAME", "1.0")})
        await self.seed("running", T0 + timedelta(days=3), {})

        result = await get_netskope_device_changes(self.pool)

        self.assertTrue(result["available"])
        self.assertEqual(result["latest_run"]["source_run_id"], str(latest))
        self.assertEqual(result["previous_run"]["source_run_id"], str(previous))
        self.assertEqual(result["counts"], {
            "added": 1, "removed": 1, "upgraded": 1, "downgraded": 1,
            "version_changed": 1, "os_changed": 1, "classification_changed": 1,
        })
        self.assertEqual(result["samples"]["upgraded"], [{"device_id": "up", "hostname": "UP", "before_value": "9.1.0", "after_value": "10.0.0"}])
        self.assertEqual(result["samples"]["removed"][0]["device_id"], "gone")
        self.assertEqual(result["samples"]["version_changed"][0]["device_id"], "odd")
        self.assertEqual(result["samples"]["os_changed"][0]["after_value"], "Windows 11")

    async def test_change_filter_lists_only_active_devices_of_that_change(self):
        await self.seed("completed", T0, {"up": device("UP", "130.0"), "same": device("SAME", "141.0")})
        await self.seed("completed", T0 + timedelta(days=1), {"up": device("UP", "141.0"), "same": device("SAME", "141.0")})
        await seed_device(self.pool, "up", device("UP", "141.0"))
        await seed_device(self.pool, "same", device("SAME", "141.0"))

        upgraded = await list_netskope_objects(self.pool, "device", "", 50, 0, None, "", "upgraded", freshness="all")

        self.assertEqual([row["source_id"] for row in upgraded["rows"]], ["up"])

    async def test_run_chronology_ignores_snapshot_write_time_and_non_device_flows(self):
        previous = uuid.uuid4()
        latest = uuid.uuid4()
        await seed_run(self.pool, previous, "completed", T0)
        await seed_run(self.pool, latest, "completed", T0 + timedelta(days=1))
        # Snapshot timestamps describe storage, not ingestion chronology.
        await seed_snapshot(self.pool, previous, "d1", device("A", "1.0"), T0 + timedelta(days=3))
        await seed_snapshot(self.pool, latest, "d1", device("A", "2.0"), T0 + timedelta(days=2))
        # Users/alerts can complete later without producing device snapshots.
        await self.seed("completed", T0 + timedelta(days=4), {})

        result = await get_netskope_device_changes(self.pool)

        self.assertEqual(result["latest_run"]["source_run_id"], str(latest))
        self.assertEqual(result["previous_run"]["source_run_id"], str(previous))
        self.assertEqual(result["latest_run"]["captured_at"], (T0 + timedelta(days=2)).isoformat())
        self.assertEqual(result["counts"]["upgraded"], 1)
        self.assertEqual(result["counts"]["downgraded"], 0)
