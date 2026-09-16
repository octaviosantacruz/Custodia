from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

MAX_SAFE_INTEGER = 2**53 - 1
INTEGER_PATTERN = re.compile(r"^-?\d+$")

def _epoch_to_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    raw = int(value)
    seconds = raw / 1_000_000 if raw > 100_000_000_000_000 else raw
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def _value(value: dict[str, Any], camel: str, snake: str) -> Any:
    return value[camel] if camel in value else value.get(snake)


def _normalize_location(value: Any) -> str | None:
    if not isinstance(value, str):
        return None if value is None else str(value)
    normalized = value.strip()
    # CyberArk uses a lone backslash as the root/empty location value.
    return None if normalized in {"", "\\"} else normalized

def _safe_signature(value: dict[str, Any]) -> tuple[Any, ...]:
    creator = value.get("creator") or {}
    creator_id = creator.get("id") if "creator" in value else value.get("creator_id")
    creator_name = creator.get("name") if "creator" in value else value.get("creator_name")
    return (
        _value(value, "safeNumber", "safe_number"), _value(value, "safeName", "safe_name"),
        _value(value, "safeUrlId", "safe_url_id"), _normalize_location(value.get("location")),
        creator_id, creator_name, _value(value, "olacEnabled", "olac_enabled"),
        _value(value, "numberOfVersionsRetention", "number_of_versions_retention"),
        _value(value, "numberOfDaysRetention", "number_of_days_retention"),
        _value(value, "autoPurgeEnabled", "auto_purge_enabled"),
        _epoch_to_datetime(_value(value, "creationTime", "creation_time")),
        _epoch_to_datetime(_value(value, "lastModificationTime", "last_modification_time")),
        value.get("description"), _value(value, "managingCPM", "managing_cpm"),
        _value(value, "isExpiredMember", "is_expired_member"),
    )


def _member_signature(value: dict[str, Any]) -> tuple[Any, ...]:
    return (
        _value(value, "safeNumber", "safe_number"),
        (str(_value(value, "memberId", "member_id")) if _value(value, "memberId", "member_id") is not None else None),
        _value(value, "memberName", "member_name"), _value(value, "memberType", "member_type"),
        _epoch_to_datetime(_value(value, "membershipExpirationDate", "membership_expiration_date")),
        _value(value, "isExpiredMembershipEnable", "is_expired_membership_enable"),
        _value(value, "isPredefinedUser", "is_predefined_user"),
        _value(value, "isReadOnly", "is_read_only"), value.get("permissions"),
    )


# Human-readable, ordered field maps so the sync preview can say exactly what
# changed on a Safe or a membership instead of only "modificado". Kept in sync
# with _safe_signature / _member_signature above.
_SAFE_FIELD_LABELS: tuple[tuple[str, str], ...] = (
    ("safe_name", "Nombre"),
    ("safe_url_id", "URL ID"),
    ("location", "Ubicación"),
    ("creator_name", "Creador"),
    ("olac_enabled", "OLAC"),
    ("versions_retention", "Retención (versiones)"),
    ("days_retention", "Retención (días)"),
    ("auto_purge_enabled", "Purga automática"),
    ("creation_time", "Creación"),
    ("last_modification_time", "Última modificación"),
    ("description", "Descripción"),
    ("managing_cpm", "CPM"),
    ("is_expired_member", "Miembro vencido"),
)

_MEMBER_FIELD_LABELS: tuple[tuple[str, str], ...] = (
    ("member_name", "Nombre"),
    ("member_type", "Tipo"),
    ("membership_expiration_date", "Expiración"),
    ("is_expired_membership_enable", "Expiración habilitada"),
    ("is_predefined_user", "Predefinido"),
    ("is_read_only", "Solo lectura"),
)

_CHANGES_PER_ENTRY = 15


