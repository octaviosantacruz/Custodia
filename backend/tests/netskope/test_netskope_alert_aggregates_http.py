"""The alert aggregate route preserves explicit missing-total availability."""

from contextlib import ExitStack
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class NetskopeAlertAggregatesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()
        self.session.set_permissions(["inventory:read", "netskope:read"])

    async def test_alert_route_returns_null_total_and_incomplete_availability(self):
        captured_at = datetime(2026, 10, 2, tzinfo=timezone.utc)
        aggregate = {
            "windows": [{
                "days": 7,
                "window_start": datetime(2026, 9, 25, tzinfo=timezone.utc),
                "window_end": captured_at,
                "captured_at": captured_at,
                "total": None,
                "availability": "incomplete",
                "by_alert_type": [{"key": "DLP", "count": 4}],
                "by_severity": [],
                "by_action": [],
            }],
        }
        with patch(
            "app.netskope.sse.api.routes.cmdb_netskope.get_netskope_alert_aggregates",
            new=AsyncMock(return_value=aggregate),
        ):
            response = await self.client.get("/api/cmdb/netskope/alerts")

        self.assertEqual(response.status_code, 200, response.text)
        window = response.json()["windows"][0]
        self.assertIsNone(window["total"])
        self.assertEqual(window["availability"], "incomplete")
        self.assertEqual([(b["key"], b["count"]) for b in window["by_alert_type"]], [("DLP", 4)])


if __name__ == "__main__":
    unittest.main()
