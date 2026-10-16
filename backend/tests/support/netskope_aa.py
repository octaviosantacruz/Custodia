"""Explicit aggregate fixture; no real tenant IDs, filters or event data."""

import hashlib
import json

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsSettings, AnalyticsResult

CONTRACT = {"report_id": "report", "widget_id": "widget", "severity_column": "severity", "count_column": "count",
            "window_days": 30, "timezone": "UTC", "scope": "dlp", "unit": "incidents"}
CSV = AnalyticsResult("csv", [["count", "severity"], ["12", " High "], ["3", "low"]])
SETTINGS = AdvancedAnalyticsSettings("https://tenant.example", "test-token")


def approval_for(contract=CONTRACT, *, version=1, definition_sha256="a" * 64):
    # Independent serialization specified by the operational contract.
    digest = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"version": version, "contract_sha256": digest, "definition_sha256": definition_sha256}
