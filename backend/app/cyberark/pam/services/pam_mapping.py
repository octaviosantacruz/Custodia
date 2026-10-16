from __future__ import annotations

import asyncio
from typing import Any

from app.cross.cmdb_sync import InventoryObject, InventoryRelationship
from app.cyberark.pam.client import CyberArkClient, CyberArkError


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _identifier(value: Any) -> str:
    """Normalize scalar API identifiers without turning null/booleans into keys."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return ""


def _bool(value: Any) -> bool:
    return bool(value) if isinstance(value, bool) else False


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _string_list(value: Any) -> list[str]:
    """Keep only well-formed string entries; never persist nested PII objects."""
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def resolve_psm_server_id(
    psm_server_id: str, catalog_by_folded: dict[str, list[str]]
) -> tuple[str | None, str]:
    """Resolve a platform's ``PSMServerID`` against the PSM catalog.

    ``catalog_by_folded`` maps ``casefold()`` -> canonical catalog IDs. The
    resolution never guesses: two *distinct* catalog IDs that differ only in
    case are ``ambiguous`` (returns ``None``) and the caller must omit the
    edge. A catalog ID repeated verbatim is still one ID, not ambiguity.
    ``missing`` returns the raw ID so the caller can keep the historical
    fallback object marked as ``catalog_missing``.
    """
    candidates = catalog_by_folded.get(psm_server_id.casefold(), [])
    if psm_server_id in candidates:
        return psm_server_id, "exact"
    distinct = list(dict.fromkeys(candidates))
    if len(distinct) == 1:
        return distinct[0], "casefold"
    if distinct:
        return None, "ambiguous"
    return psm_server_id, "missing"


def map_pam_objects(
    users: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    platforms: list[dict[str, Any]],
    platform_details: dict[str, dict[str, Any]] | None = None,
    *,
    platform_targets: list[dict[str, Any]] | None = None,
    platform_dependents: list[dict[str, Any]] | None = None,
    platform_groups: list[dict[str, Any]] | None = None,
    platform_rotational_groups: list[dict[str, Any]] | None = None,
    psm_servers: list[dict[str, Any]] | None = None,
    psm_connectors: list[dict[str, Any]] | None = None,
    components_summary: dict[str, Any] | None = None,
    components_detail: dict[str, list[dict[str, Any]]] | None = None,
) -> tuple[list[InventoryObject], list[InventoryRelationship], dict[str, int]]:
    """Map observed API contracts without retaining account secrets or PII detail.

    The third value is a small counter dict for PSM reference resolution
    (case-folded, ambiguous, catalog-missing), consumed by the run result.
    """
    objects: list[InventoryObject] = []
    relationships: list[InventoryRelationship] = []

    for user in users:
        uuid = _text(user.get("UUID"))
        display_name = _text(user.get("username"))
        source_id = uuid or display_name
        if not source_id:
            raise CyberArkError("/API/Users devolvió un usuario sin UUID ni username")
        objects.append(InventoryObject(
            object_type="user",
            source_id=source_id,
            display_name=display_name,
            attributes={
                "user_id": _text(user.get("id")),
                "identity_key": "UUID" if uuid else "username",
                "user_type": _text(user.get("userType")),
                "source": _text(user.get("source")),
                "component_user": bool(user.get("componentUser")),
                # PAM-USR-001 (ExtendedDetails=true). Deliberately excludes
                # personalDetails/internet/phones -- never persist PII here.
                "enabled": _bool(user.get("enableUser")),
                "suspended": _bool(user.get("suspended")),
                "vault_authorization": _string_list(user.get("vaultAuthorization")),
                "groups_membership": _string_list(user.get("groupsMembership")),
                "location": _text(user.get("location")),
            },
        ))

    for group in groups:
        source_id = _identifier(group.get("id"))
        display_name = _text(group.get("groupName"))
        if not source_id or not display_name:
            raise CyberArkError("/API/UserGroups devolvió un grupo sin id o groupName")
        objects.append(InventoryObject(
            object_type="role",
            source_id=source_id,
            display_name=display_name,
            attributes={
                "group_type": _text(group.get("groupType")),
                "location": _text(group.get("location")),
            },
        ))

    # PLAT-002: dual control / verify-change-reconcile policy for CyberArk's
    # "target platform" catalog. This uses its own numeric ID and a Name that
    # only sometimes equals a regular PlatformID string (verified live:
    # ~half the tenant's targets matched, half didn't) -- modeled as its own
    # object type instead of guessing a name-based join onto `platform`.
    # `platform_base_id` is kept as a plain reference attribute, not a merge.
    for target in platform_targets or []:
        target_id = _identifier(target.get("ID"))
        if not target_id:
            continue
        credentials_policy = target.get("CredentialsManagementPolicy")
        change = credentials_policy.get("Change") if isinstance(credentials_policy, dict) else None
        verification = credentials_policy.get("Verification") if isinstance(credentials_policy, dict) else None
        reconcile = credentials_policy.get("Reconcile") if isinstance(credentials_policy, dict) else None
        session_management = target.get("PrivilegedSessionManagement")
        workflows = target.get("PrivilegedAccessWorkflows")
        objects.append(InventoryObject(
            object_type="platform_target",
            source_id=target_id,
            display_name=_text(target.get("Name")) or target_id,
            attributes={
                "platform_base_id": _text(target.get("PlatformBaseID")),
                "credentials_change_automatic": _bool(change.get("PerformAutomatic")) if isinstance(change, dict) else False,
                "credentials_change_interval_days": _optional_int(change.get("RequirePasswordEveryXDays")) if isinstance(change, dict) else None,
                "credentials_verify_automatic": _bool(verification.get("PerformAutomatic")) if isinstance(verification, dict) else False,
                "credentials_verify_interval_days": _optional_int(verification.get("RequirePasswordEveryXDays")) if isinstance(verification, dict) else None,
                "credentials_reconcile_automatic": _bool(reconcile.get("AutomaticReconcileWhenUnsynced")) if isinstance(reconcile, dict) else False,
                "psm_server_id": _text(session_management.get("PSMServerId")) if isinstance(session_management, dict) else "",
                "dual_control_required": _bool(workflows.get("RequireDualControlPasswordAccessApproval")) if isinstance(workflows, dict) else False,
                "otp_required": _bool(workflows.get("EnforceOnetimePasswordAccess")) if isinstance(workflows, dict) else False,
                "reason_required": _bool(workflows.get("RequireUsersToSpecifyReasonForAccess")) if isinstance(workflows, dict) else False,
                "exclusive_access_required": _bool(workflows.get("EnforceCheckinCheckoutExclusiveAccess")) if isinstance(workflows, dict) else False,
            },
        ))

    # PSM-001: the /PSM/Servers catalog is authoritative. Resolve every
    # platform PSMServerID against it ignoring case so the edge always lands
    # on the canonical catalog object (observed live: PSMServer_UE-CYBERARK03
    # vs PSMServer_ue-cyberark03). IDs the catalog omits keep the historical
    # minimal-object fallback, now marked as catalog_missing.
    psm_catalog_objects: dict[str, InventoryObject] = {}
    psm_catalog_by_folded: dict[str, list[str]] = {}
    for server in psm_servers or []:
        catalog_id = _text(server.get("ID"))
        if not catalog_id:
            raise CyberArkError("/API/PSM/Servers devolvió un servidor sin ID")
        psm_catalog_objects[catalog_id] = InventoryObject(
            object_type="psm",
            source_id=catalog_id,
            display_name=_text(server.get("Name")) or catalog_id,
            attributes={"address": _text(server.get("Address"))},
        )
        psm_catalog_by_folded.setdefault(catalog_id.casefold(), []).append(catalog_id)

    psm_counters = {
        "psm_references_casefolded": 0,
        "psm_references_ambiguous": 0,
        "psm_references_catalog_missing": 0,
    }
    missing_catalog_psm_ids: set[str] = set()

    for platform in platforms:
        general = platform.get("general")
        if not isinstance(general, dict):
            raise CyberArkError("/API/Platforms devolvió una plataforma sin general")
        source_id = _text(general.get("id"))
        display_name = _text(general.get("name")) or source_id
        if not source_id:
            raise CyberArkError("/API/Platforms devolvió una plataforma sin general.id")
        platform_detail = (platform_details or {}).get(source_id, {})
        attributes = {
            "active": bool(general.get("active")),
            "platform_base_id": _text(general.get("platformBaseID")),
            "platform_type": _text(general.get("platformType")),
            "system_type": _text(general.get("systemType")),
            "allowed_safes_pattern": _text(platform_detail.get("allowed_safes_pattern")),
        }
        objects.append(InventoryObject(
            object_type="platform",
            source_id=source_id,
            display_name=display_name,
            attributes=attributes,
        ))
        session_management = platform.get("sessionManagement")
        psm_server_id = _text(session_management.get("PSMServerID")) if isinstance(session_management, dict) else ""
        if not psm_server_id:
            continue
        resolved_psm_id, resolution = resolve_psm_server_id(psm_server_id, psm_catalog_by_folded)
        if resolution == "ambiguous" or resolved_psm_id is None:
            # Two catalog IDs differing only in case: do not guess, and report
            # the omission instead of creating a third phantom object.
            psm_counters["psm_references_ambiguous"] += 1
            continue
        if resolution == "missing":
            psm_counters["psm_references_catalog_missing"] += 1
            missing_catalog_psm_ids.add(psm_server_id)
        elif resolution == "casefold":
            psm_counters["psm_references_casefolded"] += 1
        relationships.append(InventoryRelationship(
            source_type="platform",
            source_id=source_id,
            target_type="psm",
            target_id=resolved_psm_id,
            relationship_type="platform_uses_psm",
        ))

    objects.extend(psm_catalog_objects.values())
    for missing_id in sorted(missing_catalog_psm_ids):
        objects.append(InventoryObject(
            object_type="psm",
            source_id=missing_id,
            display_name=missing_id,
            attributes={"catalog_missing": True},
        ))

    # PSM-001: session connector-type catalog (e.g. PSM-RDP, PSM-SSH). A
    # reference catalog with no relationships of its own.
    for connector in psm_connectors or []:
        source_id = _text(connector.get("ID"))
        if not source_id:
            raise CyberArkError("/API/PSM/Connectors devolvió un conector sin ID")
        objects.append(InventoryObject(
            object_type="psm_connector",
            source_id=source_id,
            display_name=_text(connector.get("DisplayName")) or source_id,
        ))

    # PLAT-003: dependent / grouped / rotational-group platform catalogs.
    # ID is numeric here (unlike the string PlatformID used elsewhere).
    for dependent in platform_dependents or []:
        source_id = _identifier(dependent.get("ID"))
        if not source_id:
            raise CyberArkError("/API/platforms/dependents/ devolvió un dependiente sin ID")
        objects.append(InventoryObject(
            object_type="platform_dependent",
            source_id=source_id,
            display_name=_text(dependent.get("Name")) or source_id,
            attributes={
                "platform_base_id": _text(dependent.get("PlatformBaseID")),
                "platform_base_type": _text(dependent.get("PlatformBaseType")),
                "linked_target_platforms": _optional_int(dependent.get("NumberOfLinkedTargetPlatforms")) or 0,
            },
        ))
    for group in platform_groups or []:
        source_id = _identifier(group.get("ID"))
        if not source_id:
            raise CyberArkError("/API/platforms/groups/ devolvió un grupo sin ID")
        objects.append(InventoryObject(
            object_type="platform_group",
            source_id=source_id,
            display_name=_text(group.get("Name")) or source_id,
            attributes={"active": _bool(group.get("Active"))},
        ))
    for rotational_group in platform_rotational_groups or []:
        source_id = _identifier(rotational_group.get("ID"))
        if not source_id:
            raise CyberArkError("/API/platforms/rotationalGroups/ devolvió un grupo rotacional sin ID")
        objects.append(InventoryObject(
            object_type="platform_rotational_group",
            source_id=source_id,
            display_name=_text(rotational_group.get("Name")) or source_id,
            attributes={"active": _bool(rotational_group.get("Active"))},
        ))

    # SYS-001: component health. One row per ComponentID; per-instance
    # ComponentIP/ComponentUserName are intentionally excluded (host
    # inventory is out of scope). Only the aggregate connectivity/version
    # signal is kept.
    for component in (components_summary or {}).get("Components", []):
        if not isinstance(component, dict):
            continue
        component_id = _text(component.get("ComponentID"))
        if not component_id:
            raise CyberArkError("/API/ComponentsMonitoringSummary devolvió un componente sin ComponentID")
        instances = (components_detail or {}).get(component_id, [])
        versions = sorted({_text(item.get("ComponentVersion")) for item in instances if isinstance(item, dict) and _text(item.get("ComponentVersion"))})
        logon_dates = [
            item.get("LastLogonDate") for item in instances
            if isinstance(item, dict) and isinstance(item.get("LastLogonDate"), (int, float)) and not isinstance(item.get("LastLogonDate"), bool)
        ]
        all_logged_on = bool(instances) and all(
            isinstance(item, dict) and _bool(item.get("IsLoggedOn")) for item in instances
        )
        objects.append(InventoryObject(
            object_type="component",
            source_id=component_id,
            display_name=_text(component.get("ComponentName")) or component_id,
            attributes={
                "description": _text(component.get("Description")),
                "total_count": _optional_int(component.get("ComponentTotalCount")) or 0,
                "connected_count": _optional_int(component.get("ConnectedComponentCount")) or 0,
                "instance_versions": versions,
                "latest_logon_at": max(logon_dates) if logon_dates else None,
                "all_instances_logged_on": all_logged_on,
            },
        ))

    return objects, relationships, psm_counters


async def get_group_details(
    client: CyberArkClient,
    groups: list[dict[str, Any]],
    *,
    max_concurrency: int = 8,
) -> list[dict[str, Any]]:
    """Fetch membership detail with bounded concurrency to avoid API bursts."""
    if max_concurrency < 1:
        raise ValueError("max_concurrency debe ser al menos 1")
    semaphore = asyncio.Semaphore(max_concurrency)

    async def fetch_group(group: dict[str, Any]) -> dict[str, Any]:
        group_id = _identifier(group.get("id"))
        if not group_id:
            raise CyberArkError("/API/UserGroups devolvió un grupo sin id")
        async with semaphore:
            return await client.get_user_group(group_id)

    return await asyncio.gather(*(fetch_group(group) for group in groups))


def map_pam_access_relationships(
    users: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    group_details: list[dict[str, Any]],
    safe_group_memberships: list[dict[str, Any]],
) -> tuple[list[InventoryRelationship], int, int]:
    """Map relationships from verified group detail and Safe group membership data."""
    if len(groups) != len(group_details):
        raise ValueError("Cada grupo debe tener su payload de detalle")

    users_by_username: dict[str, str] = {}
    for user in users:
        username = _text(user.get("username"))
        source_id = _text(user.get("UUID")) or username
        if username and source_id:
            if username in users_by_username and users_by_username[username] != source_id:
                raise CyberArkError("/API/Users devolvió usernames duplicados con identificadores distintos")
            users_by_username[username] = source_id

    roles_by_name: dict[str, str] = {}
    for group in groups:
        role_id = _identifier(group.get("id"))
        role_name = _text(group.get("groupName"))
        if role_id and role_name:
            if role_name in roles_by_name and roles_by_name[role_name] != role_id:
                raise CyberArkError("/API/UserGroups devolvió groupName duplicado con identificadores distintos")
            roles_by_name[role_name] = role_id

    relationships: list[InventoryRelationship] = []
    skipped_group_members = 0
    for group, detail in zip(groups, group_details, strict=True):
        role_id = _identifier(group.get("id"))
        members = detail.get("members")
        if not role_id or not isinstance(members, list):
            raise CyberArkError("El detalle de /API/UserGroups no coincide con el listado de grupos")
        for member in members:
            if not isinstance(member, dict):
                raise CyberArkError("El detalle de /API/UserGroups contiene un miembro inválido")
            user_id = users_by_username.get(_text(member.get("username")))
            if not user_id:
                skipped_group_members += 1
                continue
            relationships.append(InventoryRelationship(
                source_type="user",
                source_id=user_id,
                target_type="role",
                target_id=role_id,
                relationship_type="user_has_role",
            ))

    skipped_safe_group_memberships = 0
    for membership in safe_group_memberships:
        safe_id = _identifier(membership.get("safe_number"))
        role_id = roles_by_name.get(_text(membership.get("member_name")))
        if not safe_id or not role_id:
            skipped_safe_group_memberships += 1
            continue
        relationships.append(InventoryRelationship(
            source_type="role",
            source_id=role_id,
            target_type="safe",
            target_id=safe_id,
            relationship_type="role_grants_access",
        ))

    return relationships, skipped_group_members, skipped_safe_group_memberships
