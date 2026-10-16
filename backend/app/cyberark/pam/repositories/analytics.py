import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cyberark.pam.repositories.safes import _safe_filters


async def get_summary(pool: AsyncConnectionPool, include_internal: bool = True):
    metric_safe_join = "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number" if not include_internal else ""
    metric_internal_filter = " AND coalesce(m_scope.inventory_scope, 'pending') <> 'internal' AND coalesce(m_scope.account_type_classification, '') <> 'internal'" if not include_internal else ""
    account_internal_filter = " AND coalesce(a.inventory_account_type, '') <> 'internal'" if not include_internal else ""
    return await fetch_one(pool, f"""
        SELECT
          (SELECT count(*)::int FROM public.safes s {metric_safe_join} WHERE s.lifecycle_status = 'active'{metric_internal_filter}) AS safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.inventory_scope = 'business') AS business_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.inventory_scope = 'internal') AS internal_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.inventory_scope = 'pending') AS scope_pending_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' AND s.safe_name ~* '_Accounts$' AND coalesce(m.inventory_account_types, '{{}}'::jsonb) ? 'CYBERARK MANAGED' {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS scope_candidate_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.inventory_scope = 'business' AND m.data_quality_status = 'clean') AS clean_business_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.data_quality_status = 'obsolete' {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS obsolete_safes,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.data_quality_status = 'duplicate' {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS duplicate_safes,
          (SELECT count(*)::int FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active' {'' if include_internal else "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number"} WHERE a.lifecycle_status = 'active' {'' if include_internal else "AND coalesce(m_scope.inventory_scope, 'pending') <> 'internal' AND coalesce(m_scope.account_type_classification, '') <> 'internal'"}{account_internal_filter}) AS accounts,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.classification_status = 'pending' {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS pending_classification,
          (SELECT count(*)::int
             FROM public.cyberark_safe_metadata m
             JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active'
             JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
             JOIN public.cyberark_responsibles r ON r.responsible_id = m.responsible_id
            WHERE m.business_unit_id IS NOT NULL AND m.responsible_id IS NOT NULL {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS assigned,
          (SELECT count(*)::int FROM public.cyberark_safe_metadata m JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active' WHERE m.classification_status = 'review' {'' if include_internal else "AND coalesce(m.inventory_scope, 'pending') <> 'internal'"}) AS review,
          (SELECT json_build_object(
             'denominator', count(*)::int,
             'missing_cpm', count(*) FILTER (WHERE s.managing_cpm IS NULL OR trim(s.managing_cpm) IN ('', E'\\\\'))::int,
             'no_accounts', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.cyberark_accounts a WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'))::int,
             'olac_disabled', count(*) FILTER (WHERE s.olac_enabled IS FALSE)::int,
             'retention_unconfigured', count(*) FILTER (WHERE s.number_of_versions_retention IS NULL AND s.number_of_days_retention IS NULL AND s.auto_purge_enabled IS NOT TRUE)::int,
             'manage_safe_concentration', count(*) FILTER (WHERE (SELECT count(DISTINCT sm.member_id) FROM public.safe_members sm WHERE sm.safe_number = s.safe_number AND sm.lifecycle_status = 'active' AND (sm.permissions->>'manageSafe' = 'true' OR sm.permissions->>'ManageSafe' = 'true')) > 1)::int
           ) FROM public.safes s {metric_safe_join} WHERE s.lifecycle_status = 'active'{metric_internal_filter}) AS safe_health,
          (SELECT row_to_json(r) FROM (
            SELECT run_id, source_system, source_file, status, started_at, completed_at, expected_safe_count,
                   received_safe_count, received_member_count, error_count
            FROM public.cyberark_ingestion_runs
            WHERE source_system = 'cyberark'
            ORDER BY started_at DESC LIMIT 1
          ) r) AS latest_run
    """)


