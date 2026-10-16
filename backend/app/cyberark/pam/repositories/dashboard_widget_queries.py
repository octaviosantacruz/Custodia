"""SQL de la evaluación de widgets del tablero PAM (ARCH-LAYERS-001).

El servicio ``dashboard_widgets`` decide qué medir, da forma a los buckets y
aplica la frescura; aquí vive cada consulta. Las expresiones SQL de
``CHART_DIMENSIONS`` son una allowlist de este módulo y nunca se arman con
texto del usuario.
"""

from __future__ import annotations


from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one

# The schema imports this map (through the service) to keep validation and SQL
# evaluation aligned. Values are (visible label expression, drill-down value
# expression, extra JOIN).
_NEXT_ACTION_EXPR = """CASE lower(trim(coalesce(m.next_action, '')))
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
        "CASE lower(trim(coalesce(m.account_type_classification, '')))"
        " WHEN 'nominal' THEN 'Nominal'"
        " WHEN 'no_nominal' THEN 'No nominal'"
        " WHEN 'internal' THEN 'Interno CyberArk'"
        " ELSE 'Sin clasificar' END",
        "CASE lower(trim(coalesce(m.account_type_classification, '')))"
        " WHEN 'nominal' THEN 'nominal'"
        " WHEN 'no_nominal' THEN 'no_nominal'"
        " WHEN 'internal' THEN 'internal'"
        " ELSE '__empty__' END",
        "",
    ),
}


async def latest_run_for_source(pool: AsyncConnectionPool, source_system: str, source_file: str) -> dict | None:
    return await fetch_one(pool, """
        SELECT status, started_at, completed_at
        FROM public.cyberark_ingestion_runs
        WHERE source_system = %s AND source_file = %s
        ORDER BY started_at DESC
        LIMIT 1
    """, (source_system, source_file))


async def chart_bucket_rows(
    pool: AsyncConnectionPool, dimension: str, filter_value: str, extra_join: str,
    accounts_measure: bool, where: list[str], params: list[object],
) -> list[dict]:
    if accounts_measure:
        count_expr = "count(DISTINCT a.account_row_id)::int"
        measure_join = "JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active'"
    else:
        count_expr = "count(DISTINCT s.safe_number)::int"
        measure_join = ""
    return await fetch_all(pool, f"""SELECT {dimension} AS key, {filter_value} AS filter_value, {count_expr} AS count
          FROM public.safes s
          LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
          {measure_join}
          {extra_join}
         WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}
         GROUP BY {dimension}, {filter_value}
         ORDER BY count DESC, key""", tuple(params))


async def inventory_trend_rows(pool: AsyncConnectionPool) -> list[dict]:
    # UX-AUD-012: keep the timestamp (not only the date) so the frontend
    # can label an intraday window with HH:MM instead of repeating the day.
    return await fetch_all(pool, """
        SELECT started_at AS label, received_safe_count::int AS safes
        FROM (
          SELECT started_at, received_safe_count, received_member_count
          FROM public.cyberark_ingestion_runs
          WHERE source_system = 'cyberark'
            AND source_file = 'cyberark-api'
            AND status = 'completed'
          ORDER BY started_at DESC LIMIT 12
        ) recent
        ORDER BY started_at
    """)


async def business_unit_inventory_rows(pool: AsyncConnectionPool, where_sql: str, params: list[object]) -> list[dict]:
    return await fetch_all(pool, f"""
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


async def business_unit_workflow_rows(pool: AsyncConnectionPool, where_sql: str, params: list[object]) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT COALESCE(bu.unit_name, 'Sin unidad') AS business_unit, COALESCE(m.business_unit_id::text, 'unassigned') AS business_unit_value,
               COALESCE(m.workflow_status, 'pending') AS workflow_status, count(DISTINCT s.safe_number)::int AS count
        FROM public.safes s
        LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
        WHERE s.lifecycle_status = 'active' AND {where_sql}
        GROUP BY COALESCE(bu.unit_name, 'Sin unidad'), COALESCE(m.business_unit_id::text, 'unassigned'), COALESCE(m.workflow_status, 'pending')
        ORDER BY business_unit, workflow_status
    """, tuple(params))


async def workflow_next_action_rows(pool: AsyncConnectionPool, where_sql: str, params: list[object]) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT COALESCE(m.workflow_status, 'pending') AS workflow_status, {_NEXT_ACTION_EXPR} AS next_action, count(DISTINCT s.safe_number)::int AS count
        FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        WHERE s.lifecycle_status = 'active' AND {where_sql} AND COALESCE(m.workflow_status, 'pending') IN ('pending', 'in_progress')
          AND {_NEXT_ACTION_EXPR} IN ('Migrar a SIA', 'Revisar', 'Dar de baja')
        GROUP BY COALESCE(m.workflow_status, 'pending'), {_NEXT_ACTION_EXPR}
        ORDER BY CASE {_NEXT_ACTION_EXPR} WHEN 'Migrar a SIA' THEN 1 ELSE 2 END, CASE COALESCE(m.workflow_status, 'pending') WHEN 'pending' THEN 1 ELSE 2 END
    """, tuple(params))


