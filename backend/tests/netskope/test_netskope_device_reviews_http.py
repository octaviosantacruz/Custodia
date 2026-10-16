"""NSK-DEVREV-001 / NSK-INV-002: the stale-device summary needs the Netskope catalog
permission, the listing forwards the review filters, and the per-device classification
routes are gone (retired with the classification UI)."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class NetskopeDeviceReviewsHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_the_summary_needs_the_catalog_permission(self):
        self.session.set_permissions(["inventory:read"])
        self.assertEqual((await self.client.get("/api/cmdb/netskope/device-reviews/summary")).status_code, 403)

    async def test_the_classification_routes_are_retired_even_for_netskope_admin(self):
        self.session.set_permissions(["inventory:read", "netskope:read", "netskope:admin"])
        responses = [
            await self.client.get("/api/cmdb/netskope/devices/7/review"),
            await self.client.put("/api/cmdb/netskope/devices/7/review", json={"diagnosis": "replaced"}),
            await self.client.post("/api/cmdb/netskope/device-reviews/accept-suggestion",
                                   json={"suggestion": "historical_record", "expected_count": 1, "note": "x"}),
        ]
        for response in responses:
            self.assertIn(response.status_code, (404, 405), response.text)
        paths = set(app.openapi()['paths'])
        self.assertNotIn("/api/cmdb/netskope/devices/{object_id}/review", paths)
        self.assertNotIn("/api/cmdb/netskope/device-reviews/accept-suggestion", paths)

    async def test_device_listing_accepts_and_forwards_the_review_filters(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value={
            "rows": [], "total": 0, "limit": 50, "offset": 0, "search": "", "filters": {}, "event_age": "gt_30d", "change": "",
            "freshness": "all", "client_compliance": "", "os_compliance": "", "duplicate": "", "source_evidence": None,
        })
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            ok = await self.client.get("/api/cmdb/netskope/devices", params={"review_diagnosis": "historical_record", "review_status": "pending", "event_age": "gt_30d"})
            bad = await self.client.get("/api/cmdb/netskope/devices", params={"review_diagnosis": "made_up"})
        self.assertEqual((ok.status_code, bad.status_code), (200, 422))
        self.assertEqual(listing.await_args.kwargs["review_diagnosis"], "historical_record")
        self.assertEqual(listing.await_args.kwargs["review_status"], "pending")
        # A review drill describes the whole inventory, not only the 7-day default.
        self.assertEqual(listing.await_args.args[11], "all")

    async def test_listing_accepts_attention_and_suggestion_filters_and_rejects_unknown_ones(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        listing = AsyncMock(return_value={
            "rows": [], "total": 0, "limit": 50, "offset": 0, "search": "", "filters": {}, "event_age": "", "change": "",
            "freshness": "all", "client_compliance": "", "os_compliance": "", "duplicate": "", "source_evidence": None,
        })
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            ok = await self.client.get("/api/cmdb/netskope/devices", params={"review_attention": "open_incident", "review_suggestion": "replaced"})
            bad_attention = await self.client.get("/api/cmdb/netskope/devices", params={"review_attention": "made_up"})
            bad_suggestion = await self.client.get("/api/cmdb/netskope/devices", params={"review_suggestion": "decommissioned"})
        self.assertEqual((ok.status_code, bad_attention.status_code, bad_suggestion.status_code), (200, 422, 422))
        self.assertEqual((listing.await_args.kwargs["review_attention"], listing.await_args.kwargs["review_suggestion"]), ("open_incident", "replaced"))
        with patch("app.netskope.sse.api.routes.cmdb_netskope.list_netskope_objects", new=listing):
            manual = await self.client.get("/api/cmdb/netskope/devices", params={"review_suggestion": "none"})
        self.assertEqual(manual.status_code, 200)
        self.assertEqual(listing.await_args.kwargs["review_suggestion"], "none")
        self.assertEqual(listing.await_args.args[11], "all")
