import json
import logging
from datetime import datetime, timedelta, timezone

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.connection_inventory import get_connection_coverage
from app.cyberark.pam.repositories import dashboard_widget_queries as queries
from app.cyberark.pam.repositories.dashboard_widget_queries import CHART_DIMENSIONS
from app.cyberark.pam.repositories.safe_queries import _safe_filters

LOGGER = logging.getLogger(__name__)


CHART_DIMENSION_NAMES = tuple((*CHART_DIMENSIONS, "inventory_trend", "business_unit_workflow", "workflow_next_action", "safe_accounts_members", "business_unit_inventory"))
CHART_BUCKET_LIMIT = 12
# Freshness windows approved for the widget states (VIEW-004): the manual
# compliance script and the CSV connection import tolerate 30 days; the
# synchronized inventories tolerate 24 hours since the last complete run.
COMPLIANCE_FRESHNESS = timedelta(days=30)
CONNECTIONS_FRESHNESS = timedelta(days=30)
INVENTORY_RUN_FRESHNESS = timedelta(hours=24)
# Full-run identity per synchronized inventory measure: the PSM-only refresh
# (`cyberark-psm-api`) does not confirm safes, accounts, users or roles.
INVENTORY_RUN_SOURCES: dict[str, tuple[str, str]] = {
    "safes": ("cyberark", "cyberark-api"),
    "accounts": ("cyberark", "cyberark-api"),
    "pam_users": ("cyberark", "cyberark-api"),
    "pam_roles": ("cyberark", "cyberark-api"),
    "sia_policies": ("sia", "sia-api"),
}
SCALAR_ONLY_MEASURES = {
    "connections", "pam_users", "pam_roles", "sia_policies",
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage", "cyberark_compliance", "kr1_safe_bu_coverage", "kr2_connection_coverage",
}
PERCENTAGE_MEASURES = {
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage", "cyberark_compliance", "kr1_safe_bu_coverage", "kr2_connection_coverage",
}


def _freshness_status(measured_at: datetime | None, window: timedelta) -> str:
    """State of a measurement: `available` (confirmado) while it is inside
    the freshness window, `pending` once it is older, and `unavailable` when
    there is no measurement at all."""
    if measured_at is None:
        return "unavailable"
    return "available" if datetime.now(timezone.utc) - measured_at <= window else "pending"


async def _inventory_freshness(pool: AsyncConnectionPool, measure: str) -> tuple[str, str | None]:
    """Freshness of a synchronized inventory measure. `available` only when
    the latest run of its source completed inside the 24h window; `pending`
    when that run is older or the latest one did not complete (partial,
    failed or running -- the same rule that governs retirement
    reconciliation); `unavailable` when the source has no runs at all."""
    source = INVENTORY_RUN_SOURCES.get(measure)
    if source is None:
        return "unavailable", None
    source_system, source_file = source
    row = await queries.latest_run_for_source(pool, source_system, source_file)
    if not row:
        return "unavailable", None
    if row["status"] != "completed":
        measured = row["completed_at"] or row["started_at"]
        return "pending", measured.isoformat() if measured else None
    if row["completed_at"] is None:
        return "pending", row["started_at"].isoformat() if row["started_at"] else None
    return _freshness_status(row["completed_at"], INVENTORY_RUN_FRESHNESS), row["completed_at"].isoformat()


def _widget_where(widget: dict, include_internal: bool = True) -> tuple[list[str], list[object]]:
    filters = widget.get("filters") or {}
    return _safe_filters(
        "", filters.get("workflow_status", ""), filters.get("classification_status", ""), "",
        filters.get("inventory_scope", ""), filters.get("data_quality_status", ""), "",
        filters.get("health_filter", ""), include_internal=include_internal,
    )


