"""Access catalog use cases: permissions, roles and composite roles (ARCH-LAYERS-002).

Routes call these functions instead of ``cross/repositories``. Duplicate-key
failures become domain errors here so the route only maps them to HTTP. Audit
rows and transactions stay in the repositories.
"""

from __future__ import annotations

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.access_control import (
    create_composite_role,
    create_permission,
    create_role,
    list_domain_levels,
    list_permissions,
    list_roles,
    update_composite_role,
    update_role,
)
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.cross.repositories.oidc_group_roles import UnknownMappedRoleError, set_group_roles
from app.cross.services.oidc_mapping import effective_role_pairs, environment_role_pairs

__all__ = [
    "DelegationCeilingError",
    "DuplicatePermissionError",
    "DuplicateRoleError",
    "UnknownMappedRoleError",
    "add_composite_role",
    "add_permission",
    "add_role",
    "change_composite_role",
    "change_oidc_group_roles",
    "change_role",
    "permission_catalog",
    "domain_catalog",
    "role_catalog",
]


class DuplicateRoleError(Exception):
    """A role with that code already exists."""


class DuplicatePermissionError(Exception):
    """A permission with that code already exists."""


def _is_duplicate_key(exc: Exception) -> bool:
    return "duplicate key" in str(exc).lower()


async def permission_catalog(pool: AsyncConnectionPool) -> list[dict]:
    return await list_permissions(pool)


async def domain_catalog(pool: AsyncConnectionPool) -> list[dict]:
    return await list_domain_levels(pool)


async def role_catalog(pool: AsyncConnectionPool, *, include_oidc_groups: bool) -> list[dict]:
    """Roles with the OIDC groups mapped to each one (empty unless allowed)."""
    groups_by_role: dict[str, list[str]] = {}
    if include_oidc_groups:
        pairs, _source = await effective_role_pairs(pool)
        for group, role_code in pairs:
            groups_by_role.setdefault(role_code, []).append(group)
    return [
        {**role, "oidc_groups": sorted(groups_by_role.get(role["role_code"], [])) if include_oidc_groups else []}
        for role in await list_roles(pool)
    ]


async def add_permission(pool: AsyncConnectionPool, *, actor_id: str, **fields: Any) -> str:
    try:
        return await create_permission(pool, **fields, actor_id=actor_id)
    except ValueError:
        raise
    except Exception as exc:
        if _is_duplicate_key(exc):
            raise DuplicatePermissionError from exc
        raise


async def add_role(pool: AsyncConnectionPool, *, actor_id: str, **fields: Any) -> str:
    try:
        return await create_role(pool, **fields, actor_id=actor_id)
    except (DelegationCeilingError, ValueError):
        raise
    except Exception as exc:
        if _is_duplicate_key(exc):
            raise DuplicateRoleError from exc
        raise


async def change_role(pool: AsyncConnectionPool, *, role_code: str, actor_id: str, **fields: Any) -> bool:
    return await update_role(pool, role_code=role_code, **fields, actor_id=actor_id)


async def add_composite_role(
    pool: AsyncConnectionPool, *, role_code: str, display_name: str, description: str,
    level_refs: list[dict], actor_id: str,
) -> dict:
    try:
        return await create_composite_role(
            pool, role_code=role_code, display_name=display_name, description=description,
            level_refs=level_refs, actor_id=actor_id,
        )
    except (DelegationCeilingError, ValueError):
        raise
    except Exception as exc:
        if _is_duplicate_key(exc):
            raise DuplicateRoleError from exc
        raise


async def change_composite_role(
    pool: AsyncConnectionPool, *, role_code: str, display_name: str, description: str,
    level_refs: list[dict], actor_id: str,
) -> dict | None:
    return await update_composite_role(
        pool, role_code=role_code, display_name=display_name, description=description,
        level_refs=level_refs, actor_id=actor_id,
    )


async def change_oidc_group_roles(pool: AsyncConnectionPool, group: str, role_codes: list[str], actor_id: str) -> list[str]:
    """ACCESS-UI-001 phase 2: replace the roles one Okta group grants (empty removes the group).

    The first edit adopts OIDC_ROLE_MAP_JSON so no group is lost on the switch.
    Takes effect at each member's next login.
    """
    return await set_group_roles(pool, group.strip(), role_codes, actor_id, environment_role_pairs())
