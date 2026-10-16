"""Read-only expansion of the Netskope inventory chain.

Edges are attribute groupings, never persisted relationships:

- ``netskope_user -> netskope_device`` only when the device's ``username``
  resolves to exactly one active user (the same ``observed_user`` predicate
  the inventory uses; ``user_key`` never creates an edge);
- ``netskope_device -> netskope_client_version`` / ``netskope_os`` as terminal
  attribute groups (distinct visual style in the UI, not a relation);
- ``company`` is grouping context, not a node.

The user <-> device relation is intentionally **not** persisted; that stays
blocked in CHAIN-006/NSK-DEV-001.
"""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import RECENT_DEVICE_CONDITION

SOURCE_SYSTEM = "netskope"
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
SEARCH_PER_TYPE = 20
DIRECTIONS = ("forward", "back")

NODE_TYPES = ("netskope_user", "netskope_device", "netskope_client_version", "netskope_os")
SEARCH_TYPES = ("netskope_user", "netskope_device")

# Allowlist of hops per node and direction. Version/OS are terminal attribute
# groups reached from a device; they are never roots.
NETSKOPE_HOPS: dict[str, dict[str, tuple[str, ...]]] = {
    "netskope_user": {"forward": ("netskope_device",), "back": ()},
    "netskope_device": {
        "forward": ("netskope_client_version", "netskope_os"),
        "back": ("netskope_user",),
    },
    "netskope_client_version": {"forward": (), "back": ()},
    "netskope_os": {"forward": (), "back": ()},
}


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _hop(
    node_type: str,
    object_id: int,
    label: str,
    sublabel: str,
    relation_kind: str,
    basis: str,
    *,
    forward_count: int = 0,
    back_count: int = 0,
) -> dict:
    return {
        "id": object_id,
        "node_type": node_type,
        "label": label,
        "sublabel": sublabel,
        "relation_kind": relation_kind,
        "basis": basis,
        "forward_count": forward_count,
        "back_count": back_count,
        "restricted": False,
    }


# Shared by the expansion and the person summary: the node count, the hop list
# and any aggregate must all come from this same 1-to-1 observed match.
_MATCHED_DEVICES_BODY = """
      SELECT d.object_id, d.display_name, d.source_id,
             coalesce(d.attributes->>'client_version', '') AS client_version,
             coalesce(d.attributes->>'os', '') AS os,
             (SELECT count(DISTINCT candidate.object_id)::int
              FROM public.cyberark_inventory_objects candidate
              WHERE candidate.source_system = %s
                AND candidate.object_type = 'user'
                AND candidate.lifecycle_status = 'active'
                AND (
                  lower(btrim(d.attributes->>'username')) = lower(btrim(candidate.source_id))
                  OR lower(btrim(d.attributes->>'username')) = lower(btrim(candidate.attributes->>'email'))
                )) AS candidate_count,
             (coalesce(nullif(btrim(d.attributes->>'client_version'), ''), '') <> '')::int
             + (coalesce(nullif(btrim(d.attributes->>'os'), ''), '') <> '')::int AS forward_count
      FROM public.cyberark_inventory_objects d
      WHERE d.source_system = %s AND d.object_type = 'device'
        AND d.lifecycle_status = 'active'
        AND coalesce(btrim(d.attributes->>'username'), '') <> ''
        AND (
          lower(btrim(d.attributes->>'username')) = lower(btrim(%s))
          OR lower(btrim(d.attributes->>'username')) = lower(btrim(%s))
        )
"""


async def _user_matched_devices(
    pool: AsyncConnectionPool, *, user_object_id: int, limit: int, offset: int,
) -> dict:
    """Devices whose username resolves uniquely to this user."""
    user = await fetch_one(pool, """
        SELECT object_id, display_name, source_id, attributes->>'email' AS email
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s AND object_type = 'user'
          AND lifecycle_status = 'active'
    """, (user_object_id, SOURCE_SYSTEM))
    if user is None:
        return {"rows": [], "total": 0}
    rows = await fetch_all(pool, f"""
        WITH matched_devices AS ({_MATCHED_DEVICES_BODY})
        SELECT object_id, display_name, source_id, forward_count, count(*) OVER ()::int AS total_count
        FROM matched_devices
        WHERE candidate_count = 1
        ORDER BY lower(display_name), object_id
        LIMIT %s OFFSET %s
    """, (SOURCE_SYSTEM, SOURCE_SYSTEM, user["source_id"], user["email"], limit, offset))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total}


