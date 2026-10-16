"""Session user resolution for ``/api/auth/status`` (ARCH-LAYERS-002).

Combines what the session carries with what the directory knows now (roles,
must-change-password) so a role change shows up without a new login.
"""

from __future__ import annotations

from typing import Any

from app.cross.repositories.auth_queries import get_local_account_status, get_role_assignment_names


async def refresh_session_user(
    pool: Any, actor_id: str | None, user: dict[str, Any] | None, *, local_auth_enabled: bool,
) -> tuple[dict[str, Any] | None, bool]:
    """Return ``(user, persist)``; ``persist`` means the session must store ``user``."""
    persist = False
    if actor_id and local_auth_enabled:
        account = await get_local_account_status(pool, actor_id)
        if account:
            user = {
                **(user or {}),
                "roles": account["roles"] or [],
                "role_names": account.get("role_names") or [],
                "must_change_password": bool(account["must_change_password"]),
            }
            persist = True
    if actor_id and user and (not local_auth_enabled or "roles" not in user or "role_names" not in user):
        assignments = await get_role_assignment_names(pool, actor_id)
        user = {**user, "roles": assignments["roles"], "role_names": assignments["role_names"]}
    return user, persist
