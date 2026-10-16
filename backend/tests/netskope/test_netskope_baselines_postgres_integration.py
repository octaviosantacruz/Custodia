"""NSK-VER-001 / NSK-FLT-001 against real PostgreSQL: audited baseline
writes, compliance buckets and filters that match them. Opt-in; see
tests/support/pg_integration_base.py."""

from datetime import datetime, timezone

from app.netskope.sse.repositories.netskope_baselines import get_netskope_baselines, save_netskope_baseline
from app.netskope.sse.repositories.netskope_queries import get_netskope_client_compliance, get_netskope_fleet, list_netskope_objects
from app.netskope.sse.repositories.netskope_shared import _numeric_version, parse_version
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase


RECENT_EVENT = int(datetime.now(timezone.utc).timestamp())


async def reset_baselines(pool):
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM public.netskope_baselines")
        await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type = 'netskope_baseline'")


class NetskopeBaselinesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        await reset_baselines(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)
        self.addAsyncCleanup(reset_baselines, self.pool)

    async def test_baseline_writes_are_audited_with_before_and_after(self):
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.0.0"]}, None, "admin-1")
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.1.0"]}, "ajuste", "admin-2")

        baselines = await get_netskope_baselines(self.pool)
        self.assertEqual(baselines["client_golden_releases"]["updated_by"], "admin-2")
        self.assertIsNone(baselines["os_minimum_versions"])
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT actor_id, action, before_data, after_data FROM public.access_audit_log WHERE entity_type = 'netskope_baseline' ORDER BY audit_id"
            )
            audit = await cursor.fetchall()
        self.assertEqual([row["action"] for row in audit], ["create", "update"])
        self.assertIsNone(audit[0]["before_data"])
        self.assertEqual(audit[1]["before_data"]["value"], {"releases": ["141.0.0", "138.0.0"]})
        self.assertEqual(audit[1]["after_data"], {"value": {"releases": ["141.0.0", "138.1.0"]}, "note": "ajuste"})

    async def test_client_compliance_buckets_and_matching_filter(self):
        self.assertFalse((await get_netskope_client_compliance(self.pool))["configured"])
        devices = {
            "current-a": ("Windows", "141.0.0.2792 (64-bit)"),
            "current-b": ("Mac", "142.0.1"),
            "one-behind": ("Windows", "138.1.12.2776"),
            "edge-one-behind": ("Windows", "138.1.0"),
            "two-behind": ("Windows", "132.0.13.2525"),
            "unknown": ("Mac", "beta"),
        }
        for source_id, (os_name, version) in devices.items():
            await seed_device(self.pool, source_id, {"os": os_name, "client_version": version, "last_event_timestamp": RECENT_EVENT})
        await save_netskope_baseline(self.pool, "client_golden_releases", {"releases": ["141.0.0", "138.1.0", "135.0.0"]}, None, "admin")

        result = await get_netskope_client_compliance(self.pool)

        self.assertEqual({bucket["key"]: bucket["count"] for bucket in result["buckets"]},
                         {"current": 2, "one_behind": 2, "two_plus_behind": 1, "unrecognized": 1})
        windows = next(entry for entry in result["by_os"] if entry["os"] == "Windows")
        self.assertEqual((windows["current"], windows["one_behind"], windows["two_plus_behind"]), (1, 2, 1))
        listed = await list_netskope_objects(self.pool, "device", "", 50, 0, client_compliance="one_behind", freshness="all")
        self.assertEqual(sorted(row["source_id"] for row in listed["rows"]), ["edge-one-behind", "one-behind"])

    async def test_os_minimums_and_fleet_composition(self):
        await seed_device(self.pool, "win-new", {"os": "Windows", "os_version": "11.0.26200", "device_make": "HP", "device_model": "ProBook", "last_event_timestamp": RECENT_EVENT})
        await seed_device(self.pool, "win-old", {"os": "Windows", "os_version": "10.0.19044", "device_make": "HP", "device_model": "ProBook", "last_event_timestamp": RECENT_EVENT})
        await seed_device(self.pool, "win-edge", {"os": "Windows", "os_version": "10.0.19045", "device_make": "Hewlett-Packard", "last_event_timestamp": RECENT_EVENT})
        await seed_device(self.pool, "linux", {"os": "Linux", "os_version": "6.8", "device_make": "Dell Inc.", "last_event_timestamp": RECENT_EVENT})
        await seed_device(self.pool, "mac-odd", {"os": "Mac", "os_version": "", "last_event_timestamp": RECENT_EVENT})

        fleet = await get_netskope_fleet(self.pool)
        self.assertIsNone(fleet["os_compliance"])
        self.assertEqual(fleet["total"], 5)
        # Vendor spellings are never merged by similarity.
        self.assertIn({"key": "HP", "count": 2}, fleet["by_make"])
        self.assertIn({"key": "Hewlett-Packard", "count": 1}, fleet["by_make"])

        await save_netskope_baseline(self.pool, "os_minimum_versions", {"minimums": {"Windows": "10.0.19045", "Mac": "15.0.0"}}, None, "admin")
        fleet = await get_netskope_fleet(self.pool)
        buckets = {bucket["key"]: bucket["count"] for bucket in fleet["os_compliance"]["buckets"]}
        self.assertEqual(buckets, {"supported": 2, "below_minimum": 1, "no_baseline": 1, "unrecognized": 1})
        below = await list_netskope_objects(self.pool, "device", "", 50, 0, os_compliance="below_minimum", freshness="all")
        self.assertEqual([row["source_id"] for row in below["rows"]], ["win-old"])
        by_make = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"device_make": "Hewlett-Packard"})
        self.assertEqual([row["source_id"] for row in by_make["rows"]], ["win-edge"])

    async def test_parse_version_agrees_with_the_sql_numeric_prefix(self):
        # TEST-PROP-001: the docstring calls parse_version the Python twin of
        # _numeric_version, so both must parse the same inputs the same way,
        # including the Unicode digits where Python's \d used to differ.
        values = (
            "141.0.0.2792 (64-bit)", " 141.0.0", "9", "10", "141.0.0.02792",
            "141.0.", ".", "", "beta", "٣.٤", "1２", "1.2\n3", "0001.2",
        )
        async with self.pool.connection() as conn:
            async with conn.cursor() as cur:
                for value in values:
                    await cur.execute(f"SELECT {_numeric_version('%s')} AS parsed", (value,))
                    row = await cur.fetchone()
                    expected = None if row["parsed"] is None else [int(part) for part in row["parsed"]]
                    with self.subTest(value=value):
                        self.assertEqual(parse_version(value), expected)
