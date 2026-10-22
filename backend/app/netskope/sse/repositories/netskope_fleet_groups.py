"""NSK-FLEET-001: one grouped reading of the fleet for the Equipos view.

Every group counts the inventory default population (active devices with an event in the last 7 days),
so a cell equals the list its drill opens. Client and OS compliance reuse the inventory filter cases;
without a baseline the column is not evaluated (None), never zero.
"""

from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.netskope.sse.repositories.netskope_compliance import (
    _client_compliance_case, _golden_params, _os_compliance_case,
)
from app.netskope.sse.repositories.netskope_shared import (
    DEVICE_COMPANY, DEVICE_FILTER_EXPRESSIONS, RECENT_DEVICE_CONDITION, SOURCE_SYSTEM, UCI_RATING_SQL,
    _baseline_value, _bucket, _event_age_case,
)

GROUP_LIMIT = 15
# Allowlist: public group key -> trusted SQL expression (also the inventory filter of the same name).
GROUP_EXPRESSIONS = {
    "company": DEVICE_COMPANY,
    "os": DEVICE_FILTER_EXPRESSIONS["os"],
    "client_config": "attributes->>'client_config'",
    "device_make": DEVICE_FILTER_EXPRESSIONS["device_make"],
    "onprem_status": DEVICE_FILTER_EXPRESSIONS["onprem_status"],
    "uci_rating": UCI_RATING_SQL,
}
COUNT_FIELDS = (
    "devices", "signal_24h", "client_current", "client_evaluated",
    # Golden-release severity: one release behind vs two or more (same buckets as the inventory filter).
    "client_one_behind", "client_two_plus_behind",
    "os_supported", "os_evaluated", "on_prem", "location_reported",
    # NSK-EXP-UCI-001: users with a Poor / Moderate UCI, the devices where the UCI is known at all, and the
    # office devices of users rated Poor (the crossing the inventory shortcut opens).
    "uci_low", "uci_moderate", "uci_evaluated", "on_prem_uci_low",
)


async def get_netskope_fleet_groups(pool: AsyncConnectionPool, group_by: str) -> dict[str, Any]:
    if group_by not in GROUP_EXPRESSIONS:
        raise ValueError(f"unsupported group_by: {group_by}")
    client_baseline = await _baseline_value(pool, "client_golden_releases")
    os_baseline = await _baseline_value(pool, "os_minimum_versions")
    params: list[Any] = []
    if client_baseline:
        client_sql = f"({_client_compliance_case()})"
        params.extend(_golden_params(client_baseline["value"]["releases"]))
    else:
        client_sql = "NULL::text"
    if os_baseline:
        os_sql = f"({_os_compliance_case()})"
        minimums = Jsonb(os_baseline["value"]["minimums"])
        params.extend([minimums, minimums])
    else:
        os_sql = "NULL::text"
    params.append(SOURCE_SYSTEM)
    rows = await fetch_all(pool, f"""
        WITH devices AS (
            SELECT {_bucket(GROUP_EXPRESSIONS[group_by])} AS key,
                   ({_event_age_case("now()")}) AS age,
                   {client_sql} AS client_state,
                   {os_sql} AS os_state,
                   nullif(btrim(attributes->>'onprem_status'), '') AS onprem,
                   ({UCI_RATING_SQL}) AS uci
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
        )
        SELECT key,
               count(*)::int AS devices,
               count(*) FILTER (WHERE age = 'lt_24h')::int AS signal_24h,
               count(*) FILTER (WHERE client_state = 'current')::int AS client_current,
               count(*) FILTER (WHERE client_state IN ('current', 'one_behind', 'two_plus_behind'))::int AS client_evaluated,
               count(*) FILTER (WHERE client_state = 'one_behind')::int AS client_one_behind,
               count(*) FILTER (WHERE client_state = 'two_plus_behind')::int AS client_two_plus_behind,
               count(*) FILTER (WHERE os_state = 'supported')::int AS os_supported,
               count(*) FILTER (WHERE os_state IN ('supported', 'below_minimum'))::int AS os_evaluated,
               count(*) FILTER (WHERE onprem = 'on-prem')::int AS on_prem,
               count(*) FILTER (WHERE onprem IN ('on-prem', 'off-prem'))::int AS location_reported,
               count(*) FILTER (WHERE uci = 'Poor')::int AS uci_low,
               count(*) FILTER (WHERE uci = 'Moderate')::int AS uci_moderate,
               count(*) FILTER (WHERE uci IS NOT NULL)::int AS uci_evaluated,
               count(*) FILTER (WHERE onprem = 'on-prem' AND uci = 'Poor')::int AS on_prem_uci_low
        FROM devices
        GROUP BY key
        ORDER BY count(*) DESC, key
    """, tuple(params))
    summary = {field: sum(row[field] for row in rows) for field in COUNT_FIELDS}
    groups = [{field: row[field] for field in ("key", *COUNT_FIELDS)} for row in rows]
    return {
        "group_by": group_by,
        "client_baseline": client_baseline is not None,
        "os_baseline": os_baseline is not None,
        "summary": summary,
        "groups": groups[:GROUP_LIMIT],
        "omitted_groups": max(len(groups) - GROUP_LIMIT, 0),
        "omitted_devices": sum(group["devices"] for group in groups[GROUP_LIMIT:]),
    }
