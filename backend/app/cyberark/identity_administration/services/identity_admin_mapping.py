"""Map SCIM users/groups from Identity Administration into the normalized CMDB.

Kept under its own source_system, deliberately not reconciled with PAM users
and roles: SCIM ids and PVWA ids are different identity spaces and there is
no confirmed join evidence (username/email match) between them yet. See
docs/architecture/integration-contracts.md.
"""

from __future__ import annotations

from typing import Any

from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship

SOURCE_SYSTEM = "identity_administration"
_CYBERARK_USER_EXTENSION = "urn:ietf:params:scim:schemas:cyberark:1.0:User"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _primary_email(user: dict[str, Any]) -> str:
    emails = user.get("emails")
    if not isinstance(emails, list):
        return ""
    for email in emails:
        if isinstance(email, dict) and email.get("primary") and _text(email.get("value")):
            return _text(email["value"])
    for email in emails:
        if isinstance(email, dict) and _text(email.get("value")):
            return _text(email["value"])
    return ""


def map_identity_admin_objects(
    users: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> tuple[list[InventoryObject], list[InventoryRelationship]]:
    """Map SCIM Users/Groups without retaining phone numbers or full payloads."""
    objects: list[InventoryObject] = []
    relationships: list[InventoryRelationship] = []
    role_ids: set[str] = set()
    user_ids = {_text(user.get("id")) for user in users}

    for group in groups:
        source_id = _text(group.get("id"))
        display_name = _text(group.get("displayName"))
        if not source_id or not display_name:
            raise ValueError("/scim/v2/Groups devolvió un grupo sin id o displayName")
        role_ids.add(source_id)
        meta = group.get("meta") if isinstance(group.get("meta"), dict) else {}
        objects.append(InventoryObject(
            object_type="role",
            source_id=source_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "last_modified": _text(meta.get("lastModified")),
                "membership_status": "complete" if isinstance(group.get("members"), list) else "not_reported",
                "unresolved_member_count": 0,
            },
        ))

    for user in users:
        source_id = _text(user.get("id"))
        display_name = _text(user.get("displayName")) or _text(user.get("userName"))
        if not source_id:
            raise ValueError("/scim/v2/Users devolvió un usuario sin id")
        meta = user.get("meta") if isinstance(user.get("meta"), dict) else {}
        cyberark_ext = user.get(_CYBERARK_USER_EXTENSION)
        cyberark_ext = cyberark_ext if isinstance(cyberark_ext, dict) else {}
        objects.append(InventoryObject(
            object_type="user",
            source_id=source_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "user_name": _text(user.get("userName")),
                "email": _primary_email(user),
                "active": user.get("active") if isinstance(user.get("active"), bool) else None,
                "record_source": "identity_directory" if user.get("record_source") == "identity_directory" else "scim",
                "service_user_basis": "sdk_in_everybody_role" if user.get("service_user_basis") == "sdk_in_everybody_role" else "scim_extension",
                "service_user": bool(cyberark_ext.get("serviceUser")),
                "oauth_client": cyberark_ext.get("oauthClient") if isinstance(cyberark_ext.get("oauthClient"), bool) else None,
                "last_login_date": _text(cyberark_ext.get("lastLoginDate")),
                "last_modified": _text(meta.get("lastModified")),
            },
        ))

        groups_field = user.get("groups")
        for group_ref in groups_field if isinstance(groups_field, list) else []:
            if not isinstance(group_ref, dict):
                continue
            role_id = _text(group_ref.get("value"))
            if not role_id or role_id not in role_ids:
                continue
            relationships.append(InventoryRelationship(
                source_type="user",
                source_id=source_id,
                target_type="role",
                target_id=role_id,
                relationship_type="user_has_role",
                source_system=SOURCE_SYSTEM,
            ))

    role_objects = {item.source_id: item for item in objects if item.object_type == "role"}
    for group in groups:
        parent_id = _text(group.get("id"))
        members = group.get("members")
        if members is not None and not isinstance(members, list):
            raise ValueError("SCIM Groups members no es una lista; no se puede reconciliar")
        if isinstance(members, list):
            role_objects[parent_id].attributes["direct_member_count"] = len({_text(m.get("value")) for m in members if isinstance(m, dict)})
        unresolved = {}
        for member in members or []:
            if not isinstance(member, dict) or not _text(member.get("value")):
                raise ValueError("SCIM Groups contiene un miembro sin ID; no se puede reconciliar")
            member_id = _text(member.get("value"))
            source_type = "role" if member_id in role_ids else "user" if member_id in user_ids else None
            if source_type is None:
                unresolved[member_id] = {
                    "source_id": member_id,
                    "display_name": _text(member.get("display")),
                    "kind": "user" if member.get("type") == "User" else "role" if member.get("type") == "Group" else "unknown",
                }
                continue
            relationships.append(InventoryRelationship(
                source_type=source_type, source_id=member_id,
                target_type="role", target_id=parent_id,
                relationship_type="identity_member_of", source_system=SOURCE_SYSTEM,
            ))
        role_objects[parent_id].attributes["unresolved_member_count"] = len(unresolved)
        role_objects[parent_id].attributes["unresolved_members"] = list(unresolved.values())

    return objects, relationships


# Confirmed 2026-09-11 against the tenant (see ID-001 in docs/TO_IMPLEMENT.md).
# Only the clean core fields are mapped: FederationUuid/FederationName/
# FederationType/Active/Role/Usage. Config carries SAML/SSO certificate
# metadata (never persist certificates, same rule as everywhere else in this
# project) and is excluded entirely. Domains/Apps/CyberarkServices are
# deliberately excluded too -- there is no confirmed business need to expose
# federated-app/domain topology in the CMDB yet, and doing so would widen the
# data surface without an approved reason. If that need appears, add them as
# their own explicit fields (not a raw passthrough of Config/Domains/Apps).
def map_identity_federations(federations: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    for federation in federations:
        source_id = _text(federation.get("FederationUuid"))
        if not source_id:
            raise ValueError("/Federation/GetFederations devolvió una federación sin FederationUuid")
        display_name = _text(federation.get("FederationName")) or source_id
        objects.append(InventoryObject(
            object_type="identity_federation",
            source_id=source_id,
            display_name=display_name,
            source_system=SOURCE_SYSTEM,
            attributes={
                "federation_type": _text(federation.get("FederationType")),
                "active": bool(federation.get("Active")),
                "role": _text(federation.get("Role")),
                "usage": _text(federation.get("Usage")),
            },
        ))
    return objects
