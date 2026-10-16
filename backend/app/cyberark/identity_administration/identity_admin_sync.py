"""Ingest verified Identity Administration users/roles into the normalized CMDB."""

from __future__ import annotations

from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.cmdb_sync import sync_inventory_snapshot
from app.cross.repositories.sync_run_stages import save_sync_stages
from app.cross.services.sync_stages import StageRecorder
from app.cyberark.identity_administration.integrations.identity_admin import IdentityAdminClient, IdentityAdminError, IdentityAdminSettings
from app.cyberark.identity_administration.services.identity_admin_mapping import SOURCE_SYSTEM, map_identity_admin_objects, map_identity_federations


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
    stages = StageRecorder()
    try:
        async with IdentityAdminClient(settings) as client:
            users = await stages.run("users", lambda: _fetch(client.get_users, page_size), count=len)
            roles = await stages.run("roles", lambda: _fetch_roles(client, page_size), count=len)
            # Optional layer: accounts the SCIM Users endpoint omits (service
            # users). If it fails, those accounts are neither added nor retired.
            recovered = await stages.run(
                "members_directory", lambda: _recover_directory_users(client, users, roles),
                required=False, count=len,
            )
            if recovered:
                users = users + recovered
            if settings.federations_path:
                federations = await stages.run("federations", client.get_federations, required=False, count=len)
            else:
                federations = None
                stages.skip("federations", "CA_IDENTITY_ADMIN_FEDERATIONS_PATH sin configurar")
        objects, relationships = map_identity_admin_objects(users, roles)
        objects += map_identity_federations(federations or [])
        reconcile_object_types = {"user", "role"}
        reconcile_relationship_types = {"user_has_role", "identity_member_of"}
        if settings.federations_path and federations is not None:
            reconcile_object_types.add("identity_federation")
        # A failed optional layer must not retire what it governs: directory
        # accounts are users, and their edges are role memberships.
        directory_ok = not stages.failed("members_directory")
        if not directory_ok:
            reconcile_object_types.discard("user")
            reconcile_relationship_types = set()
        result = await sync_inventory_snapshot(
            pool,
            objects,
            relationships,
            source_run_id=str(run_id),
            reconcile_relationship_types=frozenset(reconcile_relationship_types),
            reconcile_object_types=frozenset(reconcile_object_types),
            source_system=SOURCE_SYSTEM,
            retire_orphan_relationships=directory_ok,
        )
    finally:
        await save_sync_stages(pool, run_id, stages.outcomes)
    return result


async def _fetch(getter, page_size: int):
    rows, _ = await getter(page_size=page_size)
    return rows


async def _fetch_roles(client: IdentityAdminClient, page_size: int):
    roles = await _fetch(client.get_roles, page_size)
    for role in roles:
        if "members" not in role:
            # SCIM omits unassigned multi-valued attributes. For Groups, an
            # omitted members attribute therefore represents an empty group,
            # not an unknown membership list.
            role["members"] = []
        elif not isinstance(role["members"], list):
            # An explicit value with an unexpected shape is not safe to treat
            # as an empty group: abort before reconciliation.
            raise IdentityAdminError("Membresías Identity incompletas; no se puede reconciliar el inventario")
    return roles


async def _recover_directory_users(client: IdentityAdminClient, users: list[dict], roles: list[dict]):
    """Fetch unique missing User references only. Direct SCIM memberships
    remain authoritative; neither names nor another source are joined."""
    known_ids = {user.get("id") for user in users}
    missing_members: dict[str, list[dict[str, str]]] = {}
    for role in roles:
        for member in role.get("members", []):
            if not isinstance(member, dict) or member.get("type") != "User":
                continue
            member_id = member.get("value")
            if isinstance(member_id, str) and member_id.strip() and member_id not in known_ids:
                references = missing_members.setdefault(member_id, [])
                reference = {"value": role.get("id", "")}
                if reference not in references:
                    references.append(reference)
    recovered = []
    for member_id, references in missing_members.items():
        user = await client.get_directory_user(member_id)
        if user is not None:
            recovered.append({**user, "groups": references})
    return recovered
