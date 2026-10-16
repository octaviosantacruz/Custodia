"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from app.cross.repositories.cmdb import (
    get_cmdb_coverage,
)
from app.cross.repositories.connection_inventory import (
    get_coverage_progress,
    list_stale_destinations,
    list_uninventoried_addresses,
    list_coverage_series,
    save_coverage_snapshot,
    connection_history as destination_history,
    get_capability_deviations,
    get_connection_coverage,
    list_connection_inventory,
)
from app.cross.repositories.identity_pam_bridge import (
    annotate_identity_standard_seats,
    get_identity_user_pam_chain,
    list_standard_seat_emails,
)
from app.cross.repositories.person_chain_queries import (
    get_person_summary,
    search_person_candidates,
)
from app.cross.repositories.search import (
    search_inventory,
)
from app.cross.repositories.sia_person_links import (
    resolve_sia_policy_grantees,
)

__all__ = [
    "get_coverage_progress",
    "list_stale_destinations",
    "list_uninventoried_addresses",
    "list_coverage_series",
    "save_coverage_snapshot",
    "destination_history",
    "get_capability_deviations",
    "annotate_identity_standard_seats",
    "get_cmdb_coverage",
    "get_connection_coverage",
    "get_identity_user_pam_chain",
    "get_person_summary",
    "list_connection_inventory",
    "list_standard_seat_emails",
    "resolve_sia_policy_grantees",
    "search_inventory",
    "search_person_candidates",
]
