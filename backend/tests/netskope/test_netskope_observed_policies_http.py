"""NSK-POL-001: observed-policy HTTP surface.

The route requires ``netskope:read`` and only ever returns aggregate buckets,
capture bounds and a "Sin dato" action label -- never event artifacts.
"""

from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)

PAYLOAD = {
    "windows": [{
        "days": 7,
        "window_start": NOW - timedelta(days=7),
        "window_end": NOW,
        "captured_at": NOW,
        "availability": "complete",
        "policies": [{
            "policy": "Real-time Protection",
            "volume": 27,
            "first_captured_at": NOW - timedelta(days=3),
            "last_captured_at": NOW,
            "dominant_action": "Sin dato",
        }],
    }],
}

FORBIDDEN_ARTIFACTS = ("user", "userkey", "srcip", "url", "file_path", "mail", "hostname")


class NetskopeObservedPoliciesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_requires_netskope_read(self):
        self.session.set_permissions(["inventory:read"])
        response = await self.client.get("/api/cmdb/netskope/observed-policies")
        self.assertEqual(response.status_code, 403, response.text)

    async def test_returns_only_aggregate_fields_and_unknown_action(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch(
            "app.netskope.sse.api.routes.cmdb_netskope.get_observed_policies",
            new=AsyncMock(return_value=PAYLOAD),
        ):
            response = await self.client.get("/api/cmdb/netskope/observed-policies")

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("configured", body)
        window = body["windows"][0]
        self.assertEqual(window["days"], 7)
        self.assertEqual(window["availability"], "complete")
        policy = window["policies"][0]
        self.assertEqual(set(policy), {"policy", "volume", "first_captured_at", "last_captured_at", "dominant_action"})
        self.assertEqual(policy["dominant_action"], "Sin dato")
        raw = response.text
        for artifact in FORBIDDEN_ARTIFACTS:
            self.assertNotIn(artifact, raw)

    async def test_requires_authentication(self):
        anonymous = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        )
        self.addAsyncCleanup(anonymous.aclose)
        response = await anonymous.get("/api/cmdb/netskope/observed-policies")
        self.assertEqual(response.status_code, 401, response.text)


if __name__ == "__main__":
    unittest.main()