async def _evaluate_chart(pool: AsyncConnectionPool, widget: dict, include_internal: bool = True) -> dict:
    chart = widget.get("chart") or {}
    advanced = await _evaluate_advanced_chart(pool, widget, include_internal)
    if advanced is not None:
        status, measured_at = await _inventory_freshness(pool, widget.get("measure", "safes"))
        result = {**advanced, "data_status": status}
        if measured_at:
            result["measured_at"] = measured_at
        return result
    dimension, filter_value, extra_join = CHART_DIMENSIONS.get(chart.get("group_by", ""), ("", "", ""))
    if not dimension:
        return {**widget, "buckets": [], "value": 0}
    where, params = _widget_where(widget, include_internal)
    rows = await queries.chart_bucket_rows(pool, dimension, filter_value, extra_join, widget.get("measure") == "accounts", where, params)
    raw_buckets = [{"key": row["key"], "filter_value": row.get("filter_value", row["key"]), "count": row["count"]} for row in rows]
    buckets = raw_buckets[:CHART_BUCKET_LIMIT]
    if len(raw_buckets) > CHART_BUCKET_LIMIT:
        other_count = sum(bucket["count"] for bucket in raw_buckets[CHART_BUCKET_LIMIT:])
        buckets[-1] = {"key": "Otros", "count": buckets[-1]["count"] + other_count}
    status, measured_at = await _inventory_freshness(pool, widget.get("measure", "safes"))
    result = {**widget, "buckets": buckets, "value": sum(bucket["count"] for bucket in buckets), "data_status": status}
    if measured_at:
        result["measured_at"] = measured_at
    return result


async def _evaluate_advanced_chart(pool: AsyncConnectionPool, widget: dict, include_internal: bool) -> dict | None:
    group_by = (widget.get("chart") or {}).get("group_by")
    if group_by == "inventory_trend":
        rows = await queries.inventory_trend_rows(pool)
        labels = [str(row["label"]) for row in rows]
        return {**widget, "buckets": [], "value": int(rows[-1]["safes"]) if rows else 0, "chart_data": {"labels": labels, "series": [{"key": "safes", "label": "Safes", "values": [int(row["safes"]) for row in rows]}]}}

    if group_by not in {"business_unit_workflow", "workflow_next_action", "safe_accounts_members", "business_unit_inventory"}:
        return None
    where, params = _widget_where(widget, include_internal)
    where_sql = " AND ".join(where)
    if group_by == "business_unit_inventory":
        rows = await queries.business_unit_inventory_rows(pool, where_sql, params)
        return {**widget, "buckets": [], "value": sum(int(row["safes"]) for row in rows), "chart_data": {"labels": [row["label"] for row in rows], "filter_values": [row["filter_value"] for row in rows], "series": [{"key": "safes", "label": "Safes", "values": [int(row["safes"]) for row in rows]}, {"key": "accounts", "label": "Cuentas", "values": [int(row["accounts"]) for row in rows]}]}}

    if group_by == "business_unit_workflow":
        rows = await queries.business_unit_workflow_rows(pool, where_sql, params)
        x_labels = list(dict.fromkeys(row["business_unit"] for row in rows)); y_labels = list(dict.fromkeys(row["workflow_status"] for row in rows))
        cells = [{"x": x_labels.index(row["business_unit"]), "y": y_labels.index(row["workflow_status"]), "value": int(row["count"]), "filter_value": json.dumps({"business_unit": row["business_unit_value"], "workflow_status": row["workflow_status"]})} for row in rows]
        return {**widget, "buckets": [], "value": sum(cell["value"] for cell in cells), "chart_data": {"x_labels": x_labels, "y_labels": y_labels, "cells": cells}}

    if group_by == "workflow_next_action":
        rows = await queries.workflow_next_action_rows(pool, where_sql, params)
        x_labels = list(dict.fromkeys(row["next_action"] for row in rows)); y_labels = list(dict.fromkeys(row["workflow_status"] for row in rows))
        cells = [{"x": x_labels.index(row["next_action"]), "y": y_labels.index(row["workflow_status"]), "value": int(row["count"]), "filter_value": json.dumps({"workflow_status": row["workflow_status"], "next_action": row["next_action"]})} for row in rows]
        return {**widget, "buckets": [], "value": sum(cell["value"] for cell in cells), "chart_data": {"x_labels": x_labels, "y_labels": y_labels, "cells": cells}}

    rows = await queries.safe_accounts_members_rows(pool, where_sql, params)
    points = [{"key": str(index), "label": row["label"], "x": int(row["accounts"]), "y": int(row["members"]), "filter_value": row["label"]} for index, row in enumerate(rows)]
    return {**widget, "buckets": [], "value": len(points), "chart_data": {"points": points}}


