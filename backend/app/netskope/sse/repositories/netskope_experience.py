"""Resolve only active Netskope users for the ADEM read-only request."""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one


async def get_experience_user(pool: AsyncConnectionPool, object_id: int):
    return await fetch_one(pool, """
        SELECT attributes->>'email' AS email
        FROM public.cyberark_inventory_objects
        WHERE object_id = %s AND source_system = %s
          AND object_type = %s AND lifecycle_status = %s
    """, (object_id, 'netskope', 'user', 'active'))


async def list_user_inventory_device_names(pool: AsyncConnectionPool, user_object_id: int) -> list[dict]:
    """Inventory devices the exact-username link attaches to the user: object id and name (ADR 006)."""
    from app.netskope.sse.repositories.netskope_inventory import list_netskope_objects

    result = await list_netskope_objects(pool, "device", "", 200, 0, freshness="all", observed_user_id=user_object_id)
    return [
        {"object_id": row["object_id"], "name": (row["attributes"].get("hostname") or row["display_name"])}
        for row in result["rows"]
    ]
