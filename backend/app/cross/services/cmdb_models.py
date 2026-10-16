"""Normalized in-memory model and validation for the CyberArk CMDB graph."""

from dataclasses import dataclass, field
from typing import Any

OBJECT_TYPES = frozenset({
    "user", "role", "safe", "platform", "psm", "access_policy", "sia",
    "component", "psm_connector",
    "platform_dependent", "platform_group", "platform_rotational_group",
    "platform_target", "access_asset",
    "sia_connector", "sia_resource", "sia_database_account", "sia_target_set", "identity_federation",
    "device", "dem_site", "netskope_group", "netskope_policy_group",
    "netskope_role", "netskope_admin", "netskope_api_group",
})
LIFECYCLE_STATUSES = frozenset({"active", "retired"})
QUALITY_STATUSES = frozenset({"pending", "clean", "obsolete", "duplicate"})


@dataclass(frozen=True)
class InventoryObject:
    object_type: str
    source_id: str
    display_name: str
    source_system: str = "cyberark"
    lifecycle_status: str = "active"
    data_quality_status: str = "pending"
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class InventoryRelationship:
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    relationship_type: str
    source_system: str = "cyberark"
    attributes: dict[str, Any] = field(default_factory=dict)


def normalize_object(payload: InventoryObject) -> InventoryObject:
    """Validate and normalize one adapter output before it reaches SQL."""
    object_type = payload.object_type.strip().lower()
    source_system = payload.source_system.strip().lower()
    source_id = payload.source_id.strip()
    display_name = payload.display_name.strip() or source_id

    if object_type not in OBJECT_TYPES:
        raise ValueError(f"Unsupported inventory object type: {payload.object_type!r}")
    if not source_system or not source_id:
        raise ValueError("Inventory objects require source_system and source_id")
    if payload.lifecycle_status not in LIFECYCLE_STATUSES:
        raise ValueError(f"Unsupported lifecycle status: {payload.lifecycle_status!r}")
    if payload.data_quality_status not in QUALITY_STATUSES:
        raise ValueError(f"Unsupported quality status: {payload.data_quality_status!r}")

    return InventoryObject(
        object_type=object_type, source_id=source_id, display_name=display_name,
        source_system=source_system, lifecycle_status=payload.lifecycle_status,
        data_quality_status=payload.data_quality_status, attributes=dict(payload.attributes),
    )


def normalize_relationship(payload: InventoryRelationship) -> InventoryRelationship:
    source_type = payload.source_type.strip().lower()
    target_type = payload.target_type.strip().lower()
    relationship_type = payload.relationship_type.strip()
    source_system = payload.source_system.strip().lower()
    if source_type not in OBJECT_TYPES or target_type not in OBJECT_TYPES:
        raise ValueError("Relationships must reference supported inventory object types")
    if not payload.source_id.strip() or not payload.target_id.strip() or not relationship_type:
        raise ValueError("Relationships require source/target IDs and a type")
    if not source_system:
        raise ValueError("Relationships require a source_system")
    return InventoryRelationship(
        source_type=source_type, source_id=payload.source_id.strip(),
        target_type=target_type, target_id=payload.target_id.strip(),
        relationship_type=relationship_type, source_system=source_system,
        attributes=dict(payload.attributes),
    )


def deduplicate_snapshot(
    objects: list[InventoryObject], relationships: list[InventoryRelationship]
) -> tuple[list[InventoryObject], list[InventoryRelationship]]:
    """Remove identical observations and reject conflicting duplicates."""
    unique_objects: dict[tuple[str, str, str], InventoryObject] = {}
    for item in objects:
        key = (item.source_system, item.object_type, item.source_id)
        existing = unique_objects.get(key)
        if existing is not None and existing != item:
            raise ValueError(f"Conflicting inventory object observations for {key!r}")
        unique_objects[key] = item

    unique_relationships: dict[tuple[str, str, str, str, str, str], InventoryRelationship] = {}
    for item in relationships:
        key = (item.source_system, item.source_type, item.source_id, item.target_type, item.target_id, item.relationship_type)
        existing = unique_relationships.get(key)
        if existing is not None and existing != item:
            raise ValueError(f"Conflicting inventory relationship observations for {key!r}")
        unique_relationships[key] = item

    return list(unique_objects.values()), list(unique_relationships.values())
