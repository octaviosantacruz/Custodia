import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one


def _safe_filters(
    search: str,
    workflow_status: str,
    classification_status: str,
    account_type: str,
    inventory_scope: str,
    data_quality_status: str,
    scope_hint: str,
    health_filter: str = "",
    include_internal: bool = True,
    next_action: str = "",
    business_unit: str = "",
    responsible: str = "",
    include_accounts: bool = False,
) -> tuple[list[str], list[object]]:
    where = [
        "(%s = '' OR s.safe_name ILIKE '%%' || %s || '%%' OR s.safe_url_id ILIKE '%%' || %s || '%%')"
    ]
    params: list[object] = [search, search, search]
    if include_accounts and search:
        where[0] = """(%s = '' OR s.safe_name ILIKE '%%' || %s || '%%'
            OR s.safe_url_id ILIKE '%%' || %s || '%%' OR EXISTS (
                SELECT 1 FROM public.cyberark_accounts a_search
                WHERE a_search.safe_number = s.safe_number
                  AND a_search.lifecycle_status = 'active'
                  AND (a_search.account_name ILIKE '%%' || %s || '%%'
                       OR coalesce(a_search.user_name, '') ILIKE '%%' || %s || '%%'
                       OR coalesce(a_search.address, '') ILIKE '%%' || %s || '%%'
                       OR coalesce(a_search.platform_name, '') ILIKE '%%' || %s || '%%')))"""
        params.extend([search, search, search, search])
    if not include_internal:
        where.append("coalesce(m.inventory_scope, 'pending') <> 'internal'")
        where.append("coalesce(m.account_type_classification, '') <> 'internal'")
    if workflow_status:
        where.append("m.workflow_status = %s")
        params.append(workflow_status)
    if classification_status:
        where.append("coalesce(m.classification_status, 'pending') = %s")
        params.append(classification_status)
    if account_type:
        if account_type == "__empty__":
            where.append("coalesce(nullif(trim(m.account_type_classification), ''), '') = ''")
        else:
            normalized_account_type = account_type.strip().casefold().replace('_', ' ')
            manual_type = {
                "nominal": "nominal",
                "no nominal": "no_nominal",
                "interno cyberark": "internal",
                "internal": "internal",
            }.get(normalized_account_type)
            if manual_type:
                where.append("lower(trim(m.account_type_classification)) = %s")
                params.append(manual_type)
            else:
                where.append("lower(trim(m.account_type_classification)) = lower(trim(%s))")
                params.append(account_type)
    if inventory_scope:
        where.append("m.inventory_scope = %s")
        params.append(inventory_scope)
    if data_quality_status:
        where.append("m.data_quality_status = %s")
        params.append(data_quality_status)
    if scope_hint == "possible_internal_accounts_safe":
        where.append("s.safe_name ~* '_Accounts$' AND coalesce(m.inventory_account_types, '{}'::jsonb) ? 'CYBERARK MANAGED'")
    if health_filter == "missing_cpm":
        where.append("(s.managing_cpm IS NULL OR trim(s.managing_cpm) IN ('', E'\\\\'))")
    elif health_filter == "no_accounts":
        where.append("NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a_health WHERE a_health.safe_number = s.safe_number AND a_health.lifecycle_status = 'active')")
    elif health_filter == "olac_disabled":
        where.append("s.olac_enabled IS FALSE")
    elif health_filter == "retention_unconfigured":
        where.append("s.number_of_versions_retention IS NULL AND s.number_of_days_retention IS NULL AND s.auto_purge_enabled IS NOT TRUE")
    elif health_filter == "manage_safe_concentration":
        where.append("(SELECT count(DISTINCT sm_health.member_id) FROM public.safe_members sm_health WHERE sm_health.safe_number = s.safe_number AND sm_health.lifecycle_status = 'active' AND (sm_health.permissions->>'manageSafe' = 'true' OR sm_health.permissions->>'ManageSafe' = 'true')) > 1")
    if next_action:
        if next_action == "__empty__":
            where.append("coalesce(trim(m.next_action), '') = ''")
        elif next_action == "__decommission__":
            where.append("lower(trim(coalesce(m.next_action, ''))) = 'dar de baja'")
        elif next_action.strip().casefold() == "revisar":
            where.append("lower(trim(coalesce(m.next_action, ''))) IN ('revisar', 'revisar / dar de baja', 'revisar/dar de baja')")
        else:
            where.append("lower(trim(coalesce(m.next_action, ''))) = lower(trim(%s))")
            params.append(next_action)
    if business_unit:
        if business_unit == "unassigned":
            where.append("m.business_unit_id IS NULL")
        else:
            where.append("m.business_unit_id = %s")
            params.append(int(business_unit))
    if responsible:
        if responsible == "unassigned":
            where.append("m.responsible_id IS NULL")
        else:
            where.append("m.responsible_id = %s")
            params.append(int(responsible))
    return where, params


