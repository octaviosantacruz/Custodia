"""Ingest verified Privilege Cloud PAM objects into the normalized CMDB."""

from __future__ import annotations

from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from .cmdb_sync import InventoryRelationship, sync_inventory_snapshot
from .db import fetch_all


from .services.pam_accounts import sync_accounts
from .services.pam_mapping import (
    _text, get_group_details, map_pam_access_relationships, map_pam_objects,
)
from .services.pam_source import fetch_pam_source, fetch_psm_servers


# These are the complete object collections owned by the PAM snapshot.  Keep
# this list explicit instead of deriving it from the objects returned by the
# current page: an empty collection is still a valid observation and must
# retire objects that belonged to the previous complete snapshot.
PAM_RECONCILABLE_OBJECT_TYPES = frozenset({
    "user", "role", "platform", "psm",
    "component", "psm_connector", "aim_application",
    "platform_dependent", "platform_group", "platform_rotational_group", "platform_target",
})


def reconcilable_pam_relationship_types(
    *, skipped_accounts: int, skipped_group_members: int, skipped_safe_group_memberships: int
) -> frozenset[str]:
    """Only retire edges when the source mapping has no unresolved records."""
    relationship_types = {"platform_uses_psm"}
    if skipped_safe_group_memberships == 0:
        relationship_types.add("role_grants_access")
    if skipped_accounts == 0:
        relationship_types.add("safe_uses_platform")
    if skipped_group_members == 0:
        relationship_types.add("user_has_role")
    return frozenset(relationship_types)


def reconcilable_pam_object_types() -> frozenset[str]:
    """Return every object collection covered by a complete PAM snapshot."""
    return PAM_RECONCILABLE_OBJECT_TYPES


async def sync_pam_inventory(pool: AsyncConnectionPool, run_id: UUID, page_size: int = 100) -> dict[str, int]:
    """Synchronize verified PAM objects and Safe-to-Platform relationships.

    Accounts provide relationship evidence only. Their names, usernames and
    secret-management properties are intentionally not persisted here.
    """
    source = await fetch_pam_source(page_size=page_size)
    users, groups, platforms, accounts, group_details = (
        source.users, source.groups, source.platforms, source.accounts, source.group_details
    )
    objects, relationships = map_pam_objects(
        users, groups, platforms, source.platform_details,
        platform_targets=source.platform_targets,
        platform_dependents=source.platform_dependents,
        platform_groups=source.platform_groups,
        platform_rotational_groups=source.platform_rotational_groups,
        psm_servers=source.psm_servers,
        psm_connectors=source.psm_connectors,
        components_summary=source.components_summary,
        components_detail=source.components_detail,
        aim_applications=source.aim_applications,
    )
    safe_rows = await fetch_all(pool, """
        SELECT safe_number, safe_name
        FROM public.safes
        WHERE lifecycle_status = 'active'
    """)
    safe_ids_by_name = {row["safe_name"]: str(row["safe_number"]) for row in safe_rows}
    safe_group_memberships = await fetch_all(pool, """
        SELECT safe_number, member_name
        FROM public.safe_members
        WHERE lifecycle_status = 'active' AND lower(member_type) = 'group'
    """)
    access_relationships, skipped_group_members, skipped_safe_group_memberships = map_pam_access_relationships(
        users, groups, group_details, safe_group_memberships
    )
    relationships.extend(access_relationships)
    platform_ids = {item.source_id for item in objects if item.object_type == "platform"}
    platform_names = {item.source_id: item.display_name for item in objects if item.object_type == "platform"}
    skipped_accounts = 0
    for account in accounts:
        safe_id = safe_ids_by_name.get(_text(account.get("safeName")))
        platform_id = _text(account.get("platformId"))
        if not safe_id or not platform_id or platform_id not in platform_ids:
            skipped_accounts += 1
            continue
        relationships.append(InventoryRelationship(
            source_type="safe",
            source_id=safe_id,
            target_type="platform",
            target_id=platform_id,
            relationship_type="safe_uses_platform",
        ))

    account_result = await sync_accounts(pool, accounts, safe_ids_by_name, platform_names, run_id)

    reconciliation_types = reconcilable_pam_relationship_types(
        skipped_accounts=skipped_accounts,
        skipped_group_members=skipped_group_members,
        skipped_safe_group_memberships=skipped_safe_group_memberships,
    )
    result = await sync_inventory_snapshot(
        pool,
        objects,
        relationships,
        source_run_id=str(run_id),
        reconcile_relationship_types=reconciliation_types,
        # Do not derive this from ``objects``.  If CyberArk legitimately
        # returns no users/groups/platforms, the absent collection still has
        # to reconcile the previous active rows as retired.
        reconcile_object_types=reconcilable_pam_object_types(),
    )
    return {
        **result,
        "accounts": account_result["accounts"],
        "skipped_accounts": account_result["skipped_accounts"],
        "retired_accounts": account_result["retired_accounts"],
        "skipped_group_members": skipped_group_members,
        "skipped_safe_group_memberships": skipped_safe_group_memberships,
        "reconciled_relationship_types": len(reconciliation_types),
    }


async def sync_pam_connectors_inventory(
    pool: AsyncConnectionPool, run_id: UUID, page_size: int = 100
) -> dict[str, int]:
    """Refresh only the authoritative CyberArk PSM server catalog.

    PSM names are owned by ``/API/PSM/Servers`` and must not wait for the
    complete Safe/PAM snapshot.  A failure in an unrelated Safe, platform or
    component endpoint should not leave a renamed PSM server showing its old
    display name.  Relationships are intentionally untouched here; the full
    PAM snapshot remains responsible for reconciling platform-to-PSM links.
    """
    psm_servers = await fetch_psm_servers()
    objects, _ = map_pam_objects(
        users=[], groups=[], platforms=[], psm_servers=psm_servers,
    )
    return await sync_inventory_snapshot(
        pool,
        objects,
        [],
        source_run_id=str(run_id),
        reconcile_object_types=frozenset({"psm"}),
    )
