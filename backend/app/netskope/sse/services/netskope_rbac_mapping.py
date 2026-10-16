"""NSK-RBAC-001: map Netskope administrators, admin roles and the API-group page map into the isolated source.

Allowlists, verified on the tenant on 2026-10-14 (see docs/architecture/netskope-api.md):

* role: ``roleId``, ``name``, ``type``, ``userCount``, ``lastEdited`` and, from the role detail, the API groups whose
  permission is not ``none`` (id, name, level). Never ``createdBy``/``updatedBy`` (administrator identities), the IP
  allow-list, labels or obfuscation settings.
* administrator: SCIM ``id``, ``userName``, ``active`` and, from the Netskope extension, ``recordType``, ``lastLogin``,
  ``isLocked``, ``mfa.enabled`` and ``role.value``. The extension also carries ``apiAccessToken`` on service accounts:
  a credential that is never read, stored or logged here.
* API group: id, name and the console pages it opens (the static page map).

The administrator → role link is ``role.value`` = ``roleId`` only. ``samlAssertedRoleId`` matches too few roles and is
ignored. A reference to a role absent from the listing is counted as unresolved instead of being linked or invented.
"""

from __future__ import annotations

from typing import Any

from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship
from app.netskope.sse.services.netskope_mapping import SOURCE_SYSTEM

ROLE_OBJECT_TYPE = "netskope_role"
ADMIN_OBJECT_TYPE = "netskope_admin"
API_GROUP_OBJECT_TYPE = "netskope_api_group"
ADMIN_ROLE_RELATIONSHIP = "has_role"
ADMIN_EXTENSION = "urn:ietf:params:scim:schemas:netskope:2.0:User"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def map_admin_roles(
    roles: list[dict[str, Any]], details: dict[int, dict[str, Any]],
) -> list[InventoryObject]:
    """One ``netskope_role`` per listed role; the detail only adds its non-``none`` API-group permissions.

    A missing or duplicate ``roleId``/name, or a listed role without a detail, aborts the read: a partial role map would
    read as "this role has no permissions".
    """
    objects: list[InventoryObject] = []
    seen: set[int] = set()
    for role in roles:
        role_id = _int(role.get("roleId"))
        name = _text(role.get("name"))
        if role_id is None or not name:
            raise ValueError("Netskope devolvió un rol de administración sin roleId o name")
        if role_id in seen:
            raise ValueError("Netskope devolvió un rol de administración duplicado")
        seen.add(role_id)
        detail = details.get(role_id)
        if detail is None:
            raise ValueError("Falta el detalle de un rol de administración")
        permissions: list[dict[str, Any]] = []
        groups_total = 0
        for group in detail.get("apiGroups") or []:
            group_id = _int(group.get("apiGroupId"))
            level = _text(group.get("permission"))
            group_name = _text(group.get("apiGroupName"))
            if group_id is None or not level or not group_name:
                raise ValueError("Netskope devolvió un grupo de API sin id, nombre o permiso")
            groups_total += 1
            if level != "none":
                permissions.append({"id": group_id, "name": group_name, "permission": level[:8]})
        attributes: dict[str, Any] = {"permissions": permissions, "api_groups_total": groups_total}
        for key, value in (("role_type", _int(role.get("type"))), ("user_count", _int(role.get("userCount")))):
            if value is not None:
                attributes[key] = value
        last_edited = _text(role.get("lastEdited"))
        if last_edited:
            attributes["last_edited"] = last_edited
        objects.append(InventoryObject(
            object_type=ROLE_OBJECT_TYPE, source_id=str(role_id), display_name=name,
            source_system=SOURCE_SYSTEM, attributes=attributes,
        ))
    return objects


def map_admins(
    users: list[dict[str, Any]], role_ids: set[str],
) -> tuple[list[InventoryObject], list[InventoryRelationship], int]:
    """``netskope_admin`` objects and ``admin --has_role--> role`` edges by ``role.value``.

    Returns the objects, the edges and how many administrators reference a role missing from the listing.
    """
    objects: list[InventoryObject] = []
    relationships: list[InventoryRelationship] = []
    seen: set[str] = set()
    unresolved = 0
    for user in users:
        source_id = _text(user.get("id"))
        user_name = _text(user.get("userName"))
        if not source_id or not user_name:
            raise ValueError("Netskope devolvió un administrador sin id o userName")
        if source_id in seen:
            raise ValueError("Netskope devolvió un administrador duplicado")
        seen.add(source_id)
        extension = user.get(ADMIN_EXTENSION)
        extension = extension if isinstance(extension, dict) else {}
        attributes: dict[str, Any] = {}
        for key, value in (
            ("active", _bool(user.get("active"))),
            ("is_locked", _bool(extension.get("isLocked"))),
            ("record_type", _text(extension.get("recordType")) or None),
            ("last_login", _text(extension.get("lastLogin")) or None),
        ):
            if value is not None:
                attributes[key] = value
        mfa = extension.get("mfa")
        mfa_enabled = _bool(mfa.get("enabled")) if isinstance(mfa, dict) else None
        if mfa_enabled is not None:
            attributes["mfa_enabled"] = mfa_enabled
        role = extension.get("role")
        role_id = _int(role.get("value")) if isinstance(role, dict) else None
        if role_id is not None:
            attributes["role_id"] = role_id
        objects.append(InventoryObject(
            object_type=ADMIN_OBJECT_TYPE, source_id=source_id, display_name=user_name,
            source_system=SOURCE_SYSTEM, attributes=attributes,
        ))
        if role_id is not None:
            if str(role_id) in role_ids:
                relationships.append(InventoryRelationship(
                    source_type=ADMIN_OBJECT_TYPE, source_id=source_id,
                    target_type=ROLE_OBJECT_TYPE, target_id=str(role_id),
                    relationship_type=ADMIN_ROLE_RELATIONSHIP, source_system=SOURCE_SYSTEM,
                ))
            else:
                unresolved += 1
    return objects, relationships, unresolved


def map_api_groups(rows: list[dict[str, Any]]) -> list[InventoryObject]:
    """One ``netskope_api_group`` per API group with the console pages it opens, from the static page map."""
    groups: dict[int, dict[str, Any]] = {}
    for row in rows:
        group_id = _int(row.get("v3_api_group_id"))
        name = _text(row.get("v3_api_group_name"))
        page = _text(row.get("v2_page_name"))
        if group_id is None or not name:
            raise ValueError("Netskope devolvió una entrada del mapa de páginas sin id o nombre de grupo")
        entry = groups.setdefault(group_id, {"name": name, "pages": []})
        if entry["name"] != name:
            raise ValueError("Netskope devolvió dos nombres para el mismo grupo de API")
        if page:
            pair = {"page": page, "parent": _text(row.get("v2_parent_page_name"))}
            if pair not in entry["pages"]:
                entry["pages"].append(pair)
    return [
        InventoryObject(
            object_type=API_GROUP_OBJECT_TYPE, source_id=str(group_id), display_name=entry["name"],
            source_system=SOURCE_SYSTEM, attributes={"pages": entry["pages"]},
        )
        for group_id, entry in sorted(groups.items())
    ]
