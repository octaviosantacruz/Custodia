"""Ingest verified SIA access policies into the normalized CMDB."""

from __future__ import annotations

import asyncio
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cyberark.sia.integrations.sia import SiaClient, SiaSettings
from app.cyberark.sia.services.sia_mapping import (
    SOURCE_SYSTEM, map_sia_connectors, map_sia_database_strong_accounts, map_sia_objects,
    map_sia_target_sets,
    map_sia_virtual_machines,
)


async def sync_sia_inventory(pool: AsyncConnectionPool, run_id: UUID, max_detail_concurrency: int = 5) -> dict[str, int]:
    """Synchronize SIA access policies, connectors, VM resources and database
    strong accounts and target sets as their own source_system.

    Connectors, VM resources, database strong accounts and target sets are all optional:
    an install that hasn't set their corresponding CA_SIA_*_PATH keeps
    syncing whatever it does have configured exactly as before, and each
    unconfigured type is left out of reconciliation entirely rather than
    reconciled against zero fetched objects (which would retire every
    previously-synced row of a type this run never even asked about).

    Grantees are stored as attributes, not relationships — see
    services/sia_mapping.py for why.
    """
    settings = SiaSettings.from_environment()
    if max_detail_concurrency < 1:
        raise ValueError("max_detail_concurrency debe ser al menos 1")
    semaphore = asyncio.Semaphore(max_detail_concurrency)
    async with SiaClient(settings) as client:
        policies = await client.get_policies()

        async def fetch_detail(policy: dict) -> tuple[str, dict]:
            policy_id = policy.get("policyId")
            async with semaphore:
                return policy_id, await client.get_policy_detail(policy_id)

        detail_pairs = await asyncio.gather(*(fetch_detail(policy) for policy in policies))
        details = dict(detail_pairs)
        connectors = await client.get_connectors() if settings.connectors_path else []
        virtual_machines = await client.get_virtual_machines() if settings.vm_infrastructure_path else []
        database_accounts = (
            await client.get_database_strong_accounts() if settings.db_strong_accounts_path else []
        )
        target_sets = await client.get_target_sets() if settings.target_sets_path else []

    objects = map_sia_objects(policies, details)
    objects += map_sia_connectors(connectors)
    objects += map_sia_virtual_machines(virtual_machines)
    objects += map_sia_database_strong_accounts(database_accounts)
    objects += map_sia_target_sets(target_sets)
    reconcile_object_types = {"access_policy"}
    if settings.connectors_path:
        reconcile_object_types.add("sia_connector")
    if settings.vm_infrastructure_path:
        reconcile_object_types.add("sia_resource")
    if settings.db_strong_accounts_path:
        reconcile_object_types.add("sia_database_account")
    if settings.target_sets_path:
        reconcile_object_types.add("sia_target_set")
    result = await sync_inventory_snapshot(
        pool,
        objects,
        [],
        source_run_id=str(run_id),
        reconcile_object_types=frozenset(reconcile_object_types),
        source_system=SOURCE_SYSTEM,
        retire_orphan_relationships=True,
    )
    return result
