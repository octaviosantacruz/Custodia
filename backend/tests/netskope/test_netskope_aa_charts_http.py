"""AA chart routes: permission, no tenant IDs in responses, shared cache and count-only audit."""

import os
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsClient
from app.netskope.sse.services.netskope_aa_charts import CHARTS_ENV
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from tests.support.netskope_aa import SETTINGS
from tests.netskope.test_netskope_aa_charts import ENTRY, MAP


class AaChartHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(lambda: setattr(app.state, "netskope_aa_chart_cache", None))
        app.state.netskope_aa_chart_cache = None
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.audit = self.stack.enter_context(patch("app.netskope.sse.api.routes.netskope_aa.record_audit", new=AsyncMock()))
        self.stack.enter_context(patch.dict(os.environ, {CHARTS_ENV: MAP}))
        self.stack.enter_context(patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsSettings.from_environment", return_value=SETTINGS))

    async def test_reader_lists_charts_and_reads_one_without_tenant_ids(self):
        self.session.set_permissions(["netskope:read"])
        requests = []

        def handler(request):
            requests.append(request)
            if request.method == "POST":
                return httpx.Response(201, json={"query_task_id": "private-task"})
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "complete"})
            return httpx.Response(200, text="GDPR Level, # Applications\nLow,691\nHigh,327\n", headers={"content-type": "text/csv"})

        listing = await self.client.get("/api/cmdb/netskope/aa/charts")
        self.assertEqual(listing.json(), [{"id": "aa_gdpr_levels", "title": ENTRY["title"], "unit": "aplicaciones", "period": "Catálogo actual"}])
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as remote:
            with patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsClient", side_effect=lambda settings: AdvancedAnalyticsClient(settings, remote)), \
                    patch("app.netskope.sse.integrations.advanced_analytics.asyncio.sleep", new=AsyncMock()):
                first = await self.client.get("/api/cmdb/netskope/aa/charts/gdpr_levels")
                second = await self.client.get("/api/cmdb/netskope/aa/charts/gdpr_levels")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["total"], 1018)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(len(requests), 3)
        for private in ("private-task", "test-token", "170", "288017", "report_id", "widget_id"):
            self.assertNotIn(private, listing.text + first.text)
        self.assertEqual(self.audit.await_args.kwargs["after_data"], {"state": "ready", "bucket_count": 2})
        self.assertEqual(self.audit.await_args.kwargs["entity_id"], "chart:gdpr_levels")

    async def test_unknown_key_invalid_map_and_other_roles_never_reach_netskope(self):
        self.session.set_permissions(["netskope:read"])
        with patch("app.netskope.sse.services.netskope_aa_charts.AdvancedAnalyticsClient") as factory:
            self.assertEqual((await self.client.get("/api/cmdb/netskope/aa/charts/missing")).status_code, 404)
            with patch.dict(os.environ, {CHARTS_ENV: "[]"}):
                self.assertEqual((await self.client.get("/api/cmdb/netskope/aa/charts")).status_code, 503)
                self.assertEqual((await self.client.get("/api/cmdb/netskope/aa/charts/gdpr_levels")).status_code, 503)
            for permissions in (["inventory:read"], ["access:manage"], ["netskope:dlp_read"]):
                self.session.set_permissions(permissions)
                self.assertEqual((await self.client.get("/api/cmdb/netskope/aa/charts")).status_code, 403)
                self.assertEqual((await self.client.get("/api/cmdb/netskope/aa/charts/gdpr_levels")).status_code, 403)
        factory.assert_not_called()
        self.audit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
