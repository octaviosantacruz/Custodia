"""Map verified Netskope fields into the isolated CMDB source."""

from __future__ import annotations

from typing import Any

from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship

SOURCE_SYSTEM = "netskope"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_email(user: dict[str, Any]) -> str:
    emails = user.get("emails")
    if isinstance(emails, list):
        for email in emails:
            if isinstance(email, str) and email.strip():
                return email.strip()
    return ""


def _company_from_identity(value: Any) -> str:
    identity = _text(value).casefold()
    domain = identity.rsplit("@", 1)[-1].rstrip(".") if "@" in identity else ""
    return domain.split(".", 1)[0].upper() if domain else ""


ACCOUNT_ENABLED = "enabled"
ACCOUNT_DISABLED = "disabled"


def netskope_account_summary(user: dict[str, Any]) -> dict[str, Any] | None:
    """What a user's accounts[] says, in the terms of the Netskope console.

    An account Netskope marks ``deleted`` does not exist for the console, and a user whose accounts are all
    deleted is not counted as a user (``deleted_only``: absent from the snapshot, so a complete run retires it).
    A user is enabled when a live account is explicitly ``active: true`` and disabled only when every live
    account is explicitly ``active: false``. An account whose ``active`` is missing or not a boolean is no
    evidence either way: the status stays unknown, never inferred. ``None`` means the same for the whole
    payload (no usable accounts[]).
    """
    accounts = user.get("accounts")
    if not isinstance(accounts, list) or not accounts or not all(isinstance(account, dict) for account in accounts):
        return None
    live = [account for account in accounts if account.get("deleted") is not True]
    if not live:
        return {"deleted_only": True}
    active = sum(1 for account in live if account.get("active") is True)
    inactive = sum(1 for account in live if account.get("active") is False)
    if not active and active + inactive < len(live):
        return None
    provisioners = sorted({_text(account.get("provisioner")) for account in live if _text(account.get("provisioner"))})
    return {
        "deleted_only": False,
        "attributes": {
            "account_status": ACCOUNT_ENABLED if active else ACCOUNT_DISABLED,
            "accounts_active": active,
            "accounts_inactive": inactive,
            **({"provisioners": provisioners} if provisioners else {}),
        },
    }


def netskope_deleted_user_ids(users: list[dict[str, Any]]) -> set[str]:
    """Ids of the users whose accounts are all deleted (the ones the snapshot leaves out)."""
    return {
        _text(user.get("id")) for user in users
        if (netskope_account_summary(user) or {}).get("deleted_only")
    }


def _category(value: Any, limit: int = 60) -> str:
    """A short plain label (a status or a configuration name); anything else is "no data"."""
    text = value.strip() if isinstance(value, str) else ""
    return text if 0 < len(text) <= limit and "\n" not in text else ""


def onprem_fields(device: dict[str, Any]) -> dict[str, str]:
    """NSK-EXP-ONPREM-001: Netskope's own On-Premises Detection result and the configurations applied.

    Only categories are kept. The public/private IP, `match_ip` (the egress address that matched) and
    every other network field stay out: DS Hub never needs them to say where a device is.
    """
    onprem = device.get("onprem_status")
    status = _category(onprem.get("status")) if isinstance(onprem, dict) else _category(onprem)
    method = _category(onprem.get("method")) if isinstance(onprem, dict) else ""
    host = device.get("host_info") if isinstance(device.get("host_info"), dict) else {}
    return {
        key: value for key, value in (
            ("onprem_status", status or _category(device.get("onpremises_status"))),
            ("onprem_method", method),
            ("client_config", _category(host.get("client_config"))),
            ("steering_config", _category(host.get("steering_config"))),
        ) if value
    }


