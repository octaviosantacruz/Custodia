"""SQL persistence helpers for the normalized CyberArk CMDB graph."""

from typing import Any

from psycopg.types.json import Jsonb

from .cmdb_models import InventoryObject, InventoryRelationship

ObjectKey = tuple[str, str, str]


async def upsert_objects(cursor: Any, objects: list[InventoryObject], source_run_id: str | None) -> dict[ObjectKey, int]:
    object_ids: dict[ObjectKey, int] = {}
    for item in objects:
        await cursor.execute(
            """
            INSERT INTO public.cyberark_inventory_objects
              (source_system, object_type, source_id, display_name,
               lifecycle_status, data_quality_status, source_run_id, attributes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_system, object_type, source_id)
            DO UPDATE SET display_name = EXCLUDED.display_name,
                          lifecycle_status = EXCLUDED.lifecycle_status,
                          data_quality_status = CASE
                            WHEN cyberark_inventory_objects.data_quality_status <> 'pending'
                            THEN cyberark_inventory_objects.data_quality_status
                            ELSE EXCLUDED.data_quality_status
                          END,
                          last_seen_at = now(),
                          source_run_id = EXCLUDED.source_run_id,
                          attributes = EXCLUDED.attributes,
                          updated_at = now()
            RETURNING object_id
            """,
            (item.source_system, item.object_type, item.source_id, item.display_name,
             item.lifecycle_status, item.data_quality_status, source_run_id, Jsonb(item.attributes)),
        )
        row = await cursor.fetchone()
        object_ids[(item.source_system, item.object_type, item.source_id)] = row['object_id']
    return object_ids


async def _load_endpoint_ids(cursor: Any, object_ids: dict[ObjectKey, int], source_key: ObjectKey, target_key: ObjectKey) -> None:
    await cursor.execute(
        """
        SELECT object_id, source_system, object_type, source_id
        FROM public.cyberark_inventory_objects
        WHERE (source_system = %s AND object_type = %s AND source_id = %s)
           OR (source_system = %s AND object_type = %s AND source_id = %s)
        """,
        (*source_key, *target_key),
    )
    for row in await cursor.fetchall():
        object_ids[(row['source_system'], row['object_type'], row['source_id'])] = row['object_id']


async def upsert_relationships(
    cursor: Any, relationships: list[InventoryRelationship], object_ids: dict[ObjectKey, int], source_run_id: str | None
) -> None:
    for relationship in relationships:
        source_key = (relationship.source_system, relationship.source_type, relationship.source_id)
        target_key = (relationship.source_system, relationship.target_type, relationship.target_id)
        source_id = object_ids.get(source_key)
        target_id = object_ids.get(target_key)
        if source_id is None or target_id is None:
            await _load_endpoint_ids(cursor, object_ids, source_key, target_key)
            source_id = object_ids.get(source_key)
            target_id = object_ids.get(target_key)
        if source_id is None or target_id is None:
            raise ValueError(
                f"Relationship endpoint not found: {relationship.source_type}:{relationship.source_id}"
                f" -> {relationship.target_type}:{relationship.target_id}"
            )
        await cursor.execute(
            """
            INSERT INTO public.cyberark_inventory_relationships
              (source_object_id, target_object_id, relationship_type, source_run_id, attributes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (source_object_id, target_object_id, relationship_type)
            DO UPDATE SET last_seen_at = now(), source_run_id = EXCLUDED.source_run_id,
                          attributes = EXCLUDED.attributes,
                          lifecycle_status = 'active', retired_at = NULL
            """,
            (source_id, target_id, relationship.relationship_type, source_run_id, Jsonb(relationship.attributes)),
        )


async def reconcile_objects(
    cursor: Any, object_types: frozenset[str], source_run_id: str | None, source_system: str = "cyberark"
) -> int:
    if not object_types:
        return 0
    if not source_run_id:
        raise ValueError("Object reconciliation requires source_run_id")
    retired = 0
    for object_type in object_types:
        await cursor.execute(
            """
            UPDATE public.cyberark_inventory_objects
            SET lifecycle_status = 'retired', updated_at = now()
            WHERE object_type = %s
              AND source_system = %s
              AND source_run_id IS DISTINCT FROM %s
              AND lifecycle_status = 'active'
            """,
            (object_type, source_system, source_run_id),
        )
        retired += cursor.rowcount
    return retired


async def reconcile_relationships(
    cursor: Any, relationship_types: frozenset[str], source_run_id: str | None, source_system: str = "cyberark"
) -> int:
    """Retire stale relationships, scoped to relationships whose source endpoint
    belongs to source_system — otherwise two sources sharing a relationship_type
    (e.g. PAM and Identity Administration both using user_has_role) would retire
    each other's edges on every run.
    """
    if not relationship_types:
        return 0
    if not source_run_id:
        raise ValueError("Relationship reconciliation requires source_run_id")
    retired = 0
    for relationship_type in relationship_types:
        await cursor.execute(
            """
            UPDATE public.cyberark_inventory_relationships r
            SET lifecycle_status = 'retired', retired_at = COALESCE(retired_at, now())
            WHERE r.relationship_type = %s
              AND r.source_run_id IS DISTINCT FROM %s
              AND r.lifecycle_status = 'active'
              AND EXISTS (
                SELECT 1 FROM public.cyberark_inventory_objects o
                WHERE o.object_id = r.source_object_id AND o.source_system = %s
              )
            """,
            (relationship_type, source_run_id, source_system),
        )
        retired += cursor.rowcount
    return retired