def _safe_rows_query(where: list[str]) -> str:
    return f"""
        SELECT
          s.safe_number, s.safe_name, s.safe_url_id, s.location,
          count(DISTINCT sm.id)::int AS member_count,
          count(DISTINCT a.account_id)::int AS account_count,
          CASE WHEN s.managing_cpm IS NOT NULL AND trim(s.managing_cpm) NOT IN ('', E'\\\\') THEN true ELSE false END AS cpm_configured,
          s.olac_enabled, s.number_of_days_retention, s.number_of_versions_retention,
          (s.number_of_versions_retention IS NOT NULL OR s.number_of_days_retention IS NOT NULL OR s.auto_purge_enabled IS TRUE) AS retention_configured,
          (SELECT count(*)::int FROM public.cyberark_accounts a_ret WHERE a_ret.safe_number = s.safe_number AND a_ret.lifecycle_status = 'retired') AS retired_account_count,
          (SELECT max(a_ret.retired_at) FROM public.cyberark_accounts a_ret WHERE a_ret.safe_number = s.safe_number AND a_ret.lifecycle_status = 'retired') AS last_account_retired_at,
          (SELECT count(DISTINCT sm_health.member_id)::int FROM public.safe_members sm_health WHERE sm_health.safe_number = s.safe_number AND sm_health.lifecycle_status = 'active' AND (sm_health.permissions->>'manageSafe' = 'true' OR sm_health.permissions->>'ManageSafe' = 'true')) AS manage_safe_principal_count,
          coalesce(m.inventory_account_types, '{{}}'::jsonb) AS account_type_counts,
          m.internal_name, m.business_unit_id, m.responsible_id,
          m.classification_status, m.inventory_scope, m.account_type_classification, m.data_quality_status,
          m.workflow_status, m.next_action,
          CASE WHEN s.safe_name ~* '_Accounts$' AND coalesce(m.inventory_account_types, '{{}}'::jsonb) ? 'CYBERARK MANAGED'
               THEN 'possible_internal_accounts_safe' ELSE NULL END AS scope_hint,
          bu.unit_name AS business_unit_name,
          r.display_name AS responsible_name
        FROM public.safes s
        LEFT JOIN public.safe_members sm ON sm.safe_number = s.safe_number AND sm.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_accounts a ON a.safe_number = s.safe_number AND a.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
        LEFT JOIN public.cyberark_responsibles r ON r.responsible_id = m.responsible_id
        WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}
        GROUP BY s.safe_number, m.safe_number, m.business_unit_id, m.responsible_id, bu.business_unit_id, r.responsible_id
    """


async def _classification_counts(
    pool: AsyncConnectionPool, search: str, workflow_status: str, account_type: str,
    inventory_scope: str, data_quality_status: str, scope_hint: str, health_filter: str,
    include_internal: bool, next_action: str, business_unit: str, responsible: str, include_accounts: bool,
) -> dict[str, int]:
    where, params = _safe_filters(
        search, workflow_status, "", account_type, inventory_scope, data_quality_status, scope_hint,
        health_filter, include_internal=include_internal, next_action=next_action,
        business_unit=business_unit, responsible=responsible, include_accounts=include_accounts,
    )
    rows = await fetch_all(pool, f"""
        WITH safe_rows AS (
            {_safe_rows_query(where)}
        )
        SELECT coalesce(classification_status, 'pending') AS status, count(*)::int AS n
        FROM safe_rows GROUP BY 1
    """, tuple(params))
    counts = {"assigned": 0, "review": 0, "pending": 0}
    for row in rows:
        counts[row["status"] if row["status"] in counts else "pending"] += row["n"]
    return counts