async def get_analytics(
    pool: AsyncConnectionPool,
    search: str = '',
    workflow_status: str = '',
    classification_status: str = '',
    account_type: str = '',
    inventory_scope: str = '',
    data_quality_status: str = '',
    scope_hint: str = '',
    health_filter: str = '',
    include_internal: bool = True,
    next_action: str = '',
    business_unit: str = '',
    responsible: str = '',
    include_accounts: bool = False,
):
    where, filter_params = _safe_filters(
        search, workflow_status, classification_status, account_type,
        inventory_scope, data_quality_status, scope_hint, health_filter, include_internal=include_internal,
        next_action=next_action, business_unit=business_unit, responsible=responsible,
        include_accounts=include_accounts,
    )
    safe_scope = f"""
        SELECT s.safe_number
        FROM public.safes s
        LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
        WHERE s.lifecycle_status = 'active' AND {' AND '.join(where)}
    """
    workflow_status, next_actions, account_types, business_units, responsibles = await asyncio.gather(
        fetch_all(pool, """
            SELECT COALESCE(m.workflow_status, 'pending') AS key, count(*)::int AS count
            FROM public.cyberark_safe_metadata m
            JOIN ({safe_scope}) filtered ON filtered.safe_number = m.safe_number
            GROUP BY m.workflow_status
            ORDER BY count DESC, m.workflow_status
        """.format(safe_scope=safe_scope), tuple(filter_params)),
        fetch_all(pool, """
            SELECT CASE lower(trim(coalesce(m.next_action, '')))
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
                   END AS key,
                   count(*)::int AS count
             FROM public.cyberark_safe_metadata m
            JOIN ({safe_scope}) filtered ON filtered.safe_number = m.safe_number
            GROUP BY CASE lower(trim(coalesce(m.next_action, '')))
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
                     END
            ORDER BY count DESC, key
        """.format(safe_scope=safe_scope), tuple(filter_params)),
        fetch_all(pool, """
            SELECT CASE lower(trim(coalesce(m.account_type_classification, '')))
                       WHEN 'nominal' THEN 'Nominal'
                       WHEN 'no_nominal' THEN 'No nominal'
                       WHEN 'internal' THEN 'Interno CyberArk'
                       ELSE 'Sin clasificar'
                   END AS key,
                   count(DISTINCT filtered.safe_number)::int AS count
            FROM ({safe_scope}) filtered
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = filtered.safe_number
            GROUP BY 1
            ORDER BY count DESC, key
        """.format(safe_scope=safe_scope), tuple(filter_params)),
        fetch_all(pool, """
            SELECT coalesce(m.business_unit_id::text, 'unassigned') AS key,
                   coalesce(bu.unit_name, 'Sin unidad') AS label,
                   count(*)::int AS count
              FROM ({safe_scope}) filtered
              LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = filtered.safe_number
              LEFT JOIN public.cyberark_business_units bu ON bu.business_unit_id = m.business_unit_id
             GROUP BY m.business_unit_id, bu.unit_name
             ORDER BY count DESC, label
        """.format(safe_scope=safe_scope), tuple(filter_params)),
        fetch_all(pool, """
            SELECT coalesce(m.responsible_id::text, 'unassigned') AS key,
                   coalesce(r.display_name, 'Sin responsable') AS label,
                   count(*)::int AS count
              FROM ({safe_scope}) filtered
              LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = filtered.safe_number
              LEFT JOIN public.cyberark_responsibles r ON r.responsible_id = m.responsible_id
             GROUP BY m.responsible_id, r.display_name
             ORDER BY count DESC, label
        """.format(safe_scope=safe_scope), tuple(filter_params)),
    )
    return {
        "workflow_status": workflow_status,
        "next_actions": next_actions,
        "account_types": account_types,
        "business_units": business_units,
        "responsibles": responsibles,
    }


