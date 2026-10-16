"""Read-only traversal of the verified, single-source CyberArk PAM graph."""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one

PAM_SOURCE_SYSTEM = "cyberark"
BRIDGE_ROLE_LIMIT = 25
BRIDGE_SAFE_PREVIEW = 6
BRIDGE_PLATFORM_PREVIEW = 4


def standard_seat_sql(user_alias: str = "u") -> str:
    """PAM-only Standard-seat predicate: EPVUser ∩ Privilege Cloud roles."""
    return f"""{user_alias}.attributes->>'user_type' = 'EPVUser'
        AND EXISTS (
          SELECT 1
          FROM public.cyberark_inventory_relationships seat_membership
          JOIN public.cyberark_inventory_objects seat_role
            ON seat_role.object_id = seat_membership.target_object_id
          WHERE seat_membership.source_object_id = {user_alias}.object_id
            AND seat_membership.relationship_type = 'user_has_role'
            AND seat_membership.lifecycle_status = 'active'
            AND seat_role.source_system = 'cyberark'
            AND seat_role.object_type = 'role'
            AND seat_role.lifecycle_status = 'active'
            AND seat_role.display_name IN ('Privilege Cloud Administrators', 'Privilege Cloud Users')
        )"""


def empty_pam_chain() -> dict:
    return {
        "matched": False,
        "pam_user": None,
        "roles": [],
        "roles_omitted": 0,
        "totals": {"roles": 0, "safes": 0, "platforms": 0, "psms": 0, "accounts": 0},
    }


