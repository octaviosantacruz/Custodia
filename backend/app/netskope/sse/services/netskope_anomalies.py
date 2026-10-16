"""NSK-EXP-UEBA-001: a user's UEBA anomalies reduced to counts and a short, severity-ordered list.

Only scenario, sub-scenario, rule, activity, application, severity, score and time leave this module.
Addresses (source/destination IP), alert/event ids, the feature value and the free-form additional
properties of an anomaly are never kept.
"""

from collections import Counter
from datetime import datetime, timezone
from typing import Any

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "informational": 3, "unknown": 4}
RECENT_LIMIT = 10
GROUP_LIMIT = 8


def _label(value: Any, limit: int = 120) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text[:limit] if text else None


def _severity(value: Any) -> str:
    text = (_label(value) or "").lower()
    return text if text in SEVERITY_RANK else "unknown"


def _iso(millis: Any) -> str | None:
    if isinstance(millis, bool) or not isinstance(millis, (int, float)) or not 0 < millis < 253402300800000:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def summarize_anomalies(rows: list[dict[str, Any]], total: int) -> dict[str, Any]:
    clean = []
    for row in rows:
        score = row.get("score")
        clean.append({
            "severity": _severity(row.get("severity")),
            "scenario": _label(row.get("scenario")),
            "sub_scenario": _label(row.get("subScenario")),
            "rule": _label(row.get("ruleName")),
            "activity": _label(row.get("activity")),
            "app": _label(row.get("app")),
            "score": score if isinstance(score, (int, float)) and not isinstance(score, bool) else None,
            "time": _iso(row.get("time")),
        })
    severities = Counter(item["severity"] for item in clean)
    scenarios = Counter((item["scenario"], item["sub_scenario"]) for item in clean)
    rules = Counter(item["rule"] for item in clean if item["rule"])
    # Most severe first; within a severity the newest first (ISO times sort chronologically), no time last.
    newest_first = sorted(clean, key=lambda item: item["time"] or "", reverse=True)
    recent = sorted(newest_first, key=lambda item: (SEVERITY_RANK[item["severity"]], item["time"] is None))[:RECENT_LIMIT]
    return {
        "total": total, "returned": len(clean), "truncated": total > len(clean),
        "by_severity": {name: severities.get(name, 0) for name in SEVERITY_RANK},
        "by_scenario": [{"scenario": s, "sub_scenario": sub, "count": count} for (s, sub), count in scenarios.most_common(GROUP_LIMIT)],
        "top_rules": [{"rule": rule, "count": count} for rule, count in rules.most_common(5)],
        "recent": recent,
    }
