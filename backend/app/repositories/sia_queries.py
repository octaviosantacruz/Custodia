from collections import defaultdict
from typing import Any

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one

SOURCE_SYSTEM = "sia"


def _extract_ip_addresses(attributes: dict[str, Any]) -> set[str]:
    """Extract only literal IPs from SIA rules; ranges/FQDNs are not Safe joins."""
    values: set[str] = set()
    for rule in attributes.get("ip_rules") or []:
        candidates: list[Any] = [rule] if isinstance(rule, str) else []
        if isinstance(rule, dict):
            for key in ("ipAddresses", "ip_addresses", "ips"):
                if isinstance(rule.get(key), list):
                    candidates.extend(rule[key])
        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                values.add(candidate.strip().lower())
    return values


async def _safe_links_by_ip(pool: AsyncConnectionPool, rows: list[dict]) -> dict[str, list[dict]]:
    policy_ips = {ip for row in rows for ip in _extract_ip_addresses(row.get("attributes") or {})}
    if not policy_ips:
        return {}
    safe_rows = await fetch_all(pool, """
        SELECT s.safe_number, s.safe_name, a.account_id, a.account_name,
               a.address, a.platform_name, a.platform_id,
               lower(trim(a.address)) AS address_key
        FROM public.cyberark_accounts a
        JOIN public.safes s ON s.safe_number = a.safe_number
        WHERE a.lifecycle_status = 'active'
          AND s.lifecycle_status = 'active'
          AND lower(trim(a.address)) = ANY(%s)
        GROUP BY s.safe_number, s.safe_name, a.account_id, a.account_name,
                 a.address, a.platform_name, a.platform_id, lower(trim(a.address))
        ORDER BY lower(s.safe_name), s.safe_number, address_key, a.account_id
    """, (list(policy_ips),))
    links: dict[str, list[dict]] = defaultdict(list)
    for row in safe_rows:
        links[row["address_key"]].append({
            "safe_number": row["safe_number"],
            "safe_name": row["safe_name"],
            "account": {
                "account_id": row["account_id"],
                "account_name": row["account_name"],
                "address": row["address"],
                "platform_name": row.get("platform_name"),
                "platform_id": row.get("platform_id"),
            },
        })
    return links


