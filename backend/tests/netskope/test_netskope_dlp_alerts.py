"""NSK-DLP-001: allowlist projection, bounded capture and migration shape."""

import asyncio
import contextlib
import pathlib
import re
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.netskope.sse.integrations.netskope import NetskopeError, NetskopeSettings
from app.netskope.sse.services.netskope_dlp_alerts import (
    ALLOWED_ALERT_FIELDS,
    DLP_RETENTION_DAYS,
    capture_netskope_dlp_alerts,
    incident_rows,
    is_caught_up,
    payload_high_water_mark,
    sanitize_dlp_incident,
)

ROOT = pathlib.Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "migrations" / "069_netskope_dlp_alerts.sql"
APPROVED_PATH = "/api/v2/events/dataexport/events/incident"
NOW = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def _settings() -> NetskopeSettings:
    return NetskopeSettings(
        base_url="https://tenant.goskope.com", api_token="secret-token",
        device_status_path="/devices", users_path="/users", user_counts_path="/counts",
        dlp_incidents_path=APPROVED_PATH, page_delay_seconds=0,
    )


def _incident(**overrides):
    row = {
        "_id": "event-1", "timestamp": int(NOW.timestamp()) - 60,
        "dlp_incident_id": 7, "status": "open", "severity": "High",
        "user_id": "u-1",
        "dlp_match_info": [{"dlp_policy": "Policy A", "dlp_action": "alert"}],
    }
    row.update(overrides)
    return row


class DlpSanitizerTests(unittest.TestCase):
    def test_sanitizer_keeps_only_the_approved_allowlist(self):
        row = _incident(
            title="document", app="WhatsApp", site="whatsapp.com", user="ana@example.test",
            acting_user="ana@example.test", file_type="image/png", classification="Financial",
            dlp_file="report.pdf", file_path="/home/ana/report.pdf", url="https://x.test/a?b=c",
            md5="must-not", sha256="must-not", srcip="10.0.0.1", dstip="10.0.0.2",
            dlp_match_info=[{
                "dlp_policy": "Policy A", "dlp_action": "alert",
                "dlp_forensic_id": "must-not", "dlp_rules": [{"dlp_rule_name": "Rule A", "weighted": 3}],
            }],
        )
        result = sanitize_dlp_incident(row, now=NOW)
        self.assertIsNotNone(result)
        self.assertEqual(set(result), set(ALLOWED_ALERT_FIELDS))
        self.assertEqual(result["incident_id"], "7")
        self.assertEqual(result["status"], "open")
        self.assertEqual(result["severity"], "High")
        self.assertEqual(result["policy"], "Policy A")
        self.assertEqual(result["action"], "alert")
        self.assertEqual(result["user_id"], "u-1")
        self.assertEqual(result["event_timestamp"], datetime.fromtimestamp(int(NOW.timestamp()) - 60, tz=timezone.utc))
        serialized = repr(result)
        for forbidden in ("ana@example.test", "report.pdf", "/home/ana", "must-not", "10.0.0.1", "Rule A", "Financial"):
            self.assertNotIn(forbidden, serialized)

    def test_rows_without_id_or_usable_timestamp_are_dropped(self):
        self.assertIsNone(sanitize_dlp_incident(_incident(dlp_incident_id=None), now=NOW))
        self.assertIsNone(sanitize_dlp_incident(_incident(dlp_incident_id=""), now=NOW))
        self.assertIsNone(sanitize_dlp_incident(_incident(timestamp=10**100), now=NOW))
        self.assertIsNone(sanitize_dlp_incident(_incident(timestamp=1_700_000_000_000), now=NOW))  # ms, not s
        self.assertIsNone(sanitize_dlp_incident(_incident(timestamp=True), now=NOW))
        self.assertIsNone(sanitize_dlp_incident("not-a-dict", now=NOW))

    def test_first_non_empty_match_wins_for_policy_and_action(self):
        row = _incident(dlp_match_info=[
            {"dlp_policy": "", "dlp_action": ""},
            {"dlp_policy": "Policy B", "dlp_action": "block"},
            {"dlp_policy": "Policy C", "dlp_action": "alert"},
        ])
        result = sanitize_dlp_incident(row, now=NOW)
        self.assertEqual(result["policy"], "Policy B")
        self.assertEqual(result["action"], "block")

    def test_missing_match_info_stays_empty_instead_of_inventing_values(self):
        result = sanitize_dlp_incident(_incident(dlp_match_info="broken"), now=NOW)
        self.assertEqual(result["policy"], "")
        self.assertEqual(result["action"], "")

    def test_incident_rows_and_high_water_mark(self):
        payload = {"result": [{"dlp_incident_id": 1}, "bad"], "timestamp_hwm": int(NOW.timestamp())}
        self.assertEqual(incident_rows(payload), [{"dlp_incident_id": 1}])
        self.assertEqual(incident_rows({"result": "broken"}), [])
        self.assertEqual(payload_high_water_mark(payload, NOW - timedelta(hours=1)), NOW)
        self.assertEqual(payload_high_water_mark({"timestamp_hwm": "bad"}, NOW), NOW)
        self.assertEqual(payload_high_water_mark({}, NOW), NOW)

    def test_caught_up_uses_a_five_minute_epsilon(self):
        self.assertTrue(is_caught_up(NOW - timedelta(minutes=4), NOW))
        self.assertFalse(is_caught_up(NOW - timedelta(minutes=6), NOW))


