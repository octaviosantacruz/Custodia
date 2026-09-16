"""Ingest verified Identity Administration users/roles into the normalized CMDB."""

from __future__ import annotations

from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from .cmdb_sync import sync_inventory_snapshot
from .integrations.identity_admin import IdentityAdminClient, IdentityAdminSettings
from .services.identity_admin_mapping import SOURCE_SYSTEM, map_identity_admin_objects, map_identity_federations


async def sync_identity_admin_inventory(pool: AsyncConnectionPool, run_id: UUID, page_size: int = 100) -> dict[str, int]:
    """Synchronize Identity Administration users/roles (and, if configured,
    federations) as their own source_system.

    Deliberately not reconciled with PAM users/roles (see
    docs/architecture/integration-contracts.md) — objects and relationships
    are scoped to source_system="identity_administration" so reconciliation
    (retiring stale rows) never touches PAM-sourced rows.

    Federations are optional (ID-001): an install that hasn't set
    CA_IDENTITY_ADMIN_FEDERATIONS_PATH keeps syncing users/roles exactly as
    before, and identity_federation is left out of reconciliation entirely
    when unconfigured (same pattern as SIA's optional catalogs).
    """
    settings = IdentityAdminSettings.from_environment()
    async with IdentityAdminClient(settings) as client:
        users, _ = await client.get_users(page_size=page_size)
        roles, _ = await client.get_roles(page_size=page_size)
        federations = await client.get_federations() if settings.federations_path else []
    objects, relationships = map_identity_admin_objects(users, roles)
    objects += map_identity_federations(federations)
    reconcile_object_types = {"user", "role"}
    if settings.federations_path:
        reconcile_object_types.add("identity_federation")
    result = await sync_inventory_snapshot(
        pool,
        objects,
        relationships,
        source_run_id=str(run_id),
        reconcile_relationship_types=frozenset({"user_has_role"}),
        reconcile_object_types=frozenset(reconcile_object_types),
        source_system=SOURCE_SYSTEM,
    )
    return result
