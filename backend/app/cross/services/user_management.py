"""Local user administration use cases (ARCH-LAYERS-002).

The routes call these functions instead of ``cross/repositories``. Persistence
failures that carry a domain meaning are translated here (duplicate email,
unknown role, last-admin lockout); the route only maps them to HTTP statuses.
Audit rows and transactions stay in the repositories.
"""

from __future__ import annotations

import os
import secrets
from typing import Any

from psycopg.errors import UniqueViolation
from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.access_control import role_exists, role_grants_permission
from app.cross.repositories.access_delegation import DelegationCeilingError
from app.cross.repositories.oidc_groups import observed_groups_for_identities
from app.cross.services.password_hashing import hash_password_async
from app.cross.repositories.user_admin import (
    InvalidUserPassword,
    create_user,
    OidcManagedRoleError,
    delete_user,
    grant_user_role,
    list_access_review,
    list_people,
    list_users,
    reissue_temporary_password,
    revoke_user_role,
    set_automation_access,
    update_user,
)

__all__ = [
    "DelegationCeilingError",
    "DuplicateUserError",
    "InvalidUserPassword",
    "OidcManagedRoleError",
    "SelfRoleChangeError",
    "assign_role",
    "SelfAdminLockoutError",
    "UnknownRoleError",
    "find_people",
    "review_access",
    "find_users",
    "register_user",
    "modify_user",
    "remove_user",
    "reissue_password",
    "close_automation_access",
    "open_automation_access",
    "unassign_role",
]

# ``actor_id`` is the lowercased email (user_admin.create_user), so either the
# primary key or the case-insensitive email index can be the one that fires.
_DUPLICATE_USER_CONSTRAINTS = {"access_users_pkey", "uq_access_users_email_lower"}


class UnknownRoleError(Exception):
    """The role code does not exist in the access catalog."""


class DuplicateUserError(Exception):
    """A user with that email is already registered."""


class SelfRoleChangeError(Exception):
    """An actor never adds or removes their own roles (no self-escalation)."""


class SelfAdminLockoutError(Exception):
    """The actor tried to drop the role that grants ``access:manage`` from themselves."""


async def find_users(pool: AsyncConnectionPool, q: str, role: str, status: str, limit: int, offset: int) -> Any:
    return await list_users(pool, q, role, status, limit, offset)


async def review_access(pool: AsyncConnectionPool, q: str, flag: str, days: int, limit: int, offset: int) -> Any:
    return await list_access_review(pool, q, flag, days, limit, offset)


async def find_people(pool: AsyncConnectionPool, q: str, role: str, status: str, limit: int, offset: int, *, include_oidc_groups: bool = False) -> Any:
    result = await list_people(pool, q, role, status, limit, offset)
    if include_oidc_groups:
        identities = [identity for person in result["rows"] for identity in person["identities"] if identity["auth_source"] == "oidc"]
        observations = await observed_groups_for_identities(
            pool, issuer=os.environ.get("OIDC_ISSUER_URL", "").strip(),
            actor_ids=[identity["actor_id"] for identity in identities],
        )
        by_actor = {row["actor_id"]: row for row in observations}
        for identity in identities:
            observation = by_actor.get(identity["actor_id"], {})
            identity.update({key: observation.get(key) for key in ("observed_groups", "groups_observed_at", "role_group_sources")})
    return result


async def register_user(
    pool: AsyncConnectionPool, email: str, display_name: str, role_code: str, actor_id: str,
) -> tuple[str, str]:
    """Create a local user; returns ``(user_id, temporary_password)``."""
    if not await role_exists(pool, role_code):
        raise UnknownRoleError(role_code)
    try:
        return await create_user(pool, email, display_name, role_code, actor_id)
    except UniqueViolation as exc:
        # IF-021: matched on the driver's SQLSTATE and the specific
        # constraints of this table, never on the text of the exception.
        if getattr(exc.diag, "constraint_name", None) in _DUPLICATE_USER_CONSTRAINTS:
            raise DuplicateUserError from exc
        raise


async def modify_user(
    pool: AsyncConnectionPool,
    user_id: str,
    display_name: str | None,
    is_active: bool | None,
    role_code: str | None,
    password: str | None,
    actor_id: str,
) -> bool:
    if role_code is not None:
        if user_id == actor_id and not await role_grants_permission(pool, role_code, "access:manage"):
            raise SelfAdminLockoutError
        if not await role_exists(pool, role_code):
            raise UnknownRoleError(role_code)
    return await update_user(pool, user_id, display_name, is_active, role_code, password, actor_id)


async def reissue_password(pool: AsyncConnectionPool, user_id: str, actor_id: str) -> str | None:
    return await reissue_temporary_password(pool, user_id, actor_id)


async def _automation_access(pool: AsyncConnectionPool, user_id: str, active: bool, actor_id: str) -> str | None:
    password = secrets.token_urlsafe(32)
    password_hash = await hash_password_async(password)
    if not await set_automation_access(pool, user_id.strip().lower(), password_hash, active, actor_id):
        return None
    return password


async def open_automation_access(pool: AsyncConnectionPool, user_id: str, actor_id: str) -> str | None:
    """AUTH-AGENT-001: activate the automation account with a fresh credential only a tool will hold.

    ``None`` if the local account does not exist. Unlike ``reissue_password`` nobody reads it on
    screen, so it skips the first-login change."""
    return await _automation_access(pool, user_id, True, actor_id)


async def close_automation_access(pool: AsyncConnectionPool, user_id: str, actor_id: str) -> bool:
    """Deactivate it behind a credential nobody keeps; raises ValueError if no administrator would remain."""
    return await _automation_access(pool, user_id, False, actor_id) is not None


async def remove_user(pool: AsyncConnectionPool, user_id: str, actor_id: str) -> bool:
    return await delete_user(pool, user_id, actor_id)


async def assign_role(pool: AsyncConnectionPool, user_id: str, role_code: str, actor_id: str) -> bool | None:
    """ACCESS-UI-001: add a Custodia role to a local or OIDC identity."""
    if user_id == actor_id:
        raise SelfRoleChangeError
    if not await role_exists(pool, role_code):
        raise UnknownRoleError(role_code)
    return await grant_user_role(pool, user_id, role_code, actor_id)


async def unassign_role(pool: AsyncConnectionPool, user_id: str, role_code: str, actor_id: str) -> bool:
    """ACCESS-UI-001: remove a Custodia role; OIDC-mapped roles change only in the provider."""
    if user_id == actor_id:
        raise SelfRoleChangeError
    return await revoke_user_role(pool, user_id, role_code, actor_id)
