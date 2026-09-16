from datetime import datetime
from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one


FINDING_RULES: tuple[dict[str, str], ...] = (
    {
        "rule_id": "SAFE_NO_ACTIVE_ACCOUNTS",
        "version": "1",
        "title": "Safe sin cuentas activas",
        "severity": "medium",
        "category": "review",
    },
    {
        "rule_id": "ACCOUNT_PLATFORM_MISSING",
        "version": "1",
        "title": "Cuenta sin plataforma informada",
        "severity": "medium",
        "category": "data_quality",
    },
    {
        "rule_id": "ACCOUNT_PLATFORM_PARTIAL",
        "version": "1",
        "title": "Relación cuenta-plataforma parcial",
        "severity": "low",
        "category": "data_quality",
    },
)


_CURRENT_FINDINGS_QUERY = """
    SELECT 'SAFE_NO_ACTIVE_ACCOUNTS' AS rule_id, '1' AS rule_version,
           'cyberark' AS source_system, 'safe' AS subject_type,
           s.safe_number::text AS subject_id, 'Safe sin cuentas activas' AS title,
           'medium' AS severity, 'review' AS category,
           jsonb_build_object('safe_number', s.safe_number, 'safe_name', s.safe_name,
                              'account_count', 0, 'condition', 'no_active_accounts') AS evidence
    FROM public.safes s
    WHERE s.lifecycle_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.cyberark_accounts a
        WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'
      )
    UNION ALL
    SELECT 'ACCOUNT_PLATFORM_MISSING', '1', 'cyberark', 'account', a.account_id::text,
           'Cuenta sin plataforma informada', 'medium', 'data_quality',
           jsonb_build_object('account_id', a.account_id, 'account_name', a.account_name,
                              'safe_number', a.safe_number, 'safe_name', s.safe_name,
                              'condition', 'platform_not_informed')
    FROM public.cyberark_accounts a
    JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
    WHERE a.lifecycle_status = 'active'
      AND coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NULL
    UNION ALL
    SELECT 'ACCOUNT_PLATFORM_PARTIAL', '1', 'cyberark', 'account', a.account_id::text,
           'Relación cuenta-plataforma parcial', 'low', 'data_quality',
           jsonb_build_object('account_id', a.account_id, 'account_name', a.account_name,
                              'safe_number', a.safe_number, 'safe_name', s.safe_name,
                              'platform_id', a.platform_id, 'platform_name', a.platform_name,
                              'condition', 'platform_identity_partial')
    FROM public.cyberark_accounts a
    JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
    WHERE a.lifecycle_status = 'active'
      AND ((nullif(trim(a.platform_id), '') IS NULL) <> (nullif(trim(a.platform_name), '') IS NULL))
"""


async def collect_current_findings(pool: AsyncConnectionPool) -> list[dict[str, Any]]:
    return await fetch_all(pool, _CURRENT_FINDINGS_QUERY)


async def refresh_findings(pool: AsyncConnectionPool, source_run_id=None) -> int:
    current = await collect_current_findings(pool)
    async with pool.connection() as conn:
        async with conn.transaction():
            for finding in current:
                await conn.execute(
                    """INSERT INTO public.cyberark_findings
                         (rule_id, rule_version, source_system, subject_type, subject_id,
                          title, severity, category, evidence, source_run_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (rule_id, rule_version, source_system, subject_type, subject_id)
                       DO UPDATE SET title = EXCLUDED.title, severity = EXCLUDED.severity,
                           category = EXCLUDED.category, evidence = EXCLUDED.evidence,
                           source_run_id = COALESCE(EXCLUDED.source_run_id, cyberark_findings.source_run_id),
                           last_detected_at = now(), resolved_at = NULL,
                           status = CASE WHEN cyberark_findings.status = 'resolved' THEN 'open' ELSE cyberark_findings.status END,
                           updated_at = now()""",
                    (finding["rule_id"], finding["rule_version"], finding["source_system"], finding["subject_type"], finding["subject_id"], finding["title"], finding["severity"], finding["category"], Jsonb(finding["evidence"]), source_run_id),
                )

            resolution_queries = (
                ("SAFE_NO_ACTIVE_ACCOUNTS", "NOT EXISTS (SELECT 1 FROM public.safes s WHERE s.lifecycle_status = 'active' AND s.safe_number::text = f.subject_id AND NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'))"),
                # OLAC remains available as technical Safe metadata, but it is
                # not an actionable finding until a tenant policy requires it.
                ("SAFE_OLAC_DISABLED", "TRUE"),
                ("ACCOUNT_PLATFORM_MISSING", "NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.lifecycle_status = 'active' AND a.account_id::text = f.subject_id AND coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NULL)"),
                ("ACCOUNT_PLATFORM_PARTIAL", "NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.lifecycle_status = 'active' AND a.account_id::text = f.subject_id AND ((nullif(trim(a.platform_id), '') IS NULL) <> (nullif(trim(a.platform_name), '') IS NULL)) )"),
            )
            for rule_id, still_current in resolution_queries:
                await conn.execute(
                    f"""UPDATE public.cyberark_findings f
                           SET status = 'resolved', resolved_at = now(), updated_at = now()
                         WHERE f.rule_id = %s AND f.source_system = 'cyberark'
                           AND f.status IN ('open', 'acknowledged')
                           AND {still_current}""",
                    (rule_id,),
                )
    return len(current)


