"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cyberark.identity_administration.repositories.identity_admin_queries import (
    get_identity_federation_detail,
    get_identity_membership_data,
    get_identity_role_detail,
    get_identity_role_review_data,
    get_identity_user_detail,
    list_active_identity_federations_for_resolution,
    list_identity_federations,
    list_identity_roles,
    list_identity_users,
)

__all__ = [
    "get_identity_federation_detail",
    "get_identity_membership_data",
    "get_identity_role_detail",
    "get_identity_role_review_data",
    "get_identity_user_detail",
    "list_active_identity_federations_for_resolution",
    "list_identity_federations",
    "list_identity_roles",
    "list_identity_users",
]
