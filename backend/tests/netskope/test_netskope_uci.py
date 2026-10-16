"""NSK-UBA-002: UCI reduction, client reads, sync task and the strict route."""

import asyncio
import json
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from app.netskope.sse import netskope_sync
from app.netskope.sse.integrations.netskope import (
    UCI_ACTIVE_PATH, UCI_BATCH_PATH, NetskopeClient, NetskopeError, NetskopeNotConfigured,
    NetskopeSettings, netskope_uci_configured,
)
from app.netskope.sse.services.netskope_uci import build_uci_rows, previous_score
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

DAY = 24 * 3600 * 1000
NOW_MS = 1_790_000_000_000


class UciReductionTests(unittest.TestCase):
    def test_keeps_one_latest_valid_row_per_user_and_counts_rejections(self):
        rows, rejected = build_uci_rows([
            {"user": " Ana@Example.test ", "uciScore": 300, "startTime": NOW_MS - DAY, "rating": "Poor"},
            {"user": "ana@example.test", "uciScore": 250, "startTime": NOW_MS, "rating": "Poor"},
            {"user": "", "uciScore": 200, "startTime": NOW_MS, "rating": "Poor"},
            {"user": "bad@example.test", "uciScore": 1001, "startTime": NOW_MS, "rating": "Poor"},
            {"user": "bool@example.test", "uciScore": True, "startTime": NOW_MS, "rating": "Poor"},
            {"user": "time@example.test", "uciScore": 400, "startTime": 0, "rating": "Moderate"},
        ])
        self.assertEqual([(r["email_key"], r["score"], r["rating"]) for r in rows], [("ana@example.test", 250, "Poor")])
        self.assertEqual(rows[0]["scored_at"], datetime.fromtimestamp(NOW_MS / 1000, tz=timezone.utc))
        self.assertEqual(rejected, 4)

    def test_previous_score_is_the_earliest_point_old_enough_to_compare(self):
        points = [
            {"start": NOW_MS - 7 * DAY, "confidenceScore": 600},
            {"start": NOW_MS - 5 * DAY, "confidenceScore": 500},
            {"start": NOW_MS - DAY, "confidenceScore": 400},
            {"start": NOW_MS - 6 * DAY, "confidenceScore": "x"},
        ]
        self.assertEqual(previous_score(points, NOW_MS), 600)
        self.assertIsNone(previous_score([{"start": NOW_MS - DAY, "confidenceScore": 400}], NOW_MS))
        self.assertIsNone(previous_score([], NOW_MS))


def _settings(**overrides):
    return NetskopeSettings(
        base_url="https://tenant.example.test", api_token="t", device_status_path="/d", users_path="/u",
        user_counts_path="/c", uci_path=UCI_ACTIVE_PATH, page_delay_seconds=0, **overrides,
    )


