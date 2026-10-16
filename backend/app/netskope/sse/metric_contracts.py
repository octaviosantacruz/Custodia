"""SSE metric contracts. Discovery candidates never change these bindings.

Adapters describe the existing API projection, not new SQL or a cross-vendor
query engine. The registry governs preferences and exposes their semantics.
"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal


DEVICE_FILTERS = ("os", "company", "classification_status")
USER_FILTERS = ("company",)


@dataclass(frozen=True)
class MetricAdapter:
    source: Literal["inventory_sql", "alert_snapshot", "advanced_analytics"]
    endpoint: str
    fields: tuple[str, ...]
    observed_at: str | None = None
    captured_at: str | None = None
    queried_at: str | None = None
    window_start: str | None = None
    window_end: str | None = None


@dataclass(frozen=True)
class MetricContract:
    id: str
    kind: Literal["data", "chart"]
    adapter: MetricAdapter
    scope: str
    grain: str
    unit: str
    filter_keys: tuple[str, ...]
    windows_days: tuple[int, ...]
    denominator: str | None
    top_n: int | None = None
    drill: bool = True
    version: int = 1
    permission: str = "netskope:read"
    timezone: str = "UTC"


def _inventory(widget, kind, scope, grain, unit, filters, denominator, *, fields=None, windows=(), top_n=None):
    return MetricContract(
        widget, kind, MetricAdapter("inventory_sql", "/api/cmdb/netskope/metrics", fields or (widget,),
                                   observed_at="last_observed_at"),
        scope, grain, unit, filters, windows, denominator, top_n,
    )


def _devices(widget, kind="data", *, grain="device", top_n=None):
    return _inventory(widget, kind, "active_devices_with_event_in_7_days", grain,
                      "devices", DEVICE_FILTERS, "devices_total", windows=(7,), top_n=top_n)


def _users(widget, kind="data", *, scope="active_users", grain="user", fields=None, windows=(), top_n=None):
    return _inventory(widget, kind, scope, grain, "users", USER_FILTERS,
                      "users_total", fields=fields, windows=windows, top_n=top_n)


def _alerts(widget, kind, field, windows, grain, top_n=None):
    return MetricContract(
        widget, kind, MetricAdapter("alert_snapshot", "/api/cmdb/netskope/alerts", (field,),
                                   captured_at="captured_at", window_start="window_start", window_end="window_end"),
        "all_alert_types_in_completed_snapshot", grain, "alerts", (), windows, "total", top_n, drill=False,
    )


_CONTRACTS = (
    _users("users_total"),
    _users("users_recent_activity", scope="active_users_with_exact_matched_device_event_in_selected_window",
           fields=("users_with_device_activity_7d", "users_with_device_activity_14d", "users_with_device_activity_30d"),
           windows=(7, 14, 30)),
    _devices("devices_total"),
    _inventory("devices_stale_30d", "data", "active_devices_with_last_event_older_than_30_days", "device",
               "devices", DEVICE_FILTERS, None),
    _devices("devices_with_observed_user"),
    _devices("devices_observed_user_matched"),
    _devices("devices_observed_user_unmatched"),
    _users("users_without_observed_devices", scope="active_users_without_exact_matched_device_in_active_inventory"),
    _alerts("alerts_7d", "data", "total", (7,), "alert"),
    _alerts("alerts_30d", "data", "total", (30,), "alert"),
    _alerts("alerts_90d", "data", "total", (90,), "alert"),
    _devices("devices_by_os", "chart", grain="operating_system", top_n=8),
    _devices("devices_by_client", "chart", grain="client_version", top_n=8),
    _devices("devices_by_make", "chart", grain="manufacturer", top_n=8),
    _devices("devices_by_classification", "chart", grain="classification", top_n=8),
    _devices("devices_by_user_status", "chart", grain="reported_user_status", top_n=8),
    _devices("devices_by_company", "chart", grain="reported_company_or_email_domain", top_n=40),
    _users("users_by_company", "chart", grain="email_domain", top_n=40),
    _devices("devices_by_observed_user_status", "chart", grain="exact_identity_match_status"),
    _users("users_by_device_count", "chart", grain="matched_device_count_0_1_2plus"),
    _inventory("users_by_recent_device_age", "chart", "active_users_with_exact_matched_device_in_active_inventory",
               "newest_matched_device_event_age", "users", USER_FILTERS, "sum(users_by_recent_device_age.count)"),
    _inventory("coverage_risk_devices_by_user", "chart", "active_devices_with_last_event_uninstall_or_admin_disabled_and_exact_user",
               "resolved_user", "devices", DEVICE_FILTERS, "devices_active_total", top_n=10),
    MetricContract("alerts_by_severity", "chart",
                   MetricAdapter("advanced_analytics", "/api/cmdb/netskope/aa/severity", ("buckets",),
                                 queried_at="fetched_at"),
                   "requires_approved_binding", "one_row_per_severity", "requires_approved_binding",
                   (), (), "total", drill=False),
)
METRIC_CONTRACTS = MappingProxyType({contract.id: contract for contract in _CONTRACTS})
DATA_WIDGETS = frozenset(contract.id for contract in _CONTRACTS if contract.kind == "data")
CHART_WIDGETS = frozenset(contract.id for contract in _CONTRACTS if contract.kind == "chart")


def inventory_metric_fields(widgets: list[str]) -> frozenset[str]:
    """Resolve an explicit inventory selection, including its denominators."""
    if not widgets or len(widgets) > len(METRIC_CONTRACTS):
        raise ValueError(f"La selección debe contener entre 1 y {len(METRIC_CONTRACTS)} widgets Netskope")
    fields: set[str] = set()
    for widget in widgets:
        contract = METRIC_CONTRACTS.get(widget)
        if contract is None or contract.adapter.source != "inventory_sql":
            raise ValueError(f"Widget de inventario Netskope no soportado: {widget}")
        fields.update(contract.adapter.fields)
        # The users-total card includes the recent-activity count in its
        # existing explanatory text, even when that separate card is absent.
        if widget == "users_total":
            fields.add("users_with_device_activity_7d")
        if contract.denominator and not contract.denominator.startswith("sum("):
            fields.add(contract.denominator)
    return frozenset(fields)



def widget_filter_keys(widget_id: str) -> tuple[str, ...]:
    """Dynamic AA charts take no dashboard filters."""
    contract = METRIC_CONTRACTS.get(widget_id)
    return contract.filter_keys if contract else ()
