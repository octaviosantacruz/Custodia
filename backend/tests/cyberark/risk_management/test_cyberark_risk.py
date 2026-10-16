import asyncio
import json
import os
import pathlib
import re
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.cyberark.risk_management.integrations.risk_management import (
    RiskManagementClient,
    RiskManagementError,
    RiskManagementLimitError,
    RiskManagementNotConfigured,
    RiskManagementSettings,
)
from app.cyberark.risk_management.services.cyberark_risk import (
    get_public_findings,
    public_findings,
    public_remediations,
    public_risk_types,
)

RISK_ENTITIES_PERMISSION_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[4]
    / "migrations/073_cyberark_risk_entities_read_permission.sql"
)


class RiskManagementSettingsTests(unittest.TestCase):
    def test_derives_compass_host_from_the_privilege_cloud_tenant(self):
        environment = {
            "CA_PVWA_URL": "https://tenant-a.privilegecloud.cyberark.cloud/PasswordVault",
            "CA_IDENTITY_URL": "https://tenant-a.id.cyberark.cloud",
            "CA_CLIENT_ID": "client",
            "CA_CLIENT_SECRET": "secret",
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = RiskManagementSettings.from_environment()
        self.assertEqual(settings.base_url, "https://tenant-a.compass.cyberark.cloud")
        self.assertEqual(settings.token_url, "https://tenant-a.id.cyberark.cloud/oauth2/platformtoken")

    def test_rejects_a_non_privilege_cloud_tenant_host(self):
        with patch.dict(os.environ, {
            "CA_PVWA_URL": "https://tenant-a.example.test/PasswordVault",
            "CA_IDENTITY_URL": "https://tenant-a.id.cyberark.cloud",
            "CA_CLIENT_ID": "client",
            "CA_CLIENT_SECRET": "secret",
        }, clear=True):
            with self.assertRaises(RiskManagementNotConfigured):
                RiskManagementSettings.from_environment()


class RiskManagementClientTests(unittest.TestCase):
    def settings(self):
        return RiskManagementSettings(
            base_url="https://tenant-a.compass.cyberark.cloud",
            token_url="https://tenant-a.id.cyberark.cloud/oauth2/platformtoken",
            client_id="client",
            client_secret="secret",
        )

    def test_compass_surface_uses_only_get_and_paginates_with_offset(self):
        compass_requests = []

        def handler(request: httpx.Request):
            if request.url.host == "tenant-a.id.cyberark.cloud":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            compass_requests.append(request)
            offset = int(request.url.params["offset"])
            return httpx.Response(200, json={
                "riskTypes": [{"riskTypeId": f"risk-{offset}"}],
                "isLastPage": offset == 1,
                "limit": 100,
                "offset": offset,
            })

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with RiskManagementClient(self.settings(), http_client) as client:
                return await client.get_risk_types()

        rows = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual([row["riskTypeId"] for row in rows], ["risk-0", "risk-1"])
        self.assertEqual([request.method for request in compass_requests], ["GET", "GET"])
        self.assertEqual([request.url.params["offset"] for request in compass_requests], ["0", "1"])
        self.assertTrue(all("snooze" not in request.url.path for request in compass_requests))

    def test_rejects_a_page_without_the_confirmed_last_page_marker(self):
        def handler(request: httpx.Request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "token"})
            return httpx.Response(200, json={"findings": []})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with RiskManagementClient(self.settings(), http_client) as client:
                return await client.get_findings_page(50, 0)

        with self.assertRaises(RiskManagementError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())


    def _findings_client(self, pages: int, per_page: int):
        requests = []

        def handler(request: httpx.Request):
            if request.url.host == "tenant-a.id.cyberark.cloud":
                return httpx.Response(200, json={"access_token": "token", "expires_in": 300})
            requests.append(request)
            offset = int(request.url.params["offset"])
            page = offset // per_page
            return httpx.Response(200, json={
                "findings": [{"findingId": f"f-{offset + index}"} for index in range(per_page)],
                "isLastPage": page == pages - 1,
            })

        return httpx.AsyncClient(transport=httpx.MockTransport(handler)), requests

    def test_grouped_read_walks_every_findings_page_with_get(self):
        http_client, requests = self._findings_client(pages=3, per_page=100)

        async def exercise():
            async with RiskManagementClient(self.settings(), http_client) as client:
                return await client.get_all_findings()

        rows = asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        self.assertEqual(len(rows), 300)
        self.assertEqual([request.url.path for request in requests], ["/risks/findings"] * 3)
        self.assertEqual([request.url.params["offset"] for request in requests], ["0", "100", "200"])
        self.assertTrue(all(request.method == "GET" for request in requests))

    def test_grouped_read_stops_at_its_bound_with_a_limit_error(self):
        http_client, requests = self._findings_client(pages=100, per_page=100)

        async def exercise():
            async with RiskManagementClient(self.settings(), http_client) as client:
                return await client.get_all_findings()

        with self.assertRaises(RiskManagementLimitError):
            asyncio.run(exercise())
        asyncio.run(http_client.aclose())
        # Stops as soon as the bound is crossed instead of reading the whole tenant.
        self.assertEqual(len(requests), RiskManagementClient.MAX_GROUPED_FINDINGS // 100 + 1)


class RiskManagementAllowlistTests(unittest.TestCase):
    def test_entity_name_permission_is_granted_only_to_the_two_admin_roles(self):
        migration = RISK_ENTITIES_PERMISSION_MIGRATION.read_text(encoding="utf-8")
        role_grants = set(re.findall(r"\('([^']+)',\s*'pam:risk_entities_read'\)", migration))

        self.assertIn("'pam:risk_entities_read', 'pam', 'risk_entities', 'read'", migration)
        self.assertEqual(
            role_grants,
            {"admin", "cyberark_admin"},
        )
        self.assertNotIn("pam:risk_read", migration)

    def test_findings_expose_only_a_bounded_display_name_when_authorized(self):
        display_name = "person@example.test " + ("x" * 300)
        remote_row = {
            "findingId": "finding-1",
            "riskTypeId": "risk-1",
            "entityId": "opaque-entity-1",
            "entityType": "identity",
            "severity": "high",
            "status": "open",
            "createdAt": "2026-09-01T00:00:00Z",
            "updatedAt": "2026-10-01T00:00:00Z",
            "entityDisplayName": display_name,
            "email": "person@example.test",
            "freeText": "sensitive tenant context",
            "account": {"username": "secret-adjacent"},
        }

        rows_without_permission = public_findings([remote_row])
        self.assertEqual(set(rows_without_permission[0]), {
            "finding_id", "risk_type_id", "entity_id", "entity_type", "severity",
            "entity_name", "status", "first_detected_at", "last_detected_at",
        })
        serialized_without_permission = json.dumps(rows_without_permission)
        self.assertIsNone(rows_without_permission[0]["entity_name"])
        self.assertNotIn(display_name, serialized_without_permission)
        self.assertNotIn("person@example.test", serialized_without_permission)
        self.assertNotIn("sensitive tenant context", serialized_without_permission)

        rows_with_permission = public_findings([remote_row], include_entity_name=True)
        self.assertEqual(rows_with_permission[0]["entity_name"], display_name[:300])
        self.assertNotIn(display_name, json.dumps(rows_with_permission))
        row_without_remote_name = {key: value for key, value in remote_row.items() if key != "entityDisplayName"}
        rows_with_missing_name = public_findings([row_without_remote_name], include_entity_name=True)
        self.assertIsNone(rows_with_missing_name[0]["entity_name"])

    def test_findings_page_reports_name_visibility_for_current_and_legacy_contracts(self):
        client = AsyncMock()
        client.get_findings_page.return_value = {
            "findings": [{
                "findingId": "finding-1",
                "riskTypeId": "risk-1",
                "entityId": "opaque-entity-1",
                "entityDisplayName": "Visible entity",
            }],
            "isLastPage": True,
        }

        hidden = asyncio.run(get_public_findings(client, 50, 0))
        visible = asyncio.run(get_public_findings(client, 50, 0, include_entity_names=True))

        self.assertFalse(hidden["entity_names_visible"])
        self.assertIsNone(hidden["rows"][0]["entity_name"])
        self.assertTrue(visible["entity_names_visible"])
        self.assertEqual(visible["rows"][0]["entity_name"], "Visible entity")

    def test_catalog_mappers_keep_only_approved_product_content(self):
        risk_types = public_risk_types([{
            "riskTypeId": "risk-1", "riskTypeName": "Dormant account",
            "riskTypeDescription": "Review standing privilege", "severity": "medium",
            "entityType": "account", "openFindings": 2, "updatedAt": "2026-10-01",
            "remediationOptions": ["reduce-standing-access"],
            "findings": [{"status": "open", "count": 2}],
            "ownerEmail": "owner@example.test",
        }])
        remediations = public_remediations([{
            "id": "rem-1", "remediationType": "reduce-standing-access",
            "entityType": "account", "name": "Reduce standing access",
            "remediationText": "Review and reduce persistent access.",
            "targetUsername": "excluded-user",
        }])
        self.assertNotIn("ownerEmail", risk_types[0])
        self.assertNotIn("targetUsername", remediations[0])
        self.assertEqual(risk_types[0]["recommendation_types"], ["reduce-standing-access"])


if __name__ == "__main__":
    unittest.main()
