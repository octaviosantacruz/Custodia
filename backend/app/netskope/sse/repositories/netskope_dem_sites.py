"""Read-only, allowlisted DEM site inventory from the Netskope CMDB source."""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one


async def list_netskope_dem_sites(pool: AsyncConnectionPool, search: str, limit: int, offset: int) -> dict:
    like = f"%{search}%"
    params = (search, like, like)
    scope = """
        source_system = 'netskope' AND object_type = 'dem_site'
        AND lifecycle_status = 'active'
        AND (%s = '' OR display_name ILIKE %s OR source_id ILIKE %s)
    """
    summary = await fetch_one(pool, f"""
        SELECT count(*)::int AS total, max(last_seen_at) AS last_observed_at
        FROM public.cyberark_inventory_objects WHERE {scope}
    """, params)
    rows = await fetch_all(pool, f"""
        SELECT source_id AS id, display_name AS name,
               attributes->>'revision' AS revision,
               attributes->>'date_create' AS date_create,
               attributes->>'date_modify' AS date_modify,
               (attributes->>'num_gateways')::int AS num_gateways,
               (attributes->>'num_runners')::int AS num_runners,
               attributes->'pop_tracing' AS pop_tracing,
               first_seen_at, last_seen_at
        FROM public.cyberark_inventory_objects WHERE {scope}
        ORDER BY display_name, source_id LIMIT %s OFFSET %s
    """, (*params, limit, offset))
    return {"rows": rows, "total": summary["total"], "last_observed_at": summary["last_observed_at"]}
