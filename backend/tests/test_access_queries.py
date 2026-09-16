import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.access_queries import list_access_assets


class AccessAssetQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.access_queries.fetch_all", new_callable=AsyncMock)
    async def test_lists_assets_without_optional_filters(self, fetch_all):
        fetch_all.return_value = []
        result = await list_access_assets(object(), "", 50, 0, "")
        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("a.source_system = %s", query)
        self.assertIn("a.object_type = 'access_asset'", query)
        self.assertEqual(params, ("cyberark", "access", 50, 0))

    @patch("app.repositories.access_queries.fetch_all", new_callable=AsyncMock)
    async def test_applies_search_and_asset_type_filters(self, fetch_all):
        fetch_all.return_value = []
        await list_access_assets(object(), "app01", 25, 10, "windows")
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("a.display_name ILIKE %s", query)
        self.assertIn("a.attributes->>'asset_type' = %s", query)
        self.assertEqual(params, ("cyberark", "access", "%app01%", "windows", 25, 10))

    @patch("app.repositories.access_queries.fetch_all", new_callable=AsyncMock)
    async def test_scopes_platform_join_to_cyberark_source_system(self, fetch_all):
        fetch_all.return_value = []
        await list_access_assets(object(), "", 50, 0, "")
        query = fetch_all.await_args.args[1]
        self.assertIn("p.source_system = %s", query)
        self.assertIn("p.object_type = 'platform'", query)
        self.assertIn("p.source_id = NULLIF(a.attributes->>'platform_id', '')", query)

    @patch("app.repositories.access_queries.fetch_all", new_callable=AsyncMock)
    async def test_reports_total_from_window_function_and_strips_it(self, fetch_all):
        fetch_all.return_value = [
            {"object_id": 1, "display_name": "a1", "source_id": "a1", "attributes": {}, "platform_name": "Windows", "total_count": 3},
        ]
        result = await list_access_assets(object(), "", 50, 0, "")
        self.assertEqual(result["total"], 3)
        self.assertNotIn("total_count", result["rows"][0])
        self.assertEqual(result["rows"][0]["platform_name"], "Windows")


if __name__ == "__main__":
    unittest.main()
