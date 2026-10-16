"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cyberark.sia.repositories.sia_queries import (
    get_sia_policy_detail,
    list_sia_connectors,
    list_sia_database_accounts,
    list_sia_destinations,
    list_sia_policies,
    list_sia_resources,
    list_sia_target_sets,
)

__all__ = [
    "get_sia_policy_detail",
    "list_sia_connectors",
    "list_sia_database_accounts",
    "list_sia_destinations",
    "list_sia_policies",
    "list_sia_resources",
    "list_sia_target_sets",
]
