"""NSK-EXP-UEBA-001: the operator queue joins UCI and ADEM without inventing a score."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.services.netskope_attention import QUEUE_LIMIT, build_attention, build_attention_queue, performance_band, presence_state
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

ROUTE = "app.netskope.sse.api.routes.netskope_uci."


def uci(email, rating, score, name=None):
    return {"email": email, "name": name, "user_id": None, "rating": rating, "score": score, "previous_score": None}


class AttentionQueueTests(unittest.TestCase):
    def test_the_queue_is_risk_only_poor_before_moderate_and_a_low_score_alone_never_enters(self):
        queue = build_attention_queue(
            [uci("mod@x.test", "Moderate", 500), uci("both@x.test", "Moderate", 400), uci("poor@x.test", "Poor", 100)],
            [{"email": "BOTH@x.test", "exp_score": 52}, {"email": "adem@x.test", "exp_score": 10}],
        )
        self.assertEqual([p["email"] for p in queue], ["poor@x.test", "both@x.test", "mod@x.test"])
        self.assertEqual(queue[1]["reasons"], ["uci", "adem"])

    def test_the_queue_is_capped_lowest_confidence_first(self):
        result = build_attention([uci(f"u{index:03d}@x.test", "Moderate", 300 + index) for index in range(QUEUE_LIMIT + 10)], [])
        self.assertEqual(len(result["rows"]), QUEUE_LIMIT)
        self.assertEqual((result["rows"][0]["email"], result["rows"][-1]["email"]), ("u000@x.test", f"u{QUEUE_LIMIT - 1:03d}@x.test"))

    def test_performance_rows_list_every_scored_person_worst_first_beyond_the_queue_cap(self):
        adem = [{"email": f"u{index:03d}@x.test", "exp_score": 100 - index} for index in range(100)]
        result = build_attention([], adem, {"u099@x.test": {"office_days": 1, "remote_days": 4}})
        self.assertEqual(result["rows"], [])
        self.assertEqual(len(result["performance_rows"]), 100)
        self.assertEqual(result["performance_rows"][0]["email"], "u099@x.test")
        self.assertEqual(result["performance_rows"][0]["presence"], "office")
        self.assertEqual(result["performance_rows"][0]["reasons"], ["adem"])
        self.assertTrue(all(row["adem_score"] is not None for row in result["performance_rows"]))

    def test_a_score_from_a_source_that_did_not_list_the_user_is_none_never_zero(self):
        result = build_attention([uci("a@x.test", "Poor", 10)], [{"email": "b@x.test", "exp_score": 70}])
        by_email = {p["email"]: p for p in (*result["rows"], *result["performance_rows"])}
        self.assertIsNone(by_email["a@x.test"]["adem_score"])
        self.assertIsNone(by_email["b@x.test"]["uci_score"])
        self.assertIsNone(by_email["b@x.test"]["uci_rating"])

    def test_invalid_rows_are_ignored_and_the_queue_is_capped(self):
        rows = [uci(f"u{n:03}@x.test", "Moderate", n) for n in range(80)]
        queue = build_attention_queue(rows + [uci("", "Poor", 1)], [{"email": "z@x.test", "exp_score": True}, {"email": None, "exp_score": 5}])
        self.assertEqual(len(queue), QUEUE_LIMIT)
        self.assertNotIn("z@x.test", [p["email"] for p in queue])

    def test_one_office_day_in_a_hybrid_week_is_office_and_missing_data_is_never_remote(self):
        self.assertEqual(presence_state({"office_days": 1, "remote_days": 4}), "office")
        self.assertEqual(presence_state({"office_days": 0, "remote_days": 3}), "remote")
        self.assertEqual(presence_state({"office_days": 0, "remote_days": 0}), "unknown")
        self.assertEqual(presence_state(None), "unknown")

    def test_rows_carry_the_office_days_and_zero_without_presence(self):
        adem = [{"email": "h@x.test", "exp_score": 40}, {"email": "n@x.test", "exp_score": 50}]
        rows = {row["email"]: row for row in build_attention([], adem, {"h@x.test": {"office_days": 2, "remote_days": 3}})["performance_rows"]}
        self.assertEqual((rows["h@x.test"]["presence"], rows["h@x.test"]["office_days"]), ("office", 2))
        self.assertEqual((rows["n@x.test"]["presence"], rows["n@x.test"]["office_days"]), ("unknown", 0))

    def test_bands_follow_netskope_ranges_and_missing_scores_have_no_band(self):
        self.assertEqual([performance_band(v) for v in (0, 30, 30.4, 31, 70, 71, 100)], ["poor", "poor", "poor", "fair", "fair", "good", "good"])
        self.assertIsNone(performance_band(None))
        self.assertIsNone(performance_band(True))

    def test_office_counts_split_by_band(self):
        adem = [{"email": "a@x.test", "exp_score": 20}, {"email": "b@x.test", "exp_score": 55}, {"email": "c@x.test", "exp_score": 25}]
        result = build_attention([], adem, {"a@x.test": {"office_days": 1}, "b@x.test": {"office_days": 1}, "c@x.test": {"remote_days": 1}})
        self.assertEqual((result["summary"]["office_poor"], result["summary"]["office_fair"], result["summary"]["office_listed"]), (1, 1, 2))

    def test_office_summary_counts_listed_adem_users_before_the_cap(self):
        uci_rows = [uci(f"u{n:03}@x.test", "Moderate", n) for n in range(80)]
        adem = [{"email": "o@x.test", "exp_score": 40}, {"email": "r@x.test", "exp_score": 50}, {"email": "n@x.test", "exp_score": 60}]
        result = build_attention(uci_rows, adem, {"O@x.test".lower(): {"office_days": 2}, "r@x.test": {"remote_days": 3}, "u001@x.test": {"office_days": 2}})
        self.assertEqual(result["summary"], {"adem_listed": 3, "office_listed": 1, "office_poor": 0, "office_fair": 1, "remote_listed": 1, "unknown_presence": 1})
        self.assertEqual(len(result["rows"]), QUEUE_LIMIT)


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

    async def test_company_filter_reaches_the_query_and_skips_adem(self):
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        listing = AsyncMock(return_value={"rows": [{**uci("a@x.test", "Poor", 10), "company": "IDL"}]})
        with patch(ROUTE + "list_netskope_user_uci", new=listing), patch(ROUTE + "get_users_presence", new=AsyncMock(return_value={})), \
                patch(ROUTE + "NetskopeClient") as client_class, patch(ROUTE + "record_audit", new=AsyncMock()):
            response = await self.client.get("/api/cmdb/netskope/experience/attention", params={"company": " IDL "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(listing.await_args.kwargs["company"], "IDL")
        client_class.assert_not_called()
        body = response.json()
        self.assertEqual((body["rows"][0]["company"], body["adem_available"], body["performance_rows"]), ("IDL", True, []))

    async def test_adem_failure_still_returns_the_uci_side(self):
        from app.netskope.sse.integrations.netskope import NetskopeError
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        listing = AsyncMock(return_value={"rows": [uci("a@x.test", "Poor", 10)]})
        audit = AsyncMock()
        with patch(ROUTE + "list_netskope_user_uci", new=listing), patch(ROUTE + "get_users_presence", new=AsyncMock(return_value={"a@x.test": {"office_days": 1}})), patch(ROUTE + "NetskopeSettings.from_environment"), \
                patch(ROUTE + "NetskopeClient") as client_class, patch(ROUTE + "record_audit", new=audit):
            client_class.return_value.__aenter__.return_value.get_adem_worst_users = AsyncMock(side_effect=NetskopeError("a@x.test"))
            response = await self.client.get("/api/cmdb/netskope/experience/attention")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["adem_available"])
        self.assertEqual((body["rows"][0]["email"], body["rows"][0]["adem_score"]), ("a@x.test", None))
        self.assertEqual(body["rows"][0]["presence"], "office")
        self.assertEqual(audit.await_args.kwargs["after_data"], {"row_count": 1, "adem_available": False, "adem_listed": 0, "office_listed": 0,
                                                                  "office_poor": 0, "office_fair": 0, "remote_listed": 0, "unknown_presence": 0})


if __name__ == "__main__":
    unittest.main()
