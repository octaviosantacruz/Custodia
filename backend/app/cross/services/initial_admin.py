"""First-administrator use cases (ARCH-LAYERS-002).

Two sanctioned paths create the very first admin: self-registration (closed by
default, PENTEST-001) and the token bootstrap. The route owns the gating
(feature flags, bootstrap token, rate limit, security events and the session);
this service owns what happens once the request is allowed: normalizing the
identity, hashing the password and the "only while no user exists" rule.
"""

from __future__ import annotations

from typing import Any

from app.cross.repositories.auth_queries import (
    FirstUserAlreadyExists,
    count_local_users,
    create_bootstrap_admin,
    create_first_local_admin,
)
from app.cross.services.password_hashing import hash_password_async


class InitialAdminAlreadyExistsError(Exception):
    """The initial administrator was already created."""


class InvalidInitialAdminError(ValueError):
    """The submitted identity is not usable (the message is safe to show)."""


async def register_first_admin(pool: Any, email: str, display_name: str, password: str) -> str:
    """Self-registration: succeeds only for the very first account (advisory-locked)."""
    password_hash = await hash_password_async(password)  # ValueError: password policy
    actor_id = email.strip().lower()
    if not actor_id:
        raise InvalidInitialAdminError("El email es obligatorio")
    try:
        await create_first_local_admin(pool, actor_id, display_name.strip(), password_hash)
    except FirstUserAlreadyExists as exc:
        raise InitialAdminAlreadyExistsError(str(exc)) from exc
    return actor_id


async def bootstrap_first_admin(pool: Any, email: str, display_name: str, password: str) -> str:
    """Token bootstrap: the caller already proved the shared secret."""
    if await count_local_users(pool) > 0:
        raise InitialAdminAlreadyExistsError("El administrador inicial ya fue creado")
    password_hash = await hash_password_async(password)  # ValueError: password policy
    actor_id = email.strip().lower()
    await create_bootstrap_admin(pool, actor_id, display_name.strip(), password_hash)
    return actor_id