class UciClientTests(unittest.TestCase):
    def read(self, handler, method, *args, settings=None):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def exercise():
            async with NetskopeClient(settings or _settings(), client) as netskope:
                return await getattr(netskope, method)(*args)

        try:
            return asyncio.run(exercise())
        finally:
            asyncio.run(client.aclose())

    def test_ranked_read_asks_poor_then_moderate_and_tags_the_rating(self):
        bodies = []

        def handler(request):
            body = json.loads(request.content)
            bodies.append((request.method, request.url.path, body))
            return httpx.Response(200, json={"totalCount": 1, "results": [{"user": body["ratingRank"], "uciScore": 1, "startTime": 1}]})

        rows = self.read(handler, "get_ranked_uci")
        self.assertEqual([(r["user"], r["rating"]) for r in rows], [("Poor", "Poor"), ("Moderate", "Moderate")])
        self.assertEqual(bodies, [("POST", UCI_ACTIVE_PATH, {"ratingRank": "Poor"}), ("POST", UCI_ACTIVE_PATH, {"ratingRank": "Moderate"})])

    def test_ranked_read_rejects_truncated_or_malformed_answers(self):
        cases = {
            "truncated": {"totalCount": 3, "results": [{"user": "a"}]},
            "no total": {"results": []},
            "not a list": {"totalCount": 0, "results": {}},
            "invalid item": {"totalCount": 1, "results": ["a"]},
        }
        for label, payload in cases.items():
            with self.subTest(label), self.assertRaises(NetskopeError):
                self.read(lambda _request, payload=payload: httpx.Response(200, json=payload), "get_ranked_uci")

    def test_ranked_read_needs_the_approved_route(self):
        with self.assertRaises(NetskopeNotConfigured):
            self.read(lambda _request: httpx.Response(200, json={}), "get_ranked_uci", settings=_settings().__class__(**{**_settings().__dict__, "uci_path": ""}))

    def test_history_is_batched_and_keyed_by_lowercase_user(self):
        sizes = []

        def handler(request):
            body = json.loads(request.content)
            sizes.append(len(body["users"]))
            self.assertEqual(request.url.path, UCI_BATCH_PATH)
            return httpx.Response(200, json={"usersUci": [{"userId": user.upper(), "confidences": [{"start": 1, "confidenceScore": 5}]} for user in body["users"]]})

        users = [f"u{i}@example.test" for i in range(251)]
        history = self.read(handler, "get_uci_history", users, 1, 2)
        self.assertEqual(sizes, [250, 1])
        self.assertEqual(len(history), 251)
        self.assertIn("u0@example.test", history)

    def test_history_rejects_malformed_answers(self):
        for payload in ({}, {"usersUci": ["x"]}, {"usersUci": [{"userId": "a@b", "confidences": {}}]}):
            with self.subTest(payload), self.assertRaises(NetskopeError):
                self.read(lambda _request, payload=payload: httpx.Response(200, json=payload), "get_uci_history", ["a@b"], 1, 2)

    def test_configuration_accepts_only_the_approved_route(self):
        with patch.dict("os.environ", {"NETSKOPE_UCI_PATH": UCI_ACTIVE_PATH}):
            self.assertTrue(netskope_uci_configured())
        with patch.dict("os.environ", {"NETSKOPE_UCI_PATH": "/api/v2/other"}):
            self.assertFalse(netskope_uci_configured())
        with patch.dict("os.environ", {"NETSKOPE_UCI_PATH": ""}):
            self.assertFalse(netskope_uci_configured())


def _context(client):
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=client)
    context.__aexit__ = AsyncMock(return_value=False)
    return context


class UciSyncTests(unittest.IsolatedAsyncioTestCase):
    def client(self, ranked, history=None, ranked_error=None):
        client = MagicMock()
        client.get_ranked_uci = AsyncMock(return_value=ranked, side_effect=ranked_error)
        client.get_uci_history = AsyncMock(return_value=history or {})
        return client

    async def run_task(self, client, replace):
        settings = MagicMock(uci_path=UCI_ACTIVE_PATH)
        with patch.object(netskope_sync.NetskopeSettings, "from_environment", return_value=settings), \
                patch.object(netskope_sync, "NetskopeClient", return_value=_context(client)), \
                patch.object(netskope_sync, "replace_netskope_user_uci", replace):
            return await netskope_sync.sync_netskope_uci(MagicMock(), uuid4())

    async def test_replaces_scores_with_the_week_old_value_and_never_stores_the_series(self):
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        ranked = [{"user": "Ana@x.test", "uciScore": 200, "startTime": now_ms, "rating": "Poor"}]
        history = {"ana@x.test": [{"start": now_ms - 6 * DAY, "confidenceScore": 500}, {"start": now_ms, "confidenceScore": 200}]}
        replace = AsyncMock()
        result = await self.run_task(self.client(ranked, history), replace)
        rows = replace.await_args.args[2]
        self.assertEqual([(r["email_key"], r["score"], r["previous_score"]) for r in rows], [("ana@x.test", 200, 500)])
        self.assertNotIn("confidences", rows[0])
        self.assertEqual(result, {"objects": 1, "relationships": 0, "uci_rejected_rows": 0})

    async def test_an_empty_complete_read_clears_the_table_without_asking_for_history(self):
        client, replace = self.client([]), AsyncMock()
        await self.run_task(client, replace)
        client.get_uci_history.assert_not_awaited()
        self.assertEqual(replace.await_args.args[2], [])

    async def test_a_failed_read_raises_and_leaves_the_stored_scores_untouched(self):
        replace = AsyncMock()
        with self.assertRaises(NetskopeError):
            await self.run_task(self.client([], ranked_error=NetskopeError("truncated")), replace)
        replace.assert_not_awaited()

    async def test_the_task_is_registered_and_dispatched(self):
        self.assertIs(netskope_sync._TASKS[netskope_sync.TASK_UCI], netskope_sync.sync_netskope_uci)


