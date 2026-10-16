"""UX-AUD2-008: read-only canonical client-sync evidence, permission scoped."""
from contextlib import ExitStack
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class NetskopeSyncEvidenceHttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_sync_evidence_preserves_state_and_requires_catalog_read(self):
        evidence = dict(source_fresh=False, source_status="partial", source_completed_at=None,
                        as_of=datetime(2026, 10, 8, tzinfo=timezone.utc))
        with ExitStack() as stack:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
                self.assertEqual((await client.get("/api/cmdb/netskope/sync-evidence")).status_code, 401)
                session = _AuthenticatedSession(stack, client)
                await session.login()
                with patch("app.netskope.sse.api.routes.cmdb_netskope.get_netskope_source_evidence",
                           new=AsyncMock(return_value=evidence)) as read:
                    for permissions in (["inventory:read", "netskope:read"], ["inventory:read", "access:manage"]):
                        session.set_permissions(permissions)
                        response = await client.get("/api/cmdb/netskope/sync-evidence")
                        self.assertEqual(response.status_code, 200, response.text)
                        self.assertEqual(response.json()["source_status"], "partial")
                        self.assertFalse(response.json()["source_fresh"])
                        self.assertIsNone(response.json()["source_completed_at"])
                    read.reset_mock()
                    session.set_permissions(["inventory:read", "netskope:dlp_read"])
                    self.assertEqual((await client.get("/api/cmdb/netskope/sync-evidence")).status_code, 403)
                    read.assert_not_awaited()
