"""Read-only Netskope administrator and role inventory (NSK-RBAC-001).

Administrators, roles and API groups are stored as distinct inventory types of the Netskope source; an administrator
reaches its role through an active ``has_role`` edge by exact ``roleId``. Nothing here reads or returns who created or
edited a role, nor any credential (see ``netskope_rbac_mapping``).
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one

ADMIN_SCOPE = "a.source_system = 'netskope' AND a.object_type = 'netskope_admin' AND a.lifecycle_status = 'active'"
ROLE_SCOPE = "r.source_system = 'netskope' AND r.object_type = 'netskope_role' AND r.lifecycle_status = 'active'"

# `LEFT JOIN` so an administrator whose role is missing or unresolved still lists, with a null role.
_ADMIN_ROLE_JOIN = """
    FROM public.cyberark_inventory_objects a
    LEFT JOIN public.cyberark_inventory_relationships e
           ON e.source_object_id = a.object_id AND e.relationship_type = 'has_role'
    LEFT JOIN public.cyberark_inventory_objects r
           ON r.object_id = e.target_object_id AND r.object_type = 'netskope_role' AND r.lifecycle_status = 'active'
"""

_PERMISSION_RANK = {"rwa": 0, "rw": 1, "r": 2}


async def list_netskope_admins(
    pool: AsyncConnectionPool, search: str, record_type: str, state: str, role: str, limit: int, offset: int,
) -> dict[str, Any]:
    """Administrators with their role. ``role`` is a roleId, ``none`` (no resolved role) or empty for all."""
    like = f"%{search.lower()}%"
    where = f"""
        WHERE {ADMIN_SCOPE}
          AND (%s = '' OR lower(a.display_name) LIKE %s)
          AND (%s = '' OR a.attributes->>'record_type' = %s)
          AND (%s = '' OR (%s = 'active') = coalesce((a.attributes->>'active')::boolean, false))
          AND (%s = '' OR (%s = 'none' AND r.object_id IS NULL) OR r.source_id = %s)
    """
    params = (search, like, record_type, record_type, state, state, role, role, role)
    summary = await fetch_one(pool, f"""
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE coalesce((a.attributes->>'active')::boolean, false))::int AS active,
               count(*) FILTER (WHERE r.object_id IS NULL AND coalesce((a.attributes->>'active')::boolean, false))::int
                   AS active_without_role,
               count(*) FILTER (WHERE a.attributes->>'record_type' = 'SERVICE_ACCOUNT')::int AS service_accounts,
               count(*) FILTER (WHERE a.attributes->>'record_type' = 'USER'
                                  AND coalesce((a.attributes->>'active')::boolean, false)
                                  AND NOT coalesce((a.attributes->>'mfa_enabled')::boolean, false))::int
                   AS active_people_without_mfa,
               max(a.last_seen_at) AS last_observed_at
        {_ADMIN_ROLE_JOIN} WHERE {ADMIN_SCOPE}
    """)
    filtered = await fetch_one(pool, f"SELECT count(*)::int AS total {_ADMIN_ROLE_JOIN} {where}", params)
    rows = await fetch_all(pool, f"""
        SELECT a.source_id AS id, a.display_name AS name,
               (a.attributes->>'active')::boolean AS active,
               (a.attributes->>'is_locked')::boolean AS is_locked,
               a.attributes->>'record_type' AS record_type,
               a.attributes->>'last_login' AS last_login,
               (a.attributes->>'mfa_enabled')::boolean AS mfa_enabled,
               r.source_id AS role_id, r.display_name AS role_name
        {_ADMIN_ROLE_JOIN} {where}
        ORDER BY lower(a.display_name), a.source_id LIMIT %s OFFSET %s
    """, (*params, limit, offset))
    return {**summary, "filtered_total": filtered["total"], "rows": rows}


async def list_netskope_admin_roles(pool: AsyncConnectionPool) -> dict[str, Any]:
    """Roles with the administrators observed in each and how many API groups they open at each level."""
    rows = await fetch_all(pool, f"""
        SELECT r.source_id AS id, r.display_name AS name,
               (r.attributes->>'user_count')::int AS reported_user_count,
               r.attributes->>'last_edited' AS last_edited,
               (r.attributes->>'api_groups_total')::int AS api_groups_total,
               (SELECT count(*)::int FROM public.cyberark_inventory_relationships e
                  JOIN public.cyberark_inventory_objects a ON a.object_id = e.source_object_id
                 WHERE e.target_object_id = r.object_id AND e.relationship_type = 'has_role'
                   AND a.object_type = 'netskope_admin' AND a.lifecycle_status = 'active') AS admins,
               (SELECT count(*)::int FROM jsonb_array_elements(r.attributes->'permissions') p
                 WHERE p->>'permission' = 'r') AS read_groups,
               (SELECT count(*)::int FROM jsonb_array_elements(r.attributes->'permissions') p
                 WHERE p->>'permission' = 'rw') AS write_groups,
               (SELECT count(*)::int FROM jsonb_array_elements(r.attributes->'permissions') p
                 WHERE p->>'permission' = 'rwa') AS admin_groups,
               r.last_seen_at
        FROM public.cyberark_inventory_objects r WHERE {ROLE_SCOPE}
        ORDER BY lower(r.display_name), r.source_id
    """)
    return {
        "rows": rows, "total": len(rows),
        "last_observed_at": max((row["last_seen_at"] for row in rows), default=None),
    }


async def get_netskope_admin_role(pool: AsyncConnectionPool, role_id: str) -> dict[str, Any] | None:
    """One role with its permissions, each with the console pages it opens, and the administrators holding it."""
    role = await fetch_one(pool, f"""
        SELECT r.object_id, r.source_id AS id, r.display_name AS name, r.attributes
        FROM public.cyberark_inventory_objects r WHERE {ROLE_SCOPE} AND r.source_id = %s
    """, (role_id,))
    if role is None:
        return None
    pages_by_group = {
        row["source_id"]: row["pages"]
        for row in await fetch_all(pool, """
            SELECT g.source_id, g.attributes->'pages' AS pages FROM public.cyberark_inventory_objects g
            WHERE g.source_system = 'netskope' AND g.object_type = 'netskope_api_group' AND g.lifecycle_status = 'active'
        """)
    }
    permissions = []
    for item in role["attributes"].get("permissions") or []:
        pages = pages_by_group.get(str(item["id"])) or []
        permissions.append({
            "group_id": item["id"], "group": item["name"], "permission": item["permission"],
            "pages": sorted({page["page"] for page in pages}),
        })
    permissions.sort(key=lambda item: (_PERMISSION_RANK.get(item["permission"], 9), item["group"]))
    admins = await fetch_all(pool, """
        SELECT a.source_id AS id, a.display_name AS name, (a.attributes->>'active')::boolean AS active,
               a.attributes->>'record_type' AS record_type
        FROM public.cyberark_inventory_relationships e
        JOIN public.cyberark_inventory_objects a ON a.object_id = e.source_object_id
        WHERE e.target_object_id = %s AND e.relationship_type = 'has_role'
          AND a.object_type = 'netskope_admin' AND a.lifecycle_status = 'active'
        ORDER BY lower(a.display_name), a.source_id
    """, (role["object_id"],))
    attributes = role["attributes"]
    return {
        "id": role["id"], "name": role["name"], "last_edited": attributes.get("last_edited"),
        "api_groups_total": attributes.get("api_groups_total"), "permissions": permissions, "admins": admins,
    }
