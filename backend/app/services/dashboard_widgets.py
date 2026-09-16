import json

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one
from ..repositories.connection_inventory import get_connection_coverage
from ..repositories.safe_queries import _safe_filters


# The schema imports this map to keep validation and SQL evaluation aligned.
# Values are (visible label expression, drill-down value expression, extra JOIN).
_NEXT_ACTION_EXPR = """CASE lower(trim(coalesce(m.next_action, ''))
    WHEN '' THEN 'Sin definir'
    WHEN 'migrar a sia' THEN 'Migrar a SIA'
    WHEN 'migrar sia' THEN 'Migrar a SIA'
    WHEN 'consultar' THEN 'Consultar'
    WHEN 'revisar' THEN 'Revisar'
    WHEN 'dar de baja' THEN 'Dar de baja'
    WHEN 'revisar / dar de baja' THEN 'Revisar'
    WHEN 'revisar/dar de baja' THEN 'Revisar'
    WHEN 'rotar credencial' THEN 'Rotar credencial'
    ELSE trim(m.next_action)
END"""

CHART_DIMENSIONS: dict[str, tuple[str, str, str]] = {
    "workflow_status": ("COALESCE(m.workflow_status, 'pending')", "COALESCE(m.workflow_status, 'pending')", ""),
    "classification_status": ("COALESCE(m.classification_status, 'pending')", "COALESCE(m.classification_status, 'pending')", ""),
    "inventory_scope": ("COALESCE(m.inventory_scope, 'pending')", "COALESCE(m.inventory_scope, 'pending')", ""),
    "data_quality_status": ("COALESCE(m.data_quality_status, 'pending')", "COALESCE(m.data_quality_status, 'pending')", ""),
    "business_unit": (
        "COALESCE(bu.unit_name, 'Sin unidad')",
        "COALESCE(m.business_unit_id::text, 'unassigned')",
        "LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id",
    ),
    "responsible": (
        "COALESCE(r.display_name, 'Sin responsable')",
        "COALESCE(m.responsible_id::text, 'unassigned')",
        "LEFT JOIN public.cyberark_responsibles r ON r.responsible_id = m.responsible_id",
    ),
    "next_action": (_NEXT_ACTION_EXPR, _NEXT_ACTION_EXPR, ""),
    "account_type": (
        "COALESCE(account_type.key, 'Sin clasificar')",
        "COALESCE(account_type.key, '__empty__')",
        "LEFT JOIN LATERAL jsonb_each_text(COALESCE(m.inventory_account_types, '{}'::jsonb)) AS account_type(key, value) ON true",
    ),
}

CHART_DIMENSION_NAMES = tuple((*CHART_DIMENSIONS, "inventory_trend", "business_unit_workflow", "workflow_next_action", "safe_accounts_members", "business_unit_inventory"))
CHART_BUCKET_LIMIT = 12
SCALAR_ONLY_MEASURES = {
    "connections", "pam_users", "pam_roles", "sia_policies",
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage",
}
PERCENTAGE_MEASURES = {
    "pam_sia_coverage", "zsp_coverage", "account_platform_coverage", "safe_account_coverage",
}


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
        return advanced
    dimension, filter_value, extra_join = CHART_DIMENSIONS.get(chart.get("group_by", ""), ("", "", ""))
    if not dimension:
        return {**widget, "buckets": [], "value": 0}
    where, params = _widget_where(widget, include_internal)
    if widget.get("measure") == "accounts":
        count_expr = "count(DISTINCT a.account_row_id)::int"
        measure_join = "JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active'"
    else:
        count_expr = "count(DISTINCT s.safe_number)::int"
        measure_join = ""
    rows = await fetch_all(pool, f"""SELECT {dimension} AS key, {filter_value} AS filter_value, {count_expr} AS count
          FROM public.safes s
          LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
          {measure_join}
          {extra_join}
         WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}
         GROUP BY {dimension}, {filter_value}
         ORDER BY count DESC, key""", tuple(params))
    raw_buckets = [{"key": row["key"], "filter_value": row.get("filter_value", row["key"]), "count": row["count"]} for row in rows]
    buckets = raw_buckets[:CHART_BUCKET_LIMIT]
    if len(raw_buckets) > CHART_BUCKET_LIMIT:
        other_count = sum(bucket["count"] for bucket in raw_buckets[CHART_BUCKET_LIMIT:])
        buckets[-1] = {"key": "Otros", "count": buckets[-1]["count"] + other_count}
    return {**widget, "buckets": buckets, "value": sum(bucket["count"] for bucket in buckets)}


