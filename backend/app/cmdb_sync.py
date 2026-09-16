"""Persistence boundary for normalized CyberArk CMDB objects.

The external API adapters should translate their payloads into these small
records. Keeping that translation separate prevents an unverified API shape
from leaking into the database layer.
"""

from psycopg_pool import AsyncConnectionPool

from .services.cmdb_models import (
    InventoryObject, InventoryRelationship,
    deduplicate_snapshot, normalize_object, normalize_relationship,
)
from .services.cmdb_persistence import (
    reconcile_objects, reconcile_relationships, upsert_objects, upsert_relationships,
)

# Backwards-compatible re-exports for callers that use the persistence module.


async def sync_inventory_snapshot(
    pool: AsyncConnectionPool,
    objects: list[InventoryObject],
    relationships: list[InventoryRelationship],
    *,
    source_run_id: str | None = None,
    reconcile_relationship_types: frozenset[str] = frozenset(),
    reconcile_object_types: frozenset[str] = frozenset(),
    source_system: str = "cyberark",
) -> dict[str, int]:
    """Upsert a validated object graph atomically.

    Manual quality decisions are authoritative: a later source refresh cannot
    overwrite an existing non-pending quality status. Relationships are only
    written when both endpoint objects exist in this same graph or already
    exist in the database.
    """
    normalized_objects, normalized_relationships = deduplicate_snapshot(
        [normalize_object(item) for item in objects],
        [normalize_relationship(item) for item in relationships],
    )
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                object_ids = await upsert_objects(cursor, normalized_objects, source_run_id)
                await upsert_relationships(cursor, normalized_relationships, object_ids, source_run_id)
                retired_objects = await reconcile_objects(cursor, reconcile_object_types, source_run_id, source_system)
                retired_relationships = await reconcile_relationships(cursor, reconcile_relationship_types, source_run_id, source_system)

    return {
        "objects": len(normalized_objects),
        "relationships": len(normalized_relationships),
        "retired_objects": retired_objects,
        "retired_relationships": retired_relationships,
    }
