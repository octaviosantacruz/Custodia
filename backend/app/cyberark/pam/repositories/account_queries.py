from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all


def _platform_filter(platform_status: str) -> str:
    known = "coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NOT NULL"
    missing = "coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NULL"
    partial = "((nullif(trim(a.platform_id), '') IS NULL) <> (nullif(trim(a.platform_name), '') IS NULL))"
    return {"with_platform": known, "without_platform": missing, "partial_platform": partial}.get(platform_status, "")


async def get_safe_accounts(
    pool: AsyncConnectionPool, safe_number: int, q: str = "", limit: int = 200, offset: int = 0,
    lifecycle: str = "active",
):
    """Return the non-secret account inventory for one Safe.

    ``lifecycle="retired"`` lists accounts a complete sync no longer saw: CyberArk may still hold them
    during the Safe's retention. ``retired_detected_at`` is when Custodia noticed the absence (the sync
    that retired the row, ``retired_at``), not the moment the account was deleted in CyberArk.
    """
    lifecycle = "retired" if lifecycle == "retired" else "active"
    rows = await fetch_all(pool, """
        SELECT a.safe_number, s.safe_name, a.account_id, a.account_name, a.user_name, a.address,
               a.platform_id, a.platform_name, a.lifecycle_status, a.inventory_account_type,
               a.last_seen_at, a.attributes, count(*) OVER ()::int AS total_count,
               CASE WHEN a.lifecycle_status = 'retired' THEN a.retired_at END AS retired_detected_at
        FROM public.cyberark_accounts a
        JOIN public.safes s ON s.safe_number = a.safe_number
        WHERE a.safe_number = %s
          AND a.lifecycle_status = %s
          AND (%s = '' OR a.account_name ILIKE '%%' || %s || '%%'
               OR coalesce(a.user_name, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.address, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.platform_name, '') ILIKE '%%' || %s || '%%')
        ORDER BY lower(a.account_name), a.account_id
        LIMIT %s OFFSET %s
    """, (safe_number, lifecycle, q, q, q, q, q, limit, offset))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def export_accounts(pool: AsyncConnectionPool, q: str = "", platform_status: str = ""):
    platform_clause = _platform_filter(platform_status)
    platform_sql = f" AND {platform_clause}" if platform_clause else ""
    rows = await fetch_all(pool, """
        SELECT a.safe_number, s.safe_name, s.safe_url_id, a.account_id, a.account_name,
               a.user_name, a.address, a.platform_id, a.platform_name, a.lifecycle_status,
               a.last_seen_at, a.inventory_account_type
        FROM public.cyberark_accounts a
        JOIN public.safes s ON s.safe_number = a.safe_number
        WHERE a.lifecycle_status = 'active'
          AND (%s = '' OR s.safe_name ILIKE '%%' || %s || '%%'
               OR a.account_name ILIKE '%%' || %s || '%%'
               OR coalesce(a.user_name, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.address, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.platform_name, '') ILIKE '%%' || %s || '%%')
    """ + platform_sql + """
        ORDER BY lower(s.safe_name), lower(a.account_name), a.account_id
    """, (q, q, q, q, q, q))
    return rows


