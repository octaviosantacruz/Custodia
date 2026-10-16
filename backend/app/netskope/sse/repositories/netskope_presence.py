"""NSK-EXP-ONPREM-001: where devices report from, as Netskope's On-Premises Detection classified them.

Counts are over the same population as the inventory default (active devices with a signal in the last
7 days), so a count here equals the list its drill opens. A device whose record predates the first sync
that stored the field is "Sin dato", never off-prem.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.netskope.sse.repositories.netskope_shared import (
    DEVICE_COMPANY, MISSING_VALUE, RECENT_DEVICE_CONDITION, SOURCE_SYSTEM, _bucket,
)

COMPANY_LIMIT = 12
_STATUS = _bucket("attributes->>'onprem_status'")
_CONFIG = _bucket("attributes->>'client_config'")
_METHOD = _bucket("attributes->>'onprem_method'")
_DEVICES = f"""FROM public.cyberark_inventory_objects
    WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}"""


def _groups(rows: list[dict[str, Any]], limit: int | None = None) -> tuple[list[dict[str, Any]], int]:
    """Rows of (key, status, count) as [{key, total, statuses}], largest first; returns the omitted device count."""
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = grouped.setdefault(row["key"], {"key": row["key"], "total": 0, "statuses": {}})
        entry["statuses"][row["status"]] = row["count"]
        entry["total"] += row["count"]
    ordered = sorted(grouped.values(), key=lambda entry: (-entry["total"], entry["key"]))
    if limit is None:
        return ordered, 0
    return ordered[:limit], sum(entry["total"] for entry in ordered[limit:])


async def get_netskope_presence(pool: AsyncConnectionPool) -> dict[str, Any]:
    statuses = await fetch_all(pool, f"SELECT {_STATUS} AS key, count(*)::int AS count {_DEVICES} GROUP BY 1 ORDER BY count(*) DESC, key", (SOURCE_SYSTEM,))
    methods = await fetch_all(pool, f"SELECT {_METHOD} AS key, count(*)::int AS count {_DEVICES} GROUP BY 1 ORDER BY count(*) DESC, key", (SOURCE_SYSTEM,))
    by_config = await fetch_all(pool, f"SELECT {_CONFIG} AS key, {_STATUS} AS status, count(*)::int AS count {_DEVICES} GROUP BY 1, 2", (SOURCE_SYSTEM,))
    by_company = await fetch_all(pool, f"SELECT {_bucket(DEVICE_COMPANY)} AS key, {_STATUS} AS status, count(*)::int AS count {_DEVICES} GROUP BY 1, 2", (SOURCE_SYSTEM,))
    configs, _ = _groups(by_config)
    companies, omitted = _groups(by_company, COMPANY_LIMIT)
    total = sum(row["count"] for row in statuses)
    reported = sum(row["count"] for row in statuses if row["key"] != MISSING_VALUE)
    return {
        "total": total, "reported": reported,
        "statuses": statuses, "methods": methods,
        "by_client_config": configs, "by_company": companies, "company_omitted_devices": omitted,
        "missing_label": MISSING_VALUE,
    }
