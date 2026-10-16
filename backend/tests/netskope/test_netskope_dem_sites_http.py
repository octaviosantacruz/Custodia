"""The DEM sites route keeps the Netskope read gate and its safe projection."""

import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class NetskopeDemSitesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_netskope_reader_can_filter_sites_without_location_leak(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        now = datetime.now(timezone.utc)
        listing = AsyncMock(return_value={
            "rows": [{"id": "site:1", "name": "Site 1", "num_gateways": 1,
                      "pop_tracing": {"method": "icmp-paris"},
                      "first_seen_at": now, "last_seen_at": now}],
            "total": 1, "last_observed_at": now,
        })
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_dem_sites", new=listing), \
                patch("app.netskope.sse.api.routes.cmdb_netskope.netskope_dem_sites_configured", return_value=True):
            response = await self.client.get("/api/cmdb/netskope/dem/sites", params={"q": " Site ", "limit": 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(listing.await_args.args[1:], ("Site", 10, 0))
        self.assertEqual(response.json()["rows"][0]["pop_tracing"]["method"], "icmp-paris")
        self.assertNotIn("location", response.json()["rows"][0])

    async def test_non_netskope_reader_cannot_open_dem_sites(self):
        self.session.set_permissions(["inventory:read"])
        listing = AsyncMock()
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_dem_sites", new=listing):
            response = await self.client.get("/api/cmdb/netskope/dem/sites")
        self.assertEqual(response.status_code, 403)
        listing.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
