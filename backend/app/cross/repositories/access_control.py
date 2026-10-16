from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cross.repositories.access_delegation import assert_composite_levels_within_ceiling, assert_delegation_ceiling
from app.cross.repositories.admin_invariant import assert_at_least_one_active_admin, lock_admin_invariant
from app.cross.repositories.audit import record_audit


async def list_permissions(pool: AsyncConnectionPool):
    return await fetch_all(
        pool,
        """
        SELECT permission_code, domain_code, resource_code, action_code,
               description, lifecycle_status, system_managed
        FROM public.access_permissions
        ORDER BY domain_code, resource_code, action_code, permission_code
        """,
    )


async def list_roles(pool: AsyncConnectionPool):
    return await fetch_all(
        pool,
        """
        SELECT r.role_code, r.display_name, r.description, r.domain_code,
               CASE
                 WHEN r.role_kind = 'composite' AND EXISTS (
                   SELECT 1
                   FROM public.access_custom_role_levels selection
                   JOIN public.access_domains domain USING (domain_code)
                   JOIN public.access_domain_levels level
                     ON level.domain_code = selection.domain_code
                    AND level.level_code = selection.level_code
                   JOIN public.access_roles base ON base.role_code = level.base_role_code
                   WHERE selection.custom_role_code = r.role_code
                     AND (domain.lifecycle_status = 'planned' OR base.lifecycle_status = 'planned')
                 ) THEN 'planned'
                 ELSE r.lifecycle_status
               END AS lifecycle_status,
               r.system_managed, r.role_kind,
               COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code)
                         FROM public.access_effective_role_permissions rp
                         WHERE rp.role_code = r.role_code), ARRAY[]::text[]) AS permission_codes,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'domain_code', selection.domain_code,
                   'level_code', selection.level_code,
                   'level_display_name', level.display_name,
                   'base_role_code', level.base_role_code
                 ) ORDER BY domain.sort_order, level.sort_order)
                 FROM public.access_custom_role_levels selection
                 JOIN public.access_domains domain USING (domain_code)
                 JOIN public.access_domain_levels level
                   ON level.domain_code = selection.domain_code
                  AND level.level_code = selection.level_code
                 WHERE selection.custom_role_code = r.role_code
               ), '[]'::jsonb) AS level_refs,
               (SELECT count(*)::int FROM public.access_user_roles ur
                WHERE ur.role_code = r.role_code) AS user_count
        FROM public.access_roles r
        ORDER BY r.role_kind, r.system_managed DESC, r.domain_code NULLS LAST, r.display_name
        """,
    )


async def list_domain_levels(pool: AsyncConnectionPool):
    rows = await fetch_all(
        pool,
        """
        SELECT domain.domain_code, domain.display_name AS domain_display_name,
               domain.lifecycle_status AS domain_lifecycle_status, domain.sort_order AS domain_sort_order,
               level.level_code, level.display_name AS level_display_name,
               level.base_role_code, level.sort_order AS level_sort_order,
               base.lifecycle_status AS base_lifecycle_status,
               COALESCE((SELECT array_agg(permission_code ORDER BY permission_code)
                         FROM public.access_role_permissions permission
                         WHERE permission.role_code = level.base_role_code), ARRAY[]::text[]) AS permission_codes
        FROM public.access_domains domain
        LEFT JOIN public.access_domain_levels level USING (domain_code)
        LEFT JOIN public.access_roles base ON base.role_code = level.base_role_code
        ORDER BY domain.sort_order, level.sort_order, level.display_name
        """,
    )
    domains: dict[str, dict] = {}
    for row in rows:
        domain = domains.setdefault(row["domain_code"], {
            "domain_code": row["domain_code"],
            "display_name": row["domain_display_name"],
            "lifecycle_status": row["domain_lifecycle_status"],
            "sort_order": row["domain_sort_order"],
            "levels": [],
        })
        if row["level_code"] is not None:
            domain["levels"].append({
                "level_code": row["level_code"],
                "display_name": row["level_display_name"],
                "base_role_code": row["base_role_code"],
                "lifecycle_status": "planned" if row["domain_lifecycle_status"] == "planned" or row["base_lifecycle_status"] == "planned" else "active",
                "permission_codes": row["permission_codes"],
            })
    return list(domains.values())


