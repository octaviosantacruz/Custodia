"""AA discovery is bounded, GET-only and never exposes payload values."""

import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import httpx

SPEC = importlib.util.spec_from_file_location(
    "netskope_aa_probe", Path(__file__).resolve().parents[3] / "scripts/probe_netskope_aa.py",
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class NetskopeAaProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_discovery_bounds_requests_and_redacts_values_and_object_keys(self):
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual(request.method, "GET")
            if request.url.path.endswith("/reports"):
                body = {"data": [{"report_id": "r-private", "user": "secret@example.test"}]}
            elif request.url.path.endswith("/widgets"):
                body = {"data": {"report": {"report_id": "r-private"}, "widget_count": 10,
                                 "widgets": [{"widget_id": f"w-{i}", "widget_name": "Private name"} for i in range(10)]}}
            else:
                self.assertEqual(request.url.params["limit"], "1")
                self.assertEqual(request.url.params["resultFormat"], "json")
                body = {"data": [{"secret@example.test": "private-value", "total": 123}]}
            return httpx.Response(200, json=body)

        async with httpx.AsyncClient(base_url="https://tenant.example", transport=httpx.MockTransport(handler)) as client:
            with patch.object(probe.asyncio, "sleep", new=AsyncMock()):
                result = await probe.discover(client)
        self.assertEqual(len(requests), 5)
        serialized = json.dumps(result)
        for value in ("r-private", "w-0", "secret@example.test", "Private name", "private-value", "123"):
            self.assertNotIn(value, serialized)
        self.assertEqual(result["results"][-1]["shape"]["data_shape"]["row_count"], 1)

    async def test_denied_catalog_stops_without_following_unknown_ids(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(403, json={"message": "sensitive error"})

        async with httpx.AsyncClient(base_url="https://tenant.example", transport=httpx.MockTransport(handler)) as client:
            with patch.object(probe.asyncio, "sleep", new=AsyncMock()):
                result = await probe.discover(client)
        self.assertEqual(len(requests), 1)
        self.assertEqual(result["results"][0]["http_status"], 403)
        self.assertNotIn("sensitive error", json.dumps(result))


    async def test_csv_widget_sample_reports_only_dimensions(self):
        def handler(request):
            if request.url.path.endswith("/reports"):
                return httpx.Response(200, json={"data": [{"report_id": "1"}]})
            if request.url.path.endswith("/widgets"):
                return httpx.Response(200, json={"data": {"widgets": [{"widget_id": "2"}]}})
            return httpx.Response(200, text="private-header,count\nsecret@example.test,123\n", headers={"content-type": "text/csv"})

        async with httpx.AsyncClient(base_url="https://tenant.example", transport=httpx.MockTransport(handler)) as client:
            with patch.object(probe.asyncio, "sleep", new=AsyncMock()):
                result = await probe.discover(client)
        self.assertEqual(result["results"][-1]["shape"], {"type": "csv", "row_count": 1, "column_count": 2})
        self.assertNotIn("secret@example.test", json.dumps(result))
        self.assertNotIn("private-header", json.dumps(result))


    async def test_dlp_async_discovery_selects_candidate_and_redacts_results(self):
        requests = []

        def handler(request):
            requests.append(request)
            path = request.url.path
            if path.endswith("/reports"):
                return httpx.Response(200, json={"data": [
                    {"report_id": "personal", "report_name": "DLP Users secret@example.test"},
                    {"report_id": "aggregate", "report_name": "DLP Overview"},
                ]})
            if path.endswith("/widgets"):
                self.assertIn("/aggregate/", path)
                return httpx.Response(200, json={"data": {"widgets": [
                    {"widget_id": "private", "widget_name": "DLP Users Trend"},
                    {"widget_id": "severity", "widget_name": "DLP Severity"},
                ]}})
            if path.endswith("/async"):
                self.assertEqual(request.method, "POST")
                self.assertIn("/severity/async", path)
                return httpx.Response(201, json={"query_task_id": "private-task"})
            if path.endswith("/status"):
                return httpx.Response(200, json={"status": "complete"})
            return httpx.Response(200, text="private-header,count\nsecret@example.test,999\n", headers={"content-type": "text/csv"})

        async with httpx.AsyncClient(base_url="https://tenant.example", headers={"Netskope-API-Token": "private-token"}, transport=httpx.MockTransport(handler)) as client:
            with patch.object(probe.asyncio, "sleep", new=AsyncMock()):
                result = await probe.discover(client, topic="dlp", async_query=True)
        self.assertEqual(len(requests), 5)
        self.assertFalse(result["read_only"])
        self.assertTrue(result["creates_query_task"])
        self.assertEqual(result["results"][-1]["shape"], {"type": "csv", "row_count": 1, "column_count": 2})
        for private in ("secret@example.test", "private-task", "private-token", "private-header", "999", "DLP Overview"):
            self.assertNotIn(private, json.dumps(result))