def _safe_fields(value: dict[str, Any]) -> dict[str, Any]:
    creator = value.get("creator") or {}
    creator_name = creator.get("name") if "creator" in value else value.get("creator_name")
    return {
        "safe_name": _value(value, "safeName", "safe_name"),
        "safe_url_id": _value(value, "safeUrlId", "safe_url_id"),
        "location": _normalize_location(value.get("location")),
        "creator_name": creator_name,
        "olac_enabled": _value(value, "olacEnabled", "olac_enabled"),
        "versions_retention": _value(value, "numberOfVersionsRetention", "number_of_versions_retention"),
        "days_retention": _value(value, "numberOfDaysRetention", "number_of_days_retention"),
        "auto_purge_enabled": _value(value, "autoPurgeEnabled", "auto_purge_enabled"),
        "creation_time": _epoch_to_datetime(_value(value, "creationTime", "creation_time")),
        "last_modification_time": _epoch_to_datetime(_value(value, "lastModificationTime", "last_modification_time")),
        "description": value.get("description"),
        "managing_cpm": _value(value, "managingCPM", "managing_cpm"),
        "is_expired_member": _value(value, "isExpiredMember", "is_expired_member"),
    }


def _member_fields(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "member_name": _value(value, "memberName", "member_name"),
        "member_type": _value(value, "memberType", "member_type"),
        "membership_expiration_date": _epoch_to_datetime(
            _value(value, "membershipExpirationDate", "membership_expiration_date")
        ),
        "is_expired_membership_enable": _value(value, "isExpiredMembershipEnable", "is_expired_membership_enable"),
        "is_predefined_user": _value(value, "isPredefinedUser", "is_predefined_user"),
        "is_read_only": _value(value, "isReadOnly", "is_read_only"),
        "permissions": _value(value, "permissions", "permissions") or {},
    }


