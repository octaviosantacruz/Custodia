import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship

SOURCE_SYSTEM = "identity_administration"
OKTA_GROUP_PREFIX = "sg_cyberark%"


def _user_filters(
    search: str,
    active_filter: str,
    seat_emails: list[str] | None = None,
    exclude_seat_emails: list[str] | None = None,
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
    if seat_emails is not None:
        where.append("lower(coalesce(o.attributes->>'email', '')) = ANY(%s)")
        params.append(seat_emails)
    if exclude_seat_emails is not None:
        where.append("NOT (lower(coalesce(o.attributes->>'email', '')) = ANY(%s))")
        params.append(exclude_seat_emails)
    return where, params


async def list_identity_users(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    active_filter: str,
    seat_emails: list[str] | None = None,
    exclude_seat_emails: list[str] | None = None,
):
    where, params = _user_filters(search, active_filter, seat_emails, exclude_seat_emails)
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
            WHERE object_id = %s AND source_system = %s AND object_type = 'user' AND lifecycle_status = 'active'
        """, (object_id, SOURCE_SYSTEM)),
        fetch_all(pool, """
            SELECT ro.object_id, ro.display_name, ro.source_id
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects ro ON ro.object_id = r.target_object_id
            WHERE r.source_object_id = %s AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
              AND ro.lifecycle_status = 'active' AND ro.source_system = %s
            ORDER BY lower(ro.display_name)
        """, (object_id, SOURCE_SYSTEM)),
    )
    if user is not None:
        user["role_count"] = len(roles)
    return user, roles


# ORDER BY fragments are whitelisted literals: never interpolate request values.
_ROLE_SORT_KEYS = {
    "name": "lower(o.display_name)",
    # The table shows the directly reported member count; absent counts sort last.
    # ISO-8601 text sorts chronologically; empty values count as unreported.
    "modified": "nullif(o.attributes->>'last_modified', '')",
    "members": "CASE WHEN (o.attributes->>'direct_member_count') ~ '^[0-9]+$' THEN (o.attributes->>'direct_member_count')::int END",
}


def _role_order_by(sort: str, direction: str) -> str:
    key = _ROLE_SORT_KEYS.get(sort, _ROLE_SORT_KEYS["name"])
    way = "DESC" if direction == "desc" else "ASC"
    return f"{key} {way} NULLS LAST, lower(o.display_name), o.object_id"


async def list_identity_roles(pool: AsyncConnectionPool, search: str, limit: int, offset: int, kind: str = "", sort: str = "name", direction: str = "asc", object_ids: list[int] | None = None):
    where = ["o.source_system = %s", "o.object_type = 'role'", "o.lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("o.display_name ILIKE %s")
        params.append(f"%{search}%")
    if object_ids is not None:
        where.append("o.object_id = ANY(%s)")
        params.append(object_ids)
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
        ORDER BY {_role_order_by(sort, direction)}
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
            WHERE object_id = %s AND source_system = %s AND object_type = 'role' AND lifecycle_status = 'active'
        """, (object_id, SOURCE_SYSTEM)),
        fetch_all(pool, """
            SELECT so.object_id, so.display_name, so.source_id
            FROM public.cyberark_inventory_relationships r
            JOIN public.cyberark_inventory_objects so ON so.object_id = r.source_object_id
            WHERE r.target_object_id = %s AND r.relationship_type = 'user_has_role' AND r.lifecycle_status = 'active'
              AND so.lifecycle_status = 'active' AND so.source_system = 'identity_administration'
            ORDER BY lower(so.display_name)
        """, (object_id,)),
    )
    if role is not None:
        role["member_count"] = len(members)
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


async def list_active_federations(pool: AsyncConnectionPool) -> list[dict]:
    """Active federations, used to resolve the domain-derived federation of a person."""
    return await fetch_all(pool, """
        SELECT object_id, display_name, source_id,
               (coalesce(attributes->>'active', 'false') = 'true') AS active
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'identity_administration' AND object_type = 'identity_federation'
          AND lifecycle_status = 'active'
        ORDER BY lower(display_name), object_id
    """)