async def _evaluate_scalar(pool: AsyncConnectionPool, widget: dict, include_internal: bool = True) -> dict:
    measure = widget.get("measure", "safes")
    if measure in SCALAR_ONLY_MEASURES:
        if measure in PERCENTAGE_MEASURES:
            if measure == "kr1_safe_bu_coverage":
                row = await queries.safe_business_unit_coverage_row(pool, include_internal)
                total, covered = int(row["total"] or 0), int(row["covered"] or 0)
                return {**widget, "value": round(100 * covered / total, 2) if total else 0,
                        "value_format": "percentage", "data_status": "available" if total else "unavailable",
                        "covered_count": covered, "total_count": total}
            if measure == "kr2_connection_coverage":
                coverage = await get_connection_coverage(pool, include_internal)
                totals = coverage["totals"]
                total = int(totals["total"] or 0)
                covered = sum(int(totals[key] or 0) for key in ("both", "pam_only", "sia_only"))
                return {**widget, "value": round(100 * covered / total, 2) if total else 0,
                        "value_format": "percentage", "data_status": "available" if total else "unavailable",
                        "covered_count": covered, "total_count": total}
            if measure == "cyberark_compliance":
                row = await queries.compliance_snapshot_row(pool)
                if not row:
                    return {**widget, "value": 0, "value_format": "percentage", "data_status": "unavailable"}
                total, compliant = int(row["total_accounts"]), int(row["compliant_accounts"])
                return {**widget, "value": round(100 * compliant / total, 2), "value_format": "percentage",
                        "data_status": _freshness_status(row["measured_at"], COMPLIANCE_FRESHNESS),
                        "total_accounts": total, "compliant_accounts": compliant, "measured_at": row["measured_at"].isoformat()}
            if measure in {"pam_sia_coverage", "zsp_coverage"}:
                coverage = await get_connection_coverage(pool, include_internal); totals = coverage["totals"]; denominator = int(totals["total"] or 0); numerator = int(totals["both"] if measure == "pam_sia_coverage" else totals["zsp_implemented"] or 0)
            elif measure == "account_platform_coverage":
                rows = await queries.account_platform_coverage_rows(pool, include_internal); row = rows[0] if rows else {}; denominator, numerator = int(row.get("total") or 0), int(row.get("covered") or 0)
            else:
                rows = await queries.safe_account_coverage_rows(pool, include_internal); row = rows[0] if rows else {}; denominator, numerator = int(row.get("total") or 0), int(row.get("covered") or 0)
            if measure == "safe_account_coverage":
                return {**widget, "value": round((numerator / denominator) * 100, 2) if denominator else 0,
                        "value_format": "percentage", "data_status": "available" if denominator else "unavailable",
                        "covered_count": numerator, "total_count": denominator}
            return {**widget, "value": round((numerator / denominator) * 100) if denominator else 0,
                    "value_format": "percentage", "data_status": "available" if denominator else "unavailable",
                    "covered_count": numerator, "total_count": denominator}
        if measure == "connections":
            row = await queries.current_connection_import_row(pool)
            if not row or row["measured_at"] is None:
                return {**widget, "value": int(row["value"]) if row else 0, "value_format": "count", "data_status": "unavailable"}
            return {**widget, "value": int(row["value"]), "value_format": "count",
                    "data_status": _freshness_status(row["measured_at"], CONNECTIONS_FRESHNESS),
                    "measured_at": row["measured_at"].isoformat()}
        row = await queries.inventory_object_count_row(pool, measure)
        status, measured_at = await _inventory_freshness(pool, measure)
        result = {**widget, "value": row["value"] if row else 0, "value_format": "count", "data_status": status}
        if measured_at:
            result["measured_at"] = measured_at
        return result
    where, params = _widget_where(widget, include_internal)
    row = await queries.scalar_count_row(pool, widget.get("measure") == "accounts", where, params)
    status, measured_at = await _inventory_freshness(pool, widget.get("measure", "safes"))
    result = {**widget, "value": row["value"] if row else 0, "value_format": "count", "data_status": status}
    if measured_at:
        result["measured_at"] = measured_at
    return result


async def evaluate_dashboard_widgets(pool: AsyncConnectionPool, widgets: list[dict], include_internal: bool = True) -> list[dict]:
    evaluated: list[dict] = []
    for widget in widgets:
        try:
            evaluated.append(await (_evaluate_chart if widget.get("kind") == "chart" else _evaluate_scalar)(pool, widget, include_internal))
        except Exception:
            # One widget's query failing (a malformed dimension expression, a
            # transient DB error) must not blank out every other widget in
            # the same batch -- the personal dashboard, and the picker's
            # batched preview, evaluate several widgets in one call. Degrade
            # just this one to "no data" and keep going.
            LOGGER.exception(
                "No se pudo evaluar el widget del dashboard: widget_id=%s kind=%s measure=%s chart=%s",
                widget.get("widget_id"), widget.get("kind"), widget.get("measure"), widget.get("chart"),
            )
            evaluated.append({**widget, "value": 0, "buckets": [], "chart_data": None, "data_status": "unavailable"})
    return evaluated