async def user_matched_device_summary(pool: AsyncConnectionPool, user: dict) -> dict:
    """Aggregate the user's matched devices under the expansion's own filter.

    Used by the person view (CHAIN-010). The count follows the inventory's
    default freshness (an event in the last 7 days, RECENT_DEVICE_CONDITION),
    so both screens agree; active devices without a recent event are counted
    apart instead of being mixed in. Client versions and OS come only from
    recent devices, and a version is grouped without its "(64-bit)"/"(32-bit)"
    suffix because the architecture is not a different version.
    """
    row = await fetch_one(pool, f"""
        WITH matched_devices AS ({_MATCHED_DEVICES_BODY}),
        scoped AS (
          SELECT m.client_version, m.os, coalesce(({RECENT_DEVICE_CONDITION}), false) AS recent
          FROM matched_devices m
          JOIN public.cyberark_inventory_objects o ON o.object_id = m.object_id
          WHERE m.candidate_count = 1
        )
        SELECT count(*) FILTER (WHERE recent)::int AS device_count,
               count(*) FILTER (WHERE NOT recent)::int AS stale_device_count,
               coalesce(
                 array_agg(DISTINCT nullif(btrim(regexp_replace(client_version, '\\s*\\((32|64)-bit\\)\\s*$', '')), ''))
                   FILTER (WHERE recent AND nullif(btrim(client_version), '') IS NOT NULL),
                 '{{}}'
               ) AS client_versions,
               coalesce(
                 array_agg(DISTINCT nullif(os, '')) FILTER (WHERE recent AND nullif(os, '') IS NOT NULL),
                 '{{}}'
               ) AS operating_systems
        FROM scoped
    """, (SOURCE_SYSTEM, SOURCE_SYSTEM, user["source_id"], user["email"]))
    return {
        "device_count": row["device_count"] if row else 0,
        "stale_device_count": row["stale_device_count"] if row else 0,
        "client_versions": sorted(row["client_versions"]) if row else [],
        "operating_systems": sorted(row["operating_systems"]) if row else [],
    }


async def _device_observed_user(pool: AsyncConnectionPool, device_object_id: int) -> dict | None:
    """The single active user matching this device's username, or None."""
    device = await fetch_one(pool, """
        SELECT object_id, display_name, source_id, attributes
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s AND object_type = 'device'
          AND lifecycle_status = 'active'
    """, (device_object_id, SOURCE_SYSTEM))
    if device is None:
        return None
    username = str((device.get("attributes") or {}).get("username") or "").strip().lower()
    if not username:
        return None
    candidates = await fetch_all(pool, """
        SELECT object_id, display_name, source_id, attributes->>'email' AS email
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'user' AND lifecycle_status = 'active'
          AND (
            lower(btrim(source_id)) = %s
            OR lower(btrim(attributes->>'email')) = %s
          )
        ORDER BY object_id
    """, (SOURCE_SYSTEM, username, username))
    if len(candidates) != 1:
        return None
    candidate = candidates[0]
    return _hop(
        "netskope_user", candidate["object_id"], candidate["display_name"],
        candidate["source_id"], "derived", "observed_user_exact",
        forward_count=await _user_matched_device_count(pool, candidate),
    )


async def _user_matched_device_count(pool: AsyncConnectionPool, user: dict) -> int:
    """Devices the user matches, with the expansion's own 1-to-1 filter.

    Delegating to ``_user_matched_devices`` keeps the node count and its list
    under the same predicate: an ambiguous username is excluded from both.
    """
    matched = await _user_matched_devices(pool, user_object_id=user["object_id"], limit=1, offset=0)
    return matched["total"]


async def _device_attribute_groups(pool: AsyncConnectionPool, device_object_id: int) -> list[dict]:
    rows = await fetch_all(pool, """
        SELECT attributes->>'client_version' AS client_version, attributes->>'os' AS os,
               attributes->>'os_version' AS os_version
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s AND object_type = 'device'
          AND lifecycle_status = 'active'
    """, (device_object_id, SOURCE_SYSTEM))
    if not rows:
        return []
    row = rows[0]
    hops: list[dict] = []
    if (row.get("client_version") or "").strip():
        hops.append(_hop(
            "netskope_client_version", 0, row["client_version"].strip(), "",
            "derived", "attribute_group",
        ))
    if (row.get("os") or "").strip():
        hops.append(_hop(
            "netskope_os", 0, row["os"].strip(), (row.get("os_version") or "").strip(),
            "derived", "attribute_group",
        ))
    return hops