class FakeClient:
    def __init__(self, pages):
        self.pages = list(pages)
        self.calls: list[tuple[str, str]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get_dlp_incident_page(self, operation, index):
        self.calls.append((operation, index))
        return self.pages.pop(0)


class DlpCaptureTests(unittest.TestCase):
    def _patch_capture(self, client, *, state=None, upsert=None, record=None, purge=None):
        return [
            patch.dict("os.environ", {"NETSKOPE_DLP_INCIDENTS_PATH": APPROVED_PATH}, clear=True),
            patch("app.netskope.sse.services.netskope_dlp_alerts.NetskopeSettings.from_environment", return_value=_settings()),
            patch("app.netskope.sse.services.netskope_dlp_alerts.NetskopeClient", return_value=client),
            patch("app.netskope.sse.services.netskope_dlp_alerts.get_netskope_dlp_capture_state", new=AsyncMock(return_value=state)),
            patch("app.netskope.sse.services.netskope_dlp_alerts.persist_netskope_dlp_page", new=upsert or AsyncMock()),
            patch("app.netskope.sse.services.netskope_dlp_alerts.record_netskope_dlp_capture_state", new=record or AsyncMock()),
            patch("app.netskope.sse.services.netskope_dlp_alerts.purge_netskope_dlp_alerts", new=purge or AsyncMock()),
        ]

    def _start(self, contexts):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        for context in contexts:
            stack.enter_context(context)
        return stack

    def test_capture_dedupes_by_incident_keeping_the_newest_event(self):
        older = _incident(dlp_incident_id=7, timestamp=int(NOW.timestamp()) - 120, severity="Low")
        newer = _incident(dlp_incident_id=7, timestamp=int(NOW.timestamp()) - 30, severity="High")
        other = _incident(dlp_incident_id=8, timestamp=int(NOW.timestamp()) - 60)
        pages = [
            {"result": [older, other], "timestamp_hwm": int(NOW.timestamp()) - 3600},
            {"result": [newer], "timestamp_hwm": int(NOW.timestamp())},
        ]
        client = FakeClient(pages)
        upsert, record, purge = AsyncMock(), AsyncMock(), AsyncMock()
        run_id = uuid4()
        pool = object()
        self._start(self._patch_capture(client, upsert=upsert, record=record, purge=purge))
        result = asyncio.run(capture_netskope_dlp_alerts(pool, run_id, now=NOW))

        self.assertTrue(result["configured"])
        self.assertFalse(result["partial"])
        self.assertEqual(result["captured_alerts"], 2)
        alerts = [alert for call in upsert.await_args_list for alert in call.args[2]]
        by_id = {alert["incident_id"]: alert for alert in alerts}
        self.assertEqual(set(by_id), {"7", "8"})
        self.assertEqual(by_id["7"]["severity"], "High")
        self.assertEqual(by_id["7"]["event_timestamp"], datetime.fromtimestamp(int(NOW.timestamp()) - 30, tz=timezone.utc))
        state = upsert.await_args.kwargs
        self.assertFalse(state["partial"])
        self.assertEqual(state["captured_alerts"], 2)
        self.assertEqual(upsert.await_args.args[1], run_id)
        purge.assert_awaited_once_with(pool, DLP_RETENTION_DAYS)
        self.assertEqual(client.calls[0][0], str(int((NOW - timedelta(days=DLP_RETENTION_DAYS)).timestamp())))
        self.assertEqual(client.calls[1], ("next", client.calls[0][1]))

    def test_partial_capture_resumes_the_persisted_index(self):
        state = {
            "iterator_index": "existing-index", "partial": True,
            "coverage_start": NOW - timedelta(days=30), "coverage_end": NOW - timedelta(hours=3),
        }
        stalled_hwm = int((NOW - timedelta(hours=2)).timestamp())

        class StallingClient(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                self.calls.append((operation, index))
                if len(self.calls) == 1:
                    return {"result": [_incident()], "timestamp_hwm": stalled_hwm}
                return {"result": [], "timestamp_hwm": stalled_hwm}

        client = StallingClient([])
        upsert, record, purge = AsyncMock(), AsyncMock(), AsyncMock()
        self._start(self._patch_capture(client, state=state, upsert=upsert, record=record, purge=purge))
        result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))

        self.assertTrue(result["partial"])
        self.assertEqual(client.calls[0], ("resend", "existing-index"))
        self.assertTrue(all(call[0] == "next" for call in client.calls[1:]))
        self.assertEqual(upsert.await_count, len(client.calls))
        self.assertTrue(upsert.await_args.kwargs["partial"])
        # Retention is time-based: it still runs on a partial capture.
        purge.assert_awaited_once()

    def test_a_run_with_no_events_and_a_frozen_marker_is_idle_not_partial(self):
        state = {
            "iterator_index": "existing-index", "partial": True,
            "coverage_start": NOW - timedelta(days=30), "coverage_end": NOW - timedelta(minutes=40),
        }
        frozen = int((NOW - timedelta(minutes=40)).timestamp())

        class QuietClient(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                self.calls.append((operation, index))
                return {"result": [], "timestamp_hwm": frozen}

        client = QuietClient([])
        upsert = AsyncMock()
        self._start(self._patch_capture(client, state=state, upsert=upsert))
        result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))

        self.assertTrue(result["idle"])
        self.assertFalse(result["partial"])
        self.assertEqual(result["scanned_events"], 0)
        # The lag stays visible and the cursor keeps its place for the next run.
        self.assertEqual(result["lag_seconds"], 40 * 60)
        self.assertEqual(client.calls[0], ("resend", "existing-index"))
        self.assertTrue(upsert.await_args.kwargs["partial"])

    def test_events_with_a_frozen_marker_still_count_as_pending_work(self):
        state = {
            "iterator_index": "existing-index", "partial": True,
            "coverage_start": NOW - timedelta(days=30), "coverage_end": NOW - timedelta(hours=3),
        }
        frozen = int((NOW - timedelta(hours=2)).timestamp())

        class OneThenQuiet(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                self.calls.append((operation, index))
                return {"result": [_incident()] if len(self.calls) == 1 else [], "timestamp_hwm": frozen}

        self._start(self._patch_capture(OneThenQuiet([]), state=state))
        result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertFalse(result["idle"])
        self.assertTrue(result["partial"])

    def test_capture_honors_server_wait_before_next_page(self):
        client = FakeClient([
            {"result": [_incident()], "timestamp_hwm": int(NOW.timestamp()) - 3600, "wait_time": 7},
            {"result": [], "timestamp_hwm": int(NOW.timestamp()), "wait_time": 0},
        ])
        self._start(self._patch_capture(client))
        with patch("app.netskope.sse.services.netskope_dlp_alerts.asyncio.sleep", new=AsyncMock()) as sleep, \
             patch("app.netskope.sse.services.netskope_dlp_alerts.time.monotonic", return_value=0):
            result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertFalse(result["partial"])
        sleep.assert_awaited_once_with(7)

    def test_persistence_consumes_the_server_wait_without_delaying_next_request_twice(self):
        for persistence_seconds, expected_next_at, expected_wait in ((2, 5, 3), (6, 6, 0)):
            with self.subTest(persistence_seconds=persistence_seconds):
                clock = [0.0]
                request_times = []

                class TimedClient(FakeClient):
                    async def get_dlp_incident_page(self, operation, index, clock=clock, request_times=request_times):
                        request_times.append(clock[0])
                        return await super().get_dlp_incident_page(operation, index)

                async def persist(*args, clock=clock, persistence_seconds=persistence_seconds, **kwargs):
                    clock[0] += persistence_seconds

                async def sleep(seconds, clock=clock):
                    clock[0] += seconds

                client = TimedClient([
                    {"result": [_incident()], "timestamp_hwm": int(NOW.timestamp()) - 3600, "wait_time": 5},
                    {"result": [], "timestamp_hwm": int(NOW.timestamp()), "wait_time": 0},
                ])
                with contextlib.ExitStack() as stack:
                    for context in self._patch_capture(client, upsert=AsyncMock(side_effect=persist)):
                        stack.enter_context(context)
                    stack.enter_context(patch("app.netskope.sse.services.netskope_dlp_alerts.time.monotonic", side_effect=lambda clock=clock: clock[0]))
                    stack.enter_context(patch("app.netskope.sse.services.netskope_dlp_alerts.asyncio.sleep", new=AsyncMock(side_effect=sleep)))
                    result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
                self.assertEqual(request_times, [0, expected_next_at])
                self.assertFalse(result["partial"])
                self.assertEqual(result["persistence_ms"], persistence_seconds * 2 * 1000)
                self.assertEqual(result["wait_ms"], expected_wait * 1000)

    def test_a_remote_failure_logs_its_cause_without_payload(self):
        class Failing(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                raise NetskopeError("Netskope devolvió HTTP 502 para incidentes DLP")

        self._start(self._patch_capture(Failing([])))
        with self.assertLogs("app.netskope.sse.services.netskope_dlp_alerts", level="WARNING") as logs:
            result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertTrue(result["error"])
        self.assertIn("NetskopeError: Netskope devolvió HTTP 502", logs.output[0])

    def test_first_remote_error_preserves_index_without_advancing_freshness(self):
        class FailingClient(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                raise NetskopeError("boom")

        upsert, record, purge = AsyncMock(), AsyncMock(), AsyncMock()
        self._start(self._patch_capture(FailingClient([]), upsert=upsert, record=record, purge=purge))
        with self.assertLogs("app.netskope.sse.services.netskope_dlp_alerts", level="WARNING"):
            result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))

        self.assertTrue(result["error"])
        self.assertTrue(result["partial"])
        upsert.assert_not_awaited()
        self.assertIsNone(record.await_args.kwargs["captured_at"])
        self.assertEqual(record.await_args.kwargs["coverage_start"], record.await_args.kwargs["coverage_end"])
        purge.assert_not_awaited()

    def test_later_remote_failure_keeps_the_committed_page_for_replay(self):
        class FailingAfterPageClient(FakeClient):
            async def get_dlp_incident_page(self, operation, index):
                if self.calls:
                    raise NetskopeError("response lost")
                return await super().get_dlp_incident_page(operation, index)

        client = FailingAfterPageClient([
            {"result": [_incident()], "timestamp_hwm": int(NOW.timestamp()) - 3600},
        ])
        persist, record = AsyncMock(), AsyncMock()
        self._start(self._patch_capture(client, upsert=persist, record=record))
        with self.assertLogs("app.netskope.sse.services.netskope_dlp_alerts", level="WARNING"):
            result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertTrue(result["error"])
        persist.assert_awaited_once()
        self.assertEqual(persist.await_args.args[2][0]["incident_id"], "7")
        self.assertEqual(persist.await_args.kwargs["coverage_end"], NOW - timedelta(hours=1))
        self.assertTrue(persist.await_args.kwargs["partial"])

    def test_unstarted_index_reinitializes_at_the_original_epoch(self):
        start = NOW - timedelta(days=30)
        state = {"iterator_index": "unstarted", "partial": True, "coverage_start": start, "coverage_end": start}
        client = FakeClient([{"result": [], "timestamp_hwm": int(NOW.timestamp())}])
        self._start(self._patch_capture(client, state=state))
        result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertEqual(client.calls, [(str(int(start.timestamp())), "unstarted")])
        self.assertFalse(result["partial"])

    def test_unconfigured_capture_is_a_no_op(self):
        with patch.dict("os.environ", {}, clear=True), \
             patch("app.netskope.sse.services.netskope_dlp_alerts.persist_netskope_dlp_page", new=AsyncMock()) as upsert:
            result = asyncio.run(capture_netskope_dlp_alerts(object(), uuid4(), now=NOW))
        self.assertFalse(result["configured"])
        self.assertFalse(result["error"])
        upsert.assert_not_awaited()


class DlpMigrationTests(unittest.TestCase):
    def test_alert_table_columns_are_exactly_the_allowlist_plus_provenance(self):
        body = MIGRATION.read_text(encoding="utf-8")
        block = re.search(r"CREATE TABLE public\.netskope_dlp_alerts \((.*?)\);", body, re.DOTALL)
        self.assertIsNotNone(block)
        columns = {line.strip().split()[0] for line in block.group(1).splitlines() if line.strip()}
        self.assertEqual(columns, {
            "incident_id", "event_timestamp", "status", "severity", "policy",
            "action", "user_id", "source_run_id", "captured_at",
        })
        for forbidden in (
            "file", "url", "hash", "email", "ip_address", "payload", "match",
            "title", "hostname", "app", "site", "classification", "device",
        ):
            self.assertNotIn(forbidden, columns)

    def test_migration_seeds_the_narrow_permission_without_granting_it(self):
        body = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("'netskope:dlp_read'", body)
        self.assertIn("ON CONFLICT (permission_code) DO NOTHING", body)
        self.assertNotIn("INSERT INTO public.access_role_permissions", body)


if __name__ == "__main__":
    unittest.main()
