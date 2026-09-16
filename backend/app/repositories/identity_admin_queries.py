import asyncio

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one

SOURCE_SYSTEM = "identity_administration"
OKTA_GROUP_PREFIX = "sg_cyberark%"


def _user_filters(
    search: str,
    active_filter: str,
    source_ids: list[str] | None = None,
    exclude_source_ids: list[str] | None = None,
) -> tuple[list[str], list[object]]:
    where = ["o.source_system = %s", "o.object_type = 'user'", "o.lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("(o.display_name ILIKE %s OR o.attributes->>'email' ILIKE %s OR o.attributes->>'user_name' ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like, like])
    if active_filter == "active":
        where.append("(o.attributes->>'active')::boolean IS TRUE")
    elif active_filter == "inactive":
        where.append("(o.attributes->>'active')::boolean IS FALSE")
    if source_ids is not None:
        where.append("o.source_id = ANY(%s)")
        params.append(source_ids)
    if exclude_source_ids is not None:
        where.append("NOT (o.source_id = ANY(%s))")
        params.append(exclude_source_ids)
    return where, params


async def list_identity_users(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    active_filter: str,
    source_ids: list[str] | None = None,
    exclude_source_ids: list[str] | None = None,
):
    where, params = _user_filters(search, active_filter, source_ids, exclude_source_ids)
    rows = await fetch_all(pool, f"""
        WITH role_counts AS (
          SELECT r.source_object_id AS user_object_id, count(*)::int AS role_count
          FROM public.cyberark_inventory_relationships r
          JOIN public.cyberark_inventory_objects ro
            ON ro.object_id = r.target_object_id AND ro.lifecycle_status = 'active'
          WHERE r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
          GROUP BY r.source_object_id
        )
        SELECT o.object_id, o.display_name, o.source_id, o.attributes,
               coalesce(rc.role_count, 0)::int AS role_count,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects o
        LEFT JOIN role_counts rc ON rc.user_object_id = o.object_id
        WHERE {' AND '.join(where)}
        ORDER BY lower(o.display_name), o.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search, "active_filter": active_filter}


async def get_identity_user_detail(pool: AsyncConnectionPool, object_id: int):
    user, roles = await asyncio.gather(
        fetch_one(pool, """
            SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
            FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = %s AND object_type = 'user'
        """, (object_id, SOURCE_SYSTEM)),
        fetch_all(pool, """
            SELECT ro.object_id, ro.display_name, ro.source_id
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects ro ON ro.object_id = r.target_object_id
            WHERE r.source_object_id = %s AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
            ORDER BY lower(ro.display_name)
        """, (object_id,)),
    )
    return user, roles


async def list_identity_roles(pool: AsyncConnectionPool, search: str, limit: int, offset: int, kind: str = ""):
    where = ["o.source_system = %s", "o.object_type = 'role'", "o.lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("o.display_name ILIKE %s")
        params.append(f"%{search}%")
    if kind == "okta_group":
        where.append("o.display_name ILIKE %s")
        params.append(OKTA_GROUP_PREFIX)
    elif kind == "role":
        where.append("o.display_name NOT ILIKE %s")
        params.append(OKTA_GROUP_PREFIX)
    rows = await fetch_all(pool, f"""
        WITH member_counts AS (
          SELECT r.target_object_id AS role_object_id, count(*)::int AS member_count
          FROM public.cyberark_inventory_relationships r
          JOIN public.cyberark_inventory_objects so
            ON so.object_id = r.source_object_id AND so.lifecycle_status = 'active'
          WHERE r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
          GROUP BY r.target_object_id
        )
        SELECT o.object_id, o.display_name, o.source_id, o.attributes,
               coalesce(mc.member_count, 0)::int AS member_count,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects o
        LEFT JOIN member_counts mc ON mc.role_object_id = o.object_id
        WHERE {' AND '.join(where)}
        ORDER BY lower(o.display_name), o.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def get_identity_role_detail(pool: AsyncConnectionPool, object_id: int):
    role, members = await asyncio.gather(
        fetch_one(pool, """
            SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
            FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = %s AND object_type = 'role'
        """, (object_id, SOURCE_SYSTEM)),
        fetch_all(pool, """
            SELECT so.object_id, so.display_name, so.source_id
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects so ON so.object_id = r.source_object_id
            WHERE r.target_object_id = %s AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
            ORDER BY lower(so.display_name)
        """, (object_id,)),
    )
    return role, members


async def list_identity_federations(pool: AsyncConnectionPool, search: str, limit: int, offset: int):
    where = ["source_system = %s", "object_type = 'identity_federation'", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("(display_name ILIKE %s OR attributes->>'federation_type' ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like])
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, attributes,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_active_identity_federations_for_resolution(pool: AsyncConnectionPool):
    """Return the small active federation catalog used by the business rule.

    This is intentionally separate from the paginated UI endpoint so user
    listing never depends on an arbitrary page size or performs N+1 queries.
    """
    return await fetch_all(pool, """
        SELECT object_id, display_name, source_id, (attributes->>'active')::boolean AS active
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s
          AND object_type = 'identity_federation'
          AND lifecycle_status = 'active'
    """, (SOURCE_SYSTEM,))


async def get_identity_federation_detail(pool: AsyncConnectionPool, object_id: int):
    return await fetch_one(pool, """
        SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s AND object_type = 'identity_federation'
    """, (object_id, SOURCE_SYSTEM))
