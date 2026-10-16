"""Read-only Netskope group inventory with observed and reported member counts (NSK-GRP-001)."""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one

GROUP_SCOPE = """
    g.source_system = 'netskope' AND g.object_type = 'netskope_group' AND g.lifecycle_status = 'active'
"""


async def list_netskope_groups(pool: AsyncConnectionPool, search: str, provisioner: str, limit: int, offset: int) -> dict:
    """Active groups. ``observed_members`` counts active `member_of` edges from active users;
    ``reported_members`` is Netskope's own ``userCount`` (null when it did not report one)."""
    like = f"%{search}%"
    params = (search, like, like, provisioner, provisioner)
    where = f"""{GROUP_SCOPE}
        AND (%s = '' OR g.display_name ILIKE %s OR g.source_id ILIKE %s)
        AND (%s = '' OR g.attributes->>'provisioner' = %s)
    """
    summary = await fetch_one(pool, f"""
        SELECT count(*)::int AS total, max(g.last_seen_at) AS last_observed_at
        FROM public.cyberark_inventory_objects g WHERE {where}
    """, params)
    rows = await fetch_all(pool, f"""
        SELECT g.source_id AS id, g.display_name AS name,
               NULLIF(g.attributes->>'provisioner', '') AS provisioner,
               (g.attributes->>'user_count')::int AS reported_members,
               (SELECT count(*)::int FROM public.cyberark_inventory_relationships r
                  JOIN public.cyberark_inventory_objects u ON u.object_id = r.source_object_id
                 WHERE r.target_object_id = g.object_id AND r.relationship_type = 'member_of'
                   AND r.lifecycle_status = 'active' AND u.source_system = 'netskope'
                   AND u.object_type = 'user' AND u.lifecycle_status = 'active') AS observed_members,
               g.first_seen_at, g.last_seen_at
        FROM public.cyberark_inventory_objects g WHERE {where}
        ORDER BY g.display_name, g.source_id LIMIT %s OFFSET %s
    """, (*params, limit, offset))
    return {"rows": rows, "total": summary["total"], "last_observed_at": summary["last_observed_at"]}


async def list_netskope_group_members(pool: AsyncConnectionPool, group_id: str, limit: int, offset: int) -> dict | None:
    """Active users linked to one group, or ``None`` when the group is unknown or retired."""
    group = await fetch_one(pool, f"""
        SELECT g.object_id, g.source_id AS id, g.display_name AS name
        FROM public.cyberark_inventory_objects g WHERE {GROUP_SCOPE} AND g.source_id = %s
    """, (group_id,))
    if group is None:
        return None
    scope = """
        FROM public.cyberark_inventory_relationships r
        JOIN public.cyberark_inventory_objects u ON u.object_id = r.source_object_id
        WHERE r.target_object_id = %s AND r.relationship_type = 'member_of' AND r.lifecycle_status = 'active'
          AND u.source_system = 'netskope' AND u.object_type = 'user' AND u.lifecycle_status = 'active'
    """
    total = await fetch_one(pool, f"SELECT count(*)::int AS total {scope}", (group["object_id"],))
    rows = await fetch_all(pool, f"""
        SELECT u.source_id AS id, u.display_name AS name, u.attributes->>'email' AS email
        {scope} ORDER BY u.display_name, u.source_id LIMIT %s OFFSET %s
    """, (group["object_id"], limit, offset))
    return {"group": {"id": group["id"], "name": group["name"]}, "rows": rows, "total": total["total"]}


POLICY_GROUP_SCOPE = """
    g.source_system = 'netskope' AND g.object_type = 'netskope_policy_group' AND g.lifecycle_status = 'active'
"""


async def list_netskope_policy_groups(pool: AsyncConnectionPool) -> dict:
    """NSK-POLICY-002: the active Real-time Protection policy groups, in the console's group-id order.

    Only identity and kind are stored (id, name, type, editable flag); never who created or modified a group.
    """
    rows = await fetch_all(pool, f"""
        SELECT g.source_id AS id, g.display_name AS name,
               NULLIF(g.attributes->>'group_type', '') AS group_type,
               (g.attributes->>'can_be_edited_deleted')::boolean AS can_be_edited_deleted,
               g.first_seen_at, g.last_seen_at
        FROM public.cyberark_inventory_objects g WHERE {POLICY_GROUP_SCOPE}
        ORDER BY CASE WHEN g.source_id ~ '^[0-9]+$' THEN g.source_id::bigint END NULLS LAST, g.source_id
    """)
    return {"rows": rows, "total": len(rows), "last_observed_at": max((row["last_seen_at"] for row in rows), default=None)}
