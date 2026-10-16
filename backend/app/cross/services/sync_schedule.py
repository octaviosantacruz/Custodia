"""Pure scheduling rules for source synchronization (SYNC-POLICY-001).

A source is due from its last *successful* run (``completed`` or ``partial``),
not from the last time work was enqueued. After failures it retries with
exponential backoff, then falls back to the regular interval.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.source_contract import SyncPolicy


@dataclass(frozen=True)
class SourceRunHistory:
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    consecutive_failures: int = 0
    first_seen_at: datetime | None = None
    active: bool = False  # a queued or running run exists
    last_attempt_at: datetime | None = None
    last_status: str | None = None


def retry_delay_seconds(consecutive_failures: int, policy: SyncPolicy) -> float:
    exponent = max(consecutive_failures - 1, 0)
    return min(policy.backoff_base_seconds * (2 ** min(exponent, 20)), policy.backoff_max_seconds)


def effective_task_interval_minutes(
    *, task_key: str, source_system: str, policy: SyncPolicy, global_default: float,
    environment_overrides: dict[str, float], admin_overrides: dict[str, dict] | None = None,
) -> tuple[float, str]:
    """Return effective cadence and its source; admin override > env > policy > global."""
    if admin_overrides and task_key in admin_overrides:
        return float(admin_overrides[task_key]["interval_minutes"]), "administrative"
    if task_key in environment_overrides:
        return environment_overrides[task_key], "environment_task"
    if source_system in environment_overrides:
        return environment_overrides[source_system], "environment_source"
    if policy.interval_minutes is not None:
        return policy.interval_minutes, "task_policy"
    return global_default, "global_default"


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def next_attempt_delay_seconds(
    history: SourceRunHistory, interval_minutes: float, policy: SyncPolicy, *, now: datetime | None = None,
) -> float | None:
    """Seconds until the next scheduled attempt; ``None`` when not scheduled.

    An active run means the source is busy: report 0 so the caller reconsiders
    it on its short pass (the queue itself refuses to overlap runs).
    """
    if interval_minutes <= 0:
        return None
    current = now or datetime.now(timezone.utc)
    interval = timedelta(minutes=interval_minutes)
    success, failure = _aware(history.last_success_at), _aware(history.last_failure_at)
    if history.consecutive_failures > 0 and failure is not None:
        if history.consecutive_failures <= policy.max_retries:
            due = failure + min(timedelta(seconds=retry_delay_seconds(history.consecutive_failures, policy)), interval)
        else:
            due = failure + interval
    elif success is not None:
        due = success + interval
    else:
        return 0.0
    return max((due - current).total_seconds(), 0.0)


# SYNC-OBS-001: a task is stale after this many whole intervals without a success.
STALE_AFTER_INTERVALS = 3


def task_freshness(
    *, configured: bool, interval_minutes: float, last_success_at: datetime | None, now: datetime | None = None,
) -> tuple[str, float | None]:
    """Evidence-only freshness: ``(state, intervals_since_success)``.

    ``fresh``/``stale`` need a configured, enabled task *and* a recorded
    success; anything else is ``unknown`` (no run history, disabled or not
    configured) because absence of evidence must not be shown as staleness or
    as freshness. ``partial`` counts as a success, as it does for scheduling.
    """
    success = _aware(last_success_at)
    if not configured or interval_minutes <= 0 or success is None:
        return "unknown", None
    elapsed = ((now or datetime.now(timezone.utc)) - success).total_seconds() / 60
    intervals = max(elapsed, 0.0) / interval_minutes
    return ("stale" if intervals > STALE_AFTER_INTERVALS else "fresh"), round(intervals, 1)
