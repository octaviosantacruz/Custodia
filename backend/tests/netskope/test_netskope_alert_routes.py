"""NSK-DLP-001: the revived minimal DLP routes and their compatible denial.

The four user/incident paths stop answering 410 only for an actor holding the
narrow ``netskope:dlp_read`` permission. Every other actor -- including
``access:manage`` -- keeps the proven 410 Gone, and the per-device path stays
retired for everyone because the approved allowlist has no device field.
Reads are audited; no event artifact (file, URL, hash, IP, event email) is
ever present in a response.
"""

import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

REVIVED_DLP_PATHS = (
    "/api/cmdb/netskope/investigations",
    "/api/cmdb/netskope/dlp/status",
    "/api/cmdb/netskope/dlp/policies",
)
# NSK-INV-002: the global and per-user summaries are retired for everyone, like the per-device one.
RETIRED_FOR_ALL_PATHS = (
    "/api/cmdb/netskope/incidents/summary",
    "/api/cmdb/netskope/users/alerts/summary",
)
RETIRED_DLP_PATHS = REVIVED_DLP_PATHS + RETIRED_FOR_ALL_PATHS + ("/api/cmdb/netskope/devices/alerts/summary",)

# Keys a retired 410 body must never carry.
FORBIDDEN_KEYS = ("results", "devices", "cache", "dimensions", "incident_count", "event_count")

# Artifacts that must never appear in a revived response, in body or keys.
FORBIDDEN_ARTIFACTS = (
    "file_path", "file_name", "dlp_file", "sha256", "md5", "srcip", "dstip",
    "url", "referer", "dlp_match_info", "title", "src_location",
)

NOW = datetime(2026, 9, 25, tzinfo=timezone.utc)

LIST_PAYLOAD = {
    "rows": [{
        "incident_id": "7", "event_timestamp": NOW, "status": "open", "severity": "High",
        "policy": "Policy A", "action": "alert", "user_id": "u-1",
        "user": {"object_id": 8, "display_name": "Ada", "email": "ada@example.test"},
    }],
    "total": 1, "limit": 50, "offset": 0,
    "severity": "", "status": "", "action": "", "policy": "", "resolution": "", "user_id": "",
}


class NetskopeDlpRoutesHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_every_dlp_path_answers_410_without_the_narrow_permission(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        for path in RETIRED_DLP_PATHS:
            with self.subTest(path=path):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 410, response.text)
                body = response.json()
                self.assertEqual(set(body), {"detail"})
                self.assertIn("retirada", body["detail"])
                for key in FORBIDDEN_KEYS:
                    self.assertNotIn(key, body)

    async def test_access_manage_keeps_the_compatible_410(self):
        # NSK-DLP-001 deliberately does not widen access:manage; the new
        # permission must be assigned explicitly.
        self.session.set_permissions(["inventory:read", "access:manage"])
        for path in RETIRED_DLP_PATHS:
            with self.subTest(path=path):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 410, response.text)

    async def test_dlp_read_revives_the_minimal_routes_with_audited_reads(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:dlp_read"])
        audit = AsyncMock()
        with patch("app.netskope.sse.api.routes.netskope_dlp.get_netskope_dlp_capture_state", new=AsyncMock(return_value=None)), \
             patch("app.netskope.sse.api.routes.netskope_dlp.list_netskope_dlp_alerts", new=AsyncMock(return_value=LIST_PAYLOAD)), \
             patch("app.netskope.sse.api.routes.netskope_dlp.netskope_dlp_incidents_configured", return_value=True), \
             patch("app.netskope.sse.api.routes.netskope_dlp.record_audit", new=audit):
            retired = [await self.client.get(path) for path in RETIRED_FOR_ALL_PATHS]
            alerts = await self.client.get("/api/cmdb/netskope/investigations")
            status = await self.client.get("/api/cmdb/netskope/dlp/status")

        self.assertEqual([response.status_code for response in retired], [410, 410])
        self.assertEqual(alerts.status_code, 200, alerts.text)
        self.assertEqual(alerts.json()["rows"][0]["incident_id"], "7")
        self.assertEqual(status.status_code, 200, status.text)
        self.assertTrue(status.json()["configured"])

        audited = {(call.kwargs["entity_id"], call.kwargs["action"]) for call in audit.await_args_list}
        self.assertEqual(audited, {("filtered", "read")})
        for call in audit.await_args_list:
            self.assertEqual(call.kwargs["entity_type"], "netskope_dlp_alert")
            self.assertNotIn("user_id", call.kwargs["after_data"])
            self.assertNotIn("email", call.kwargs["after_data"])

    async def test_revived_rows_never_expose_event_artifacts(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:dlp_read"])
        with patch("app.netskope.sse.api.routes.netskope_dlp.list_netskope_dlp_alerts", new=AsyncMock(return_value=LIST_PAYLOAD)), \
             patch("app.netskope.sse.api.routes.netskope_dlp.record_audit", new=AsyncMock()):
            response = await self.client.get("/api/cmdb/netskope/investigations")
        self.assertEqual(response.status_code, 200, response.text)
        row = response.json()["rows"][0]
        self.assertEqual(set(row), {"incident_id", "event_timestamp", "status", "severity", "policy", "action", "user_id", "user"})
        self.assertEqual(set(row["user"]), {"object_id", "display_name", "email"})
        raw = response.text
        for artifact in FORBIDDEN_ARTIFACTS:
            self.assertNotIn(artifact, raw)

    async def test_policies_route_answers_the_contract_with_only_names_and_counts(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:dlp_read"])
        payload = {
            "window_days": 30, "total_policies": 1, "unnamed_alerts": 2,
            "policies": [{
                "policy": "Policy A", "alert_count": 3, "last_7d": 2, "previous_7d": 1,
                "latest_event_at": "2026-09-24T00:00:00Z",
                "by_severity": [{"key": "High", "count": 3}], "by_action": [{"key": "alert", "count": 3}],
            }],
        }
        audit = AsyncMock()
        with patch("app.netskope.sse.api.routes.netskope_dlp.get_netskope_dlp_capture_state", new=AsyncMock(return_value=None)), \
             patch("app.netskope.sse.api.routes.netskope_dlp.get_netskope_dlp_policies", new=AsyncMock(return_value=payload)), \
             patch("app.netskope.sse.api.routes.netskope_dlp.netskope_dlp_incidents_configured", return_value=True), \
             patch("app.netskope.sse.api.routes.netskope_dlp.record_audit", new=audit):
            response = await self.client.get("/api/cmdb/netskope/dlp/policies")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body["policies"][0]), {
            "policy", "alert_count", "last_7d", "previous_7d", "latest_event_at", "by_severity", "by_action",
        })
        self.assertTrue(body["configured"])
        self.assertEqual(audit.await_args.kwargs["after_data"], {"row_count": 1})

    async def test_former_investigation_parameters_are_inert(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:dlp_read"])
        with patch("app.netskope.sse.api.routes.netskope_dlp.list_netskope_dlp_alerts", new=AsyncMock(return_value=LIST_PAYLOAD)) as listing, \
             patch("app.netskope.sse.api.routes.netskope_dlp.record_audit", new=AsyncMock()):
            response = await self.client.get(
                "/api/cmdb/netskope/investigations",
                params={"q": "drive", "device_id": "d1", "username": "ana@example.com", "window_hours": "72"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("ana@example.com", response.text)
        self.assertNotIn("drive", response.text)
        listing.assert_awaited_once()

    async def test_dlp_routes_require_authentication(self):
        anonymous = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(anonymous.aclose)
        for path in RETIRED_DLP_PATHS:
            with self.subTest(path=path):
                response = await anonymous.get(path)
                self.assertEqual(response.status_code, 401, response.text)

    async def test_per_device_summary_stays_retired_even_with_dlp_read(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:dlp_read"])
        response = await self.client.get("/api/cmdb/netskope/devices/alerts/summary")
        self.assertEqual(response.status_code, 410, response.text)


if __name__ == "__main__":
    unittest.main()
