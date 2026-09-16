import unittest
from unittest.mock import AsyncMock, patch

from app.repositories.sia_queries import (
    list_sia_connectors, list_sia_database_accounts, list_sia_destinations, list_sia_policies, list_sia_resources,
)


class SiaDestinationQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_lists_destinations_without_optional_filters(self, fetch_all):
        fetch_all.return_value = []
        result = await list_sia_destinations(object(), "", 50, 0, "")
        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("WHERE TRUE", query)
        self.assertEqual(params, ("sia", "sia", "sia", 50, 0))

    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_applies_destination_type_and_search(self, fetch_all):
        fetch_all.return_value = []
        await list_sia_destinations(object(), "10.67", 25, 50, "ip")
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("destination_type = %s", query)
        self.assertIn("destination::text ILIKE %s", query)
        self.assertEqual(params, ("sia", "sia", "sia", "ip", "%10.67%", "%10.67%", 25, 50))


class SiaSafeLinkQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_links_literal_sia_ips_to_active_account_safes(self, fetch_all):
        fetch_all.side_effect = [
            [{
                "object_id": 1,
                "display_name": "Access policy",
                "source_id": "policy-1",
                "attributes": {"ip_rules": ["10.0.0.1", {"ipAddresses": ["10.0.0.2"]}]},
                "total_count": 1,
            }],
            [{
                "safe_number": 42, "safe_name": "Prod-Safe", "account_id": "acct-1",
                "account_name": "db-admin", "address": "10.0.0.2",
                "platform_name": "Unix", "platform_id": "unix",
                "address_key": "10.0.0.2",
            }],
        ]

        result = await list_sia_policies(object(), "", 50, 0, "")

        self.assertEqual(result["rows"][0]["linked_safes"], [{
            "safe_number": 42,
            "safe_name": "Prod-Safe",
            "matched_ips": ["10.0.0.2"],
            "accounts": [{
                "account_id": "acct-1", "account_name": "db-admin", "address": "10.0.0.2",
                "platform_name": "Unix", "platform_id": "unix",
            }],
        }])
        self.assertEqual(result["rows"][0]["linked_ip_count"], 1)
        self.assertIn("lower(trim(a.address)) = ANY(%s)", fetch_all.await_args_list[1].args[1])

    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_filters_linkage_status_after_exact_ip_enrichment(self, fetch_all):
        fetch_all.side_effect = [
            [
                {"object_id": 1, "display_name": "One Safe", "source_id": "p1", "attributes": {"ip_rules": ["10.0.0.1"]}},
                {"object_id": 2, "display_name": "No Safe", "source_id": "p2", "attributes": {"ip_rules": ["10.0.0.9"]}},
            ],
            [
                {"safe_number": 1, "safe_name": "A", "account_id": "a1", "account_name": "one", "address": "10.0.0.1", "platform_name": None, "platform_id": None, "address_key": "10.0.0.1"},
            ],
        ]

        result = await list_sia_policies(object(), "", 50, 0, "", "unlinked")

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["object_id"], 2)
        self.assertEqual(result["rows"][0]["linkage_status"], "unlinked")


class SiaConnectorQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_scopes_by_source_system_and_object_type(self, fetch_all):
        fetch_all.return_value = []
        result = await list_sia_connectors(object(), "", 50, 0)
        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("source_system = %s", query)
        self.assertIn("object_type = 'sia_connector'", query)
        self.assertEqual(params, ("sia", 50, 0))

    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_applies_search(self, fetch_all):
        fetch_all.return_value = []
        await list_sia_connectors(object(), "conn-01", 25, 10)
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("display_name ILIKE %s", query)
        self.assertEqual(params, ("sia", "%conn-01%", 25, 10))


class SiaResourceQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_scopes_by_source_system_and_object_type(self, fetch_all):
        fetch_all.return_value = []
        result = await list_sia_resources(object(), "", 50, 0)
        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("source_system = %s", query)
        self.assertIn("object_type = 'sia_resource'", query)
        self.assertEqual(params, ("sia", 50, 0))

    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_applies_search_and_resource_type_filter(self, fetch_all):
        fetch_all.return_value = []
        await list_sia_resources(object(), "web", 25, 10, "virtual_machine")
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("display_name ILIKE %s", query)
        self.assertIn("attributes->>'resource_type' = %s", query)
        self.assertEqual(params, ("sia", "%web%", "virtual_machine", 25, 10))


class SiaDatabaseAccountQueryTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_scopes_by_source_system_and_object_type(self, fetch_all):
        fetch_all.return_value = []
        result = await list_sia_database_accounts(object(), "", 50, 0)
        self.assertEqual(result["rows"], [])
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("source_system = %s", query)
        self.assertIn("object_type = 'sia_database_account'", query)
        self.assertEqual(params, ("sia", 50, 0))

    @patch("app.repositories.sia_queries.fetch_all", new_callable=AsyncMock)
    async def test_applies_search_across_name_platform_and_database(self, fetch_all):
        fetch_all.return_value = []
        await list_sia_database_accounts(object(), "app", 25, 10)
        query, params = fetch_all.await_args.args[1:]
        self.assertIn("display_name ILIKE %s", query)
        self.assertIn("attributes->>'platform' ILIKE %s", query)
        self.assertIn("attributes->>'database' ILIKE %s", query)
        self.assertEqual(params, ("sia", "%app%", "%app%", "%app%", 25, 10))