async def create_permission(
    pool: AsyncConnectionPool,
    *,
    permission_code: str,
    domain_code: str,
    resource_code: str,
    action_code: str,
    description: str,
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1 FROM public.access_domains WHERE domain_code = %s", (domain_code,))
                if await cursor.fetchone() is None:
                    raise ValueError(f"Dominio desconocido: {domain_code}")
                await cursor.execute(
                    """INSERT INTO public.access_permissions
                       (permission_code, domain_code, resource_code, action_code, description, lifecycle_status, system_managed)
                       VALUES (%s, %s, %s, %s, %s, 'active', false)""",
                    (permission_code, domain_code, resource_code, action_code, description),
                )
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="create",
                    entity_type="access_permission",
                    entity_id=permission_code,
                    after_data={"domain_code": domain_code, "resource_code": resource_code, "action_code": action_code, "description": description},
                )
    return permission_code


async def role_exists(pool: AsyncConnectionPool, role_code: str) -> bool:
    row = await fetch_one(pool, "SELECT 1 AS present FROM public.access_roles WHERE role_code = %s", (role_code,))
    return row is not None


async def role_grants_permission(pool: AsyncConnectionPool, role_code: str, permission_code: str) -> bool:
    row = await fetch_one(
        pool,
        "SELECT 1 AS present FROM public.access_effective_role_permissions WHERE role_code = %s AND permission_code = %s",
        (role_code, permission_code),
    )
    return row is not None


async def create_role(
    pool: AsyncConnectionPool,
    *,
    role_code: str,
    display_name: str,
    description: str,
    domain_code: str,
    permission_codes: list[str],
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # ACCESS-CEILING-001: serialize with every other access
                # mutation before resolving what this actor may delegate.
                await lock_admin_invariant(cursor)
                await cursor.execute("SELECT 1 FROM public.access_domains WHERE domain_code = %s", (domain_code,))
                if await cursor.fetchone() is None:
                    raise ValueError(f"Dominio desconocido: {domain_code}")
                await cursor.execute(
                    "SELECT permission_code FROM public.access_permissions WHERE permission_code = ANY(%s)",
                    (permission_codes,),
                )
                valid = {row["permission_code"] for row in await cursor.fetchall()}
                missing = sorted(set(permission_codes) - valid)
                if missing:
                    raise ValueError("Permisos desconocidos: " + ", ".join(missing))
                # ACCESS-CEILING-001: a delegated actor can only grant what
                # they already hold; access:manage bypasses this.
                await assert_delegation_ceiling(cursor, actor_id, permission_codes)
                await cursor.execute(
                    """INSERT INTO public.access_roles
                       (role_code, display_name, description, domain_code, lifecycle_status, system_managed, role_kind)
                       VALUES (%s, %s, %s, %s, 'active', false, 'direct')""",
                    (role_code, display_name, description, domain_code),
                )
                if permission_codes:
                    await cursor.executemany(
                        "INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES (%s, %s)",
                        [(role_code, code) for code in permission_codes],
                    )
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="create",
                    entity_type="access_role",
                    entity_id=role_code,
                    after_data={"display_name": display_name, "permission_codes": permission_codes},
                )
    return role_code


