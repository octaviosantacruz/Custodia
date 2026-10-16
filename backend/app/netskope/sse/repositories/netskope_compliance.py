"""Client-version and fleet compliance queries for Netskope."""

from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import (
    DEVICE_COMPANY, DEVICE_FILTER_EXPRESSIONS, RECENT_DEVICE_CONDITION,
    SOURCE_SYSTEM, _baseline_value, _bucket, _numeric_version, _version_key,
    parse_version,
)


# --- NSK-VER-001: client version compliance against admin golden releases ---

CLIENT_COMPLIANCE_BUCKETS = (
    ("current", "Al día"),
    ("one_behind", "1 golden atrás"),
    ("two_plus_behind", "2 o más golden atrás"),
    ("unrecognized", "Versión no reconocida"),
)


def _client_compliance_case() -> str:
    # Params: latest golden numeric[], previous golden numeric[].
    key = _version_key("attributes")
    return f"""CASE
        WHEN {key} IS NULL THEN 'unrecognized'
        WHEN {key} >= %s::numeric[] THEN 'current'
        WHEN {key} >= %s::numeric[] THEN 'one_behind'
        ELSE 'two_plus_behind'
    END"""


def _golden_params(releases: list[str]) -> tuple[list[int], list[int]]:
    parsed = sorted((parse_version(release) for release in releases), reverse=True)
    return parsed[0], parsed[1]


async def get_netskope_client_compliance(pool: AsyncConnectionPool):
    baseline = await _baseline_value(pool, "client_golden_releases")
    if not baseline:
        return {"configured": False, "baseline": None, "buckets": [], "by_os": [], "total": 0}
    latest, previous = _golden_params(baseline["value"]["releases"])
    rows = await fetch_all(pool, f"""
        SELECT {_bucket(DEVICE_FILTER_EXPRESSIONS["os"])} AS os, ({_client_compliance_case()}) AS bucket, count(*)::int AS count
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
        GROUP BY 1, 2
    """, (latest, previous, SOURCE_SYSTEM))
    totals = {key: 0 for key, _ in CLIENT_COMPLIANCE_BUCKETS}
    by_os: dict[str, dict[str, Any]] = {}
    for row in rows:
        totals[row["bucket"]] += row["count"]
        entry = by_os.setdefault(row["os"], {"os": row["os"], "total": 0, **{key: 0 for key, _ in CLIENT_COMPLIANCE_BUCKETS}})
        entry[row["bucket"]] += row["count"]
        entry["total"] += row["count"]
    return {
        "configured": True,
        "baseline": baseline,
        "buckets": [{"key": key, "label": label, "count": totals[key]} for key, label in CLIENT_COMPLIANCE_BUCKETS],
        "by_os": sorted(by_os.values(), key=lambda entry: (-entry["total"], entry["os"])),
        "total": sum(totals.values()),
    }


# --- NSK-FLT-001: fleet composition and OS minimum versions ---

OS_COMPLIANCE_BUCKETS = (
    ("supported", "Soportado"),
    ("below_minimum", "Debajo del mínimo"),
    ("no_baseline", "SO sin mínimo configurado"),
    ("unrecognized", "Versión de SO no reconocida"),
)


def _os_compliance_case() -> str:
    # Param: {"Windows": "10.0.19045", ...} as jsonb, keyed by the exact OS.
    device_version = _numeric_version("attributes->>'os_version'")
    minimum = _numeric_version("(%s::jsonb ->> btrim(coalesce(attributes->>'os', '')))")
    return f"""CASE
        WHEN {device_version} IS NULL THEN 'unrecognized'
        WHEN {minimum} IS NULL THEN 'no_baseline'
        WHEN {device_version} >= {minimum} THEN 'supported'
        ELSE 'below_minimum'
    END"""


async def get_netskope_fleet(pool: AsyncConnectionPool, result_limit: int = 15):
    specs = {
        "by_make": DEVICE_FILTER_EXPRESSIONS["device_make"],
        "by_model": DEVICE_FILTER_EXPRESSIONS["device_model"],
        "by_company": DEVICE_COMPANY,
    }
    distributions = {}
    for name, expression in specs.items():
        distributions[name] = await fetch_all(pool, f"""
            SELECT {_bucket(expression)} AS key, count(*)::int AS count
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
            GROUP BY 1 ORDER BY count(*) DESC, key LIMIT %s
        """, (SOURCE_SYSTEM, result_limit))
    distributions["by_os_version"] = await fetch_all(pool, f"""
        SELECT {_bucket(DEVICE_FILTER_EXPRESSIONS["os"])} AS os, {_bucket("attributes->>'os_version'")} AS os_version, count(*)::int AS count
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
        GROUP BY 1, 2 ORDER BY count(*) DESC, os, os_version LIMIT %s
    """, (SOURCE_SYSTEM, result_limit))
    total_row = await fetch_one(pool, f"""
        SELECT count(*)::int AS total FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
    """, (SOURCE_SYSTEM,))
    baseline = await _baseline_value(pool, "os_minimum_versions")
    os_compliance = None
    if baseline:
        rows = await fetch_all(pool, f"""
            SELECT {_bucket(DEVICE_FILTER_EXPRESSIONS["os"])} AS os, ({_os_compliance_case()}) AS bucket, count(*)::int AS count
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
            GROUP BY 1, 2
        """, (Jsonb(baseline["value"]["minimums"]), Jsonb(baseline["value"]["minimums"]), SOURCE_SYSTEM))
        totals = {key: 0 for key, _ in OS_COMPLIANCE_BUCKETS}
        for row in rows:
            totals[row["bucket"]] += row["count"]
        os_compliance = {
            "baseline": baseline,
            "buckets": [{"key": key, "label": label, "count": totals[key]} for key, label in OS_COMPLIANCE_BUCKETS],
        }
    return {**distributions, "total": total_row["total"] if total_row else 0, "os_compliance": os_compliance}
