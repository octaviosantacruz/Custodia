"""Read-only queries for the isolated Netskope CMDB inventory.

Public facade: the implementation lives in ``netskope_shared`` (constants and
helpers), ``netskope_metrics``, ``netskope_inventory`` and
``netskope_compliance``. Existing importers keep using this module.

Individual DLP incident/event investigation is deliberately out of scope (see
``docs/architecture/integration-contracts.md``): only the count-only alert
aggregates in ``netskope_metrics`` remain approved.
"""

from app.netskope.sse.repositories.netskope_compliance import (
    CLIENT_COMPLIANCE_BUCKETS, OS_COMPLIANCE_BUCKETS,
    get_netskope_client_compliance, get_netskope_fleet,
)
from app.netskope.sse.repositories.netskope_dem_sites import list_netskope_dem_sites
from app.netskope.sse.repositories.netskope_groups import (
    list_netskope_group_members, list_netskope_groups, list_netskope_policy_groups,
)
from app.netskope.sse.repositories.netskope_inventory import (
    DEVICE_CHANGE_TYPES, DUPLICATE_KEYS, LISTABLE_DEVICE_CHANGES,
    get_netskope_client_events, get_netskope_device_changes,
    get_netskope_device_facets, get_netskope_device_freshness,
    get_netskope_device_history, get_netskope_duplicates, list_netskope_objects,
)
from app.netskope.sse.repositories.netskope_metrics import get_netskope_alert_aggregates, get_netskope_metrics
from app.netskope.sse.repositories.netskope_shared import (
    COVERAGE_RISK_EVENTS, DEVICE_COMPANY, DEVICE_FILTER_EXPRESSIONS,
    DEVICE_FRESHNESS_DEFAULT, DEVICE_FRESHNESS_VALUES, EVENT_AGE_BUCKETS,
    EVENT_AGE_THRESHOLDS, FACET_KEYS, FACET_LIMIT, MISSING_VALUE,
    RECENT_DEVICE_CONDITION, SOURCE_SYSTEM, _baseline_value, _bucket,
    _event_age_case, _numeric_version, _version_key, parse_version,
)

# Public facade: every imported name is re-exported on purpose so existing
# importers keep using this module; declared here so the linter understands.
__all__ = [
    "CLIENT_COMPLIANCE_BUCKETS",
    "OS_COMPLIANCE_BUCKETS",
    "get_netskope_client_compliance",
    "get_netskope_fleet",
    "list_netskope_dem_sites",
    "list_netskope_group_members",
    "list_netskope_groups",
    "list_netskope_policy_groups",
    "DEVICE_CHANGE_TYPES",
    "DUPLICATE_KEYS",
    "LISTABLE_DEVICE_CHANGES",
    "get_netskope_client_events",
    "get_netskope_device_changes",
    "get_netskope_device_facets",
    "get_netskope_device_freshness",
    "get_netskope_device_history",
    "get_netskope_duplicates",
    "list_netskope_objects",
    "get_netskope_alert_aggregates",
    "get_netskope_metrics",
    "COVERAGE_RISK_EVENTS",
    "DEVICE_COMPANY",
    "DEVICE_FILTER_EXPRESSIONS",
    "DEVICE_FRESHNESS_DEFAULT",
    "DEVICE_FRESHNESS_VALUES",
    "EVENT_AGE_BUCKETS",
    "EVENT_AGE_THRESHOLDS",
    "FACET_KEYS",
    "FACET_LIMIT",
    "MISSING_VALUE",
    "RECENT_DEVICE_CONDITION",
    "SOURCE_SYSTEM",
    "_baseline_value",
    "_bucket",
    "_event_age_case",
    "_numeric_version",
    "_version_key",
    "parse_version",
]