async def update_role(
    pool: AsyncConnectionPool,
    *,
    role_code: str,
    display_name: str,
    description: str,
    domain_code: str,
    permission_codes: list[str],
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # IF-002: a custom role's permission set can be the only
                # source of access:manage for some active admin. Serialize
                # against every other mutation that can affect the
                # active-admin invariant before reading anything it
                # depends on.
                await lock_admin_invariant(cursor)
                await cursor.execute(
                    "SELECT to_jsonb(r) AS data, r.system_managed, r.role_kind FROM public.access_roles r WHERE r.role_code = %s FOR UPDATE",
                    (role_code,),
                )
                role = await cursor.fetchone()
                if role is None:
                    return False
                if role["system_managed"]:
                    raise ValueError("Los roles del sistema son de solo lectura")
                if role["role_kind"] != "direct":
                    raise ValueError("El rol compuesto se edita desde su combinación de niveles")
                # IF-004: capture the permission set this role actually had
                # before touching it -- to_jsonb(access_roles) alone never
                # contains access_role_permissions rows, so before_data used
                # to be asymmetric with after_data (which always included
                # the new permission_codes) and the audit log couldn't show
                # what permission was actually removed.
                await cursor.execute(
                    "SELECT array_agg(permission_code ORDER BY permission_code) AS codes FROM public.access_role_permissions WHERE role_code = %s",
                    (role_code,),
                )
                before_permission_codes = (await cursor.fetchone())["codes"] or []
                await cursor.execute("SELECT 1 FROM public.access_domains WHERE domain_code = %s", (domain_code,))
                if await cursor.fetchone() is None:
                    raise ValueError(f"Dominio desconocido: {domain_code}")
                await cursor.execute(
                    "SELECT permission_code FROM public.access_permissions WHERE permission_code = ANY(%s)",
                    (permission_codes,),
                )
                valid = {row["permission_code"] for row in await cursor.fetchall()}
                missing = sorted(set(permission_codes) - valid)
                if missing:
                    raise ValueError("Permisos desconocidos: " + ", ".join(missing))
                # ACCESS-CEILING-001: the new permission set cannot exceed the
                # actor's own; removing permissions is always allowed.
                await assert_delegation_ceiling(cursor, actor_id, permission_codes)
                await cursor.execute(
                    "UPDATE public.access_roles SET display_name = %s, description = %s, domain_code = %s WHERE role_code = %s",
                    (display_name, description, domain_code, role_code),
                )
                await cursor.execute("DELETE FROM public.access_role_permissions WHERE role_code = %s", (role_code,))
                if permission_codes:
                    await cursor.executemany(
                        "INSERT INTO public.access_role_permissions (role_code, permission_code) VALUES (%s, %s)",
                        [(role_code, code) for code in permission_codes],
                    )
                await assert_at_least_one_active_admin(cursor)
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="access_role",
                    entity_id=role_code,
                    before_data={**role["data"], "permission_codes": before_permission_codes},
                    after_data={"display_name": display_name, "permission_codes": permission_codes},
                )
    return True


async def _validate_level_selections(cursor, level_refs: list[dict]):
    if not level_refs:
        raise ValueError("Seleccioná al menos un área con un nivel de acceso")
    requested_domains = [item["domain_code"] for item in level_refs]
    if len(requested_domains) != len(set(requested_domains)):
        raise ValueError("Solo se puede seleccionar un nivel por dominio")
    await cursor.execute("SELECT domain_code FROM public.access_domains ORDER BY domain_code")
    expected_domains = {row["domain_code"] for row in await cursor.fetchall()}
    selected_domains = set(requested_domains)
    extra = sorted(selected_domains - expected_domains)
    if extra:
        raise ValueError("Dominios desconocidos: " + ", ".join(extra))
    await cursor.execute(
        """SELECT level.domain_code, level.level_code, level.base_role_code,
                  domain.lifecycle_status AS domain_lifecycle_status,
                  base.lifecycle_status AS base_lifecycle_status,
                  base.role_kind
           FROM public.access_domain_levels level
           JOIN public.access_domains domain USING (domain_code)
           JOIN public.access_roles base ON base.role_code = level.base_role_code"""
    )
    available = {(row["domain_code"], row["level_code"]): row for row in await cursor.fetchall()}
    requested = {(item["domain_code"], item["level_code"]) for item in level_refs}
    missing_levels = sorted(requested - set(available))
    if missing_levels:
        raise ValueError("Niveles desconocidos: " + ", ".join(f"{domain}:{level}" for domain, level in missing_levels))
    if any(available[key]["role_kind"] != "direct" for key in requested):
        raise ValueError("Un nivel debe referenciar un rol base directo")
    lifecycle_status = "planned" if any(
        available[key]["domain_lifecycle_status"] == "planned" or available[key]["base_lifecycle_status"] == "planned"
        for key in requested
    ) else "active"
    return requested, lifecycle_status