async def _evaluate_advanced_chart(pool: AsyncConnectionPool, widget: dict, include_internal: bool) -> dict | None:
    group_by = (widget.get("chart") or {}).get("group_by")
    if group_by == "inventory_trend":
        rows = await fetch_all(pool, """
            SELECT started_at::date AS label, received_safe_count::int AS safes
            FROM (
              SELECT started_at, received_safe_count, received_member_count
              FROM public.cyberark_ingestion_runs
              WHERE source_system = 'cyberark' AND status = 'completed'
              ORDER BY started_at DESC LIMIT 12
            ) recent
            ORDER BY started_at
        """)
        labels = [str(row["label"]) for row in rows]
        return {**widget, "buckets": [], "value": int(rows[-1]["safes"]) if rows else 0, "chart_data": {"labels": labels, "series": [{"key": "safes", "label": "Safes", "values": [int(row["safes"]) for row in rows]}]}}

    if group_by not in {"business_unit_workflow", "workflow_next_action", "safe_accounts_members", "business_unit_inventory"}:
        return None
    where, params = _widget_where(widget, include_internal)
    where_sql = " AND ".join(where)
    if group_by == "business_unit_inventory":
        rows = await fetch_all(pool, f"""
            SELECT COALESCE(bu.unit_name, 'Sin unidad') AS label, COALESCE(m.business_unit_id::text, 'unassigned') AS filter_value,
                   count(DISTINCT s.safe_number)::int AS safes, count(DISTINCT a.account_row_id)::int AS accounts
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
            LEFT JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active'
            WHERE s.lifecycle_status = 'active' AND {where_sql}
            GROUP BY COALESCE(bu.unit_name, 'Sin unidad'), COALESCE(m.business_unit_id::text, 'unassigned')
            ORDER BY safes DESC, label LIMIT 12
        """, tuple(params))
        return {**widget, "buckets": [], "value": sum(int(row["safes"]) for row in rows), "chart_data": {"labels": [row["label"] for row in rows], "filter_values": [row["filter_value"] for row in rows], "series": [{"key": "safes", "label": "Safes", "values": [int(row["safes"]) for row in rows]}, {"key": "accounts", "label": "Cuentas", "values": [int(row["accounts"]) for row in rows]}]}}

    if group_by == "business_unit_workflow":
        rows = await fetch_all(pool, f"""
            SELECT COALESCE(bu.unit_name, 'Sin unidad') AS business_unit, COALESCE(m.business_unit_id::text, 'unassigned') AS business_unit_value,
                   COALESCE(m.workflow_status, 'pending') AS workflow_status, count(DISTINCT s.safe_number)::int AS count
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
            WHERE s.lifecycle_status = 'active' AND {where_sql}
            GROUP BY COALESCE(bu.unit_name, 'Sin unidad'), COALESCE(m.business_unit_id::text, 'unassigned'), COALESCE(m.workflow_status, 'pending')
            ORDER BY business_unit, workflow_status
        """, tuple(params))
        x_labels = list(dict.fromkeys(row["business_unit"] for row in rows)); y_labels = list(dict.fromkeys(row["workflow_status"] for row in rows))
        cells = [{"x": x_labels.index(row["business_unit"]), "y": y_labels.index(row["workflow_status"]), "value": int(row["count"]), "filter_value": json.dumps({"business_unit": row["business_unit_value"], "workflow_status": row["workflow_status"]})} for row in rows]
        return {**widget, "buckets": [], "value": sum(cell["value"] for cell in cells), "chart_data": {"x_labels": x_labels, "y_labels": y_labels, "cells": cells}}

    if group_by == "workflow_next_action":
        rows = await fetch_all(pool, f"""
            SELECT COALESCE(m.workflow_status, 'pending') AS workflow_status, {_NEXT_ACTION_EXPR} AS next_action, count(DISTINCT s.safe_number)::int AS count
            FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            WHERE s.lifecycle_status = 'active' AND {where_sql} AND COALESCE(m.workflow_status, 'pending') IN ('pending', 'in_progress')
              AND {_NEXT_ACTION_EXPR} IN ('Migrar a SIA', 'Revisar', 'Dar de baja')
            GROUP BY COALESCE(m.workflow_status, 'pending'), {_NEXT_ACTION_EXPR}
            ORDER BY CASE {_NEXT_ACTION_EXPR} WHEN 'Migrar a SIA' THEN 1 ELSE 2 END, CASE COALESCE(m.workflow_status, 'pending') WHEN 'pending' THEN 1 ELSE 2 END
        """, tuple(params))
        x_labels = list(dict.fromkeys(row["next_action"] for row in rows)); y_labels = list(dict.fromkeys(row["workflow_status"] for row in rows))
        cells = [{"x": x_labels.index(row["next_action"]), "y": y_labels.index(row["workflow_status"]), "value": int(row["count"]), "filter_value": json.dumps({"workflow_status": row["workflow_status"], "next_action": row["next_action"]})} for row in rows]
        return {**widget, "buckets": [], "value": sum(cell["value"] for cell in cells), "chart_data": {"x_labels": x_labels, "y_labels": y_labels, "cells": cells}}

    rows = await fetch_all(pool, f"""
        SELECT s.safe_name AS label,
               (SELECT count(*)::int FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active') AS accounts,
               (SELECT count(*)::int FROM public.safe_members sm WHERE sm.safe_number = s.safe_number AND sm.lifecycle_status = 'active') AS members
        FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        WHERE s.lifecycle_status = 'active' AND {where_sql}
        ORDER BY accounts DESC, members DESC, label LIMIT 100
    """, tuple(params))
    points = [{"key": str(index), "label": row["label"], "x": int(row["accounts"]), "y": int(row["members"]), "filter_value": row["label"]} for index, row in enumerate(rows)]
    return {**widget, "buckets": [], "value": len(points), "chart_data": {"points": points}}