def map_netskope_objects(users: list[dict[str, Any]], devices: list[dict[str, Any]]) -> list[InventoryObject]:
    objects: list[InventoryObject] = []
    # Every row is observed before any user is left out: the same id read twice with different content,
    # including once deleted and once alive, is a contradictory read and must fail instead of picking a side.
    observed: dict[str, Any] = {}
    for user in users:
        source_id = _text(user.get("id"))
        if not source_id:
            raise ValueError("Netskope users devolvió un usuario sin id")
        summary = netskope_account_summary(user)
        display_name = " ".join(part for part in (_text(user.get("givenName")), _text(user.get("familyName"))) if part)
        item = None if summary is not None and summary["deleted_only"] else InventoryObject(
            object_type="user", source_id=source_id,
            display_name=display_name or source_id,
            source_system=SOURCE_SYSTEM,
            attributes={"email": _first_email(user), "company": _company_from_identity(_first_email(user)), **(summary["attributes"] if summary else {})},
        )
        if source_id in observed:
            if observed[source_id] != item:
                raise ValueError(f"Netskope users devolvió el usuario {source_id!r} dos veces con contenido distinto")
            continue
        observed[source_id] = item
        if item is not None:
            objects.append(item)
    for device in devices:
        source_id = _text(device.get("device_id"))
        if not source_id:
            raise ValueError("Netskope clientstatus devolvió un dispositivo sin device_id")
        host = device.get("host_info") if isinstance(device.get("host_info"), dict) else {}
        user_info = device.get("user_info") if isinstance(device.get("user_info"), dict) else {}
        last_event = device.get("last_seen_device_event") if isinstance(device.get("last_seen_device_event"), dict) else {}
        objects.append(InventoryObject(
            object_type="device", source_id=source_id,
            display_name=_text(host.get("hostname")) or source_id,
            source_system=SOURCE_SYSTEM,
            attributes={
                "hostname": _text(host.get("hostname")), "device_make": _text(host.get("device_make")),
                "device_model": _text(host.get("device_model")), "os": _text(host.get("os")),
                "os_version": _text(host.get("os_version")), "client_version": _text(device.get("client_version")),
                "guid": _text(device.get("guid")), "heartbeat": device.get("heart_beat") if isinstance(device.get("heart_beat"), bool) else None,
                "user_key": _text(user_info.get("userkey")), "username": _text(user_info.get("username")),
                "company": _company_from_identity(user_info.get("username") or user_info.get("userkey")),
                "user_status": _text(device.get("user_status")), "classification_status": _text(user_info.get("device_classification_status")),
                "last_event_timestamp": device.get("last_event_timestamp") if isinstance(device.get("last_event_timestamp"), int) else None,
                "last_seen_event": _text(last_event.get("event")),
                **onprem_fields(device),
            },
        ))
    return objects


def map_netskope_dem_sites(sites: list[dict[str, Any]]) -> list[InventoryObject]:
    """Project only the approved DEM site fields; never persist locations or embedded assets."""
    objects: list[InventoryObject] = []
    seen_ids: set[str] = set()
    for site in sites:
        source_id = _text(site.get("id"))
        name = _text(site.get("name"))
        if not source_id or not name:
            raise ValueError("Netskope DEM devolvió un site sin id o name")
        if source_id in seen_ids:
            raise ValueError("Netskope DEM devolvió un site duplicado")
        seen_ids.add(source_id)

        attributes: dict[str, Any] = {}
        for key in ("revision", "date_create", "date_modify"):
            value = site.get(key)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError(f"Netskope DEM devolvió {key} inválido")
                attributes[key] = value.strip()
        for key in ("num_gateways", "num_runners"):
            value = site.get(key)
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise ValueError(f"Netskope DEM devolvió {key} inválido")
                attributes[key] = value
        tracing = site.get("pop_tracing")
        if tracing is not None:
            if not isinstance(tracing, dict):
                raise ValueError("Netskope DEM devolvió pop_tracing inválido")
            safe_tracing: dict[str, Any] = {}
            for key, expected_type in (("gslb", bool), ("method", str), ("period", int)):
                value = tracing.get(key)
                if value is None:
                    continue
                if not isinstance(value, expected_type) or (key == "period" and (isinstance(value, bool) or value < 0)):
                    raise ValueError(f"Netskope DEM devolvió pop_tracing.{key} inválido")
                safe_tracing[key] = value.strip() if isinstance(value, str) else value
            attributes["pop_tracing"] = safe_tracing
        objects.append(InventoryObject(
            object_type="dem_site", source_id=source_id, display_name=name,
            source_system=SOURCE_SYSTEM, attributes=attributes,
        ))
    return objects


GROUP_OBJECT_TYPE = "netskope_group"
GROUP_MEMBERSHIP = "member_of"


POLICY_GROUP_OBJECT_TYPE = "netskope_policy_group"