ROUTE = "app.netskope.sse.api.routes.netskope_uci."


class UciRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_only_netskope_uba_read_opens_the_route(self):
        listing = AsyncMock()
        for permissions in (["inventory:read", "netskope:read"], ["access:manage", "inventory:read"], ["netskope:dlp_read"]):
            self.session.set_permissions(permissions)
            with patch(ROUTE + "list_netskope_user_uci", new=listing):
                response = await self.client.get("/api/cmdb/netskope/uci")
            self.assertEqual(response.status_code, 403, permissions)
        listing.assert_not_awaited()

    async def test_reader_with_the_permission_gets_rows_and_the_read_is_audited_without_values(self):
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        now = datetime.now(timezone.utc)
        listing = AsyncMock(return_value={
            "rows": [{"email": "a@x.test", "user_id": None, "name": None, "rating": "Poor", "score": 120, "previous_score": None, "scored_at": now}],
            "total": 1, "by_rating": {"Poor": 1, "Moderate": 0}, "captured_at": now,
        })
        audit = AsyncMock()
        with patch(ROUTE + "list_netskope_user_uci", new=listing), patch(ROUTE + "record_audit", new=audit), \
                patch(ROUTE + "netskope_uci_configured", return_value=True):
            response = await self.client.get("/api/cmdb/netskope/uci", params={"rating": "Poor", "search": " ana ", "limit": 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(listing.await_args.args[1:], ("Poor", "ana", "score", 10, 0))
        body = response.json()
        self.assertTrue(body["configured"])
        self.assertEqual(body["rows"][0]["score"], 120)
        self.assertEqual(audit.await_args.kwargs["after_data"], {"row_count": 1, "rating": "Poor", "searched": True})

    async def test_invalid_rating_is_rejected(self):
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        response = await self.client.get("/api/cmdb/netskope/uci", params={"rating": "Good"})
        self.assertEqual(response.status_code, 422)

    async def test_company_route_needs_the_strict_permission_and_audits_counts_only(self):
        companies = AsyncMock(return_value={"companies": [{"company": "ACME", "users": 10, "poor": 1, "moderate": 2, "previous": {"users": 9, "poor": 0, "moderate": 2}}], "omitted_users": 4, "previous_week": None, "unassigned": "Sin dato"})
        for permissions in (["inventory:read", "netskope:read"], ["access:manage", "inventory:read"]):
            self.session.set_permissions(permissions)
            with patch(ROUTE + "uci_by_company", new=companies):
                denied = await self.client.get("/api/cmdb/netskope/uci/companies")
            self.assertEqual(denied.status_code, 403, permissions)
        companies.assert_not_awaited()
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        audit = AsyncMock()
        with patch(ROUTE + "uci_by_company", new=companies), patch(ROUTE + "record_audit", new=audit):
            response = await self.client.get("/api/cmdb/netskope/uci/companies")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"companies": [{"company": "ACME", "users": 10, "poor": 1, "moderate": 2, "previous": {"users": 9, "poor": 0, "moderate": 2}}], "omitted_users": 4, "previous_week": None})
        self.assertEqual(audit.await_args.kwargs["after_data"], {"row_count": 1})


if __name__ == "__main__":
    unittest.main()
