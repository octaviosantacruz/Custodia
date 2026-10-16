"""Authenticated AA read path: real mapping/cache, bounded HTTP and count audit."""

import json
import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from tests.support.netskope_aa import CONTRACT, SETTINGS, approval_for
from app.netskope.sse.services.netskope_aa_metrics import CONTRACT_ENV


class AaHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        if hasattr(app.state, "netskope_aa_severity_cache"):
            del app.state.netskope_aa_severity_cache
        self.addCleanup(lambda: setattr(app.state, "netskope_aa_severity_cache", None))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.audit = self.stack.enter_context(patch("app.netskope.sse.api.routes.netskope_aa.record_audit", new=AsyncMock()))
        self.stack.enter_context(patch.dict(os.environ, {CONTRACT_ENV: json.dumps(CONTRACT), "NETSKOPE_AA_SEVERITY_APPROVAL_JSON": json.dumps(approval_for())}))
        self.stack.enter_context(patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsSettings.from_environment", return_value=SETTINGS))

    async def test_reader_uses_remote_aggregate_and_shared_memory_result_with_safe_audit(self):
        self.session.set_permissions(["netskope:read"])
        requests = []

        def handler(request):
            requests.append(request)
            if request.method == "POST":
                return httpx.Response(201, json={"query_task_id": "private-task"})
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "complete", "owner": "secret@example.test"})
            return httpx.Response(200, text="severity,count\nHigh,12\nLow,3\n", headers={"content-type": "text/csv"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as remote:
            with patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsClient", side_effect=lambda settings: AdvancedAnalyticsClient(settings, remote)), patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                first = await self.client.get("/api/cmdb/netskope/aa/severity")
                second = await self.client.get("/api/cmdb/netskope/aa/severity")
        self.session.set_permissions(["inventory:read"])
        denied_cached = await self.client.get("/api/cmdb/netskope/aa/severity")
        self.assertEqual(denied_cached.status_code, 403)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(first.json()["total"], 15)
        self.assertEqual(first.json()["window_days"], 30)
        self.assertEqual(len(requests), 3)
        for private in ("private-task", "secret@example.test", "test-token", "report_id", "widget_id"):
            self.assertNotIn(private, first.text)
        self.assertEqual(self.audit.await_count, 2)
        self.assertEqual(self.audit.await_args.kwargs["after_data"], {"state": "ready", "bucket_count": 2})

    async def test_non_netskope_roles_cannot_read_or_initiate_remote_tasks(self):
        for permissions in (["inventory:read"], ["access:manage"], ["netskope:dlp_read"]):
            self.session.set_permissions(permissions)
            with patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsClient") as factory:
                response = await self.client.get("/api/cmdb/netskope/aa/severity")
            self.assertEqual(response.status_code, 403)
            factory.assert_not_called()
        self.audit.assert_not_awaited()

    async def test_unconfigured_and_invalid_contracts_are_explicit_without_remote_access(self):
        self.session.set_permissions(["netskope:read"])
        with patch.dict(os.environ, {CONTRACT_ENV: ""}):
            response = await self.client.get("/api/cmdb/netskope/aa/severity")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "not_configured")
        self.assertIsNone(response.json()["total"])
        with patch.dict(os.environ, {CONTRACT_ENV: '{"private": "secret@example.test"}'}):
            response = await self.client.get("/api/cmdb/netskope/aa/severity")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret@example.test", response.text)

    async def test_registry_exposes_23_semantic_contracts_without_querying_candidates(self):
        self.session.set_permissions(["netskope:read"])
        with patch.dict(os.environ, {"NETSKOPE_AA_SEVERITY_APPROVAL_JSON": ""}), patch(
            "app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsClient",
        ) as factory:
            response = await self.client.get("/api/dashboard/netskope/contracts")
        self.assertEqual(response.status_code, 200)
        contracts = response.json()
        self.assertEqual(len(contracts), 23)
        self.assertEqual(sum(row["kind"] == "data" for row in contracts), 11)
        by_id = {row["id"]: row for row in contracts}
        self.assertEqual(by_id["users_total"]["filter_keys"], ["company"])
        self.assertEqual(by_id["devices_by_os"]["top_n"], 8)
        self.assertEqual(by_id["alerts_30d"]["windows_days"], [30])
        self.assertEqual(by_id["alerts_30d"]["unit"], "alerts")
        self.assertEqual(by_id["alerts_30d"]["adapter"]["captured_at"], "captured_at")
        self.assertNotIn("alerts_by_policy", by_id)
        severity = by_id["alerts_by_severity"]
        self.assertEqual(severity["contract_state"], "pending_validation")
        self.assertEqual(severity["adapter"]["queried_at"], "fetched_at")
        self.assertIsNone(severity["adapter"]["window_end"])
        for private in ("report_id", "widget_id", "test-token"):
            self.assertNotIn(private, response.text)
        factory.assert_not_called()
        approved = await self.client.get("/api/dashboard/netskope/contracts")
        approved_severity = next(row for row in approved.json() if row["id"] == "alerts_by_severity")
        self.assertEqual(approved_severity["contract_state"], "verified")
        self.assertEqual(approved_severity["scope"], "dlp")
        self.assertEqual(approved_severity["unit"], "incidents")
        self.assertEqual(approved_severity["windows_days"], [30])
        self.assertEqual(approved_severity["version"], 1)
        self.session.set_permissions(["access:manage"])
        self.assertEqual((await self.client.get("/api/dashboard/netskope/contracts")).status_code, 403)

    async def test_remote_failures_are_not_zero_metrics_or_payload_leaks(self):
        self.session.set_permissions(["netskope:read"])
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500, json={"secret": "secret@example.test"}))) as remote:
            with patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsClient", side_effect=lambda settings: AdvancedAnalyticsClient(settings, remote)):
                response = await self.client.get("/api/cmdb/netskope/aa/severity")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("secret@example.test", response.text)
        self.audit.assert_not_awaited()
