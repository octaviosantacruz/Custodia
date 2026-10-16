"""NSK-POL-001: shape observed Netskope policy aggregates for the read API.

Only policies that fired are returned. The configured catalog is out of scope,
so a policy absent from the latest cohort is simply not listed (never marked
disabled) and a missing value is "Sin dato", never 0.

NSK-POL-002: every window reports ``policy_capture``. ``missing`` means the
latest cohort never captured the policy dimension (it predates it); only
``captured`` with an empty list means no policy fired in that capture.
"""

from datetime import datetime, timezone
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.netskope.sse.repositories.netskope_metrics import ALERT_AGGREGATE_STALE_AFTER
from app.netskope.sse.repositories.netskope_shared import ALERT_AGGREGATE_RETENTION_DAYS
from app.netskope.sse.repositories.netskope_observed_policies import (
    fetch_observed_policy_rows,
    observed_policy_window_days,
)

# Cross-dimension policy x action is explicitly out of scope: the action
# dimension is global, so no dominant action can be derived per policy.
DOMINANT_ACTION_UNKNOWN = "Sin dato"


async def get_observed_policies(pool: AsyncConnectionPool) -> dict[str, Any]:
    """Return per-window observed policy rows with capture bounds."""
    rows = await fetch_observed_policy_rows(pool)
    by_window: dict[int, dict[str, Any]] = {}
    for row in rows:
        window = by_window.get(row["window_days"])
        if window is None:
            window = {
                "days": row["window_days"],
                "window_start": row["window_start"],
                "window_end": row["window_end"],
                "captured_at": row["captured_at"],
                "policy_capture": "captured" if row["policy_captured"] else "missing",
                "policies": [],
            }
            by_window[row["window_days"]] = window
        elif row["captured_at"] > window["captured_at"]:
            # A cohort is one run; keep its capture metadata defensively.
            window["captured_at"] = row["captured_at"]
            window["window_start"] = row["window_start"]
            window["window_end"] = row["window_end"]
        if row["policy"] is None:
            continue
        window["policies"].append({
            "policy": row["policy"],
            "volume": row["alert_count"],
            "first_captured_at": row["first_captured_at"],
            "last_captured_at": row["last_captured_at"],
            "dominant_action": DOMINANT_ACTION_UNKNOWN,
        })

    stale_before = datetime.now(timezone.utc) - ALERT_AGGREGATE_STALE_AFTER
    windows: list[dict[str, Any]] = []
    for days in observed_policy_window_days():
        window = by_window.get(days)
        if window is None:
            continue
        window["policies"].sort(key=lambda item: (-item["volume"], item["policy"]))
        window["availability"] = "stale" if window["captured_at"] < stale_before else "complete"
        windows.append(window)
    # first/last captured_at come from snapshots kept for this many days, so
    # "first" is bounded by the retention and is not the first real appearance.
    return {"windows": windows, "retention_days": ALERT_AGGREGATE_RETENTION_DAYS}


__all__ = ["get_observed_policies", "DOMINANT_ACTION_UNKNOWN"]
