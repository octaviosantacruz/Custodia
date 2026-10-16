"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cyberark.pam.repositories.account_queries import (
    export_accounts,
    get_account_management_summary,
    get_account_platform_coverage,
)
from app.cyberark.pam.repositories.analytics import (
    get_access_concentration,
    get_analytics,
    get_inventory_freshness,
    get_summary,
)
from app.cyberark.pam.repositories.license_reconciliation import (
    get_standard_seat_reconciliation,
)
from app.cyberark.pam.repositories.pam_chain_expand import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SEARCH_TYPES,
    expand_chain_node,
    get_chain_node,
    search_chain_nodes,
)
from app.cyberark.pam.repositories.pam_chain_queries import (
    get_pam_user_chain,
    list_pam_components,
    list_pam_connectors,
    list_pam_platforms,
    list_pam_users,
    list_platform_catalogs,
    list_platform_targets,
    list_psm_connector_types,
)
from app.cyberark.pam.repositories.pam_cleanup_queries import (
    get_pam_cleanup_signals,
)
from app.cyberark.pam.repositories.pam_role_queries import (
    get_pam_role_detail,
    list_pam_roles,
)
from app.cyberark.pam.repositories.safes import (
    export_safes,
    get_safe_accounts,
    get_safe_detail,
    list_accounts,
    list_safes,
)

__all__ = [
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
    "SEARCH_TYPES",
    "expand_chain_node",
    "export_accounts",
    "export_safes",
    "get_access_concentration",
    "get_account_management_summary",
    "get_account_platform_coverage",
    "get_analytics",
    "get_chain_node",
    "get_inventory_freshness",
    "get_pam_cleanup_signals",
    "get_pam_role_detail",
    "get_pam_user_chain",
    "get_safe_accounts",
    "get_safe_detail",
    "get_standard_seat_reconciliation",
    "get_summary",
    "list_accounts",
    "list_pam_components",
    "list_pam_connectors",
    "list_pam_platforms",
    "list_pam_roles",
    "list_pam_users",
    "list_platform_catalogs",
    "list_platform_targets",
    "list_psm_connector_types",
    "list_safes",
    "search_chain_nodes",
]