async def get_identity_membership_data(pool: AsyncConnectionPool, object_id: int):
    # One consistent snapshot: a sync cannot split object and edge observations.
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            nodes = await (await conn.execute("""
                SELECT object_id, display_name, source_id, object_type, attributes, last_seen_at
                FROM public.cyberark_inventory_objects
                WHERE source_system = %s AND lifecycle_status = 'active'
                  AND object_type IN ('role', 'user')
                ORDER BY lower(display_name), object_id
            """, (SOURCE_SYSTEM,))).fetchall()
            edges = await (await conn.execute("""
                SELECT r.target_object_id AS parent_id, r.source_object_id AS member_id
                FROM public.cyberark_inventory_relationships r
                JOIN public.cyberark_inventory_objects parent ON parent.object_id = r.target_object_id
                JOIN public.cyberark_inventory_objects member ON member.object_id = r.source_object_id
                WHERE r.relationship_type = 'identity_member_of' AND r.lifecycle_status = 'active'
                  AND parent.source_system = %s AND member.source_system = %s
                  AND parent.lifecycle_status = 'active' AND member.lifecycle_status = 'active'
                ORDER BY parent.object_id, lower(member.display_name), member.object_id
            """, (SOURCE_SYSTEM, SOURCE_SYSTEM))).fetchall()
    return nodes, edges


async def get_identity_role_review_data(pool: AsyncConnectionPool):
    """Read the active normalized Identity graph and its latest source run.

    Cost: reads every active Identity role/user row and every active
    ``identity_member_of`` edge in one REPEATABLE READ, READ ONLY transaction,
    with no LIMIT. The membership analysis needs the complete graph, so
    truncating would drop reachable accounts and report false non-matches; the
    route therefore recomputes this bounded-by-dataset scan on each expansion
    of the panel. The scan is isolated by ``source_system`` and only reads
    ``role``/``user`` objects.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            nodes = await (await conn.execute("""
                SELECT object_id, source_id, display_name, object_type,
                       CASE WHEN object_type = 'role' THEN jsonb_build_object(
                         'membership_status', attributes->'membership_status',
                         'unresolved_members', attributes->'unresolved_members',
                         'unresolved_member_count', attributes->'unresolved_member_count',
                         'display_name', attributes->'display_name'
                       ) ELSE '{}'::jsonb END AS attributes,
                       lifecycle_status
                FROM public.cyberark_inventory_objects
                WHERE source_system = %s AND lifecycle_status = 'active'
                  AND object_type IN ('role', 'user')
                ORDER BY lower(display_name), object_id
            """, (SOURCE_SYSTEM,))).fetchall()
            edges = await (await conn.execute("""
                SELECT member.object_type AS source_type, member.source_id,
                       parent.source_id AS target_id
                FROM public.cyberark_inventory_relationships r
                JOIN public.cyberark_inventory_objects parent ON parent.object_id = r.target_object_id
                JOIN public.cyberark_inventory_objects member ON member.object_id = r.source_object_id
                WHERE r.relationship_type = 'identity_member_of' AND r.lifecycle_status = 'active'
                  AND parent.source_system = %s AND member.source_system = %s
                  AND parent.lifecycle_status = 'active' AND member.lifecycle_status = 'active'
                  AND parent.object_type = 'role'
                ORDER BY parent.object_id, lower(member.display_name), member.object_id
            """, (SOURCE_SYSTEM, SOURCE_SYSTEM))).fetchall()
            run = await (await conn.execute("""
                SELECT status, completed_at
                FROM public.cyberark_ingestion_runs
                WHERE source_system = %s
                ORDER BY started_at DESC, run_id DESC
                LIMIT 1
            """, (SOURCE_SYSTEM,))).fetchone()

    objects = [InventoryObject(
        object_type=row["object_type"], source_id=row["source_id"], display_name=row["display_name"],
        source_system=SOURCE_SYSTEM, lifecycle_status=row["lifecycle_status"],
        attributes={**(row["attributes"] or {}), "object_id": row["object_id"]},
    ) for row in nodes]
    relationships = [InventoryRelationship(
        source_type=row["source_type"], source_id=row["source_id"],
        target_type="role", target_id=row["target_id"], relationship_type="identity_member_of",
        source_system=SOURCE_SYSTEM,
    ) for row in edges]
    return objects, relationships, run
