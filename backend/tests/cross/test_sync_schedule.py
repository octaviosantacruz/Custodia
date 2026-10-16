import unittest
from datetime import datetime, timedelta, timezone

from app.config import AppSettings
from app.cross.services.sync_schedule import (
    SourceRunHistory, effective_task_interval_minutes,
    STALE_AFTER_INTERVALS, next_attempt_delay_seconds, retry_delay_seconds, task_freshness,
)
from app.lifecycle import due_sources, validate_sync_settings
from app.source_contract import SyncPolicy

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
POLICY = SyncPolicy(max_retries=2, backoff_base_seconds=300, backoff_max_seconds=1200)


def settings(**overrides):
    # Explicit values: the process environment (verify.sh) must not leak in.
    values = {"ingestion_interval_minutes": 0, "sync_source_intervals": {}, **overrides}
    return AppSettings(database_url="postgresql://unused", session_secret="x" * 32, **values)


class NextAttemptTests(unittest.TestCase):
    def test_task_interval_precedence_is_admin_then_environment_then_policy_then_global(self):
        policy = SyncPolicy(interval_minutes=30)
        base = dict(task_key="netskope_dlp", source_system="netskope", policy=policy, global_default=60)
        self.assertEqual(effective_task_interval_minutes(**base, environment_overrides={}, admin_overrides={}), (30, "task_policy"))
        self.assertEqual(effective_task_interval_minutes(**{**base, "policy": SyncPolicy()}, environment_overrides={}, admin_overrides={}), (60, "global_default"))
        self.assertEqual(effective_task_interval_minutes(**base, environment_overrides={"netskope": 45}, admin_overrides={}), (45, "environment_source"))
        self.assertEqual(effective_task_interval_minutes(**base, environment_overrides={"netskope": 45, "netskope_dlp": 20}, admin_overrides={}), (20, "environment_task"))
        self.assertEqual(effective_task_interval_minutes(**base, environment_overrides={"netskope_dlp": 20}, admin_overrides={"netskope_dlp": {"interval_minutes": 0}}), (0, "administrative"))

    def test_never_run_is_due_immediately_and_disabled_interval_is_not_scheduled(self):
        self.assertEqual(next_attempt_delay_seconds(SourceRunHistory(), 15, POLICY, now=NOW), 0)
        self.assertIsNone(next_attempt_delay_seconds(SourceRunHistory(), 0, POLICY, now=NOW))

    def test_cadence_counts_from_the_last_success_not_from_the_last_enqueue(self):
        history = SourceRunHistory(last_success_at=NOW - timedelta(minutes=10))
        self.assertEqual(next_attempt_delay_seconds(history, 15, POLICY, now=NOW), 5 * 60)
        stale = SourceRunHistory(last_success_at=NOW - timedelta(minutes=20))
        self.assertEqual(next_attempt_delay_seconds(stale, 15, POLICY, now=NOW), 0)

    def test_failures_back_off_exponentially_then_wait_a_full_interval(self):
        base = dict(last_success_at=NOW - timedelta(hours=5), last_failure_at=NOW)
        first = SourceRunHistory(consecutive_failures=1, **base)
        second = SourceRunHistory(consecutive_failures=2, **base)
        exhausted = SourceRunHistory(consecutive_failures=3, **base)
        self.assertEqual(next_attempt_delay_seconds(first, 60, POLICY, now=NOW), 300)
        self.assertEqual(next_attempt_delay_seconds(second, 60, POLICY, now=NOW), 600)
        self.assertEqual(next_attempt_delay_seconds(exhausted, 60, POLICY, now=NOW), 3600)

    def test_a_retry_is_never_later_than_the_regular_interval(self):
        history = SourceRunHistory(consecutive_failures=2, last_failure_at=NOW)
        self.assertEqual(next_attempt_delay_seconds(history, 5, POLICY, now=NOW), 300)

    def test_backoff_is_capped(self):
        self.assertEqual(retry_delay_seconds(10, POLICY), 1200)