async def _evaluate_scalar(pool: AsyncConnectionPool, widget: dict, include_internal: bool = True) -> dict:
    measure = widget.get("measure", "safes")
    if measure in SCALAR_ONLY_MEASURES:
        if measure in PERCENTAGE_MEASURES:
            if measure in {"pam_sia_coverage", "zsp_coverage"}:
                coverage = await get_connection_coverage(pool, include_internal); totals = coverage["totals"]; denominator = int(totals["total"] or 0); numerator = int(totals["both"] if measure == "pam_sia_coverage" else totals["zsp_implemented"] or 0)
            elif measure == "account_platform_coverage":
                rows = await fetch_all(pool, """SELECT count(*)::int AS total, count(*) FILTER (WHERE coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NOT NULL)::int AS covered FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active' LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE a.lifecycle_status = 'active' AND (%s IS TRUE OR (coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal' AND coalesce(a.inventory_account_type, '') <> 'internal'))""", (include_internal,)); row = rows[0] if rows else {}; denominator, numerator = int(row.get("total") or 0), int(row.get("covered") or 0)
            else:
                rows = await fetch_all(pool, """SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'))::int AS covered FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE s.lifecycle_status = 'active' AND (%s IS TRUE OR (coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal'))""", (include_internal,)); row = rows[0] if rows else {}; denominator, numerator = int(row.get("total") or 0), int(row.get("covered") or 0)
            return {**widget, "value": round((numerator / denominator) * 100) if denominator else 0, "value_format": "percentage"}
        query_map = {"connections": "SELECT count(*)::int AS value FROM public.connection_inventory ci JOIN public.connection_inventory_imports i ON i.import_id = ci.import_id WHERE i.is_current IS TRUE", "pam_users": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'cyberark' AND object_type = 'user' AND lifecycle_status = 'active'", "pam_roles": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'cyberark' AND object_type = 'role' AND lifecycle_status = 'active'", "sia_policies": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'sia' AND object_type = 'access_policy' AND lifecycle_status = 'active'"}
        row = await fetch_one(pool, query_map[measure], ())
        return {**widget, "value": row["value"] if row else 0, "value_format": "count"}
    where, params = _widget_where(widget, include_internal)
    if widget.get("measure") == "accounts": query = f"""SELECT count(DISTINCT a.account_row_id)::int AS value FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active' WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}"""
    else: query = f"""SELECT count(DISTINCT s.safe_number)::int AS value FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}"""
    row = await fetch_one(pool, query, tuple(params))
    return {**widget, "value": row["value"] if row else 0, "value_format": "count"}


async def evaluate_dashboard_widgets(pool: AsyncConnectionPool, widgets: list[dict], include_internal: bool = True) -> list[dict]:
    evaluated: list[dict] = []
    for widget in widgets:
        evaluated.append(await (_evaluate_chart if widget.get("kind") == "chart" else _evaluate_scalar)(pool, widget, include_internal))
    return evaluated