async def list_pam_users(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    include_internal: bool = True,
    standard_seat: str = "",
    status: str = "",
) -> dict:
    where = ["u.source_system = 'cyberark'", "u.object_type = 'user'", "u.lifecycle_status = 'active'"]
    params: list[object] = []
    if search:
        where.append("u.display_name ILIKE %s")
        params.append(f"%{search}%")
    if not include_internal:
        where.append("EXISTS (SELECT 1 FROM public.cyberark_inventory_relationships ur_visible JOIN public.cyberark_inventory_relationships rs_visible ON rs_visible.source_object_id = ur_visible.target_object_id AND rs_visible.relationship_type = 'role_grants_access' AND rs_visible.lifecycle_status = 'active' JOIN public.cyberark_inventory_objects safe_visible ON safe_visible.object_id = rs_visible.target_object_id AND safe_visible.object_type = 'safe' AND safe_visible.source_system = 'cyberark' AND safe_visible.lifecycle_status = 'active' LEFT JOIN public.cyberark_safe_metadata meta_visible ON meta_visible.safe_number::text = safe_visible.source_id WHERE ur_visible.source_object_id = u.object_id AND ur_visible.relationship_type = 'user_has_role' AND ur_visible.lifecycle_status = 'active' AND coalesce(meta_visible.inventory_scope, 'pending') <> 'internal' AND coalesce(meta_visible.account_type_classification, '') <> 'internal')")
    seat_clause = standard_seat_sql("u")
    if standard_seat == "reconciled":
        where.append(seat_clause)
    elif standard_seat == "unreconciled":
        where.append(f"NOT ({seat_clause})")
    if status == "suspended":
        where.append("coalesce((u.attributes->>'suspended')::boolean, false) = true")
    elif status == "disabled":
        where.append("coalesce((u.attributes->>'enabled')::boolean, true) = false")
    rows = await fetch_all(pool, f"""
        SELECT u.object_id, u.display_name, u.source_id,
               count(DISTINCT r.target_object_id)::int AS role_count,
               ({seat_clause}) AS standard_seat_reconciled,
               coalesce((u.attributes->>'enabled')::boolean, true) AS enabled,
               coalesce((u.attributes->>'suspended')::boolean, false) AS suspended,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects u
        LEFT JOIN public.cyberark_inventory_relationships r
          ON r.source_object_id = u.object_id
         AND r.relationship_type = 'user_has_role'
         AND r.lifecycle_status = 'active'
        WHERE {' AND '.join(where)}
        GROUP BY u.object_id, u.display_name, u.source_id, u.attributes
        ORDER BY lower(u.display_name), u.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "search": search,
        "standard_seat": standard_seat,
        "status": status,
    }


async def list_pam_platforms(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
) -> dict:
    """List verified PAM platforms with their active Safe, account, and PSM context."""
    where = [
        "p.source_system = 'cyberark'",
        "p.object_type = 'platform'",
        "p.lifecycle_status = 'active'",
        "(p.attributes->>'active')::boolean IS TRUE",
    ]
    params: list[object] = []
    if search:
        where.append("p.display_name ILIKE %s")
        params.append(f"%{search}%")
    rows = await fetch_all(pool, f"""
        SELECT p.object_id, p.display_name, p.source_id,
               coalesce(p.attributes->>'system_type', '') AS system_type,
               coalesce((p.attributes->>'active')::boolean, false) AS active,
               coalesce(p.attributes->>'allowed_safes_pattern', '') AS allowed_safes_pattern,
               count(DISTINCT safe_link.source_object_id)::int AS safe_count,
               count(DISTINCT account.account_id)::int AS account_count,
               coalesce(
                 array_agg(DISTINCT jsonb_build_object(
                   'object_id', psm.object_id, 'display_name', psm.display_name, 'source_id', psm.source_id
                 )) FILTER (WHERE psm.object_id IS NOT NULL),
                 '{{}}'
               ) AS psms,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects p
        LEFT JOIN public.cyberark_inventory_relationships safe_link
          ON safe_link.target_object_id = p.object_id
         AND safe_link.relationship_type = 'safe_uses_platform'
         AND safe_link.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_accounts account
          ON account.platform_id = p.source_id
         AND account.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_inventory_relationships psm_link
          ON psm_link.source_object_id = p.object_id
         AND psm_link.relationship_type = 'platform_uses_psm'
         AND psm_link.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_inventory_objects psm
          ON psm.object_id = psm_link.target_object_id
         AND psm.source_system = 'cyberark'
         AND psm.object_type = 'psm'
         AND psm.lifecycle_status = 'active'
        WHERE {' AND '.join(where)}
        GROUP BY p.object_id, p.display_name, p.source_id, p.attributes
        ORDER BY lower(p.display_name), p.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_pam_connectors(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
) -> dict:
    """List verified PAM PSM connectors and the platforms that use them."""
    where = [
        "psm.source_system = 'cyberark'",
        "psm.object_type = 'psm'",
        "psm.lifecycle_status = 'active'",
    ]
    params: list[object] = []
    if search:
        where.append("(psm.display_name ILIKE %s OR p.display_name ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    rows = await fetch_all(pool, f"""
        SELECT psm.object_id, psm.display_name, psm.source_id,
               coalesce(psm.attributes->>'address', '') AS address,
               count(DISTINCT p.object_id)::int AS platform_count,
               coalesce(
                 array_agg(DISTINCT jsonb_build_object(
                   'object_id', p.object_id, 'display_name', p.display_name, 'source_id', p.source_id
                 )) FILTER (WHERE p.object_id IS NOT NULL),
                 '{{}}'
               ) AS platforms,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects psm
        LEFT JOIN public.cyberark_inventory_relationships psm_link
          ON psm_link.target_object_id = psm.object_id
         AND psm_link.relationship_type = 'platform_uses_psm'
         AND psm_link.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_inventory_objects p
          ON p.object_id = psm_link.source_object_id
         AND p.source_system = 'cyberark'
         AND p.object_type = 'platform'
         AND p.lifecycle_status = 'active'
        WHERE {' AND '.join(where)}
        GROUP BY psm.object_id, psm.display_name, psm.source_id
        ORDER BY lower(psm.display_name), psm.object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_psm_connector_types(pool: AsyncConnectionPool, search: str, limit: int, offset: int) -> dict:
    """PSM session connector-type catalog (PSM-001, e.g. PSM-RDP, PSM-SSH). Not PSM servers."""
    where = ["source_system = 'cyberark'", "object_type = 'psm_connector'", "lifecycle_status = 'active'"]
    params: list[object] = []
    if search:
        where.append("display_name ILIKE %s")
        params.append(f"%{search}%")
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_pam_components(pool: AsyncConnectionPool) -> dict:
    """PAM component health summary (SYS-001): Portal/CPM/PSM connectivity and version, no host inventory."""
    rows = await fetch_all(pool, """
        SELECT object_id, display_name, source_id,
               coalesce(attributes->>'description', '') AS description,
               coalesce((attributes->>'total_count')::int, 0) AS total_count,
               coalesce((attributes->>'connected_count')::int, 0) AS connected_count,
               coalesce(attributes->'instance_versions', '[]'::jsonb) AS instance_versions,
               (attributes->>'latest_logon_at')::bigint AS latest_logon_at,
               coalesce((attributes->>'all_instances_logged_on')::boolean, false) AS all_instances_logged_on
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'cyberark' AND object_type = 'component' AND lifecycle_status = 'active'
        ORDER BY lower(display_name), object_id
    """)
    return {"rows": rows}


async def list_platform_catalogs(pool: AsyncConnectionPool) -> dict:
    """Dependent / grouped / rotational-group platform catalogs (PLAT-003)."""
    dependents = await fetch_all(pool, """
        SELECT object_id, display_name, source_id,
               coalesce(attributes->>'platform_base_id', '') AS platform_base_id,
               coalesce(attributes->>'platform_base_type', '') AS platform_base_type,
               coalesce((attributes->>'linked_target_platforms')::int, 0) AS linked_target_platforms
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'cyberark' AND object_type = 'platform_dependent' AND lifecycle_status = 'active'
        ORDER BY lower(display_name), object_id
    """)
    groups = await fetch_all(pool, """
        SELECT object_id, display_name, source_id, coalesce((attributes->>'active')::boolean, false) AS active
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'cyberark' AND object_type = 'platform_group' AND lifecycle_status = 'active'
        ORDER BY lower(display_name), object_id
    """)
    rotational_groups = await fetch_all(pool, """
        SELECT object_id, display_name, source_id, coalesce((attributes->>'active')::boolean, false) AS active
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'cyberark' AND object_type = 'platform_rotational_group' AND lifecycle_status = 'active'
        ORDER BY lower(display_name), object_id
    """)
    return {"dependents": dependents, "groups": groups, "rotational_groups": rotational_groups}


async def list_platform_targets(pool: AsyncConnectionPool, search: str, limit: int, offset: int) -> dict:
    """CPM/workflow policy for CyberArk's "target platform" catalog (PLAT-002).

    This is its own object type, not a column on `platform`: the target's
    Name only sometimes equals a regular PlatformID, so it cannot be safely
    joined onto the base platform object (verified live against the tenant).
    `platform_base_id` is a plain reference attribute for context.
    """
    where = ["source_system = 'cyberark'", "object_type = 'platform_target'", "lifecycle_status = 'active'"]
    params: list[object] = []
    if search:
        where.append("(display_name ILIKE %s OR attributes->>'platform_base_id' ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id,
               coalesce(attributes->>'platform_base_id', '') AS platform_base_id,
               coalesce((attributes->>'dual_control_required')::boolean, false) AS dual_control_required,
               coalesce((attributes->>'otp_required')::boolean, false) AS otp_required,
               coalesce((attributes->>'reason_required')::boolean, false) AS reason_required,
               coalesce((attributes->>'exclusive_access_required')::boolean, false) AS exclusive_access_required,
               coalesce((attributes->>'credentials_change_automatic')::boolean, false) AS credentials_change_automatic,
               coalesce((attributes->>'credentials_change_interval_days')::int, null) AS credentials_change_interval_days,
               coalesce((attributes->>'credentials_verify_automatic')::boolean, false) AS credentials_verify_automatic,
               coalesce((attributes->>'credentials_verify_interval_days')::int, null) AS credentials_verify_interval_days,
               coalesce((attributes->>'credentials_reconcile_automatic')::boolean, false) AS credentials_reconcile_automatic,
               coalesce(attributes->>'psm_server_id', '') AS psm_server_id,
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


async def get_pam_user_chain(pool: AsyncConnectionPool, object_id: int, include_internal: bool = True) -> dict | None:
    pam_user = await fetch_one(pool, """
        SELECT object_id, display_name, source_id
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = 'cyberark'
          AND object_type = 'user' AND lifecycle_status = 'active'
    """, (object_id,))
    if pam_user is None:
        return None
    return await get_pam_chain_for_user(pool, pam_user, include_internal=include_internal)


async def get_pam_chain_for_user(
    pool: AsyncConnectionPool,
    pam_user: dict,
    *,
    role_limit: int | None = None,
    safe_limit: int | None = None,
    platform_limit: int | None = None,
    include_internal: bool = True,
) -> dict:
    """Build the verified user -> role -> Safe -> platform -> PSM chain."""
    internal_clause = "" if include_internal else "AND coalesce(meta_scope.inventory_scope, 'pending') <> 'internal' AND coalesce(meta_scope.account_type_classification, '') <> 'internal'"
    account_internal_clause = "" if include_internal else "AND coalesce(a.inventory_account_type, '') <> 'internal'"
    rows = await fetch_all(pool, """
        WITH user_roles AS (
          SELECT ro.object_id AS role_object_id, ro.display_name AS role_name, ro.source_id AS role_source_id
          FROM public.cyberark_inventory_relationships ur
          JOIN public.cyberark_inventory_objects ro
            ON ro.object_id = ur.target_object_id
           AND ro.source_system = 'cyberark'
           AND ro.object_type = 'role'
           AND ro.lifecycle_status = 'active'
          WHERE ur.source_object_id = %s
            AND ur.relationship_type = 'user_has_role'
            AND ur.lifecycle_status = 'active'
        )
        SELECT ur.role_object_id, ur.role_name, ur.role_source_id,
               so.object_id AS safe_object_id, so.display_name AS safe_name, so.source_id AS safe_number,
               (SELECT count(*) FROM public.cyberark_accounts a
                 WHERE a.safe_number::text = so.source_id AND a.lifecycle_status = 'active'
                   {account_internal_clause})::int AS account_count,
               po.object_id AS platform_object_id, po.display_name AS platform_name, po.source_id AS platform_source_id,
               psm.object_id AS psm_object_id, psm.display_name AS psm_name, psm.source_id AS psm_source_id
        FROM user_roles ur
        LEFT JOIN public.cyberark_inventory_relationships rs
          ON rs.source_object_id = ur.role_object_id
         AND rs.relationship_type = 'role_grants_access'
         AND rs.lifecycle_status = 'active'
         LEFT JOIN public.cyberark_inventory_objects so
          ON so.object_id = rs.target_object_id
         AND so.source_system = 'cyberark'
         AND so.object_type = 'safe'
           AND so.lifecycle_status = 'active'
         LEFT JOIN public.cyberark_safe_metadata meta_scope
           ON meta_scope.safe_number::text = so.source_id
        LEFT JOIN public.cyberark_inventory_relationships sp
          ON sp.source_object_id = so.object_id
         AND sp.relationship_type = 'safe_uses_platform'
         AND sp.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_inventory_objects po
          ON po.object_id = sp.target_object_id
         AND po.source_system = 'cyberark'
         AND po.object_type = 'platform'
         AND po.lifecycle_status = 'active'
        LEFT JOIN public.cyberark_inventory_relationships pp
          ON pp.source_object_id = po.object_id
         AND pp.relationship_type = 'platform_uses_psm'
         AND pp.lifecycle_status = 'active'
         LEFT JOIN public.cyberark_inventory_objects psm
          ON psm.object_id = pp.target_object_id
         AND psm.source_system = 'cyberark'
         AND psm.object_type = 'psm'
           AND psm.lifecycle_status = 'active'
        WHERE 1 = 1 {internal_clause}
        ORDER BY lower(ur.role_name), lower(so.display_name), lower(po.display_name), lower(psm.display_name)
    """.format(internal_clause=internal_clause, account_internal_clause=account_internal_clause), (pam_user["object_id"],))
    return build_pam_chain(pam_user, rows or [], role_limit, safe_limit, platform_limit)


def build_pam_chain(
    pam_user: dict,
    rows: list[dict],
    role_limit: int | None = None,
    safe_limit: int | None = None,
    platform_limit: int | None = None,
) -> dict:
    roles: list[dict] = []
    role_index: dict[int, dict] = {}
    safe_ids: set[int] = set()
    platform_ids: set[int] = set()
    psm_ids: set[int] = set()
    account_total = 0
    for row in rows:
        role = role_index.get(row["role_object_id"])
        if role is None:
            role = {
                "object_id": row["role_object_id"],
                "display_name": row["role_name"],
                "source_id": row["role_source_id"],
                "safe_count": 0,
                "safes": [],
                "_safe_index": {},
            }
            role_index[row["role_object_id"]] = role
            roles.append(role)

        if row["safe_object_id"] is None:
            continue
        safe = role["_safe_index"].get(row["safe_object_id"])
        if safe is None:
            role["safe_count"] += 1
            safe = {
                "object_id": row["safe_object_id"],
                "display_name": row["safe_name"],
                "safe_number": row["safe_number"],
                "account_count": row["account_count"],
                "platform_count": 0,
                "platforms": [],
                "_platform_index": {},
            }
            role["_safe_index"][row["safe_object_id"]] = safe
            if safe_limit is None or len(role["safes"]) < safe_limit:
                role["safes"].append(safe)

        if row["platform_object_id"] is not None:
            platform_ids.add(row["platform_object_id"])
            platform = safe["_platform_index"].get(row["platform_object_id"])
            if platform is None:
                safe["platform_count"] += 1
                platform = {
                    "object_id": row["platform_object_id"],
                    "display_name": row["platform_name"],
                    "source_id": row["platform_source_id"],
                    "psms": [],
                    "_psm_ids": set(),
                }
                safe["_platform_index"][row["platform_object_id"]] = platform
                if platform_limit is None or len(safe["platforms"]) < platform_limit:
                    safe["platforms"].append(platform)
            if row["psm_object_id"] is not None and row["psm_object_id"] not in platform["_psm_ids"]:
                psm_ids.add(row["psm_object_id"])
                platform["_psm_ids"].add(row["psm_object_id"])
                platform["psms"].append({
                    "object_id": row["psm_object_id"],
                    "display_name": row["psm_name"],
                    "source_id": row["psm_source_id"],
                })

        if row["safe_object_id"] not in safe_ids:
            safe_ids.add(row["safe_object_id"])
            account_total += row["account_count"]

    for role in roles:
        for safe in role["safes"]:
            safe.pop("_platform_index", None)
            for platform in safe["platforms"]:
                platform.pop("_psm_ids", None)
        role.pop("_safe_index", None)

    displayed_roles = roles if role_limit is None else roles[:role_limit]
    return {
        "matched": True,
        "pam_user": {
            "object_id": pam_user["object_id"],
            "display_name": pam_user["display_name"],
            "source_id": pam_user["source_id"],
        },
        "roles": displayed_roles,
        "roles_omitted": len(roles) - len(displayed_roles),
        "totals": {
            "roles": len(roles),
            "safes": len(safe_ids),
            "platforms": len(platform_ids),
            "psms": len(psm_ids),
            "accounts": account_total,
        },
    }
