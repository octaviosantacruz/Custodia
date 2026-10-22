"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.netskope.sse.repositories.netskope_chain_expand import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SEARCH_TYPES,
    expand_netskope_chain_node,
    get_netskope_chain_node,
    search_netskope_chain_nodes,
)
from app.netskope.sse.repositories.netskope_dlp_queries import (
    get_netskope_dlp_capture_state,
    get_netskope_dlp_policies,
    list_netskope_dlp_alerts,
)
from app.netskope.sse.repositories.netskope_experience import (
    get_experience_user,
    list_user_inventory_device_names,
)
from app.netskope.sse.repositories.netskope_cross_metrics import list_retired_users_with_device_activity
from app.netskope.sse.repositories.netskope_queries import (
    DEVICE_FRESHNESS_DEFAULT,
    get_netskope_alert_aggregates,
    get_netskope_client_compliance,
    get_netskope_client_events,
    get_netskope_device_changes,
    get_netskope_device_facets,
    get_netskope_device_freshness,
    get_netskope_device_history,
    get_netskope_duplicates,
    get_netskope_fleet,
    get_netskope_metrics,
    list_netskope_dem_sites,
    list_netskope_group_members,
    list_netskope_groups,
    list_netskope_policy_groups,
    list_netskope_objects,
    parse_version,
)
from app.netskope.sse.repositories.netskope_fleet_groups import GROUP_EXPRESSIONS as FLEET_GROUPS, get_netskope_fleet_groups
from app.netskope.sse.repositories.netskope_presence import get_netskope_presence, get_users_presence
from app.netskope.sse.repositories.netskope_shared import (
    get_netskope_source_evidence,
)
from app.netskope.sse.repositories.netskope_admins import (
    get_netskope_admin_role,
    list_netskope_admin_roles,
    list_netskope_admins,
)
from app.netskope.sse.repositories.netskope_uci import (
    list_netskope_user_uci,
    uci_by_company,
)

__all__ = [
    "get_netskope_admin_role",
    "list_netskope_admin_roles",
    "list_netskope_admins",
    "DEFAULT_LIMIT",
    "DEVICE_FRESHNESS_DEFAULT",
    "MAX_LIMIT",
    "SEARCH_TYPES",
    "expand_netskope_chain_node",
    "get_experience_user",
    "list_user_inventory_device_names",
    "get_netskope_alert_aggregates",
    "get_netskope_chain_node",
    "get_netskope_client_compliance",
    "get_netskope_client_events",
    "get_netskope_device_changes",
    "get_netskope_device_facets",
    "get_netskope_device_freshness",
    "get_netskope_device_history",
    "get_netskope_dlp_capture_state",
    "get_netskope_dlp_policies",
    "get_netskope_duplicates",
    "FLEET_GROUPS",
    "get_netskope_fleet",
    "get_netskope_fleet_groups",
    "get_netskope_metrics",
    "get_netskope_presence",
    "get_users_presence",
    "get_netskope_source_evidence",
    "list_netskope_dem_sites",
    "list_netskope_dlp_alerts",
    "list_netskope_group_members",
    "list_netskope_groups",
    "list_netskope_policy_groups",
    "list_netskope_objects",
    "list_retired_users_with_device_activity",
    "list_netskope_user_uci",
    "uci_by_company",
    "parse_version",
    "search_netskope_chain_nodes",
]
