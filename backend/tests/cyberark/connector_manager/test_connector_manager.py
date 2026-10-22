import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.cyberark.connector_manager.integrations.connector_manager import (
    ConnectorManagerClient,
    ConnectorManagerError,
    ConnectorManagerNotConfigured,
    ConnectorManagerSettings,
)
from app.cyberark.connector_manager.services.catalogs import get_catalog


SETTINGS = ConnectorManagerSettings(
    "https://tenant.connectormanagement.cyberark.cloud",
    "https://tenant.id.cyberark.cloud/oauth2/platformtoken", "client", "private-secret",
)


class ConnectorManagerTests(unittest.IsolatedAsyncioTestCase):
    async def read(self, handler, kind="pools"):
        def transport(request):
            if request.url.host == "tenant.id.cyberark.cloud":
                return httpx.Response(200, json={"access_token": "private-token"})
            return handler(request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
            async with ConnectorManagerClient(SETTINGS, http) as client:
                return await get_catalog(client, kind)

    async def test_complete_pools_follow_both_cursor_formats_and_exclude_network_values(self):
        for camel in (True, False):
            with self.subTest(camel=camel):
                requests = []
                def handler(request, requests=requests, camel=camel):
                    requests.append(request)
                    second = "continuation_token" in request.url.params
                    row = {
                        "id": "pool-2" if second else "pool-1", "name": "Pool de operaciones",
                        "description": "Acceso a destinos", "createdAt": "2026-10-01T01:00:00+01:00", "updatedAt": "2026-10-02T00:00:00Z",
                        "assignedNetworkIds": ["private-network-id"], "identifiersCount": 2,
                        "componentsCount": {"PLATFORM_CONNECTOR": 0, "ACCESS_CONNECTOR": 3, "private-host.example": 99},
                        "identifiers": [{"value": "10.11.12.13"}], "hostname": "private-host.example", "ip": "10.11.12.13",
                        "componentPayload": {"secret": "private-token"},
                    }
                    page = {"continuationToken" if camel else "continuation_token": None if second else "opaque+/=&cursor",
                            "totalResourcesCount" if camel else "total_resources_count": 2}
                    return httpx.Response(200, json={"resources": [row], "page": page})
                result = await self.read(handler)
                self.assertEqual(result["total"], 2)
                self.assertEqual(result["source_system"], "cyberark_connector_manager")
                self.assertTrue(result["queried_at"])
                self.assertEqual(result["rows"][0], {
                    "id": "pool-1", "name": "Pool de operaciones", "description": "Acceso a destinos",
                    "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-02T00:00:00+00:00",
                    "assigned_network_count": 1, "identifiers_count": 2,
                    "platform_connectors_count": 0, "access_connectors_count": 3,
                })
                self.assertEqual([request.method for request in requests], ["GET", "GET"])
                self.assertTrue(all(request.url.path == "/api/pool-service/pools" for request in requests))
                self.assertTrue(all(request.url.params["projection"] == "EXTENDED" for request in requests))
                self.assertTrue(all(request.url.params["page_size"] == "100" for request in requests))
                self.assertEqual(requests[1].url.params["continuation_token"], "opaque+/=&cursor")
                for private in ("10.11.12.13", "private-host.example", "private-network-id", "private-token"):
                    self.assertNotIn(private, json.dumps(result))

    async def test_networks_expose_only_association_counts_and_missing_pool_counts_stay_unknown(self):
        rows = [{"id": "n1", "name": "Red operativa", "assignedPools": [{"id": "private-pool-id", "name": "private-host.example"}], "networkValues": ["10.0.0.0/8"]},
                {"id": "n2", "name": "Sin información", "assignedPools": None}]
        result = await self.read(lambda _: httpx.Response(200, json={"resources": rows}), "networks")
        self.assertEqual(result["rows"][0], {"id": "n1", "name": "Red operativa", "assigned_pool_count": 1, "created_at": None, "updated_at": None})
        self.assertIsNone(result["rows"][1]["assigned_pool_count"])
        self.assertNotIn("private-", json.dumps(result))
        self.assertNotIn("10.0.0.0", json.dumps(result))
        missing = await self.read(lambda _: httpx.Response(200, json={"resources": [{"id": "p", "name": "Sin conteos", "identifiersCount": True, "componentsCount": {"ACCESS_CONNECTOR": -1}}]}))
        self.assertIsNone(missing["rows"][0]["identifiers_count"])
        self.assertIsNone(missing["rows"][0]["platform_connectors_count"])
        self.assertIsNone(missing["rows"][0]["access_connectors_count"])

    async def test_malformed_incomplete_or_looping_pages_never_become_a_successful_inventory(self):
        row = {"id": "p1", "name": "Pool"}
        cases = [
            {"resources": None},
            {"resources": [None]},
            {"resources": [{"name": "Sin ID"}]},
            {"resources": [{"id": "p1"}]},
            {"resources": [row, row]},
            {"resources": [row], "page": None},
            {"resources": [row], "page": {"totalResourcesCount": 2}},
            {"resources": [row], "page": {"totalResourcesCount": True}},
            {"resources": [row], "page": {"totalResourcesCount": 0}},
            {"resources": [], "page": {"continuationToken": "next"}},
            {"resources": [row], "page": {"continuationToken": 42}},
            {"resources": [row], "page": {"continuationToken": None, "continuation_token": "next"}},
        ]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(ConnectorManagerError):
                await self.read(lambda _, payload=payload: httpx.Response(200, json=payload))
        requests = []
        def repeating(request):
            requests.append(request)
            return httpx.Response(200, json={"resources": [{"id": str(len(requests)), "name": "Pool"}], "page": {"continuationToken": "same"}})
        with self.assertRaises(ConnectorManagerError):
            await self.read(repeating)
        self.assertEqual(len(requests), 2)

    async def test_bounds_and_changing_totals_abort_the_full_read(self):
        for issue in ("pages", "items", "changing_total"):
            with self.subTest(issue=issue):
                requests = []
                def handler(request, requests=requests, issue=issue):
                    requests.append(request)
                    index = len(requests)
                    page = {"continuationToken": str(index)}
                    if index == 2 and issue in ("items", "changing_total"):
                        page["continuationToken"] = None
                    if issue == "changing_total":
                        page["totalResourcesCount"] = 3 if index == 1 else 2
                    return httpx.Response(200, json={"resources": [{"id": str(index), "name": "Pool"}], "page": page})
                with patch.object(ConnectorManagerClient, "MAX_PAGES", 2), patch.object(ConnectorManagerClient, "MAX_ITEMS", 1 if issue == "items" else 100), self.assertRaises(ConnectorManagerError):
                    await self.read(handler)
                self.assertEqual(len(requests), 2)

    async def test_empty_catalog_is_valid_but_a_later_http_failure_discards_earlier_rows(self):
        result = await self.read(lambda _: httpx.Response(200, json={"resources": [], "page": {"totalResourcesCount": 0, "continuationToken": None}}))
        self.assertEqual((result["total"], result["rows"]), (0, []))
        requests = []
        def fail_second(request):
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(200, json={"resources": [{"id": "p", "name": "Pool"}], "page": {"continuationToken": "next"}})
            return httpx.Response(403, json={"message": "private-token"})
        with self.assertRaises(ConnectorManagerError) as raised:
            await self.read(fail_second)
        self.assertNotIn("private-token", str(raised.exception))


class ConnectorManagerSettingsTests(unittest.TestCase):
    def test_uses_the_shared_tenant_contract_without_exposing_the_secret(self):
        env = {"CA_PVWA_URL": "https://tenant.privilegecloud.cyberark.cloud/PasswordVault", "CA_IDENTITY_URL": "https://tenant.id.cyberark.cloud", "CA_CLIENT_ID": "client", "CA_CLIENT_SECRET": "private-secret"}
        with patch.dict(os.environ, env, clear=True):
            settings = ConnectorManagerSettings.from_environment()
        self.assertEqual(settings, SETTINGS)
        self.assertNotIn("private-secret", repr(settings))
        for change in ({"CA_CLIENT_SECRET": "", "CA_SECRET_FILE": "/nonexistent"}, {"CA_PVWA_URL": "https://tenant.example.test"}, {"CA_IDENTITY_URL": "http://tenant.id.cyberark.cloud"}):
            with self.subTest(change=change), patch.dict(os.environ, {**env, **change}, clear=True), self.assertRaises(ConnectorManagerNotConfigured):
                ConnectorManagerSettings.from_environment()
