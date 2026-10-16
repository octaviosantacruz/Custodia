"""Discovery contracts: complete associations, no payload leakage or auto-binding."""

import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient, AdvancedAnalyticsError, AdvancedAnalyticsSettings
from app.netskope.sse.services.netskope_aa_catalog import discover_catalog


class AaCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_report_relations_and_global_widgets_are_indexed_without_personal_data(self):
        def handler(request):
            self.assertEqual(request.method, "GET")
            path = request.url.path
            if path == "/api/v2/reporting/aa/reports":
                return httpx.Response(200, json={"data": [
                    {"report_id": 10, "report_name": "DLP person@example.test", "user": "private-owner"},
                    {"report_id": 20, "report_name": "Traffic"},
                ]})
            if path == "/api/v2/reporting/aa/widgets":
                return httpx.Response(200, json={"data": [
                    {"widget_id": 7, "widget_name": "Severity"}, {"widget_id": 8, "widget_name": "private-title"},
                ]})
            if path.endswith("/10/widgets"):
                return httpx.Response(200, json={"data": {"widgets": [
                    {"widget_id": 7, "widget_name": "DLP Severity person@example.test", "user_id": "private-user"},
                    {"widget_id": 9, "widget_name": "Top Policies"},
                ]}})
            if path.endswith("/20/widgets"):
                return httpx.Response(200, json={"data": {"widgets": [{"widget_id": 7, "widget_name": "Severity"}]}})
            self.fail("Discovery executed a data query")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            async with AdvancedAnalyticsClient(AdvancedAnalyticsSettings("https://tenant.example", "private-token"), http) as client:
                with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                    result = await discover_catalog(client)
        self.assertTrue(result["complete_for_returned_reports"])
        self.assertEqual(result["reports"]["10"]["widget_ids"], ["7", "9"])
        self.assertEqual(result["widgets"]["7"]["report_ids"], ["10", "20"])
        self.assertEqual(result["widgets"]["8"]["report_ids"], [])
        self.assertFalse(result["widgets"]["9"]["in_global_catalog"])
        self.assertEqual(result["metric_candidates"]["policies"], [
            {"report_id": "10", "widget_id": "9", "status": "unverified", "categories": ["policies"]},
        ])
        self.assertEqual(result["metric_bindings"], {})
        for secret in ("person@example.test", "private-owner", "private-user", "private-title", "private-token"):
            self.assertNotIn(secret, json.dumps(result))

    async def test_denied_malformed_and_duplicate_reports_never_become_complete_or_half_indexed(self):
        for bad_response in (
            httpx.Response(403, json={"message": "private-denial"}),
            httpx.Response(200, json={"data": {"widgets": None}}),
            httpx.Response(200, json={"data": {"widgets": [{"widget_id": 7}, {"widget_id": 7}]}}),
            httpx.Response(200, json={"data": {"widgets": [{"widget_id": 7}, {"widget_id": "../escape"}]}}),
        ):
            with self.subTest(status=bad_response.status_code):
                def handler(request, bad_response=bad_response):
                    if request.url.path.endswith("/reports"):
                        return httpx.Response(200, json={"data": [{"report_id": 1}, {"report_id": 2}]})
                    if request.url.path.endswith("/1/widgets"):
                        return bad_response
                    return httpx.Response(200, json={"data": []})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                    async with AdvancedAnalyticsClient(AdvancedAnalyticsSettings("https://tenant.example", "token"), http) as client:
                        with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                            result = await discover_catalog(client)
                self.assertFalse(result["complete_for_returned_reports"])
                self.assertEqual(result["unavailable_reports"], 1)
                self.assertEqual(result["reports"]["1"]["status"], "unavailable")
                self.assertEqual(result["reports"]["2"]["status"], "discovered")
                self.assertEqual(result["widgets"], {})
                self.assertNotIn("private-denial", json.dumps(result))

    async def test_invalid_global_catalog_fails_instead_of_claiming_an_empty_inventory(self):
        for payload in ({"data": None}, {"data": [{"widget_id": True}]}, {"data": [{"widget_id": 1}, {"widget_id": 1}]}):
            def handler(request, payload=payload):
                return httpx.Response(200, json={"data": []} if request.url.path.endswith("/reports") else payload)

            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                async with AdvancedAnalyticsClient(AdvancedAnalyticsSettings("https://tenant.example", "token"), http) as client:
                    with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                        with self.assertRaises(AdvancedAnalyticsError):
                            await discover_catalog(client)
