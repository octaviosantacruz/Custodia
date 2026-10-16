"""AA public metric and memory cache invariants, independent of UI/storage."""

import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsError, AdvancedAnalyticsSettings, AnalyticsResult
from app.netskope.sse.services.netskope_aa_metrics import AnalyticsContractError, CONTRACT_ENV, SeverityContract, SeverityMetricsCache, public_severity

from tests.support.netskope_aa import CONTRACT, CSV, SETTINGS, approval_for


class PublicAaMetricTests(unittest.TestCase):
    def test_csv_and_json_become_same_narrow_metric_without_ids(self):
        contract = SeverityContract(**CONTRACT)
        csv_value = public_severity(CSV, contract)
        json_value = public_severity(AnalyticsResult("json", {"data": [{"severity": "High", "count": 12}, {"severity": "low", "count": 3}], "owner": "secret@example.test"}), contract)
        self.assertEqual(csv_value, json_value)
        indexed = AnalyticsResult("csv", [["", "count", "severity"], ["0", "12", "High"], ["1", "3", "low"]])
        self.assertEqual(public_severity(indexed, contract), csv_value)
        self.assertEqual(csv_value, {"source": "advanced_analytics", "state": "ready", "window_days": 30,
                                    "timezone": "UTC", "scope": "dlp", "unit": "incidents", "total": 15,
                                    "buckets": [{"key": "high", "count": 12}, {"key": "low", "count": 3}]})
        self.assertNotIn("secret@example.test", json.dumps(json_value))
        self.assertNotIn("report_id", csv_value)
        self.assertNotIn("widget_id", csv_value)

    def test_unknown_columns_labels_duplicate_groups_and_bad_counts_fail_closed(self):
        cases = [
            AnalyticsResult("csv", [["severity", "count", "user"], ["high", "2", "secret@example.test"]]),
            AnalyticsResult("json", [{"severity": "secret@example.test", "count": 2}]),
            AnalyticsResult("csv", [["", "severity", "count"], ["0", "high", "2"], ["0", "low", "1"]]),
            AnalyticsResult("json", [{"severity": "high", "count": 2}, {"severity": "HIGH", "count": 3}]),
            AnalyticsResult("csv", [["severity", "count"], ["high", "1.5"]]),
            AnalyticsResult("json", [{"severity": "high", "count": -1}]),
            AnalyticsResult("json", [{"severity": "high", "count": True}]),
            AnalyticsResult("json", [{"severity": "high", "count": 2**53}]),
            AnalyticsResult("json", [{"severity": "high", "count": 2**53 - 1}, {"severity": "low", "count": 1}]),
        ]
        for value in cases:
            with self.subTest(format=value.format), self.assertRaises(AdvancedAnalyticsError) as caught:
                public_severity(value, SeverityContract(**CONTRACT))
            self.assertNotIn("secret@example.test", str(caught.exception))

    def test_empty_rows_are_unavailable_count_not_invented_zero(self):
        for value in [AnalyticsResult("csv", [["severity", "count"]]), AnalyticsResult("json", [])]:
            result = public_severity(value, SeverityContract(**CONTRACT))
            self.assertEqual(result["state"], "empty")
            self.assertIsNone(result["total"])
        zero = public_severity(AnalyticsResult("json", [{"severity": "high", "count": 0}]), SeverityContract(**CONTRACT))
        self.assertEqual(zero["state"], "ready")
        self.assertEqual(zero["total"], 0)

    def test_contract_requires_explicit_window_scope_zone_and_columns(self):
        invalid = [dict(CONTRACT, window_days=True), dict(CONTRACT, timezone="not/a-zone"),
                   dict(CONTRACT, report_id="../other"), dict(CONTRACT, unit="users"),
                   {k: v for k, v in CONTRACT.items() if k != "window_days"}, dict(CONTRACT, extra="field")]
        for value in invalid:
            with self.subTest(value=value), patch.dict(os.environ, {CONTRACT_ENV: json.dumps(value)}), self.assertRaises(AnalyticsContractError):
                SeverityContract.from_environment()


class AaCacheTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {CONTRACT_ENV: json.dumps(CONTRACT), "NETSKOPE_AA_SEVERITY_APPROVAL_JSON": json.dumps(approval_for())})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.settings = patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsSettings.from_environment", return_value=SETTINGS)
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.query = AsyncMock(return_value=CSV)
        client = MagicMock()
        client.query_widget = self.query
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        self.factory = patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsClient", return_value=client)
        self.factory_mock = self.factory.start()
        self.addCleanup(self.factory.stop)
        self.cache = SeverityMetricsCache()

    async def test_invalid_definition_approvals_never_start_remote_work(self):
        valid = approval_for()
        for value in (dict(valid, version=True), dict(valid, version=0),
                      dict(valid, definition_sha256="invalid"), dict(valid, contract_sha256="0" * 64),
                      {key: val for key, val in valid.items() if key != "definition_sha256"},
                      dict(valid, token="private-token")):
            with self.subTest(value=value), patch.dict(os.environ, {"NETSKOPE_AA_SEVERITY_APPROVAL_JSON": json.dumps(value)}), self.assertRaises(AnalyticsContractError) as caught:
                await self.cache.get()
            self.assertNotIn("private-token", str(caught.exception))
        self.factory_mock.assert_not_called()

    async def test_unconfigured_has_no_external_request_or_count(self):
        with patch.dict(os.environ, {CONTRACT_ENV: ""}):
            value = await self.cache.get()
        self.assertEqual(value["state"], "not_configured")
        self.assertIsNone(value["total"])
        self.factory_mock.assert_not_called()

    async def test_candidate_without_definition_approval_cannot_query_or_reuse_ready_result(self):
        with patch.dict(os.environ, {"NETSKOPE_AA_SEVERITY_APPROVAL_JSON": ""}):
            value = await self.cache.get()
        self.assertEqual(value["state"], "pending_validation")
        self.assertIsNone(value["total"])
        self.factory_mock.assert_not_called()

    async def test_concurrent_readers_share_query_until_expiry_and_cannot_mutate_cache(self):
        with patch("app.netskope.sse.services.netskope_aa_metrics.monotonic", return_value=100):
            values = await asyncio.gather(*(self.cache.get() for _ in range(8)))
            self.query.assert_awaited_once()
            self.assertTrue(all(value["total"] == 15 for value in values))
            values[0]["buckets"][0]["count"] = 999
            self.assertEqual((await self.cache.get())["buckets"][0]["count"], 12)
        with patch("app.netskope.sse.services.netskope_aa_metrics.monotonic", return_value=401):
            await self.cache.get()
        self.assertEqual(self.query.await_count, 2)

    async def test_approval_revocation_and_new_definition_version_invalidate_cached_results(self):
        await self.cache.get()
        with patch.dict(os.environ, {"NETSKOPE_AA_SEVERITY_APPROVAL_JSON": ""}):
            pending = await self.cache.get()
        self.assertEqual(pending["state"], "pending_validation")
        self.assertIsNone(pending["total"])
        self.assertEqual(self.query.await_count, 1)
        restored = await self.cache.get()
        self.assertEqual(restored["contract_version"], 1)
        self.assertEqual(self.query.await_count, 2)
        with patch.dict(os.environ, {"NETSKOPE_AA_SEVERITY_APPROVAL_JSON": json.dumps(approval_for(version=2, definition_sha256="b" * 64))}):
            revised = await self.cache.get()
        self.assertEqual(revised["contract_version"], 2)
        self.assertEqual(self.query.await_count, 3)

    async def test_changed_contract_or_tenant_credentials_cannot_reuse_previous_result(self):
        await self.cache.get()
        changed_contract = dict(CONTRACT, window_days=7, widget_id="new-widget")
        with patch.dict(os.environ, {CONTRACT_ENV: json.dumps(changed_contract)}), self.assertRaises(AnalyticsContractError):
            await self.cache.get()
        self.assertEqual(self.query.await_count, 1)
        with patch.dict(os.environ, {CONTRACT_ENV: json.dumps(changed_contract), "NETSKOPE_AA_SEVERITY_APPROVAL_JSON": json.dumps(approval_for(changed_contract, version=2))}):
            changed = await self.cache.get()
        self.assertEqual(changed["window_days"], 7)
        self.assertEqual(self.query.await_count, 2)
        with patch("app.netskope.sse.services.netskope_aa_metrics.AdvancedAnalyticsSettings.from_environment", return_value=AdvancedAnalyticsSettings("https://other.example", "new-token")):
            await self.cache.get()
        self.assertEqual(self.query.await_count, 3)

    async def test_expired_failures_do_not_serve_stale_result_or_start_task_storm(self):
        with patch("app.netskope.sse.services.netskope_aa_metrics.monotonic", return_value=100):
            await self.cache.get()
        self.query.side_effect = AdvancedAnalyticsError("remote unavailable")
        with patch("app.netskope.sse.services.netskope_aa_metrics.monotonic", return_value=401):
            for _ in range(5):
                with self.assertRaises(AdvancedAnalyticsError):
                    await self.cache.get()
        self.assertEqual(self.query.await_count, 2)
        self.query.side_effect = None
        with patch("app.netskope.sse.services.netskope_aa_metrics.monotonic", return_value=417):
            self.assertEqual((await self.cache.get())["total"], 15)
        self.assertEqual(self.query.await_count, 3)