def map_netskope_policy_groups(groups: list[dict[str, Any]]) -> list[InventoryObject]:
    """NSK-POLICY-002 allowlist: id, name, type and whether an admin may edit/delete it.

    ``created_by``/``modify_by`` (administrator identities) and the modification time are never persisted. A
    missing or duplicate id or name aborts the read instead of inventing or dropping a group.
    """
    objects: list[InventoryObject] = []
    seen_ids: set[str] = set()
    for group in groups:
        raw_id = group.get("group_id")
        source_id = _text(raw_id) if isinstance(raw_id, str) else (str(raw_id) if isinstance(raw_id, int) and not isinstance(raw_id, bool) else "")
        name = _text(group.get("group_name"))
        if not source_id or not name:
            raise ValueError("Netskope devolvió un grupo de políticas sin group_id o group_name")
        if source_id in seen_ids:
            raise ValueError("Netskope devolvió un grupo de políticas duplicado")
        seen_ids.add(source_id)
        attributes: dict[str, Any] = {}
        group_type = _text(group.get("group_type"))
        if group_type:
            attributes["group_type"] = group_type
        editable = group.get("can_be_edited_deleted")
        if isinstance(editable, bool):
            attributes["can_be_edited_deleted"] = editable
        objects.append(InventoryObject(
            object_type=POLICY_GROUP_OBJECT_TYPE, source_id=source_id, display_name=name,
            source_system=SOURCE_SYSTEM, attributes=attributes,
        ))
    return objects


def map_netskope_groups(groups: list[dict[str, Any]]) -> list[InventoryObject]:
    """NSK-GRP-001 allowlist: id, name, provisioner and the reported member count.

    Timestamps, collection ids and modifier identities are never persisted. A
    group Netskope marks as deleted is left out of the snapshot, so a complete
    run retires it. ``user_count`` is omitted when Netskope does not report it:
    absence is "unknown", never zero.
    """
    objects: list[InventoryObject] = []
    seen_ids: set[str] = set()
    for group in groups:
        source_id = _text(group.get("id"))
        name = _text(group.get("displayName"))
        if not source_id or not name:
            raise ValueError("Netskope getgroups devolvió un grupo sin id o displayName")
        if source_id in seen_ids:
            raise ValueError("Netskope getgroups devolvió un grupo duplicado")
        seen_ids.add(source_id)
        if group.get("deleted") is True:
            continue
        attributes: dict[str, Any] = {"provisioner": _text(group.get("provisioner"))}
        scim_id = _text(group.get("scimId"))
        if scim_id:
            attributes["scim_id"] = scim_id
        count = group.get("userCount")
        if count is not None:
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise ValueError("Netskope getgroups devolvió userCount inválido")
            attributes["user_count"] = count
        objects.append(InventoryObject(
            object_type=GROUP_OBJECT_TYPE, source_id=source_id, display_name=name,
            source_system=SOURCE_SYSTEM, attributes=attributes,
        ))
    return objects


def map_netskope_group_memberships(
    users: list[dict[str, Any]], group_ids: set[str],
) -> tuple[list[InventoryRelationship], int]:
    """`user --member_of--> netskope_group` from each account's ``parentGroups``.

    ``parentGroups`` holds group ``id`` values (verified on the tenant; display
    names repeat across groups, so they are never used). Accounts Netskope marks
    deleted do not count. References to a group absent from the listing are
    returned as an unresolved count instead of being linked or invented.
    """
    pairs: set[tuple[str, str]] = set()
    unresolved: set[tuple[str, str]] = set()
    for user in users:
        user_id = _text(user.get("id"))
        accounts = user.get("accounts")
        if not user_id or not isinstance(accounts, list):
            continue
        for account in accounts:
            if not isinstance(account, dict) or account.get("deleted") is True:
                continue
            parents = account.get("parentGroups")
            for group_id in parents if isinstance(parents, list) else []:
                group_id = _text(group_id)
                if not group_id:
                    continue
                (pairs if group_id in group_ids else unresolved).add((user_id, group_id))
    relationships = [
        InventoryRelationship(
            source_type="user", source_id=user_id, target_type=GROUP_OBJECT_TYPE, target_id=group_id,
            relationship_type=GROUP_MEMBERSHIP, source_system=SOURCE_SYSTEM,
        )
        for user_id, group_id in sorted(pairs)
    ]
    return relationships, len(unresolved)
