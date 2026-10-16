import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.cross.repositories.ingestion import (
    get_ingestion_schedule,
    last_scheduled_ingestion_at,
    source_run_history,
)


class IngestionScheduleRepositoryTests(unittest.TestCase):
    def test_reads_the_last_automatic_enqueue_not_a_completion_timestamp(self):
        timestamp = datetime(2026, 9, 22, 2, 14, tzinfo=timezone.utc)
        with patch("app.cross.repositories.ingestion.fetch_one", new=AsyncMock(return_value={"last_scheduled_at": timestamp})) as fetch:
            result = asyncio.run(last_scheduled_ingestion_at(object()))

        self.assertEqual(result, timestamp)
        query = fetch.await_args.args[1]
        self.assertIn("max(enqueued_at)", query)
        self.assertIn("triggered_by = 'system:scheduler'", query)

    def test_schedule_reports_the_remaining_time_after_a_restart(self):
        last = datetime.now(timezone.utc) - timedelta(minutes=5)
        with patch("app.cross.repositories.ingestion.last_scheduled_ingestion_at", new=AsyncMock(return_value=last)):
            result = asyncio.run(get_ingestion_schedule(object(), 15))

        self.assertTrue(result["enabled"])
        self.assertEqual(result["interval_minutes"], 15)
        self.assertEqual(result["last_scheduled_at"], last)
        self.assertGreater(result["next_scheduled_at"], last)

    def test_reads_run_history_per_task_counting_partial_as_a_success(self):
        success = datetime(2026, 9, 22, 2, 0, tzinfo=timezone.utc)
        failure = datetime(2026, 9, 22, 2, 10, tzinfo=timezone.utc)
        with patch(
            "app.cross.repositories.ingestion.fetch_all",
            new=AsyncMock(return_value=[
                {"task_key": "cyberark", "last_success_at": success, "last_failure_at": None, "last_attempt_at": success, "last_status": "partial", "active": False, "consecutive_failures": 0},
                {"task_key": "netskope_dlp", "last_success_at": success, "last_failure_at": failure, "last_attempt_at": failure, "last_status": "failed", "active": True, "consecutive_failures": 2},
            ]),
        ) as fetch:
            result = asyncio.run(source_run_history(object()))

        self.assertEqual(result["netskope_dlp"].consecutive_failures, 2)
        self.assertTrue(result["netskope_dlp"].active)
        self.assertEqual(result["cyberark"].last_success_at, success)
        query = fetch.await_args.args[1]
        self.assertIn("status IN ('completed', 'partial')", query)
        self.assertIn("GROUP BY task_key", query)

    def test_disabled_schedule_has_no_next_execution(self):
        with patch("app.cross.repositories.ingestion.last_scheduled_ingestion_at", new=AsyncMock(return_value=None)):
            result = asyncio.run(get_ingestion_schedule(object(), 0))

        self.assertFalse(result["enabled"])
        self.assertIsNone(result["next_scheduled_at"])


if __name__ == "__main__":
    unittest.main()
