"""NSK-EXP-UEBA-001: anomalies reduced to counts and a short list, never addresses or ids."""

import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from app.netskope.sse.services.netskope_anomalies import summarize_anomalies
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

ROUTE = "app.netskope.sse.api.routes.netskope_uci."


def anomaly(severity, time, **over):
    return {
        "severity": severity, "time": time, "scenario": "Insider threat", "subScenario": "DLP violation",
        "ruleName": "Low Severity DLP policy violation", "activity": "Upload", "app": "Drive", "score": 100,
        "sourceIp": "10.0.0.9", "destinationIp": "8.8.8.8", "alertId": "a1", "eventId": "e1", "anomalyId": "x1",
        "anomalyData": {"featureValue": "secret.pdf"}, "additionalProperties": [{"key": "k", "value": "v"}], **over,
    }


class SummarizeAnomaliesTests(unittest.TestCase):
    def test_severity_is_normalized_and_the_list_is_most_severe_then_newest(self):
        rows = [anomaly("low", 1_790_000_000_000), anomaly("Low", 1_790_000_900_000), anomaly("High", 1_780_000_000_000),
                anomaly("medium", 1_790_000_500_000), anomaly("Medium", 1_790_000_100_000), anomaly("odd", 1_790_000_000_000)]
        result = summarize_anomalies(rows, total=6)
        self.assertEqual(result["by_severity"], {"high": 1, "medium": 2, "low": 2, "informational": 0, "unknown": 1})
        self.assertEqual([r["severity"] for r in result["recent"]], ["high", "medium", "medium", "low", "low", "unknown"])
        self.assertTrue(result["recent"][1]["time"] > result["recent"][2]["time"])
        self.assertFalse(result["truncated"])

    def test_nothing_identifying_leaves_the_module(self):
        result = summarize_anomalies([anomaly("high", 1_790_000_000_000)], total=1)
        serialized = str(result)
        for leaked in ("10.0.0.9", "8.8.8.8", "a1", "e1", "x1", "secret.pdf", "additionalProperties"):
            self.assertNotIn(leaked, serialized)
        self.assertEqual(set(result["recent"][0]), {"severity", "scenario", "sub_scenario", "rule", "activity", "app", "score", "time"})

    def test_a_longer_total_is_flagged_and_the_list_is_capped(self):
        rows = [anomaly("low", 1_790_000_000_000 + n) for n in range(30)]
        result = summarize_anomalies(rows, total=4361)
        self.assertTrue(result["truncated"])
        self.assertEqual((result["returned"], len(result["recent"])), (30, 10))
        self.assertEqual(result["by_scenario"], [{"scenario": "Insider threat", "sub_scenario": "DLP violation", "count": 30}])

    def test_a_missing_time_is_none_and_goes_last(self):
        result = summarize_anomalies([anomaly("low", None), anomaly("low", 1_790_000_000_000)], total=2)
        self.assertIsNone(result["recent"][1]["time"])


class AnomaliesRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_only_netskope_uba_read_opens_the_route(self):
        lookup = AsyncMock()
        for permissions in (["inventory:read", "netskope:read"], ["access:manage", "inventory:read"]):
            self.session.set_permissions(permissions)
            with patch(ROUTE + "get_experience_user", new=lookup):
                denied = await self.client.get("/api/cmdb/netskope/users/1/anomalies")
            self.assertEqual(denied.status_code, 403, permissions)
        lookup.assert_not_awaited()

    async def test_reader_gets_the_summary_and_the_audit_has_counts_only(self):
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        audit = AsyncMock()
        with patch(ROUTE + "get_experience_user", new=AsyncMock(return_value={"email": "person@example.test"})), \
                patch(ROUTE + "NetskopeSettings.from_environment"), patch(ROUTE + "NetskopeClient") as client_class, \
                patch(ROUTE + "record_audit", new=audit):
            remote = AsyncMock(return_value=([anomaly("high", 1_790_000_000_000)], 1))
            client_class.return_value.__aenter__.return_value.get_user_anomalies = remote
            response = await self.client.get("/api/cmdb/netskope/users/1/anomalies")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["total"], body["window_days"], body["by_severity"]["high"]), (1, 30, 1))
        self.assertNotIn("10.0.0.9", response.text)
        remote.assert_awaited_once_with("person@example.test")
        self.assertEqual(audit.await_args.kwargs["after_data"], {"total": 1, "returned": 1})

    async def test_remote_failure_is_generic_and_missing_user_is_404(self):
        from app.netskope.sse.integrations.netskope import NetskopeError
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        with patch(ROUTE + "get_experience_user", new=AsyncMock(return_value={"email": "person@example.test"})), \
                patch(ROUTE + "NetskopeSettings.from_environment"), patch(ROUTE + "NetskopeClient") as client_class:
            client_class.return_value.__aenter__.return_value.get_user_anomalies = AsyncMock(side_effect=NetskopeError("person@example.test 10.0.0.1"))
            failed = await self.client.get("/api/cmdb/netskope/users/1/anomalies")
        self.assertEqual(failed.status_code, 502)
        self.assertNotIn("person@example.test", failed.text)
        with patch(ROUTE + "get_experience_user", new=AsyncMock(return_value=None)):
            missing = await self.client.get("/api/cmdb/netskope/users/9/anomalies")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
