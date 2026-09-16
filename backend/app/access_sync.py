"""Ingest verified Access space assets into the normalized CMDB (ACCESS-001)."""

from __future__ import annotations

from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from .cmdb_sync import sync_inventory_snapshot
from .integrations.access import AccessClient, AccessSettings
from .services.access_mapping import SOURCE_SYSTEM, map_access_objects


async def sync_access_inventory(pool: AsyncConnectionPool, run_id: UUID) -> dict[str, int]:
    """Synchronize Access space assets as their own source_system.

    platformId is kept as an attribute only; see services/access_mapping.py
    for why no relationship is persisted from it.
    """
    settings = AccessSettings.from_environment()
    async with AccessClient(settings) as client:
        assets = await client.get_assets()

    objects = map_access_objects(assets)
    result = await sync_inventory_snapshot(
        pool,
        objects,
        [],
        source_run_id=str(run_id),
        reconcile_object_types=frozenset({"access_asset"}),
        source_system=SOURCE_SYSTEM,
    )
    return result
