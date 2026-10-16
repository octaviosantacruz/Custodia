"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cross.repositories.api_tokens import (
    TooManyActiveApiTokens,
    create_api_token,
    list_api_tokens,
    revoke_api_token,
)
from app.cross.repositories.auth_queries import (
    FirstUserAlreadyExists,
    count_local_users,
    create_bootstrap_admin,
    create_first_local_admin,
    find_local_user_for_login,
    get_actor_permissions,
    get_local_account_status,
    get_role_assignment_names,
    update_password_hash_after_rehash,
)
from app.cross.repositories.user_admin import (
    InvalidCurrentPassword,
    InvalidUserPassword,
    change_own_password,
    update_own_profile,
)

__all__ = [
    "FirstUserAlreadyExists",
    "InvalidCurrentPassword",
    "InvalidUserPassword",
    "TooManyActiveApiTokens",
    "change_own_password",
    "count_local_users",
    "create_api_token",
    "create_bootstrap_admin",
    "create_first_local_admin",
    "find_local_user_for_login",
    "get_actor_permissions",
    "get_local_account_status",
    "get_role_assignment_names",
    "list_api_tokens",
    "revoke_api_token",
    "update_own_profile",
    "update_password_hash_after_rehash",
]
