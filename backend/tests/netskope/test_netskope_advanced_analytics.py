"""AA transport contract: bounded tasks, actual formats and no task replay."""

import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient, AdvancedAnalyticsError, AdvancedAnalyticsSettings
from app.netskope.sse.integrations.netskope import NetskopeSettings


class AdvancedAnalyticsTests(unittest.IsolatedAsyncioTestCase):
    def settings(self, base="https://tenant.example"):
        return NetskopeSettings(base, "private-token", "", "", "")

    async def test_aa_credentials_are_independent_of_inventory_contract_and_errors_are_controlled(self):
        with patch.dict(os.environ, {"NETSKOPE_URL": "https://tenant.example", "NETSKOPE_API_TOKEN": "test-only-token"}, clear=True):
            settings = AdvancedAnalyticsSettings.from_environment()
            self.assertEqual(settings.base_url, "https://tenant.example")
            self.assertNotIn("test-only-token", repr(settings))
        with patch.dict(os.environ, {"NETSKOPE_URL": "https://tenant.example", "NETSKOPE_API_TOKEN_FILE": "/tmp/custodia-aa-nonexistent-secret"}, clear=True):
            with self.assertRaises(AdvancedAnalyticsError):
                AdvancedAnalyticsSettings.from_environment()

    async def test_task_waits_for_completion_and_honors_actual_csv_format(self):
        requests = []
        states = iter(["running", "complete"])

        def handler(request):
            requests.append((request.method, request.url.path))
            self.assertEqual(request.headers["Netskope-API-Token"], "private-token")
            if request.method == "POST":
                self.assertEqual(dict(request.url.params), {"limit": "2", "resultFormat": "json"})
                return httpx.Response(201, json={"query_task_id": "task-1"})
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": next(states)})
            return httpx.Response(200, text='\ufeffdate,total\n2026-10-01,12\n2026-10-02,15\n', headers={"content-type": "text/csv; charset=utf-8"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            async with AdvancedAnalyticsClient(self.settings(), http) as client:
                with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                    result = await client.query_widget("report-1", "widget-1", limit=2)
            self.assertFalse(http.is_closed)  # Caller-owned transport remains usable.
        self.assertEqual(result.format, "csv")
        self.assertEqual(result.payload, [["date", "total"], ["2026-10-01", "12"], ["2026-10-02", "15"]])
        self.assertEqual(requests, [
            ("POST", "/api/v2/reporting/aa/reports/report-1/widgets/widget-1/async"),
            ("GET", "/api/v2/reporting/aa/tasks/task-1/status"),
            ("GET", "/api/v2/reporting/aa/tasks/task-1/status"),
            ("GET", "/api/v2/reporting/aa/tasks/task-1/result"),
        ])

    async def test_unfinished_or_failed_tasks_never_fetch_results(self):
        for state, expected_count in [("running", 4), ("failed", 2), (None, 2)]:
            with self.subTest(state=state):
                requests = []

                def handler(request, requests=requests, state=state):
                    requests.append(request)
                    return httpx.Response(201, json={"query_task_id": "task"}) if request.method == "POST" else httpx.Response(200, json={"status": state})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                    async with AdvancedAnalyticsClient(self.settings(), http) as client:
                        with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                            with self.assertRaises(AdvancedAnalyticsError):
                                await client.query_widget("report", "widget", max_polls=3)
                self.assertEqual(len(requests), expected_count)
                self.assertEqual(sum(r.method == "POST" for r in requests), 1)
                self.assertFalse(any(r.url.path.endswith("/result") for r in requests))

    async def test_creation_errors_are_redacted_and_not_replayed(self):
        cases = ["network", "http", "invalid_task", "redirect"]
        for case in cases:
            with self.subTest(case=case):
                requests = []

                def handler(request, requests=requests, case=case):
                    requests.append(request)
                    if case == "network":
                        raise httpx.ReadTimeout("private-token tenant-secret", request=request)
                    if case == "http":
                        return httpx.Response(500, json={"error": "tenant-secret"})
                    if case == "redirect":
                        return httpx.Response(302, headers={"location": "https://evil.example"})
                    return httpx.Response(201, json={"query_task_id": "../../tenant-secret"})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True) as http:
                    async with AdvancedAnalyticsClient(self.settings(), http) as client:
                        with self.assertRaises(AdvancedAnalyticsError) as caught:
                            await client.query_widget("report", "widget")
                self.assertEqual(len(requests), 1)
                self.assertNotIn("private-token", str(caught.exception))
                self.assertNotIn("tenant-secret", str(caught.exception))

    async def test_invalid_host_identifiers_and_limits_fail_before_io(self):
        for base in ["http://tenant.example", "https://user:secret@tenant.example", "https://tenant.example/path", "https://tenant.example?x=1"]:
            with self.subTest(base=base), self.assertRaises(AdvancedAnalyticsError):
                AdvancedAnalyticsClient(self.settings(base))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: self.fail("Unexpected request"))) as http:
            async with AdvancedAnalyticsClient(self.settings(), http) as client:
                for report, widget, options in [("../other", "widget", {}), ("report", "widget", {"limit": 10001}), ("report", "widget", {"limit": True}), ("report", "widget", {"max_polls": 0})]:
                    with self.subTest(options=options), self.assertRaises(AdvancedAnalyticsError):
                        await client.query_widget(report, widget, **options)

    async def test_result_formats_and_malformed_or_oversized_payloads(self):
        cases = [
            ("application/json", json.dumps({"data": [{"count": 7}]}), {"data": [{"count": 7}]}),
            ("application/json", "broken", None),
            ("text/csv", "a,b\n1,2,3\n", None),
            ("text/html", "private content", None),
            ("text/csv", "a" * (AdvancedAnalyticsClient.MAX_BYTES + 1), None),
        ]
        for content_type, body, expected in cases:
            with self.subTest(content_type=content_type, valid=expected is not None):
                def handler(request, content_type=content_type, body=body):
                    if request.method == "POST":
                        return httpx.Response(201, json={"query_task_id": "task"})
                    if request.url.path.endswith("/status"):
                        return httpx.Response(200, json={"status": "complete"})
                    return httpx.Response(200, text=body, headers={"content-type": content_type})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                    async with AdvancedAnalyticsClient(self.settings(), http) as client:
                        with patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                            if expected is None:
                                with self.assertRaises(AdvancedAnalyticsError):
                                    await client.query_widget("report", "widget")
                            else:
                                self.assertEqual((await client.query_widget("report", "widget")).payload, expected)

    async def test_server_rate_limit_consumes_deadline_without_early_polling(self):
        now = [0.0]
        request_times = []

        async def sleep(seconds):
            now[0] += seconds

        def handler(request):
            request_times.append(now[0])
            if request.method == "POST":
                return httpx.Response(201, json={"query_task_id": "task"}, headers={"RateLimit-Remaining": "0", "RateLimit-Reset": "7"})
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "complete"})
            return httpx.Response(200, json={"data": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            async with AdvancedAnalyticsClient(self.settings(), http) as client:
                with patch("app.netskope.sse.integrations.advanced_analytics.time.monotonic", side_effect=lambda: now[0]), patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", side_effect=sleep):
                    await client.query_widget("report", "widget", deadline_seconds=10)
        self.assertEqual(request_times, [0, 7, 7])
        request_times.clear()
        now[0] = 0
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            async with AdvancedAnalyticsClient(self.settings(), http) as client:
                with patch("app.netskope.sse.integrations.advanced_analytics.time.monotonic", side_effect=lambda: now[0]), self.assertRaises(AdvancedAnalyticsError):
                    await client.query_widget("report", "widget", deadline_seconds=5)
        self.assertEqual(request_times, [0])
