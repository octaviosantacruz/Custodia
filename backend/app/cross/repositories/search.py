"""Bounded, non-secret global inventory search."""

import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all

ROWS_PER_GROUP = 20


def _like(query: str) -> str:
    return f"%{query}%"


async def search_inventory(
    pool: AsyncConnectionPool,
    query: str,
    *,
    include_internal: bool = True,
) -> dict:
    """Search active, navigable inventory records using only non-secret fields."""
    like = _like(query)
    safe_visibility = "" if include_internal else """
      AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
      AND coalesce(meta.account_type_classification, '') <> 'internal'
    """
    account_visibility = "" if include_internal else """
      AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
      AND coalesce(meta.account_type_classification, '') <> 'internal'
      AND coalesce(a.inventory_account_type, '') <> 'internal'
    """
    pam_visibility = "" if include_internal else """
      AND EXISTS (
        SELECT 1
        FROM public.cyberark_inventory_relationships access
        JOIN public.cyberark_inventory_objects safe_object
          ON safe_object.object_id = access.target_object_id
         AND safe_object.source_system = 'cyberark'
         AND safe_object.object_type = 'safe'
         AND safe_object.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_safe_metadata meta
          ON meta.safe_number::text = safe_object.source_id
        WHERE access.source_object_id = o.object_id
          AND access.relationship_type = 'role_grants_access'
          AND access.lifecycle_status = 'active'
          AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(meta.account_type_classification, '') <> 'internal'
      )
    """
    pam_user_visibility = "" if include_internal else """
      AND EXISTS (
        SELECT 1
        FROM public.cyberark_inventory_relationships membership
        JOIN public.cyberark_inventory_relationships access
          ON access.source_object_id = membership.target_object_id
         AND access.relationship_type = 'role_grants_access'
         AND access.lifecycle_status = 'active'
        JOIN public.cyberark_inventory_objects safe_object
          ON safe_object.object_id = access.target_object_id
         AND safe_object.source_system = 'cyberark'
         AND safe_object.object_type = 'safe'
         AND safe_object.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_safe_metadata meta
          ON meta.safe_number::text = safe_object.source_id
        WHERE membership.source_object_id = o.object_id
          AND membership.relationship_type = 'user_has_role'
          AND membership.lifecycle_status = 'active'
          AND coalesce(meta.inventory_scope, 'pending') <> 'internal'
          AND coalesce(meta.account_type_classification, '') <> 'internal'
      )
    """
    rows = await asyncio.gather(
        fetch_all(pool, f"""
            SELECT s.safe_number AS target, s.safe_name AS label,
                   coalesce(nullif(s.location, ''), s.safe_url_id) AS detail
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata meta ON meta.safe_number = s.safe_number
            WHERE s.lifecycle_status = 'active'
              AND (s.safe_name ILIKE %s OR s.safe_url_id ILIKE %s OR s.location ILIKE %s)
              {safe_visibility}
            ORDER BY lower(s.safe_name), s.safe_number
            LIMIT %s
        """, (like, like, like, ROWS_PER_GROUP)),
        fetch_all(pool, f"""
            SELECT a.safe_number AS target, a.account_name AS label,
                   concat('Safe: ', s.safe_name) AS detail
            FROM public.cyberark_accounts a
            JOIN public.safes s ON s.safe_number = a.safe_number AND s.lifecycle_status = 'active'
            LEFT JOIN public.cyberark_safe_metadata meta ON meta.safe_number = s.safe_number
            WHERE a.lifecycle_status = 'active'
              AND (a.account_name ILIKE %s OR a.user_name ILIKE %s
                   OR a.address ILIKE %s OR a.platform_id ILIKE %s
                   OR a.platform_name ILIKE %s OR s.safe_name ILIKE %s)
              {account_visibility}
            ORDER BY lower(a.account_name), a.account_id
            LIMIT %s
        """, (like, like, like, like, like, like, ROWS_PER_GROUP)),
        fetch_all(pool, f"""
            SELECT o.object_id AS target, o.display_name AS label,
                   'PAM user' AS detail
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'cyberark' AND o.object_type = 'user'
              AND o.lifecycle_status = 'active' AND o.display_name ILIKE %s
              {pam_user_visibility}
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (like, ROWS_PER_GROUP)),
        fetch_all(pool, f"""
            SELECT o.object_id AS target, o.display_name AS label,
                   'PAM role' AS detail
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'cyberark' AND o.object_type = 'role'
              AND o.lifecycle_status = 'active' AND o.display_name ILIKE %s
              {pam_visibility}
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (like, ROWS_PER_GROUP)),
        fetch_all(pool, """
            SELECT o.object_id AS target, o.display_name AS label,
                   coalesce(nullif(o.attributes->>'status', ''), 'SIA policy') AS detail
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'sia' AND o.object_type = 'access_policy'
              AND o.lifecycle_status = 'active'
              AND (o.display_name ILIKE %s OR o.attributes->>'description' ILIKE %s)
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (like, like, ROWS_PER_GROUP)),
        fetch_all(pool, """
            SELECT o.object_id AS target, o.display_name AS label,
                   coalesce(nullif(o.attributes->>'email', ''), o.attributes->>'user_name', 'Identity Administration user') AS detail
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'identity_administration' AND o.object_type = 'user'
              AND o.lifecycle_status = 'active'
              AND (o.display_name ILIKE %s OR o.attributes->>'email' ILIKE %s
                   OR o.attributes->>'user_name' ILIKE %s)
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (like, like, like, ROWS_PER_GROUP)),
        fetch_all(pool, """
            SELECT o.object_id AS target, o.display_name AS label,
                   'Identity Administration role' AS detail
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = 'identity_administration' AND o.object_type = 'role'
              AND o.lifecycle_status = 'active' AND o.display_name ILIKE %s
            ORDER BY lower(o.display_name), o.object_id
            LIMIT %s
        """, (like, ROWS_PER_GROUP)),
        fetch_all(pool, """
            SELECT ci.inventory_id AS target, ci.instance_name AS label,
                   concat(ci.private_ip, CASE WHEN ci.environment <> '' THEN ' · ' || ci.environment ELSE '' END) AS detail
            FROM public.connection_inventory ci
            JOIN public.connection_inventory_imports import_run
              ON import_run.import_id = ci.import_id AND import_run.is_current IS TRUE
            WHERE ci.lifecycle_status = 'active' AND (ci.private_ip ILIKE %s OR ci.instance_name ILIKE %s)
            ORDER BY lower(ci.instance_name), ci.inventory_id
            LIMIT %s
        """, (like, like, ROWS_PER_GROUP)),
    )
    group_definitions = (
        ("safes", "safe", "safes"),
        ("accounts", "account", "safes"),
        ("pam_users", "pam_user", "pam_users"),
        ("pam_roles", "pam_role", "pam_roles"),
        ("sia_policies", "sia_policy", "sia_policies"),
        ("identity_users", "identity_user", "identity_users"),
        ("identity_roles", "identity_role", "identity_roles"),
        ("connections", "connection", "connections"),
    )
    groups = {
        name: [
            {"type": result_type, "label": row["label"], "detail": row["detail"],
             "workspace": workspace, "target": row["target"], "query": query}
            for row in group_rows
        ]
        for (name, result_type, workspace), group_rows in zip(group_definitions, rows, strict=True)
    }
    return {"query": query, "groups": groups}