async def get_access_concentration(pool: AsyncConnectionPool, limit: int = 10, include_internal: bool = True):
    """Who holds the most keys: PAM users and roles ranked by the number of
    distinct Safes they can reach through the verified
    user -> role -> safe chain. Read-only over the cyberark graph; not a KPI
    feed. Identity Administration and SIA are excluded by source_system."""
    internal_clause = "" if include_internal else "AND NOT EXISTS (SELECT 1 FROM public.cyberark_inventory_objects target_obj LEFT JOIN public.safes target_safe ON target_safe.safe_number::text = target_obj.source_id OR target_safe.safe_name = target_obj.display_name LEFT JOIN public.cyberark_safe_metadata target_meta ON target_meta.safe_number = target_safe.safe_number WHERE target_obj.object_id = rs.target_object_id AND coalesce(target_meta.inventory_scope, 'pending') = 'internal')"
    users, roles, totals = await asyncio.gather(
        fetch_all(pool, """
            SELECT u.display_name AS name,
                   count(DISTINCT rs.target_object_id)::int AS safe_count
            FROM public.cyberark_inventory_objects u
            JOIN public.cyberark_inventory_relationships ur
              ON ur.source_object_id = u.object_id
             AND ur.relationship_type = 'user_has_role' AND ur.lifecycle_status = 'active'
            JOIN public.cyberark_inventory_relationships rs
              ON rs.source_object_id = ur.target_object_id
             AND rs.relationship_type = 'role_grants_access' AND rs.lifecycle_status = 'active'
            WHERE u.source_system = 'cyberark' AND u.object_type = 'user'
              AND u.lifecycle_status = 'active'
              {internal_clause}
            GROUP BY u.object_id, u.display_name
            HAVING count(DISTINCT rs.target_object_id) > 0
            ORDER BY safe_count DESC, lower(u.display_name)
            LIMIT %s
        """.format(internal_clause=internal_clause), (limit,)),
        fetch_all(pool, """
            SELECT r.display_name AS name,
                   count(DISTINCT rs.target_object_id)::int AS safe_count
            FROM public.cyberark_inventory_objects r
            JOIN public.cyberark_inventory_relationships rs
              ON rs.source_object_id = r.object_id
             AND rs.relationship_type = 'role_grants_access' AND rs.lifecycle_status = 'active'
            WHERE r.source_system = 'cyberark' AND r.object_type = 'role'
              AND r.lifecycle_status = 'active'
              {internal_clause}
            GROUP BY r.object_id, r.display_name
            HAVING count(DISTINCT rs.target_object_id) > 0
            ORDER BY safe_count DESC, lower(r.display_name)
            LIMIT %s
        """.format(internal_clause=internal_clause), (limit,)),
        fetch_one(pool, """
            SELECT
              (SELECT count(*)::int FROM public.cyberark_inventory_objects
                WHERE source_system = 'cyberark' AND object_type = 'user' AND lifecycle_status = 'active') AS users,
              (SELECT count(*)::int FROM public.cyberark_inventory_objects
                WHERE source_system = 'cyberark' AND object_type = 'role' AND lifecycle_status = 'active') AS roles,
              (SELECT count(*)::int FROM public.cyberark_inventory_objects target_obj
                LEFT JOIN public.safes target_safe ON target_safe.safe_number::text = target_obj.source_id OR target_safe.safe_name = target_obj.display_name
                LEFT JOIN public.cyberark_safe_metadata target_meta ON target_meta.safe_number = target_safe.safe_number
                WHERE target_obj.source_system = 'cyberark' AND target_obj.object_type = 'safe' AND target_obj.lifecycle_status = 'active'
                  {internal_total_clause}) AS safes
        """.format(internal_total_clause='' if include_internal else "AND coalesce(target_meta.inventory_scope, 'pending') <> 'internal'")),
    )
    return {"users": users, "roles": roles, "totals": totals or {"users": 0, "roles": 0, "safes": 0}}


async def get_inventory_freshness(pool: AsyncConnectionPool, include_internal: bool = True):
    """Freshness signals from the persisted Safe/account inventory."""
    safe_join = "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number" if not include_internal else ""
    internal_filter = " AND coalesce(m_scope.inventory_scope, 'pending') <> 'internal'" if not include_internal else ""
    account_internal_filter = " AND coalesce(a.inventory_account_type, '') <> 'internal'" if not include_internal else ""
    return await fetch_one(pool, f"""
        SELECT
          (SELECT count(*)::int FROM public.safes s {safe_join} WHERE s.lifecycle_status = 'active'{internal_filter}) AS safes,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active' AND s.last_modification_time IS NULL{internal_filter}) AS last_mod_unknown,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active' AND s.last_modification_time >= now() - interval '30 days'{internal_filter}) AS last_mod_30d,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active'
              AND s.last_modification_time >= now() - interval '90 days'
              AND s.last_modification_time < now() - interval '30 days'{internal_filter}) AS last_mod_90d,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active'
              AND s.last_modification_time >= now() - interval '365 days'
              AND s.last_modification_time < now() - interval '90 days'{internal_filter}) AS last_mod_365d,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active'
              AND s.last_modification_time < now() - interval '365 days'{internal_filter}) AS last_mod_over_year,
          (SELECT count(*)::int FROM public.safes s {safe_join}
            WHERE s.lifecycle_status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM public.cyberark_accounts a
                WHERE a.safe_number = s.safe_number AND a.lifecycle_status = 'active'){internal_filter}) AS safes_without_accounts,
          (SELECT count(*)::int FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number {'' if include_internal else "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number"} WHERE a.lifecycle_status = 'active' AND s.lifecycle_status = 'active'{internal_filter}{account_internal_filter}) AS accounts_active,
          (SELECT count(*)::int FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number {'' if include_internal else "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number"} WHERE a.lifecycle_status = 'retired' AND s.lifecycle_status = 'active'{internal_filter}{account_internal_filter}) AS accounts_retired,
          (SELECT count(*)::int FROM public.cyberark_accounts a JOIN public.safes s ON s.safe_number = a.safe_number {'' if include_internal else "JOIN public.cyberark_safe_metadata m_scope ON m_scope.safe_number = s.safe_number"}
            WHERE a.lifecycle_status = 'active' AND s.lifecycle_status = 'active' AND a.last_seen_at < now() - interval '30 days'{internal_filter}{account_internal_filter}) AS accounts_not_seen_30d
    """)