async def safe_accounts_members_rows(pool: AsyncConnectionPool, where_sql: str, params: list[object]) -> list[dict]:
    return await fetch_all(pool, f"""
        SELECT s.safe_name AS label,
               (SELECT count(*)::int FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active') AS accounts,
               (SELECT count(*)::int FROM public.safe_members sm WHERE sm.safe_number = s.safe_number AND sm.lifecycle_status = 'active') AS members
        FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        WHERE s.lifecycle_status = 'active' AND {where_sql}
        ORDER BY accounts DESC, members DESC, label LIMIT 100
    """, tuple(params))


async def safe_business_unit_coverage_row(pool: AsyncConnectionPool, include_internal: bool) -> dict | None:
    return await fetch_one(pool, """SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE m.business_unit_id IS NOT NULL)::int AS covered
                    FROM public.safes s
                    LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
                    WHERE s.lifecycle_status = 'active' AND (%s IS TRUE OR
                      (coalesce(m.inventory_scope, 'pending') <> 'internal'
                       AND coalesce(m.account_type_classification, '') <> 'internal'))""", (include_internal,))


async def compliance_snapshot_row(pool: AsyncConnectionPool) -> dict | None:
    return await fetch_one(pool, "SELECT total_accounts, compliant_accounts, measured_at FROM public.cyberark_compliance_snapshot WHERE singleton IS TRUE", ())


async def account_platform_coverage_rows(pool: AsyncConnectionPool, include_internal: bool) -> list[dict]:
    return await fetch_all(pool, """SELECT count(*)::int AS total, count(*) FILTER (WHERE coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NOT NULL)::int AS covered FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active' LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE a.lifecycle_status = 'active' AND (%s IS TRUE OR (coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal' AND coalesce(a.inventory_account_type, '') <> 'internal'))""", (include_internal,))


async def safe_account_coverage_rows(pool: AsyncConnectionPool, include_internal: bool) -> list[dict]:
    return await fetch_all(pool, """SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'))::int AS covered FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE s.lifecycle_status = 'active' AND (%s IS TRUE OR (coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal'))""", (include_internal,))


async def current_connection_import_row(pool: AsyncConnectionPool) -> dict | None:
    return await fetch_one(pool, """SELECT
                  (SELECT count(*)::int FROM public.connection_inventory ci
                     JOIN public.connection_inventory_imports i ON i.import_id = ci.import_id
                    WHERE i.is_current IS TRUE) AS value,
                  (SELECT created_at FROM public.connection_inventory_imports WHERE is_current IS TRUE) AS measured_at""", ())


_INVENTORY_OBJECT_COUNTS = {
    "pam_users": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'cyberark' AND object_type = 'user' AND lifecycle_status = 'active'",
    "pam_roles": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'cyberark' AND object_type = 'role' AND lifecycle_status = 'active'",
    "sia_policies": "SELECT count(*)::int AS value FROM public.cyberark_inventory_objects WHERE source_system = 'sia' AND object_type = 'access_policy' AND lifecycle_status = 'active'",
}


async def inventory_object_count_row(pool: AsyncConnectionPool, measure: str) -> dict | None:
    return await fetch_one(pool, _INVENTORY_OBJECT_COUNTS[measure], ())


async def scalar_count_row(pool: AsyncConnectionPool, accounts_measure: bool, where: list[str], params: list[object]) -> dict | None:
    if accounts_measure: query = f"""SELECT count(DISTINCT a.account_row_id)::int AS value FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active' WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}"""
    else: query = f"""SELECT count(DISTINCT s.safe_number)::int AS value FROM public.safes s LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}"""
    return await fetch_one(pool, query, tuple(params))
