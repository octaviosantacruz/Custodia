"""Map SCIM users/groups from Identity Administration into the normalized CMDB.

Kept under its own source_system, deliberately not reconciled with PAM users
and roles: SCIM ids and PVWA ids are different identity spaces and there is
no confirmed join evidence (username/email match) between them yet. See
docs/architecture/integration-contracts.md.
"""

from __future__ import annotations

from typing import Any

from .cmdb_models import InventoryObject, InventoryRelationship

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


def _last_login(user: dict[str, Any]) -> str:
    extension = user.get(_CYBERARK_USER_EXTENSION)
    return _text(extension.get("lastLoginDate")) if isinstance(extension, dict) else ""


def _dedupe_users_by_email(users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse duplicate SCIM records for the same person into one.

    The tenant has been observed to occasionally mint a second SCIM id for
    the same real user in the same page (see
    docs/architecture/integration-contracts.md). Users without an email
    aren't deduped against each other, since an empty key would incorrectly
    merge unrelated records. The record with the most recent login is kept
    for scalar attributes; role memberships are unioned across duplicates
    so neither copy's roles are silently dropped.
    """
    by_email: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    passthrough: list[dict[str, Any]] = []
    for user in users:
        email = _primary_email(user).lower()
        if not email:
            passthrough.append(user)
            continue
        existing = by_email.get(email)
        if existing is None:
            by_email[email] = dict(user)
            order.append(email)
            continue
        existing_groups = existing.get("groups") if isinstance(existing.get("groups"), list) else []
        new_groups = user.get("groups") if isinstance(user.get("groups"), list) else []
        seen_role_ids = {group.get("value") for group in existing_groups if isinstance(group, dict)}
        merged_groups = list(existing_groups) + [
            group for group in new_groups if isinstance(group, dict) and group.get("value") not in seen_role_ids
        ]
        canonical = user if _last_login(user) > _last_login(existing) else existing
        canonical = dict(canonical)
        canonical["groups"] = merged_groups
        by_email[email] = canonical
    return [by_email[email] for email in order] + passthrough


def map_identity_admin_objects(
    users: list[dict[str, Any]],
    groups: list[dict[str, Any]],
) -> tuple[list[InventoryObject], list[InventoryRelationship]]:
    """Map SCIM Users/Groups without retaining phone numbers or full payloads."""
    objects: list[InventoryObject] = []
    relationships: list[InventoryRelationship] = []
    role_ids: set[str] = set()
    users = _dedupe_users_by_email(users)

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
            attributes={"last_modified": _text(meta.get("lastModified"))},
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
                "active": bool(user.get("active")),
                "service_user": bool(cyberark_ext.get("serviceUser")),
                "oauth_client": bool(cyberark_ext.get("oauthClient")),
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
