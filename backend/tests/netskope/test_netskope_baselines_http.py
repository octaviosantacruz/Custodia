"""NSK-VER-001 / NSK-FLT-001: baseline writes need netskope:admin, input is
validated and normalized before it reaches the repository."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

SAVED = {"value": {}, "note": None, "updated_by": "actor-1", "updated_at": "2026-09-23T00:00:00Z"}


class NetskopeBaselinesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_reading_needs_the_catalog_permission(self):
        self.session.set_permissions(["inventory:read"])
        self.assertEqual((await self.client.get("/api/netskope/baselines")).status_code, 403)
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch("app.netskope.sse.api.routes.netskope_baselines.get_netskope_baselines", new=AsyncMock(return_value={"client_golden_releases": None, "os_minimum_versions": None})):
            response = await self.client.get("/api/netskope/baselines")
        self.assertEqual(response.status_code, 200)

    async def test_writing_needs_netskope_admin_and_stores_releases_newest_first(self):
        payload = {"releases": ["135.0.0", " 141.0.0 ", "138.1.0"], "note": "  Golden según doc 2026-09  "}
        self.session.set_permissions(["inventory:read", "netskope:read"])
        denied = await self.client.put("/api/netskope/baselines/client-golden-releases", json=payload)
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:admin"])
        save = AsyncMock(return_value=SAVED)
        with patch("app.netskope.sse.api.routes.netskope_baselines.save_netskope_baseline", new=save):
            granted = await self.client.put("/api/netskope/baselines/client-golden-releases", json=payload)
        self.assertEqual(granted.status_code, 200)
        args = save.await_args.args
        self.assertEqual(args[1:], ("client_golden_releases", {"releases": ["141.0.0", "138.1.0", "135.0.0"]}, "Golden según doc 2026-09", "actor-1"))

    async def test_invalid_baselines_are_rejected_before_the_repository(self):
        self.session.set_permissions(["inventory:read", "netskope:admin"])
        save = AsyncMock(return_value=SAVED)
        cases = [
            ("/api/netskope/baselines/client-golden-releases", {"releases": ["141.0.0"]}),
            ("/api/netskope/baselines/client-golden-releases", {"releases": ["141.0.0", "beta"]}),
            ("/api/netskope/baselines/client-golden-releases", {"releases": ["141.0.0", "１４１.0"]}),
            ("/api/netskope/baselines/client-golden-releases", {"releases": ["141.0", "141.0"]}),
            ("/api/netskope/baselines/os-minimum-versions", {"minimums": {}}),
            ("/api/netskope/baselines/os-minimum-versions", {"minimums": {"Windows": "latest"}}),
            ("/api/netskope/baselines/os-minimum-versions", {"minimums": {"  ": "10.0"}}),
        ]
        with patch("app.netskope.sse.api.routes.netskope_baselines.save_netskope_baseline", new=save):
            for path, payload in cases:
                with self.subTest(payload=payload):
                    self.assertEqual((await self.client.put(path, json=payload)).status_code, 422)
        save.assert_not_awaited()

    async def test_compliance_filter_without_baseline_is_a_clear_400(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=AsyncMock(side_effect=ValueError("No hay releases golden configuradas para Netskope"))):
            response = await self.client.get("/api/cmdb/netskope/devices", params={"client_compliance": "current"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("releases golden", response.json()["detail"])
