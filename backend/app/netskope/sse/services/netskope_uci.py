"""NSK-UBA-002: reduce UCI reads to one latest score per user (no series kept)."""

from datetime import datetime, timezone
from typing import Any

UCI_MIN_SCORE = 0
UCI_MAX_SCORE = 1000
# The earlier score must be at least this old, so a same-day point is never
# presented as "a week ago".
PREVIOUS_MIN_AGE_MS = 3 * 24 * 3600 * 1000


def _score(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if UCI_MIN_SCORE <= value <= UCI_MAX_SCORE else None


def email_key(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def build_uci_rows(ranked: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Latest valid reading per user plus the number of rejected rows.

    A row without a usable user, score or timestamp is counted, never guessed.
    When the same user is listed twice the most recent reading wins.
    """
    latest: dict[str, dict[str, Any]] = {}
    rejected = 0
    for item in ranked:
        key = email_key(item.get("user"))
        score = _score(item.get("uciScore"))
        started = item.get("startTime")
        if not key or score is None or isinstance(started, bool) or not isinstance(started, int) or started <= 0:
            rejected += 1
            continue
        current = latest.get(key)
        if current is None or started > current["scored_ms"]:
            latest[key] = {
                "email_key": key, "rating": item["rating"], "score": score, "scored_ms": started,
                "scored_at": datetime.fromtimestamp(started / 1000, tz=timezone.utc),
            }
    return list(latest.values()), rejected


def previous_score(points: list[dict[str, Any]], scored_ms: int) -> int | None:
    """Earliest valid point of the window that is old enough to be a real comparison."""
    candidates = [
        (point["start"], _score(point.get("confidenceScore")))
        for point in points
        if isinstance(point.get("start"), int) and not isinstance(point.get("start"), bool)
        and point["start"] <= scored_ms - PREVIOUS_MIN_AGE_MS
    ]
    candidates = [(start, score) for start, score in candidates if score is not None]
    return min(candidates)[1] if candidates else None
