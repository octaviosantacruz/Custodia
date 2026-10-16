"""NSK-DEV-004: device filters travel from the query string to the
repository call through the real FastAPI wiring, and the facets route keeps
the Netskope catalog permission gate."""

import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app
from app.netskope.sse.device_evidence import device_evidence

# The typed NetskopeObjectsResponse contract (AUD-API-002) requires the full
# page envelope, not just the fields each test asserts on.
EMPTY_PAGE = {
    "rows": [], "total": 0, "limit": 50, "offset": 0, "search": "",
    "filters": {}, "event_age": "", "change": "", "freshness": "recent",
    "client_compliance": "", "os_compliance": "", "duplicate": "",
}
EMPTY_FACETS = {
    key: [] for key in (
        "os", "client_version", "classification_status", "user_status",
        "company", "last_seen_event", "device_make", "device_model",
    )
}


def _object_row(object_id, display_name, source_id, attributes):
    now = datetime.now(timezone.utc)
    return {
        "object_id": object_id, "display_name": display_name, "source_id": source_id,
        "attributes": attributes, "first_seen_at": now, "last_seen_at": now,
        "observed_user_status": "unmatched", "observed_user": None,
    }


SOURCE_OK = {"source_fresh": True, "source_status": "completed", "source_completed_at": None, "as_of": datetime.now(timezone.utc)}


class NetskopeDeviceFiltersHttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_metric_selection_is_validated_and_skipped_fields_are_absent(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        base = {
            "users_total": 9, "devices_total": 7, "devices_stale_30d": 3,
            "devices_with_observed_user": 5, "last_observed_at": None,
        }
        # Keep the route and repositories real; only database transport is stubbed.
        with patch("app.netskope.sse.repositories.netskope_metrics.fetch_one", new=AsyncMock(return_value=base)) as query, patch("app.netskope.sse.repositories.netskope_metrics.get_netskope_source_evidence", new=AsyncMock(return_value=SOURCE_OK)):
            response = await self.client.get("/api/cmdb/netskope/metrics", params={"widgets": "devices_total", "os": " Windows "})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), base)
            self.assertIn("Windows", query.await_args.args[2])
            for widgets in (["unknown"], ["alerts_7d"], ["alerts_by_severity"], ["devices_total"] * 29):
                response = await self.client.get("/api/cmdb/netskope/metrics", params=[("widgets", widget) for widget in widgets])
                self.assertIn(response.status_code, (400, 422))
            self.assertEqual(query.await_count, 1)
            with patch("app.netskope.sse.repositories.netskope_metrics.fetch_all", new=AsyncMock(return_value=[])), patch(
                "app.netskope.sse.repositories.netskope_cross_metrics.fetch_one",
                new=AsyncMock(return_value={
                    "status": {"matched": 3, "ambiguous": 1, "unmatched": 3},
                    "per_user": {"users_with_device_activity_7d": 2}, "risk_rows": [],
                }),
            ), patch("app.netskope.sse.repositories.netskope_cross_metrics.fetch_all", new=AsyncMock(return_value=[])):
                legacy = await self.client.get("/api/cmdb/netskope/metrics")
            self.assertEqual(legacy.status_code, 200)
            self.assertEqual(legacy.json()["devices_by_client"], [])
            self.assertEqual(legacy.json()["devices_observed_user_matched"], 3)
            self.assertEqual(legacy.json()["users_with_device_activity_7d"], 2)
            # The complete (legacy) response carries the stale count with the sync evidence it was read under.
            self.assertEqual(legacy.json()["devices_stale_30d"], 3)
            self.assertTrue(legacy.json()["source_evidence"]["source_fresh"])
            self.session.set_permissions(["inventory:read"])
            response = await self.client.get("/api/cmdb/netskope/metrics", params={"widgets": "devices_total"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(query.await_count, 3)

    async def test_evidence_response_drops_unapproved_nested_fields(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        row = _object_row(1, "Device", "d1", {"hostname": "Device"})
        row["device_evidence"] = {**device_evidence(row), "username": "must-not-appear", "raw_payload": {"password": "must-not-appear"}}
        listing = AsyncMock(return_value={**EMPTY_PAGE, "rows": [row], "total": 1})
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            response = await self.client.get("/api/cmdb/netskope/devices")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rows"][0]["device_evidence"]["state"], "unknown")
        self.assertNotIn("must-not-appear", response.text)

    async def test_evidence_and_exact_person_filters_include_historical_devices(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value=EMPTY_PAGE)
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            response = await self.client.get("/api/cmdb/netskope/devices", params={"evidence_state": "review", "observed_user_id": 3, "device_object_id": 59})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(listing.await_args.args[11], "all")
            for key, value in (("evidence_state", "review"), ("observed_user_id", 3), ("device_object_id", 59)):
                self.assertEqual(listing.await_args.kwargs[key], value)
            for params in ({"evidence_state": "abandoned"}, {"observed_user_id": 0}, {"device_object_id": -1}):
                self.assertEqual((await self.client.get("/api/cmdb/netskope/devices", params=params)).status_code, 422)
        self.session.set_permissions(["inventory:read"])
        self.assertEqual((await self.client.get("/api/cmdb/netskope/devices", params={"evidence_state": "review"})).status_code, 403)

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_filters_reach_the_repository_trimmed_and_by_name(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value=EMPTY_PAGE)
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            response = await self.client.get(
                "/api/cmdb/netskope/devices",
                params={"os": " Windows ", "client_version": "110.0.1", "classification_status": "managed", "user_status": "enabled", "company": "ITTI", "last_seen_event": "Uninstalled", "heartbeat": "active", "event_age": "gt_30d", "onprem_status": " off-prem ", "client_config": "Default tenant config"},
            )
        self.assertEqual(response.status_code, 200)
        args = listing.await_args.args
        # A leftover ?heartbeat= from an old link is ignored, not an error and not forwarded.
        self.assertEqual(args[1:5], ("device", "", 50, 0))
        self.assertEqual(args[5], {
            "os": "Windows", "client_version": "110.0.1", "classification_status": "managed",
            "user_status": "enabled", "company": "ITTI", "last_seen_event": "Uninstalled",
            "device_make": "", "device_model": "", "hostname": "", "username": "",
            "observed_user_status": "", "observed_user": "",
            "onprem_status": "off-prem", "client_config": "Default tenant config",
        })
        self.assertEqual(args[6], "gt_30d")
        self.assertEqual(listing.await_args.kwargs["coverage_risk"], "")

    async def test_change_filter_accepts_listable_changes_only(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value=EMPTY_PAGE)
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            accepted = await self.client.get("/api/cmdb/netskope/devices", params={"change": "upgraded"})
            # Retired devices are not in the active table; "removed" is a
            # panel-only category, never a table filter.
            rejected = await self.client.get("/api/cmdb/netskope/devices", params={"change": "removed"})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(listing.await_args.args[7], "upgraded")
        self.assertEqual(listing.await_args.args[11], "all")
        self.assertEqual(rejected.status_code, 422)

    async def test_quality_and_duplicate_drills_use_the_full_inventory_scope(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value=EMPTY_PAGE)
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            for params in (
                {"client_compliance": "current"},
                {"os_compliance": "supported"},
                {"duplicate": "hostname"},
            ):
                response = await self.client.get("/api/cmdb/netskope/devices", params=params)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(listing.await_args.args[11], "all")

    async def test_duplicate_drills_pass_through_and_username_is_lowercased(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value=EMPTY_PAGE)
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            response = await self.client.get("/api/cmdb/netskope/devices", params={"duplicate": "hostname", "hostname": " NB-100 ", "username": "Ana@Example.com"})
            rejected = await self.client.get("/api/cmdb/netskope/devices", params={"duplicate": "fuzzy"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(listing.await_args.args[10], "hostname")
        self.assertEqual(listing.await_args.args[5]["hostname"], "NB-100")
        self.assertEqual(listing.await_args.args[5]["username"], "ana@example.com")
        self.assertEqual(rejected.status_code, 422)

    async def test_event_age_rejects_values_outside_the_allowlist(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        response = await self.client.get("/api/cmdb/netskope/devices", params={"event_age": "yesterday"})
        self.assertEqual(response.status_code, 422)

    async def test_device_and_user_listings_never_attach_dlp_incident_data(self):
        # Regression for the retired DLP cache: the listing used to merge a
        # per-row alert_summary and a dlp_cache_partial flag read from
        # netskope_dlp_event_cache. Both must stay absent.
        self.session.set_permissions(["inventory:read", "netskope:read"])
        device_page = {**EMPTY_PAGE, "rows": [_object_row(1, "LAPTOP-1", "d1", {"hostname": "LAPTOP-1"})], "total": 1}
        user_page = {**EMPTY_PAGE, "rows": [_object_row(2, "a@example.com", "u1", {"email": "a@example.com"})], "total": 1}
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=AsyncMock(return_value=device_page)):
            devices = await self.client.get("/api/cmdb/netskope/devices")
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=AsyncMock(return_value=user_page)):
            users = await self.client.get("/api/cmdb/netskope/users")

        for response in (devices, users):
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertNotIn("dlp_cache_partial", body)
            self.assertNotIn("alert_summary", body["rows"][0])
            self.assertNotIn("incident", response.text)

    async def test_facets_require_the_netskope_catalog_permission(self):
        self.session.set_permissions(["inventory:read"])
        denied = await self.client.get("/api/cmdb/netskope/devices/facets")
        self.assertEqual(denied.status_code, 403)

        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch("app.netskope.sse.api.routes.cmdb_netskope.get_netskope_device_facets", new=AsyncMock(return_value=EMPTY_FACETS)):
            granted = await self.client.get("/api/cmdb/netskope/devices/facets")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json(), EMPTY_FACETS)