def _serialize(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _field_changes(
    before: dict[str, Any], after: dict[str, Any], labels: tuple[tuple[str, str], ...]
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for key, label in labels:
        if before.get(key) != after.get(key):
            changes.append({"field": label, "before": _serialize(before.get(key)), "after": _serialize(after.get(key))})
    return changes


def _permission_changes(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for key in sorted(set(before) | set(after)):
        if bool(before.get(key)) != bool(after.get(key)):
            changes.append({"field": f"Permiso · {key}", "before": bool(before.get(key)), "after": bool(after.get(key))})
    return changes


def compare_inventory(
    current_safes: list[dict[str, Any]],
    current_members: list[dict[str, Any]],
    incoming_safes: list[dict[str, Any]],
    incoming_members: list[dict[str, Any]],
) -> dict[str, Any]:
    current_safe_map = {int(row["safe_number"]): row for row in current_safes}
    incoming_safe_map = {int(row["safeNumber"]): row for row in incoming_safes}
    # CyberArk returns memberId as number or text depending on the member.
    # Normalize the comparison key so a representation change is not a false delta.
    current_member_map = {(int(row["safe_number"]), str(row["member_id"])): row for row in current_members}
    incoming_member_map = {(int(row["safeNumber"]), str(row["memberId"])): row for row in incoming_members}

    new_safe_keys = set(incoming_safe_map) - set(current_safe_map)
    retired_safe_keys = set(current_safe_map) - set(incoming_safe_map)
    common_safe_keys = set(incoming_safe_map) & set(current_safe_map)
    changed_safe_keys = {
        key for key in common_safe_keys
        if _safe_signature(incoming_safe_map[key]) != _safe_signature(current_safe_map[key])
    }
    new_member_keys = set(incoming_member_map) - set(current_member_map)
    retired_member_keys = set(current_member_map) - set(incoming_member_map)
    common_member_keys = set(incoming_member_map) & set(current_member_map)
    changed_member_keys = {
        key for key in common_member_keys
        if _member_signature(incoming_member_map[key]) != _member_signature(current_member_map[key])
    }

    def safe_name(key: int) -> str:
        row = incoming_safe_map[key] if key in incoming_safe_map else current_safe_map[key]
        return str(row.get("safeName", row.get("safe_name", key)))

    def member_label(key: tuple[int, str]) -> dict[str, Any]:
        row = incoming_member_map[key] if key in incoming_member_map else current_member_map[key]
        return {
            "safe_number": key[0], "member_id": key[1],
            "member_name": row.get("memberName", row.get("member_name", "")),
        }

    def changed_safe_entry(key: int) -> dict[str, Any]:
        changes = _field_changes(
            _safe_fields(current_safe_map[key]), _safe_fields(incoming_safe_map[key]), _SAFE_FIELD_LABELS
        )
        return {"safe_number": key, "safe_name": safe_name(key), "changes": changes[:_CHANGES_PER_ENTRY]}

    def changed_member_entry(key: tuple[int, str]) -> dict[str, Any]:
        before = _member_fields(current_member_map[key])
        after = _member_fields(incoming_member_map[key])
        changes = _field_changes(before, after, _MEMBER_FIELD_LABELS)
        permission_changes = _permission_changes(before["permissions"], after["permissions"])
        return {
            **member_label(key),
            "changes": (changes + permission_changes)[:_CHANGES_PER_ENTRY],
            "security_relevant": bool(permission_changes) or any(item["field"] == "Tipo" for item in changes),
        }

    return {
        "safe_counts": {
            "incoming": len(incoming_safe_map), "current": len(current_safe_map),
            "new": len(new_safe_keys), "changed": len(changed_safe_keys),
            "unchanged": len(common_safe_keys) - len(changed_safe_keys),
            "retired": len(retired_safe_keys),
        },
        "member_counts": {
            "incoming": len(incoming_member_map), "current": len(current_member_map),
            "new": len(new_member_keys), "changed": len(changed_member_keys),
            "unchanged": len(common_member_keys) - len(changed_member_keys),
            "retired": len(retired_member_keys),
        },
        "samples": {
            "new_safes": [{"safe_number": key, "safe_name": safe_name(key)} for key in sorted(new_safe_keys)[:20]],
            "changed_safes": [changed_safe_entry(key) for key in sorted(changed_safe_keys)[:20]],
            "retired_safes": [{"safe_number": key, "safe_name": safe_name(key)} for key in sorted(retired_safe_keys)[:20]],
            "new_members": [member_label(key) for key in sorted(new_member_keys)[:20]],
            "changed_members": [changed_member_entry(key) for key in sorted(changed_member_keys)[:20]],
            "retired_members": [member_label(key) for key in sorted(retired_member_keys)[:20]],
        },
    }


def _is_safe_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= MAX_SAFE_INTEGER


def _assert_epoch(value: Any, field: str) -> None:
    if value is None:
        return
    if _is_safe_integer(value):
        return
    if isinstance(value, str) and INTEGER_PATTERN.fullmatch(value):
        return
    raise ValueError(f"{field} debe ser null o un epoch entero seguro")


def validate_entry(entry: dict[str, Any], index: int) -> None:
    safe_name = entry.get("safeName")
    safe_data = entry.get("safeData")
    members = entry.get("members")
    if not isinstance(safe_name, str) or not safe_name:
        raise ValueError(f"entry {index}: safeName invalido")
    if not isinstance(safe_data, dict):
        raise ValueError(f"{safe_name}: safeData debe ser un objeto")
    if not _is_safe_integer(safe_data.get("safeNumber")):
        raise ValueError(f"{safe_name}: safeData.safeNumber debe ser un entero seguro")
    if safe_data.get("safeName") != safe_name:
        raise ValueError(f"{safe_name}: safeData.safeName no coincide con safeName")
    if not isinstance(safe_data.get("safeUrlId"), str) or not safe_data["safeUrlId"]:
        raise ValueError(f"{safe_name}: safeData.safeUrlId invalido")
    for field in ("creationTime", "lastModificationTime"):
        if field not in safe_data:
            raise ValueError(f"{safe_name}: falta {field}")
        _assert_epoch(safe_data[field], f"{safe_name}.{field}")
    if not isinstance(members, list):
        raise ValueError(f"{safe_name}: members debe ser un array")

    for member_index, member in enumerate(members):
        if not isinstance(member, dict):
            raise ValueError(f"{safe_name}: member {member_index} debe ser un objeto")
        if not _is_safe_integer(member.get("safeNumber")):
            raise ValueError(f"{safe_name}: member {member_index}.safeNumber invalido")
        if member["safeNumber"] != safe_data["safeNumber"]:
            raise ValueError(f"{safe_name}: member {member_index}.safeNumber no coincide con el safe padre")
        for field in ("memberId", "memberName", "memberType"):
            if not isinstance(member.get(field), str) or not member[field]:
                raise ValueError(f"{safe_name}: member {member_index}.{field} invalido")
        if "membershipExpirationDate" not in member:
            raise ValueError(f"{safe_name}: falta membershipExpirationDate en member {member_index}")
        _assert_epoch(member["membershipExpirationDate"], f"{safe_name}.{member['memberId']}.membershipExpirationDate")
        if not isinstance(member.get("permissions"), dict):
            raise ValueError(f"{safe_name}: member {member['memberId']}.permissions debe ser un objeto")
