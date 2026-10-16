"""Metadata indexes for AA discovery; candidate labels never approve metrics."""

from datetime import datetime, timezone
import re

from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsError


PATTERNS = {
    "severity": r"severity",
    "policies": r"polic",
    "applications": r"application|\bapps?\b|shadow it|\bccl\b|\bcci\b",
    "traffic": r"traffic|bandwidth|bytes|sites|categor",
    "dlp": r"\bdlp\b|data loss",
    "trend": r"trend|over time",
    "identity": r"\busers?\b|email|employee|organization unit",
}


def _rows(payload, kind):
    data = payload.get("data")
    if kind == "widgets" and isinstance(data, dict):
        data = data.get("widgets")
    if not isinstance(data, list) or len(data) > 1000 or any(not isinstance(row, dict) for row in data):
        raise AdvancedAnalyticsError("AA: forma de catálogo no verificada")
    return data


def _project(row, kind):
    value = row.get(f"{kind}_id")
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", str(value)):
        raise AdvancedAnalyticsError("AA: ID de catálogo inválido")
    name = row.get(f"{kind}_name", "")
    if not isinstance(name, str):
        raise AdvancedAnalyticsError("AA: nombre de catálogo inválido")
    return str(value), [key for key, pattern in PATTERNS.items() if re.search(pattern, name, re.I)]


async def discover_catalog(client, *, progress=None):
    """Collect every returned report, global widget and report-widget relation.

    Only IDs, fixed categories and discovery status leave this function. Titles,
    owner/user fields and arbitrary metadata are deliberately not retained.
    """
    report_rows = _rows(await client.list_catalog("reports"), "reports")
    if len(report_rows) > 100:
        raise AdvancedAnalyticsError("AA: catálogo excede el límite de reportes")
    reports = {}
    widgets = {}
    metric_candidates = {key: [] for key in ("severity", "policies", "applications", "traffic")}
    for row in report_rows:
        report_id, labels = _project(row, "report")
        if report_id in reports:
            raise AdvancedAnalyticsError("AA: reporte duplicado en catálogo")
        reports[report_id] = {"categories": labels, "widget_ids": [], "status": "pending"}
    for row in _rows(await client.list_catalog("widgets"), "widgets"):
        widget_id, labels = _project(row, "widget")
        if widget_id in widgets:
            raise AdvancedAnalyticsError("AA: widget duplicado en catálogo")
        widgets[widget_id] = {"categories": labels, "in_global_catalog": True, "report_ids": []}
    errors = 0
    for position, (report_id, report) in enumerate(reports.items(), 1):
        try:
            entries = _rows(await client.list_catalog("widgets", report_id=report_id), "widgets")
            projected = [_project(row, "widget") for row in entries]
            if len({widget_id for widget_id, _ in projected}) != len(projected):
                raise AdvancedAnalyticsError("AA: widget duplicado en reporte")
        except AdvancedAnalyticsError:
            report["status"] = "unavailable"
            errors += 1
        else:
            report["status"] = "discovered"
            for widget_id, labels in projected:
                widget = widgets.setdefault(widget_id, {"categories": [], "in_global_catalog": False, "report_ids": []})
                widget["categories"] = sorted(set(widget["categories"]) | set(labels))
                widget["report_ids"].append(report_id)
                report["widget_ids"].append(widget_id)
                for metric in metric_candidates:
                    if metric in labels:
                        metric_candidates[metric].append({"report_id": report_id, "widget_id": widget_id,
                                                          "status": "unverified", "categories": labels})
        if progress is not None:
            progress(position, len(reports), errors)
    return {"version": 1, "fetched_at": datetime.now(timezone.utc).isoformat(),
            "complete_for_returned_reports": errors == 0, "unavailable_reports": errors,
            "scope": "accessible_to_service_credential", "reports": reports, "widgets": widgets,
            "metric_candidates": metric_candidates, "metric_bindings": {},
            "filters_verified": False, "result_queries_executed": 0}
