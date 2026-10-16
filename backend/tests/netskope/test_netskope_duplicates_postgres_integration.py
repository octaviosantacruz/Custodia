"""NSK-DUP-001 against real PostgreSQL: exact (never fuzzy) grouping of
possible duplicates, and filters that return exactly the grouped devices.
Opt-in; see tests/support/pg_integration_base.py."""

from app.netskope.sse.repositories.netskope_queries import get_netskope_duplicates, list_netskope_objects
from tests.support.netskope_pg_fixtures import reset_netskope, seed_device
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class NetskopeDuplicatesPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await reset_netskope(self.pool)
        self.addAsyncCleanup(reset_netskope, self.pool)

    async def test_groups_are_exact_and_filters_match_them(self):
        seeds = {
            "a1": {"hostname": "NB-100", "username": "ana@example.com"},
            "a2": {"hostname": " NB-100 ", "username": "bob@example.com"},
            "a3": {"hostname": "NB-100", "username": "Ana@Example.com"},
            "near": {"hostname": "NB-1000", "username": "carl@example.com"},
            "case": {"hostname": "nb-100", "username": "dora@example.com"},
            "solo": {"hostname": "NB-200", "username": "eve@example.com"},
            "blank": {"hostname": "", "username": ""},
            "blank2": {"hostname": "  ", "username": None},
        }
        for source_id, attributes in seeds.items():
            await seed_device(self.pool, source_id, attributes)
        await seed_device(self.pool, "retired", {"hostname": "NB-200", "username": "eve@example.com"}, lifecycle_status="retired")

        result = await get_netskope_duplicates(self.pool, freshness="all")

        # Whitespace is trimmed, but "nb-100" and "NB-1000" are different
        # hostnames: no case folding or similarity for hostnames. Blank
        # values and retired devices never form a group.
        self.assertEqual(result["hostname"]["groups"], 1)
        self.assertEqual(result["hostname"]["top"][0]["key"], "NB-100")
        self.assertEqual(result["hostname"]["top"][0]["devices"], 3)
        self.assertEqual(result["hostname"]["top"][0]["distinct_other"], 2)
        # Usernames compare case-insensitively (e-mail addresses).
        self.assertEqual(result["username"]["groups"], 1)
        self.assertEqual(result["username"]["top"][0]["key"], "ana@example.com")

        by_hostname = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"hostname": "NB-100"}, freshness="all")
        self.assertEqual(sorted(row["source_id"] for row in by_hostname["rows"]), ["a1", "a2", "a3"])
        grouped = await list_netskope_objects(self.pool, "device", "", 50, 0, duplicate="hostname", freshness="all")
        self.assertEqual(sorted(row["source_id"] for row in grouped["rows"]), ["a1", "a2", "a3"])
        by_user = await list_netskope_objects(self.pool, "device", "", 50, 0, filters={"username": "ana@example.com"}, freshness="all")
        self.assertEqual(sorted(row["source_id"] for row in by_user["rows"]), ["a1", "a3"])
