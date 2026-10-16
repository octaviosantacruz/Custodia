"""NSK-EXP-UEBA-001: the operator queue joins UCI and ADEM without inventing a score."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.services.netskope_attention import QUEUE_LIMIT, build_attention_queue
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

ROUTE = "app.netskope.sse.api.routes.netskope_uci."


def uci(email, rating, score, name=None):
    return {"email": email, "name": name, "user_id": None, "rating": rating, "score": score, "previous_score": None}


class AttentionQueueTests(unittest.TestCase):
    def test_users_in_both_lists_come_first_then_poor_then_moderate_then_adem_only(self):
        queue = build_attention_queue(
            [uci("poor@x.test", "Poor", 100), uci("mod@x.test", "Moderate", 500), uci("both@x.test", "Moderate", 600)],
            [{"email": "BOTH@x.test", "exp_score": 52}, {"email": "adem@x.test", "exp_score": 60}],
        )
        self.assertEqual([p["email"] for p in queue], ["both@x.test", "poor@x.test", "mod@x.test", "adem@x.test"])
        self.assertEqual(queue[0]["reasons"], ["uci", "adem"])
        self.assertEqual(queue[3]["reasons"], ["adem"])

    def test_a_score_from_a_source_that_did_not_list_the_user_is_none_never_zero(self):
        queue = build_attention_queue([uci("a@x.test", "Poor", 10)], [{"email": "b@x.test", "exp_score": 70}])
        by_email = {p["email"]: p for p in queue}
        self.assertIsNone(by_email["a@x.test"]["adem_score"])
        self.assertIsNone(by_email["b@x.test"]["uci_score"])
        self.assertIsNone(by_email["b@x.test"]["uci_rating"])

    def test_invalid_rows_are_ignored_and_the_queue_is_capped(self):
        rows = [uci(f"u{n:03}@x.test", "Moderate", n) for n in range(80)]
        queue = build_attention_queue(rows + [uci("", "Poor", 1)], [{"email": "z@x.test", "exp_score": True}, {"email": None, "exp_score": 5}])
        self.assertEqual(len(queue), QUEUE_LIMIT)
        self.assertNotIn("z@x.test", [p["email"] for p in queue])


class AttentionRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_needs_the_strict_permission(self):
        listing = AsyncMock()
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch(ROUTE + "list_netskope_user_uci", new=listing):
            denied = await self.client.get("/api/cmdb/netskope/experience/attention")
        self.assertEqual(denied.status_code, 403)
        listing.assert_not_awaited()

    async def test_adem_failure_still_returns_the_uci_side(self):
        from app.netskope.sse.integrations.netskope import NetskopeError
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        listing = AsyncMock(return_value={"rows": [uci("a@x.test", "Poor", 10)]})
        audit = AsyncMock()
        with patch(ROUTE + "list_netskope_user_uci", new=listing), patch(ROUTE + "NetskopeSettings.from_environment"), \
                patch(ROUTE + "NetskopeClient") as client_class, patch(ROUTE + "record_audit", new=audit):
            client_class.return_value.__aenter__.return_value.get_adem_worst_users = AsyncMock(side_effect=NetskopeError("a@x.test"))
            response = await self.client.get("/api/cmdb/netskope/experience/attention")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["adem_available"])
        self.assertEqual((body["rows"][0]["email"], body["rows"][0]["adem_score"]), ("a@x.test", None))
        self.assertEqual(audit.await_args.kwargs["after_data"], {"row_count": 1, "adem_available": False})


if __name__ == "__main__":
    unittest.main()
