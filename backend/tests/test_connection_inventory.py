import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.connection_inventory import get_connection_coverage, list_connection_inventory, replace_connection_inventory


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *args):
        return None


class FakeCursor:
    def __init__(self):
        self.executemany = AsyncMock()


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()
        self.execute = AsyncMock()

    def transaction(self):
        return AsyncContext(self)

    def cursor(self):
        return AsyncContext(self.cursor_instance)


class FakePool:
    def __init__(self):
        self.connection_instance = FakeConnection()

    def connection(self):
        return AsyncContext(self.connection_instance)


class ConnectionInventoryTests(unittest.TestCase):
    def test_matches_imported_ip_to_safes_and_sia(self):
        rows = [{
            "inventory_id": 1,
            "private_ip": "10.67.9.143",
            "safe_matches": [{"safe_number": 4}],
            "sia_matches": [{"object_id": 9}],
            "total_count": 1,
            "import_id": "batch-1",
            "file_name": "connections.csv",
            "row_count": 1,
            "imported_at": "2026-09-08T00:00:00Z",
        }]
        with patch("app.repositories.connection_inventory.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(list_connection_inventory(object(), "10.67", 50, 0))

        self.assertEqual(result["rows"][0]["safe_match_count"], 1)
        self.assertEqual(result["rows"][0]["sia_match_count"], 1)
        query = fetch_all.await_args.args[1]
        self.assertIn("lower(trim(a.address)) = lower(trim(ci.private_ip))", query)
        self.assertIn("source_system = 'sia'", query)
        self.assertEqual(fetch_all.await_args.args[2][-2:], (50, 0))

    def test_can_hide_internal_safe_account_matches(self):
        with patch("app.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], []])) as fetch_all:
            asyncio.run(list_connection_inventory(object(), "", 50, 0, include_internal=False))

        query = fetch_all.await_args_list[0].args[1]
        self.assertIn("smeta.inventory_scope", query)
        self.assertIn("a.inventory_account_type", query)

    def test_filters_rows_by_environment_and_observed_coverage(self):
        with patch("app.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], []])) as fetch_all:
            result = asyncio.run(list_connection_inventory(object(), "", 50, 0, True, "PROD", "sia_only"))

        query = fetch_all.await_args_list[0].args[1]
        params = fetch_all.await_args_list[0].args[2]
        self.assertIn("lower(trim(ci.environment))", query)
        self.assertIn("safe_matches.inventory_id IS NULL AND sia_matches.inventory_id IS NOT NULL", query)
        self.assertIn("PROD", params)
        self.assertIn("sia_only", params)
        self.assertEqual(result["filters"], {"environment": "PROD", "coverage": "sia_only"})

    def test_summarizes_exact_ip_coverage_by_environment(self):
        rows = [{
            "environment": "PROD", "total": 10, "both": 4, "pam_only": 2, "sia_only": 1,
            "none": 3, "zsp_implemented": 7, "zsp_pending": 2, "zsp_unknown": 1,
            "import_id": "batch-1", "file_name": "connections.csv", "row_count": 10,
            "imported_at": "2026-09-08T00:00:00Z",
        }, {
            "environment": "DEV", "total": 5, "both": 1, "pam_only": 1, "sia_only": 1,
            "none": 2, "zsp_implemented": 2, "zsp_pending": 2, "zsp_unknown": 1,
            "import_id": "batch-1", "file_name": "connections.csv", "row_count": 10,
            "imported_at": "2026-09-08T00:00:00Z",
        }]
        with patch("app.repositories.connection_inventory.fetch_all", new=AsyncMock(return_value=rows)) as fetch_all:
            result = asyncio.run(get_connection_coverage(object(), include_internal=False))

        self.assertEqual(result["totals"]["total"], 15)
        self.assertEqual(result["totals"]["both"], 5)
        self.assertEqual(result["by_environment"][0]["environment"], "PROD")
        query = fetch_all.await_args.args[1]
        self.assertIn("lower(trim(a.address)) = lower(trim(ci.private_ip))", query)
        self.assertIn("source_system = 'sia'", query)
        self.assertIn("smeta.inventory_scope", query)
        self.assertIn("ORDER BY total DESC, environment", query)
        self.assertNotIn("lower(environment)", query)

    def test_keeps_current_import_metadata_when_search_has_no_matches(self):
        with patch("app.repositories.connection_inventory.fetch_all", new=AsyncMock(side_effect=[[], [{
            "import_id": "batch-1", "file_name": "conexiones.csv", "row_count": 18, "imported_at": "2026-09-08T00:00:00Z",
        }]])):
            result = asyncio.run(list_connection_inventory(object(), "10.0.0.99", 50, 0))

        self.assertEqual(result["rows"], [])
        self.assertEqual(result["import"]["file_name"], "conexiones.csv")

    def test_import_inserts_rows_through_the_async_cursor(self):
        pool = FakePool()
        asyncio.run(replace_connection_inventory(pool, [{
            "source_row_number": 2, "instance_name": "server-1", "environment": "DEV",
            "private_ip": "10.0.0.1", "port": 22, "ca_sia": True, "ca_dba": False,
            "zsp_implemented": True, "access_available": True, "description": "",
        }], "connections.csv", "operator-1"))

        pool.connection_instance.cursor_instance.executemany.assert_awaited_once()
        self.assertIn("INSERT INTO public.connection_inventory", pool.connection_instance.cursor_instance.executemany.await_args.args[0])
        self.assertEqual(pool.connection_instance.execute.await_count, 4)
        self.assertIn("INSERT INTO public.access_audit_log", pool.connection_instance.execute.await_args_list[-2].args[0])
        self.assertIn("INSERT INTO public.activity_events", pool.connection_instance.execute.await_args_list[-1].args[0])


if __name__ == "__main__":
    unittest.main()