async def list_safes(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    workflow_status: str,
    classification_status: str,
    account_type: str,
    inventory_scope: str,
    data_quality_status: str,
    scope_hint: str,
    health_filter: str = "",
    include_internal: bool = True,
    next_action: str = "",
    business_unit: str = "",
    responsible: str = "",
    include_accounts: bool = False,
):
    where, params = _safe_filters(
        search, workflow_status, classification_status, account_type,
        inventory_scope, data_quality_status, scope_hint, health_filter, include_internal=include_internal,
        next_action=next_action, business_unit=business_unit, responsible=responsible,
        include_accounts=include_accounts,
    )
    rows = await fetch_all(pool, f"""
        WITH safe_rows AS (
            {_safe_rows_query(where)}
        )
        SELECT safe_rows.*, count(*) OVER ()::int AS total_count,
               (count(*) FILTER (WHERE coalesce(classification_status, 'pending') = 'assigned') OVER ())::int AS assigned_count,
               (count(*) FILTER (WHERE coalesce(classification_status, 'pending') = 'review') OVER ())::int AS review_count,
               (count(*) FILTER (WHERE coalesce(classification_status, 'pending') NOT IN ('assigned', 'review')) OVER ())::int AS pending_count
        FROM safe_rows
        ORDER BY lower(safe_name), safe_number
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    # Classification counts cover the whole filtered result, not just this
    # page, so the progress indicator does not depend on how many rows the
    # operator has loaded.
    classification_counts = {
        "assigned": rows[0]["assigned_count"] if rows else 0,
        "review": rows[0]["review_count"] if rows else 0,
        "pending": rows[0]["pending_count"] if rows else 0,
    }
    if classification_status:
        # The breakdown must ignore the classification filter itself, otherwise
        # filtering by one state would zero out the others.
        classification_counts = await _classification_counts(
            pool, search, workflow_status, account_type, inventory_scope, data_quality_status,
            scope_hint, health_filter, include_internal, next_action, business_unit, responsible, include_accounts,
        )
    for row in rows:
        for key in ("total_count", "assigned_count", "review_count", "pending_count"):
            row.pop(key, None)
    return {
        "rows": rows,
        "total": total,
        "classification_counts": classification_counts,
        "limit": limit,
        "offset": offset,
        "search": search,
        "workflow_status": workflow_status,
        "classification_status": classification_status,
        "account_type": account_type,
        "inventory_scope": inventory_scope,
        "data_quality_status": data_quality_status,
        "scope_hint": scope_hint,
        "health_filter": health_filter,
        "next_action": next_action,
        "business_unit": business_unit,
        "responsible": responsible,
        "include_accounts": include_accounts,
    }


async def export_safes(
    pool: AsyncConnectionPool,
    search: str,
    workflow_status: str,
    classification_status: str,
    account_type: str,
    inventory_scope: str,
    data_quality_status: str,
    scope_hint: str,
    health_filter: str = "",
    next_action: str = "",
    business_unit: str = "",
    responsible: str = "",
    include_accounts: bool = False,
):
    where, params = _safe_filters(
        search, workflow_status, classification_status, account_type,
        inventory_scope, data_quality_status, scope_hint, health_filter,
        next_action=next_action, business_unit=business_unit, responsible=responsible,
        include_accounts=include_accounts,
    )
    return await fetch_all(pool, f"""
        WITH safe_rows AS (
            {_safe_rows_query(where)}
        )
        SELECT * FROM safe_rows
        ORDER BY lower(safe_name), safe_number
    """, tuple(params))


async def get_safe_detail(pool: AsyncConnectionPool, safe_number: int):
    safe, members = await asyncio.gather(
        fetch_one(pool, """
            SELECT s.*, m.internal_name, m.business_unit_id, m.responsible_id,
                   m.classification_status, m.inventory_scope, m.account_type_classification, m.data_quality_status,
                   m.workflow_status, m.next_action,
                   m.notes, m.assigned_at, m.assigned_by,
                   (SELECT count(*) FROM public.cyberark_accounts a
                     WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active')::int AS account_count,
                   coalesce(m.inventory_account_types, '{}'::jsonb) AS account_type_counts,
                   bu.unit_name AS business_unit_name, r.display_name AS responsible_name
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
            LEFT JOIN public.cyberark_responsibles r ON r.responsible_id = m.responsible_id
            WHERE s.safe_number = %s
        """, (safe_number,)),
        fetch_all(pool, """
            SELECT member_id, member_name, member_type, membership_expiration_date, lifecycle_status,
                   is_predefined_user, is_read_only, permissions
            FROM public.safe_members
            WHERE safe_number = %s AND lifecycle_status = 'active'
            ORDER BY lower(member_name), member_id
        """, (safe_number,)),
    )
    return safe, members