async def list_accounts(
    pool: AsyncConnectionPool, q: str = "", limit: int = 50, offset: int = 0, platform_status: str = ""
):
    platform_clause = _platform_filter(platform_status)
    platform_sql = f" AND {platform_clause}" if platform_clause else ""
    rows = await fetch_all(pool, """
        SELECT a.safe_number, s.safe_name, a.account_id, a.account_name,
               a.user_name, a.address, a.platform_id, a.platform_name,
               a.lifecycle_status, a.last_seen_at, a.attributes, a.inventory_account_type,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_accounts a
        JOIN public.safes s ON s.safe_number = a.safe_number
        WHERE a.lifecycle_status = 'active'
          AND (%s = '' OR s.safe_name ILIKE '%%' || %s || '%%'
               OR a.account_name ILIKE '%%' || %s || '%%'
               OR coalesce(a.user_name, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.address, '') ILIKE '%%' || %s || '%%'
               OR coalesce(a.platform_name, '') ILIKE '%%' || %s || '%%')
    """ + platform_sql + """
        ORDER BY lower(s.safe_name), lower(a.account_name), a.account_id
        LIMIT %s OFFSET %s
    """, (q, q, q, q, q, q, limit, offset))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def get_account_platform_coverage(pool: AsyncConnectionPool, include_internal: bool = True):
    internal_join = "" if include_internal else "JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number"
    safe_internal_filter = "" if include_internal else " AND coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal'"
    account_internal_filter = "" if include_internal else safe_internal_filter + " AND coalesce(a.inventory_account_type, '') <> 'internal'"
    return await fetch_all(pool, f"""
        SELECT
          count(*)::int AS accounts_active,
          count(*) FILTER (WHERE coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NOT NULL)::int AS accounts_with_platform,
          count(*) FILTER (WHERE coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')) IS NULL)::int AS accounts_without_platform,
          count(*) FILTER (WHERE (nullif(trim(a.platform_id), '') IS NULL) <> (nullif(trim(a.platform_name), '') IS NULL))::int AS accounts_with_partial_platform,
          count(DISTINCT coalesce(nullif(trim(a.platform_id), ''), nullif(trim(a.platform_name), '')))::int AS platforms_observed,
          (SELECT count(*)::int FROM public.safes s {internal_join}
             WHERE s.lifecycle_status = 'active'
               AND NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a2 WHERE a2.safe_number = s.safe_number AND a2.lifecycle_status = 'active'){safe_internal_filter}) AS safes_without_accounts
        FROM public.cyberark_accounts a
        JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
        {internal_join}
        WHERE a.lifecycle_status = 'active'{account_internal_filter}
    """)


async def get_account_management_summary(pool: AsyncConnectionPool, include_internal: bool = True):
    internal_join = "" if include_internal else "JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number"
    safe_internal_filter = "" if include_internal else " AND coalesce(m.inventory_scope, 'pending') <> 'internal' AND coalesce(m.account_type_classification, '') <> 'internal'"
    account_internal_filter = "" if include_internal else safe_internal_filter + " AND coalesce(a.inventory_account_type, '') <> 'internal'"
    return await fetch_all(pool, f"""
        WITH eligible_accounts AS (
          SELECT a.attributes
          FROM public.cyberark_accounts a
          JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
          {internal_join}
          WHERE a.lifecycle_status = 'active'{account_internal_filter}
        ), normalized AS (
          SELECT
            CASE WHEN jsonb_typeof(attributes->'automatic_management_enabled') = 'boolean'
                 THEN attributes->>'automatic_management_enabled' END AS automatic_management_enabled,
            CASE WHEN jsonb_typeof(attributes->'management_status') = 'string'
                   AND attributes->>'management_status' IN ('success', 'failure', 'in_process')
                 THEN attributes->>'management_status' END AS management_status,
            CASE WHEN jsonb_typeof(attributes->'secret_modified_at') = 'string'
                   AND pg_input_is_valid(attributes->>'secret_modified_at', 'timestamptz')
                 THEN (attributes->>'secret_modified_at')::timestamptz END AS secret_modified_at
          FROM eligible_accounts
        )
        SELECT
          count(*)::int AS accounts_active,
          count(*) FILTER (WHERE automatic_management_enabled = 'true')::int AS automatic_enabled,
          count(*) FILTER (WHERE automatic_management_enabled = 'false')::int AS automatic_disabled,
          count(*) FILTER (WHERE automatic_management_enabled IS NULL)::int AS management_unknown,
          count(*) FILTER (WHERE management_status = 'success')::int AS status_success,
          count(*) FILTER (WHERE management_status = 'failure')::int AS status_failure,
          count(*) FILTER (WHERE management_status = 'in_process')::int AS status_in_process,
          count(*) FILTER (WHERE management_status IS NULL)::int AS status_unknown,
          count(*) FILTER (WHERE secret_modified_at >= now() - interval '30 days')::int AS changed_30d,
          count(*) FILTER (WHERE secret_modified_at < now() - interval '30 days'
                             AND secret_modified_at >= now() - interval '90 days')::int AS changed_90d,
          count(*) FILTER (WHERE secret_modified_at < now() - interval '90 days'
                             AND secret_modified_at >= now() - interval '365 days')::int AS changed_365d,
          count(*) FILTER (WHERE secret_modified_at < now() - interval '365 days')::int AS changed_older,
          count(*) FILTER (WHERE secret_modified_at IS NULL)::int AS changed_unknown
        FROM normalized
    """)
