"""ACCESS-UI-001 phase 2: the Okta group -> DS Hub role mapping kept in PostgreSQL.

`access_oidc_mapping_state` says whether the mapping is managed here. Without
that row the login keeps reading OIDC_ROLE_MAP_JSON; the first edit adopts the
environment mapping and the edit itself in one transaction, so no group is lost
on the switch. Every edit takes the admin-invariant lock and checks the
delegation ceiling for the roles it adds or removes, like any role assignment.
"""

from typing import Any

from app.cross.repositories.access_delegation import assert_role_assignment_ceiling
from app.cross.repositories.admin_invariant import lock_admin_invariant
from app.cross.repositories.audit import record_audit
from app.db import fetch_all, fetch_one


class UnknownMappedRoleError(ValueError):
    """A mapping names a role that is not in the catalog."""


async def stored_group_role_pairs(pool: Any) -> list[tuple[str, str]] | None:
    """The stored pairs, or None while the mapping is still read from the environment."""
    state = await fetch_one(pool, "SELECT managed_since FROM public.access_oidc_mapping_state WHERE singleton")
    if state is None:
        return None
    rows = await fetch_all(pool, "SELECT group_name, role_code FROM public.access_oidc_group_roles ORDER BY group_name, role_code")
    return [(row["group_name"], row["role_code"]) for row in rows]


async def _group_roles(cursor, group: str) -> list[str]:
    await cursor.execute(
        "SELECT role_code FROM public.access_oidc_group_roles WHERE group_name = %s ORDER BY role_code", (group,),
    )
    return [row["role_code"] for row in await cursor.fetchall()]


async def _assert_roles_exist(cursor, role_codes: set[str]) -> None:
    if not role_codes:
        return
    await cursor.execute("SELECT role_code FROM public.access_roles WHERE role_code = ANY(%s)", (sorted(role_codes),))
    known = {row["role_code"] for row in await cursor.fetchall()}
    missing = sorted(role_codes - known)
    if missing:
        raise UnknownMappedRoleError("Rol inexistente: " + ", ".join(missing))


async def set_group_roles(
    pool: Any, group: str, role_codes: list[str], actor_id: str, environment_pairs: list[tuple[str, str]],
) -> list[str]:
    """Replace the roles one group grants; an empty list removes the group."""
    requested = sorted(set(role_codes))
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await lock_admin_invariant(cursor)
                await cursor.execute("SELECT 1 AS present FROM public.access_oidc_mapping_state WHERE singleton FOR UPDATE")
                if await cursor.fetchone() is None:
                    adopted = sorted({pair for pair in environment_pairs})
                    await _assert_roles_exist(cursor, {role for _, role in adopted})
                    await cursor.executemany(
                        "INSERT INTO public.access_oidc_group_roles (group_name, role_code, granted_by) VALUES (%s, %s, 'environment') ON CONFLICT DO NOTHING",
                        adopted,
                    )
                    await cursor.execute("INSERT INTO public.access_oidc_mapping_state (managed_by) VALUES (%s)", (actor_id,))
                    await record_audit(
                        pool, connection=conn, actor_id=actor_id, action="oidc_mapping_adopted", entity_type="oidc_mapping",
                        entity_id="okta", after_data={"pairs": [{"group": group_name, "role_code": role} for group_name, role in adopted]},
                    )
                await _assert_roles_exist(cursor, set(requested))
                before = await _group_roles(cursor, group)
                for role_code in sorted(set(requested) ^ set(before)):
                    await assert_role_assignment_ceiling(cursor, actor_id, role_code)
                if before == requested:
                    return requested
                await cursor.execute("DELETE FROM public.access_oidc_group_roles WHERE group_name = %s", (group,))
                await cursor.executemany(
                    "INSERT INTO public.access_oidc_group_roles (group_name, role_code, granted_by) VALUES (%s, %s, %s)",
                    [(group, role_code, actor_id) for role_code in requested],
                )
                await record_audit(
                    pool, connection=conn, actor_id=actor_id, action="oidc_group_roles_update", entity_type="oidc_group",
                    entity_id=group, before_data={"roles": before}, after_data={"roles": requested},
                )
    return requested