async def list_findings(
    pool: AsyncConnectionPool, status: str = "", rule_id: str = "", severity: str = "",
    limit: int = 50, offset: int = 0, include_internal: bool = True,
):
    # Keep withdrawn rules in the audit table while removing them from active
    # posture responses, including legacy rows created by earlier versions.
    filters = ["f.rule_id <> %s"]
    params: list[object] = ["SAFE_OLAC_DISABLED"]
    if status:
        filters.append("f.status = %s")
        params.append(status)
    if rule_id:
        filters.append("f.rule_id = %s")
        params.append(rule_id)
    if severity:
        filters.append("f.severity = %s")
        params.append(severity)
    if not include_internal:
        filters.append("""NOT (
            (f.subject_type = 'safe' AND EXISTS (
                SELECT 1
                  FROM public.cyberark_safe_metadata m
                 WHERE m.safe_number::text = f.subject_id
                   AND (coalesce(m.inventory_scope, 'pending') = 'internal'
                        OR coalesce(m.account_type_classification, '') = 'internal')
            ))
            OR (f.subject_type = 'account' AND (
                EXISTS (
                    SELECT 1
                      FROM public.cyberark_accounts a
                     WHERE a.account_id::text = f.subject_id
                       AND coalesce(a.inventory_account_type, '') = 'internal'
                )
                OR EXISTS (
                    SELECT 1
                      FROM public.cyberark_safe_metadata m
                     WHERE m.safe_number::text = f.evidence->>'safe_number'
                       AND (coalesce(m.inventory_scope, 'pending') = 'internal'
                            OR coalesce(m.account_type_classification, '') = 'internal')
                )
            ))
        )""")
    rows = await fetch_all(pool, f"""
        SELECT f.finding_id, f.rule_id, f.rule_version, f.source_system,
               f.subject_type, f.subject_id, f.title, f.severity, f.category,
               f.status, f.evidence, f.source_run_id, f.first_detected_at,
               f.last_detected_at, f.resolved_at, f.exception_reason,
               f.exception_until, f.updated_at, count(*) OVER ()::int AS total_count
          FROM public.cyberark_findings f
         WHERE {' AND '.join(filters)}
         ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'excepted' THEN 2 ELSE 3 END,
                  CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  f.last_detected_at DESC, f.finding_id DESC
         LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def get_finding(pool: AsyncConnectionPool, finding_id: int):
    return await fetch_one(pool, "SELECT * FROM public.cyberark_findings WHERE finding_id = %s", (finding_id,))


async def update_finding(
    pool: AsyncConnectionPool, finding_id: int, status: str,
    exception_reason: str | None, exception_until: datetime | None,
):
    return await fetch_one(pool, """
        UPDATE public.cyberark_findings
           SET status = %s,
               exception_reason = %s,
               exception_until = %s,
               resolved_at = CASE WHEN %s = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
               updated_at = now()
         WHERE finding_id = %s
        RETURNING *
    """, (status, exception_reason, exception_until, status, finding_id))