async def get_netskope_chain_node(pool: AsyncConnectionPool, *, node_type: str, node_id: int) -> dict | None:
    if node_type == "netskope_user":
        row = await fetch_one(pool, """
            SELECT object_id AS id, object_type AS node_type, display_name AS label,
                   source_id AS sublabel, attributes->>'email' AS email
            FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = %s AND object_type = 'user'
              AND lifecycle_status = 'active'
        """, (node_id, SOURCE_SYSTEM))
        if row is None:
            return None
        matched = await _user_matched_devices(pool, user_object_id=node_id, limit=1, offset=0)
        return {
            **row,
            "node_type": "netskope_user",
            "forward_count": matched["total"],
            "back_count": 0,
        }

    if node_type == "netskope_device":
        row = await fetch_one(pool, """
            SELECT object_id AS id, object_type AS node_type, display_name AS label,
                   source_id AS sublabel, attributes
            FROM public.cyberark_inventory_objects
            WHERE object_id = %s AND source_system = %s AND object_type = 'device'
              AND lifecycle_status = 'active'
        """, (node_id, SOURCE_SYSTEM))
        if row is None:
            return None
        groups = await _device_attribute_groups(pool, node_id)
        observed = await _device_observed_user(pool, node_id)
        return {
            **row,
            "node_type": "netskope_device",
            "forward_count": len(groups),
            "back_count": 1 if observed else 0,
        }

    # Version/OS groups are synthetic terminal values, not object rows.
    return None


async def expand_netskope_chain_node(
    pool: AsyncConnectionPool,
    *,
    node_type: str,
    node_id: int,
    direction: str,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> dict:
    if direction not in DIRECTIONS or node_type not in NETSKOPE_HOPS:
        return {"rows": [], "total": 0, "limit": limit, "offset": offset}
    if not NETSKOPE_HOPS[node_type][direction]:
        return {"rows": [], "total": 0, "limit": limit, "offset": offset}

    if node_type == "netskope_user" and direction == "forward":
        result = await _user_matched_devices(pool, user_object_id=node_id, limit=limit, offset=offset)
        rows = [
            _hop("netskope_device", row["object_id"], row["display_name"], row["source_id"],
                 "derived", "observed_user_exact", forward_count=row["forward_count"], back_count=1)
            for row in result["rows"]
        ]
        return {"rows": rows, "total": result["total"], "limit": limit, "offset": offset}

    if node_type == "netskope_device" and direction == "back":
        observed = await _device_observed_user(pool, node_id)
        rows = [observed] if observed else []
        return {"rows": rows, "total": len(rows), "limit": limit, "offset": offset}

    if node_type == "netskope_device" and direction == "forward":
        groups = await _device_attribute_groups(pool, node_id)
        return {"rows": groups[offset:offset + limit], "total": len(groups), "limit": limit, "offset": offset}

    return {"rows": [], "total": 0, "limit": limit, "offset": offset}


async def search_netskope_chain_nodes(
    pool: AsyncConnectionPool,
    *,
    query: str,
    node_types: tuple[str, ...],
    limit: int = SEARCH_PER_TYPE,
) -> dict:
    like = _like_pattern(query)
    groups: dict[str, list[dict]] = {}
    for node_type in node_types:
        if node_type == "netskope_user":
            rows = await fetch_all(pool, """
                SELECT o.object_id AS id, o.display_name AS label, o.source_id AS sublabel
                FROM public.cyberark_inventory_objects o
                WHERE o.source_system = %s AND o.object_type = 'user' AND o.lifecycle_status = 'active'
                  AND (
                    o.display_name ILIKE %s OR o.source_id ILIKE %s
                    OR coalesce(o.attributes->>'email', '') ILIKE %s
                  )
                ORDER BY lower(o.display_name), o.object_id
                LIMIT %s
            """, (SOURCE_SYSTEM, like, like, like, limit))
        elif node_type == "netskope_device":
            rows = await fetch_all(pool, """
                SELECT o.object_id AS id, o.display_name AS label, o.source_id AS sublabel
                FROM public.cyberark_inventory_objects o
                WHERE o.source_system = %s AND o.object_type = 'device' AND o.lifecycle_status = 'active'
                  AND (
                    o.display_name ILIKE %s OR o.source_id ILIKE %s
                    OR coalesce(o.attributes->>'username', '') ILIKE %s
                  )
                ORDER BY lower(o.display_name), o.object_id
                LIMIT %s
            """, (SOURCE_SYSTEM, like, like, like, limit))
        else:
            rows = []
        groups[node_type] = [{**row, "node_type": node_type} for row in rows]
    return {"query": query, "groups": groups}
