"""Read-only queries for the verified CyberArk PAM identity graph.

PAM roles, users and Safes are joined only inside ``source_system =
'cyberark'``. Users are persisted as ``object_type = 'user'`` while groups and
roles are persisted as ``object_type = 'role'``. SIA policy hits are returned
as explicit name references, never as normalized relationships.
"""

import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one

PAM_SOURCE_SYSTEM = "cyberark"
ROLE_IDENTITY_PATTERN = "(o.display_name ~* '@itti[.]digital$' OR o.display_name ~* '@cyberark[.]cloud([.]|$)')"
OKTA_GROUP_PATTERN = "o.display_name ~* '^sg_'"


async def list_pam_roles(pool: AsyncConnectionPool, search: str, limit: int, offset: int, kind: str = "", include_internal: bool = True):
    where = ["o.source_system = 'cyberark'", "o.lifecycle_status = 'active'"]
    params: list[object] = []
    if search:
        where.append("o.display_name ILIKE %s")
        params.append(f"%{search}%")
    if kind == "user":
        where.append("o.object_type = 'user'")
        where.append(ROLE_IDENTITY_PATTERN)
    elif kind == "okta_group":
        where.append("o.object_type = 'role'")
        where.append(OKTA_GROUP_PATTERN)
    elif kind == "cyberark_role":
        where.append("o.object_type = 'role'")
        where.append(f"NOT ({ROLE_IDENTITY_PATTERN}) AND NOT ({OKTA_GROUP_PATTERN})")
    else:
        where.append("o.object_type = 'role'")
    if not include_internal:
        where.append("""EXISTS (
            SELECT 1
              FROM public.cyberark_inventory_relationships visible_access
              JOIN public.cyberark_inventory_objects visible_safe
                ON visible_safe.object_id = visible_access.target_object_id
               AND visible_safe.source_system = 'cyberark'
               AND visible_safe.object_type = 'safe'
               AND visible_safe.lifecycle_status = 'active'
              LEFT JOIN public.cyberark_safe_metadata visible_meta
                ON visible_meta.safe_number::text = visible_safe.source_id
             WHERE visible_access.relationship_type = 'role_grants_access'
               AND visible_access.lifecycle_status = 'active'
               AND (
                   (o.object_type = 'role' AND visible_access.source_object_id = o.object_id)
                   OR (o.object_type = 'user' AND EXISTS (
                       SELECT 1
                         FROM public.cyberark_inventory_relationships visible_membership
                        WHERE visible_membership.source_object_id = o.object_id
                          AND visible_membership.target_object_id = visible_access.source_object_id
                          AND visible_membership.relationship_type = 'user_has_role'
                          AND visible_membership.lifecycle_status = 'active'
                   ))
               )
               AND coalesce(visible_meta.inventory_scope, 'pending') <> 'internal'
               AND coalesce(visible_meta.account_type_classification, '') <> 'internal'
        )""")
    visible_safe_filter = "" if include_internal else " AND coalesce(safe_meta.inventory_scope, 'pending') <> 'internal' AND coalesce(safe_meta.account_type_classification, '') <> 'internal'"
    visible_user_safe_filter = "" if include_internal else " AND coalesce(user_safe_meta.inventory_scope, 'pending') <> 'internal' AND coalesce(user_safe_meta.account_type_classification, '') <> 'internal'"
    visible_account_filter = "" if include_internal else " AND coalesce(a.inventory_account_type, '') <> 'internal'"
    visible_user_role_filter = "" if include_internal else """
                   AND EXISTS (
                       SELECT 1
                         FROM public.cyberark_inventory_relationships role_access
                         JOIN public.cyberark_inventory_objects role_safe
                           ON role_safe.object_id = role_access.target_object_id
                          AND role_safe.source_system = 'cyberark'
                          AND role_safe.object_type = 'safe'
                          AND role_safe.lifecycle_status = 'active'
                         LEFT JOIN public.cyberark_safe_metadata role_meta
                           ON role_meta.safe_number::text = role_safe.source_id
                        WHERE role_access.source_object_id = role_object.object_id
                          AND role_access.relationship_type = 'role_grants_access'
                          AND role_access.lifecycle_status = 'active'
                          AND coalesce(role_meta.inventory_scope, 'pending') <> 'internal'
                          AND coalesce(role_meta.account_type_classification, '') <> 'internal'
                   )"""
    rows = await fetch_all(pool, f"""
        WITH member_counts AS (
          SELECT r.target_object_id AS role_object_id,
                 count(DISTINCT r.source_object_id)::int AS member_count
          FROM public.cyberark_inventory_relationships r
          JOIN public.cyberark_inventory_objects u
            ON u.object_id = r.source_object_id
           AND u.source_system = 'cyberark'
           AND u.object_type = 'user'
           AND u.lifecycle_status = 'active'
          WHERE r.relationship_type = 'user_has_role'
            AND r.lifecycle_status = 'active'
          GROUP BY r.target_object_id
        ), safe_counts AS (
          SELECT r.source_object_id AS role_object_id,
                 count(DISTINCT r.target_object_id)::int AS safe_count
          FROM public.cyberark_inventory_relationships r
          JOIN public.cyberark_inventory_objects s
            ON s.object_id = r.target_object_id
           AND s.source_system = 'cyberark'
           AND s.object_type = 'safe'
           AND s.lifecycle_status = 'active'
          LEFT JOIN public.cyberark_safe_metadata safe_meta
            ON safe_meta.safe_number::text = s.source_id
          WHERE r.relationship_type = 'role_grants_access'
            AND r.lifecycle_status = 'active'
            {visible_safe_filter}
          GROUP BY r.source_object_id
        ), account_counts AS (
          SELECT r.source_object_id AS role_object_id,
                 count(DISTINCT a.account_id)::int AS account_count
          FROM public.cyberark_inventory_relationships r
          JOIN public.cyberark_inventory_objects s
            ON s.object_id = r.target_object_id
           AND s.source_system = 'cyberark'
           AND s.object_type = 'safe'
           AND s.lifecycle_status = 'active'
          JOIN public.cyberark_accounts a
            ON a.safe_number::text = s.source_id
           AND a.lifecycle_status = 'active'
          LEFT JOIN public.cyberark_safe_metadata safe_meta
            ON safe_meta.safe_number::text = s.source_id
          WHERE r.relationship_type = 'role_grants_access'
            AND r.lifecycle_status = 'active'
            {visible_safe_filter}
            {visible_account_filter}
          GROUP BY r.source_object_id
        )
        SELECT o.object_id, o.display_name, o.source_id, o.attributes,
               CASE WHEN o.object_type = 'user' THEN coalesce((
                 SELECT count(DISTINCT ur.target_object_id)
                 FROM public.cyberark_inventory_relationships ur
                 WHERE ur.source_object_id = o.object_id
                   AND ur.relationship_type = 'user_has_role'
                   AND ur.lifecycle_status = 'active'
               ), 0) ELSE coalesce(mc.member_count, 0) END::int AS member_count,
               CASE WHEN o.object_type = 'user' THEN coalesce((
                 SELECT count(DISTINCT rs.target_object_id)
                 FROM public.cyberark_inventory_relationships ur
                 JOIN public.cyberark_inventory_relationships rs
                   ON rs.source_object_id = ur.target_object_id
                  AND rs.relationship_type = 'role_grants_access'
                  AND rs.lifecycle_status = 'active'
                 JOIN public.cyberark_inventory_objects safe_object
                   ON safe_object.object_id = rs.target_object_id
                  AND safe_object.source_system = 'cyberark'
                  AND safe_object.object_type = 'safe'
                  AND safe_object.lifecycle_status = 'active'
                 LEFT JOIN public.cyberark_safe_metadata user_safe_meta
                   ON user_safe_meta.safe_number::text = safe_object.source_id
                 WHERE ur.source_object_id = o.object_id
                   AND ur.relationship_type = 'user_has_role'
                   AND ur.lifecycle_status = 'active'
                   {visible_user_safe_filter}
               ), 0) ELSE coalesce(sc.safe_count, 0) END::int AS safe_count,
               CASE WHEN o.object_type = 'user' THEN coalesce((
                 SELECT count(DISTINCT a.account_id)
                 FROM public.cyberark_inventory_relationships ur
                 JOIN public.cyberark_inventory_relationships rs
                   ON rs.source_object_id = ur.target_object_id
                  AND rs.relationship_type = 'role_grants_access'
                  AND rs.lifecycle_status = 'active'
                 JOIN public.cyberark_inventory_objects safe_object
                   ON safe_object.object_id = rs.target_object_id
                  AND safe_object.source_system = 'cyberark'
                  AND safe_object.object_type = 'safe'
                  AND safe_object.lifecycle_status = 'active'
                 LEFT JOIN public.cyberark_safe_metadata user_safe_meta
                   ON user_safe_meta.safe_number::text = safe_object.source_id
                 JOIN public.cyberark_accounts a
                   ON a.safe_number::text = safe_object.source_id
                   AND a.lifecycle_status = 'active'
                 WHERE ur.source_object_id = o.object_id
                   AND ur.relationship_type = 'user_has_role'
                   AND ur.lifecycle_status = 'active'
                   {visible_user_safe_filter}
                   {visible_account_filter}
               ), 0) ELSE coalesce(ac.account_count, 0) END::int AS account_count,
               CASE WHEN o.object_type = 'user' THEN coalesce((
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'object_id', role_object.object_id,
                     'display_name', role_object.display_name,
                     'source_id', role_object.source_id
                   ) ORDER BY lower(role_object.display_name), role_object.object_id
                 )
                 FROM public.cyberark_inventory_relationships user_role
                 JOIN public.cyberark_inventory_objects role_object
                   ON role_object.object_id = user_role.target_object_id
                  AND role_object.source_system = 'cyberark'
                  AND role_object.object_type = 'role'
                  AND role_object.lifecycle_status = 'active'
                 WHERE user_role.source_object_id = o.object_id
                   AND user_role.relationship_type = 'user_has_role'
                   AND user_role.lifecycle_status = 'active'
                   {visible_user_role_filter}
               ), '[]'::jsonb) ELSE '[]'::jsonb END AS role_examples,
               coalesce((
                 SELECT count(DISTINCT policy.object_id)
                 FROM public.cyberark_inventory_objects policy
                 WHERE policy.source_system = 'sia'
                   AND policy.object_type = 'access_policy'
                   AND policy.lifecycle_status = 'active'
                   AND (
                     (o.object_type = 'user' AND policy.attributes->'granted_users' ? o.display_name)
                     OR (o.object_type = 'role' AND policy.attributes->'granted_roles' ? o.display_name)
                     OR (o.object_type = 'role' AND policy.attributes->'granted_groups' ? o.display_name)
                   )
               ), 0)::int AS sia_reference_count,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects o
        LEFT JOIN member_counts mc ON mc.role_object_id = o.object_id
        LEFT JOIN safe_counts sc ON sc.role_object_id = o.object_id
        LEFT JOIN account_counts ac ON ac.role_object_id = o.object_id
        WHERE {' AND '.join(where)}
        ORDER BY lower(o.display_name), o.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search, "kind": kind}


async def get_pam_role_detail(pool: AsyncConnectionPool, object_id: int, include_internal: bool = True):
    visible_safe_filter = "" if include_internal else " AND coalesce(safe_meta.inventory_scope, 'pending') <> 'internal' AND coalesce(safe_meta.account_type_classification, '') <> 'internal'"
    visible_account_filter = "" if include_internal else " AND coalesce(a.inventory_account_type, '') <> 'internal'"
    role, users, safes, sia_references = await asyncio.gather(
        fetch_one(pool, """
            SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
            FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = 'cyberark'
              AND object_type = 'role' AND lifecycle_status = 'active'
        """, (object_id,)),
        fetch_all(pool, """
            SELECT u.object_id, u.display_name, u.source_id
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects u
              ON u.object_id = r.source_object_id
             AND u.source_system = 'cyberark'
             AND u.object_type = 'user'
             AND u.lifecycle_status = 'active'
            WHERE r.target_object_id = %s
              AND r.relationship_type = 'user_has_role'
              AND r.lifecycle_status = 'active'
            ORDER BY lower(u.display_name), u.object_id
        """, (object_id,)),
        fetch_all(pool, f"""
            SELECT s.object_id, s.display_name, s.source_id,
                   (SELECT count(*)::int
                    FROM public.cyberark_accounts a
                    WHERE a.safe_number::text = s.source_id
                      AND a.lifecycle_status = 'active'
                      {visible_account_filter}) AS account_count
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects s
              ON s.object_id = r.target_object_id
             AND s.source_system = 'cyberark'
             AND s.object_type = 'safe'
             AND s.lifecycle_status = 'active'
            LEFT JOIN public.cyberark_safe_metadata safe_meta
              ON safe_meta.safe_number::text = s.source_id
            WHERE r.source_object_id = %s
              AND r.relationship_type = 'role_grants_access'
              AND r.lifecycle_status = 'active'
              {visible_safe_filter}
            ORDER BY lower(s.display_name), s.object_id
        """, (object_id,)),
        fetch_all(pool, """
            SELECT object_id, display_name, source_id, attributes
            FROM public.cyberark_inventory_objects
            WHERE source_system = 'sia'
              AND object_type = 'access_policy'
              AND lifecycle_status = 'active'
              AND attributes->'granted_roles' ? (
                SELECT display_name
                FROM public.cyberark_inventory_objects
                WHERE object_id = %s AND source_system = 'cyberark' AND object_type = 'role'
              )
            ORDER BY lower(display_name), object_id
        """, (object_id,)),
    )
    if role is None:
        return None
    return {
        "role": role,
        "users": users,
        "safes": safes,
        "sia_references": sia_references,
        "sia_match_type": "display_name_reference_only",
    }
