"""Device-use evidence: temporal boundaries and conservative unknown states."""

import unittest
from datetime import datetime, timedelta, timezone

from app.netskope.sse.device_evidence import FUTURE_TOLERANCE_SECONDS, device_evidence

AS_OF = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def row(attributes, **source):
    return {
        "attributes": attributes, "evidence_as_of": AS_OF,
        "source_status": "completed", "source_completed_at": AS_OF - timedelta(hours=1),
        **source,
    }


class DeviceEvidenceTests(unittest.TestCase):
    def test_state_depends_only_on_the_age_of_the_last_event(self):
        # NSK-HB-001: the heartbeat flag never changes the state, whatever its value.
        cases = [
            (7 * 86400, "recent"),
            (7 * 86400 + 1, "not_recent"),
            (30 * 86400, "not_recent"),
            (30 * 86400 + 1, "review"),
            (60 * 86400, "review"),
        ]
        for age, expected in cases:
            for heartbeat in (True, False, None, "false"):
                with self.subTest(age=age, heartbeat=heartbeat):
                    result = device_evidence(row({"last_event_timestamp": AS_OF.timestamp() - age, "heartbeat": heartbeat}))
                    self.assertEqual(result["state"], expected)
                    self.assertEqual(result["last_signal_at"], AS_OF - timedelta(seconds=age))
                    self.assertNotIn("heartbeat", result)

    def test_age_is_reported_in_whole_days_without_changing_the_thresholds(self):
        for seconds, expected in ((86400 * 289.96, 289), (86400 * 1.5, 1), (30, 0)):
            with self.subTest(seconds=seconds):
                result = device_evidence(row({"last_event_timestamp": AS_OF.timestamp() - seconds, "heartbeat": True}))
                self.assertEqual(result["age_days"], expected)
                self.assertIsInstance(result["age_days"], int)
        # 30 days and one second is already past the review threshold, though it shows as 30 whole days.
        edge = device_evidence(row({"last_event_timestamp": AS_OF.timestamp() - (30 * 86400 + 1), "heartbeat": False}))
        self.assertEqual((edge["age_days"], edge["state"]), (30, "review"))

    def test_missing_invalid_and_future_signals_are_unknown(self):
        for timestamp in (None, "1758000000", True, -1, 0, float("nan"), float("inf"), 10**400, AS_OF.timestamp() + FUTURE_TOLERANCE_SECONDS + 1):
            with self.subTest(timestamp=str(timestamp)):
                result = device_evidence(row({"last_event_timestamp": timestamp, "heartbeat": False}))
                self.assertEqual(result["state"], "unknown")
                self.assertIsNone(result["last_signal_at"])
                self.assertIsNone(result["age_days"])

    def test_a_signal_slightly_ahead_of_the_clock_counts_as_recent_but_one_beyond_the_tolerance_does_not(self):
        ahead = device_evidence(row({"last_event_timestamp": AS_OF.timestamp() + FUTURE_TOLERANCE_SECONDS, "last_seen_event": "Dem Heartbeat"}))
        self.assertEqual(ahead["state"], "recent")
        self.assertIsNotNone(ahead["last_signal_at"])
        self.assertEqual(ahead["age_days"], 0)

    def test_missing_stale_incomplete_and_future_runs_block_abandonment_classification(self):
        attributes = {"last_event_timestamp": (AS_OF - timedelta(days=90)).timestamp(), "heartbeat": False}
        cases = [
            {"source_status": None, "source_completed_at": None},
            {"source_status": "running"}, {"source_status": "partial"}, {"source_status": "failed"},
            {"source_completed_at": None},
            {"source_completed_at": AS_OF - timedelta(hours=24, seconds=1)},
            {"source_completed_at": AS_OF + timedelta(seconds=1)},
        ]
        for source in cases:
            with self.subTest(source=source):
                result = device_evidence(row(attributes, **source))
                self.assertEqual(result["state"], "unknown")
                self.assertFalse(result["source_fresh"])
                self.assertIsNotNone(result["last_signal_at"], "preserve old evidence without treating it as current")
        self.assertEqual(device_evidence(row(attributes, source_completed_at=AS_OF - timedelta(hours=24)))["state"], "review")

    def test_projection_excludes_inventory_sync_time_and_unknown_fields_without_mutation(self):
        attributes = {"last_seen_at": AS_OF.isoformat(), "heartbeat": "false", "username": "private@example.test", "raw_payload": "excluded", "client_version": "141", "os": "Mac"}
        original = attributes.copy()
        result = device_evidence(row(attributes))
        self.assertEqual(result["state"], "unknown")
        self.assertNotIn("heartbeat", result)
        self.assertEqual(result["client_version"], "141")
        self.assertEqual(result["os"], "Mac")
        self.assertTrue(set(attributes.keys() - {"heartbeat", "client_version", "os"}).isdisjoint(result))
        self.assertEqual(attributes, original)