def _policy_filters(search: str, status_filter: str) -> tuple[list[str], list[object]]:
    where = ["source_system = %s", "object_type = 'access_policy'", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("(display_name ILIKE %s OR attributes->>'description' ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like])
    if status_filter:
        where.append("attributes->>'status' = %s")
        params.append(status_filter)
    return where, params


async def list_sia_policies(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    status_filter: str,
    linkage_status: str = "",
):
    where, params = _policy_filters(search, status_filter)
    pagination = "" if linkage_status else "LIMIT %s OFFSET %s"
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, attributes,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        {pagination}
    """, tuple(params + ([limit, offset] if not linkage_status else [])))
    total = rows[0]["total_count"] if rows and not linkage_status else len(rows)
    for row in rows:
        row.pop("total_count", None)
    safe_links = await _safe_links_by_ip(pool, rows)
    for row in rows:
        matched: dict[int, dict] = {}
        matched_ips = _extract_ip_addresses(row.get("attributes") or {})
        for ip in matched_ips:
            for safe in safe_links.get(ip, []):
                item = matched.setdefault(safe["safe_number"], {
                    "safe_number": safe["safe_number"],
                    "safe_name": safe["safe_name"],
                    "matched_ips": [],
                    "accounts": [],
                })
                if ip not in item["matched_ips"]:
                    item["matched_ips"].append(ip)
                if safe["account"] not in item["accounts"]:
                    item["accounts"].append(safe["account"])
        row["linked_safes"] = sorted(matched.values(), key=lambda item: (item["safe_name"].lower(), item["safe_number"]))
        row["linked_ip_count"] = len(matched_ips & set(safe_links))
        row["linkage_status"] = "multiple" if len(row["linked_safes"]) > 1 else "linked" if row["linked_safes"] else "unlinked"
    if linkage_status:
        rows = [row for row in rows if row["linkage_status"] == linkage_status]
        total = len(rows)
        rows = rows[offset:offset + limit]
    return {
        "rows": rows, "total": total, "limit": limit, "offset": offset,
        "search": search, "status_filter": status_filter, "linkage_status": linkage_status,
    }


async def get_sia_policy_detail(pool: AsyncConnectionPool, object_id: int):
    return await fetch_one(pool, """
        SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s AND object_type = 'access_policy'
    """, (object_id, SOURCE_SYSTEM))


async def list_sia_destinations(pool: AsyncConnectionPool, search: str, limit: int, offset: int, destination_type: str):
    where: list[str] = []
    params: list[object] = []
    if destination_type:
        where.append("destination_type = %s")
        params.append(destination_type)
    if search:
        where.append("(display_name ILIKE %s OR destination::text ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like])
    destination_where = " AND ".join(where) or "TRUE"
    query = f"""
        WITH destination_rows AS (
          SELECT object_id AS policy_object_id, display_name, source_id, attributes->'platforms' AS platforms,
                 'ip' AS destination_type, value AS destination
          FROM public.cyberark_inventory_objects
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(attributes->'ip_rules') = 'array' THEN attributes->'ip_rules' ELSE '[]'::jsonb END
          ) AS item(value)
          WHERE source_system = %s AND object_type = 'access_policy' AND lifecycle_status = 'active'
          UNION ALL
          SELECT object_id, display_name, source_id, attributes->'platforms', 'fqdn', value
          FROM public.cyberark_inventory_objects
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(attributes->'fqdn_rules') = 'array' THEN attributes->'fqdn_rules' ELSE '[]'::jsonb END
          ) AS item(value)
          WHERE source_system = %s AND object_type = 'access_policy' AND lifecycle_status = 'active'
          UNION ALL
          SELECT object_id, display_name, source_id, attributes->'platforms', 'logical_name', value
          FROM public.cyberark_inventory_objects
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(attributes->'logical_names') = 'array' THEN attributes->'logical_names' ELSE '[]'::jsonb END
          ) AS item(value)
          WHERE source_system = %s AND object_type = 'access_policy' AND lifecycle_status = 'active'
        )
        SELECT policy_object_id, display_name, source_id, platforms, destination_type, destination,
               count(*) OVER ()::int AS total_count
        FROM destination_rows
        WHERE {destination_where}
        ORDER BY lower(display_name), destination_type, destination::text, policy_object_id
        LIMIT %s OFFSET %s
    """
    rows = await fetch_all(pool, query, tuple([SOURCE_SYSTEM, SOURCE_SYSTEM, SOURCE_SYSTEM] + params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search, "destination_type": destination_type}


async def list_sia_connectors(pool: AsyncConnectionPool, search: str, limit: int, offset: int):
    where = ["source_system = %s", "object_type = 'sia_connector'", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("display_name ILIKE %s")
        params.append(f"%{search}%")
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, attributes,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_sia_database_accounts(pool: AsyncConnectionPool, search: str, limit: int, offset: int):
    where = ["source_system = %s", "object_type = 'sia_database_account'", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("(display_name ILIKE %s OR attributes->>'platform' ILIKE %s OR attributes->>'database' ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like, like])
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, attributes,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search}


async def list_sia_resources(pool: AsyncConnectionPool, search: str, limit: int, offset: int, resource_type: str = ""):
    where = ["source_system = %s", "object_type = 'sia_resource'", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("display_name ILIKE %s")
        params.append(f"%{search}%")
    if resource_type:
        where.append("attributes->>'resource_type' = %s")
        params.append(resource_type)
    rows = await fetch_all(pool, f"""
        SELECT object_id, display_name, source_id, attributes,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects
        WHERE {' AND '.join(where)}
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search, "resource_type": resource_type}
