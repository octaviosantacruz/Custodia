"""Read-only queries for Access space assets (ACCESS-001).

platform_id is cross-referenced against PAM's platform inventory with an
exact-match join, never a persisted relationship (see access_mapping.py).
The join mirrors identity_pam_bridge.py: match by exact source_id equality
only, and only annotate -- an asset with no match still lists normally with
platform_name = null.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all

SOURCE_SYSTEM = "access"
PAM_SOURCE_SYSTEM = "cyberark"


async def list_access_assets(
    pool: AsyncConnectionPool,
    search: str,
    limit: int,
    offset: int,
    asset_type: str = "",
) -> dict[str, Any]:
    where = ["a.source_system = %s", "a.object_type = 'access_asset'", "a.lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM]
    if search:
        where.append("a.display_name ILIKE %s")
        params.append(f"%{search}%")
    if asset_type:
        where.append("a.attributes->>'asset_type' = %s")
        params.append(asset_type)

    rows = await fetch_all(pool, f"""
        SELECT a.object_id, a.display_name, a.source_id, a.attributes,
               p.display_name AS platform_name,
               count(*) OVER ()::int AS total_count
        FROM public.cyberark_inventory_objects a
        LEFT JOIN public.cyberark_inventory_objects p
          ON p.source_system = %s AND p.object_type = 'platform'
         AND p.lifecycle_status = 'active'
         AND p.source_id = NULLIF(a.attributes->>'platform_id', '')
        WHERE {' AND '.join(where)}
        ORDER BY lower(a.display_name), a.object_id
        LIMIT %s OFFSET %s
    """, tuple([PAM_SOURCE_SYSTEM] + params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset, "search": search, "asset_type": asset_type}