async def _find_duplicate_combination(cursor, requested: set[tuple[str, str]], excluded_role_code: str = ""):
    signature = sorted(f"{domain}:{level}" for domain, level in requested)
    await cursor.execute(
        """SELECT selection.custom_role_code AS role_code, role.display_name
           FROM public.access_custom_role_levels selection
           JOIN public.access_roles role ON role.role_code = selection.custom_role_code
           WHERE (%s = '' OR selection.custom_role_code <> %s)
           GROUP BY selection.custom_role_code, role.display_name
           HAVING array_agg(selection.domain_code || ':' || selection.level_code ORDER BY selection.domain_code, selection.level_code) = %s::text[]
           LIMIT 1""",
        (excluded_role_code, excluded_role_code, signature),
    )
    return await cursor.fetchone()


async def create_composite_role(
    pool: AsyncConnectionPool,
    *,
    role_code: str,
    display_name: str,
    description: str,
    level_refs: list[dict],
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # ACCESS-CEILING-001: serialize with every other access
                # mutation before resolving what this actor may delegate.
                await lock_admin_invariant(cursor)
                requested, lifecycle_status = await _validate_level_selections(cursor, level_refs)
                await assert_composite_levels_within_ceiling(cursor, actor_id, level_refs)
                duplicate = await _find_duplicate_combination(cursor, requested)
                await cursor.execute(
                    """INSERT INTO public.access_roles
                       (role_code, display_name, description, domain_code, lifecycle_status, system_managed, role_kind)
                       VALUES (%s, %s, %s, NULL, %s, false, 'composite')""",
                    (role_code, display_name, description, lifecycle_status),
                )
                await cursor.executemany(
                    """INSERT INTO public.access_custom_role_levels
                       (custom_role_code, domain_code, level_code)
                       VALUES (%s, %s, %s)""",
                    [(role_code, item["domain_code"], item["level_code"]) for item in level_refs],
                )
                after_data = {"display_name": display_name, "role_kind": "composite", "level_refs": level_refs}
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="create",
                    entity_type="access_role",
                    entity_id=role_code,
                    after_data=after_data,
                )
    return {"role_code": role_code, "duplicate_of": duplicate}


async def update_composite_role(
    pool: AsyncConnectionPool,
    *,
    role_code: str,
    display_name: str,
    description: str,
    level_refs: list[dict],
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                # IF-002: see update_role's note above.
                await lock_admin_invariant(cursor)
                await cursor.execute(
                    "SELECT to_jsonb(role) AS data, role.role_kind, role.system_managed FROM public.access_roles role WHERE role.role_code = %s FOR UPDATE",
                    (role_code,),
                )
                role = await cursor.fetchone()
                if role is None:
                    return None
                if role["role_kind"] != "composite" or role["system_managed"]:
                    raise ValueError("Solo se pueden editar composiciones de roles custom")
                # IF-004: capture the level selection this composite role
                # actually had before touching it -- to_jsonb(access_roles)
                # never contains access_custom_role_levels rows, so
                # before_data used to be asymmetric with after_data (which
                # always included the new level_refs).
                await cursor.execute(
                    "SELECT domain_code, level_code FROM public.access_custom_role_levels WHERE custom_role_code = %s ORDER BY domain_code, level_code",
                    (role_code,),
                )
                before_level_refs = [{"domain_code": row["domain_code"], "level_code": row["level_code"]} for row in await cursor.fetchall()]
                requested, lifecycle_status = await _validate_level_selections(cursor, level_refs)
                await assert_composite_levels_within_ceiling(cursor, actor_id, level_refs)
                duplicate = await _find_duplicate_combination(cursor, requested, role_code)
                await cursor.execute(
                    "UPDATE public.access_roles SET display_name = %s, description = %s, lifecycle_status = %s WHERE role_code = %s",
                    (display_name, description, lifecycle_status, role_code),
                )
                await cursor.execute("DELETE FROM public.access_custom_role_levels WHERE custom_role_code = %s", (role_code,))
                await cursor.executemany(
                    """INSERT INTO public.access_custom_role_levels
                       (custom_role_code, domain_code, level_code)
                       VALUES (%s, %s, %s)""",
                    [(role_code, item["domain_code"], item["level_code"]) for item in level_refs],
                )
                await assert_at_least_one_active_admin(cursor)
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="access_role",
                    entity_id=role_code,
                    before_data={**role["data"], "role_kind": "composite", "level_refs": before_level_refs},
                    after_data={"display_name": display_name, "role_kind": "composite", "level_refs": level_refs},
                )
    return {"role_code": role_code, "duplicate_of": duplicate}