class DueSourcesTests(unittest.TestCase):
    def test_each_source_uses_its_own_interval_and_busy_sources_are_not_due(self):
        config = settings(ingestion_interval_minutes=60, sync_source_intervals={"netskope_inventory": 10})
        history = {
            "netskope_inventory": SourceRunHistory(last_success_at=NOW - timedelta(minutes=11)),
            "sia": SourceRunHistory(last_success_at=NOW - timedelta(minutes=11)),
            "access": SourceRunHistory(last_success_at=NOW - timedelta(hours=3), active=True),
        }
        due, wait = due_sources({"netskope_inventory", "sia", "access"}, history, config, now=NOW)
        self.assertEqual(due, {"netskope_inventory"})
        self.assertEqual(wait, 60)

    def test_a_failing_task_backs_off_without_delaying_its_sibling_tasks(self):
        # SYNC-TASK-001: DLP failing must not hold back the inventory task.
        config = settings(ingestion_interval_minutes=60)
        history = {
            "netskope_inventory": SourceRunHistory(last_success_at=NOW - timedelta(minutes=61)),
            "netskope_dlp": SourceRunHistory(
                last_success_at=NOW - timedelta(hours=5), last_failure_at=NOW - timedelta(seconds=10), consecutive_failures=1,
            ),
            "netskope_alerts": SourceRunHistory(last_success_at=NOW - timedelta(minutes=61)),
        }
        due, wait = due_sources({"netskope_inventory", "netskope_dlp", "netskope_alerts"}, history, config, now=NOW)
        self.assertEqual(due, {"netskope_inventory", "netskope_alerts"})
        self.assertEqual(wait, 290)

    def test_a_source_override_covers_its_tasks_and_a_task_override_wins(self):
        from app.lifecycle import source_interval_minutes
        self.assertEqual(source_interval_minutes(settings(sync_source_intervals={"netskope": 30}), "netskope_dlp"), 30)
        mixed = settings(sync_source_intervals={"netskope": 30, "netskope_dlp": 5})
        self.assertEqual(source_interval_minutes(mixed, "netskope_dlp"), 5)
        self.assertEqual(source_interval_minutes(mixed, "netskope_alerts"), 30)
        # SYNC-TASK-002: the source name still covers both PAM tasks.
        pam = settings(sync_source_intervals={"cyberark": 20})
        self.assertEqual((source_interval_minutes(pam, "pam_safes"), source_interval_minutes(pam, "pam_psm")), (20, 20))
        self.assertEqual(source_interval_minutes(settings(sync_source_intervals={"cyberark": 20, "pam_psm": 10}), "pam_psm"), 10)
        admin = {"pam_psm": {"interval_minutes": 0}}
        self.assertEqual(source_interval_minutes(pam, "pam_psm", admin), 0)

    def test_a_failing_psm_refresh_does_not_delay_the_safes_task(self):
        config = settings(ingestion_interval_minutes=60)
        history = {
            "pam_safes": SourceRunHistory(last_success_at=NOW - timedelta(minutes=61)),
            "pam_psm": SourceRunHistory(
                last_success_at=NOW - timedelta(hours=5), last_failure_at=NOW - timedelta(seconds=10), consecutive_failures=1,
            ),
        }
        due, _wait = due_sources({"pam_safes", "pam_psm"}, history, config, now=NOW)
        self.assertEqual(due, {"pam_safes"})

    def test_sync_settings_accept_task_keys_and_reject_unknown_names(self):
        validate_sync_settings(settings(sync_source_intervals={"netskope_dlp": 5, "sia": 10}))
        with self.assertRaises(RuntimeError):
            validate_sync_settings(settings(sync_source_intervals={"netskope_dlq": 5}))

    def test_disabled_tasks_are_not_due_and_administrative_override_can_disable_them(self):
        tasks = {"netskope_inventory", "netskope_dlp"}
        self.assertEqual(due_sources(tasks, {}, settings(), now=NOW), (set(), None))
        enabled = settings(sync_source_intervals={"netskope": 30})
        self.assertEqual(due_sources(tasks, {}, enabled, now=NOW), (tasks, None))
        overrides = {task: {"interval_minutes": 0} for task in tasks}
        self.assertEqual(due_sources(tasks, {}, enabled, now=NOW, admin_overrides=overrides), (set(), None))

    def test_unknown_override_source_fails_startup_validation(self):
        with self.assertRaisesRegex(RuntimeError, "no registradas"):
            validate_sync_settings(settings(sync_source_intervals={"nope": 30}))

    def test_overrides_below_five_minutes_are_rejected(self):
        with self.assertRaises(ValueError):
            settings(sync_source_intervals={"netskope": 2})


if __name__ == "__main__":
    unittest.main()


class TaskFreshnessTests(unittest.TestCase):
    def freshness(self, minutes_ago, interval=60, **overrides):
        success = None if minutes_ago is None else NOW - timedelta(minutes=minutes_ago)
        values = {"configured": True, "interval_minutes": interval, "last_success_at": success, "now": NOW, **overrides}
        return task_freshness(**values)

    def test_stale_only_after_more_than_n_whole_intervals(self):
        self.assertEqual(STALE_AFTER_INTERVALS, 3)
        self.assertEqual(self.freshness(59), ("fresh", 1.0))
        self.assertEqual(self.freshness(180), ("fresh", 3.0))
        self.assertEqual(self.freshness(181), ("stale", 3.0))
        self.assertEqual(self.freshness(600), ("stale", 10.0))

    def test_threshold_follows_the_effective_interval(self):
        self.assertEqual(self.freshness(100, interval=30)[0], "stale")
        self.assertEqual(self.freshness(100, interval=120)[0], "fresh")

    def test_no_evidence_is_unknown_never_stale_or_fresh(self):
        self.assertEqual(self.freshness(None), ("unknown", None))
        self.assertEqual(self.freshness(600, configured=False), ("unknown", None))
        self.assertEqual(self.freshness(600, interval=0), ("unknown", None))

    def test_naive_timestamp_and_clock_skew(self):
        naive = (NOW - timedelta(minutes=30)).replace(tzinfo=None)
        self.assertEqual(task_freshness(configured=True, interval_minutes=60, last_success_at=naive, now=NOW), ("fresh", 0.5))
        self.assertEqual(self.freshness(-10), ("fresh", 0.0))
