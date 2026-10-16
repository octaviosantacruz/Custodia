"""Local credential verification use cases (ARCH-LAYERS-002).

The route owns rate limiting, the security events and the session cookie; this
service owns credential verification and the best-effort hash upgrade. No
account detail is revealed: a missing user and a wrong password are the same
outcome (``None``).
"""

from __future__ import annotations

import logging
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.auth_queries import find_local_user_for_login, update_password_hash_after_rehash
from app.cross.services.password_hashing import needs_rehash, rehash_password_async, verify_password_async

LOGGER = logging.getLogger(__name__)


async def authenticate_local_user(pool: AsyncConnectionPool, email: str, password: str) -> dict[str, Any] | None:
    user = await find_local_user_for_login(pool, email.strip())
    if not user or not await verify_password_async(password, user["password_hash"]):
        return None
    return user


async def upgrade_password_hash_if_needed(pool: AsyncConnectionPool, user: dict[str, Any], password: str) -> None:
    """PENTEST-009: transparently move a legacy scrypt hash (or stale Argon2id
    parameters) to the current one now that the plaintext proved it matches.

    Best effort: a failure must never turn an already-verified login into an
    error; the account keeps its hash and gets another chance on its next login.
    """
    if not needs_rehash(user["password_hash"]):
        return
    try:
        new_hash = await rehash_password_async(password)
        await update_password_hash_after_rehash(pool, user["actor_id"], new_hash)
    except Exception:
        LOGGER.warning("No se pudo migrar el hash de contraseña de %s a Argon2id", user["actor_id"], exc_info=True)


def local_session_payload(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "actor_id": user["actor_id"],
        "name": user["display_name"],
        "email": user["email"],
        "roles": user["roles"] or [],
        "role_names": user.get("role_names") or [],
        "must_change_password": bool(user["must_change_password"]),
        "session_version": user["session_version"],
        "auth_source": "local",
    }
