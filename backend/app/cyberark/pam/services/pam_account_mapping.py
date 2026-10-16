"""Pure normalization of CyberArk account payloads."""

from datetime import datetime, timezone
from typing import Any


SECRET_MANAGEMENT_FIELD = "secretManagement"
AUTOMATIC_MANAGEMENT_ENABLED_FIELD = "automaticManagementEnabled"
MANAGEMENT_STATUS_FIELD = "status"
SECRET_MODIFIED_TIME_FIELD = "lastModifiedTime"
MAX_SECRET_MODIFIED_EPOCH = 4_102_444_800


def _secret_management_attributes(account: dict[str, Any]) -> dict[str, Any]:
    secret_management = account.get(SECRET_MANAGEMENT_FIELD)
    if not isinstance(secret_management, dict):
        secret_management = {}

    automatic_management_enabled = secret_management.get(AUTOMATIC_MANAGEMENT_ENABLED_FIELD)
    if not isinstance(automatic_management_enabled, bool):
        automatic_management_enabled = None

    status = secret_management.get(MANAGEMENT_STATUS_FIELD)
    normalized_status = status.strip().lower() if isinstance(status, str) else ""
    management_status = {
        "success": "success",
        "failure": "failure",
        "inprocess": "in_process",
        "in_process": "in_process",
    }.get(normalized_status)

    modified_epoch = secret_management.get(SECRET_MODIFIED_TIME_FIELD)
    secret_modified_at = None
    if (
        isinstance(modified_epoch, int)
        and not isinstance(modified_epoch, bool)
        and 0 < modified_epoch < MAX_SECRET_MODIFIED_EPOCH
    ):
        secret_modified_at = datetime.fromtimestamp(modified_epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "automatic_management_enabled": automatic_management_enabled,
        "management_status": management_status,
        "secret_modified_at": secret_modified_at,
    }


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _identifier(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return ""


def _account_identifier(account: dict[str, Any]) -> str:
    for key in ("id", "accountId", "accountID", "account_id"):
        value = _identifier(account.get(key))
        if value:
            return value
    return ""


def _account_text(account: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = _text(account.get(key))
        if value:
            return value
    return ""


def normalize_accounts(
    accounts: list[dict[str, Any]],
    safe_ids_by_name: dict[str, str],
    platform_names: dict[str, str],
) -> tuple[list[dict[str, Any]], int]:
    """Return database-ready account records and the number skipped."""
    normalized: list[dict[str, Any]] = []
    skipped = 0
    for account in accounts:
        safe_number = safe_ids_by_name.get(_account_text(account, "safeName", "safe_name"))
        account_id = _account_identifier(account)
        if not safe_number or not account_id:
            skipped += 1
            continue
        platform_id = _account_text(account, "platformId", "platformID", "platform_id") or None
        account_name = _account_text(account, "name", "accountName", "account_name", "userName", "username") or account_id
        user_name = _account_text(account, "userName", "username", "user_name") or None
        address = _account_text(account, "address") or None
        normalized.append({
            "safe_number": int(safe_number), "account_id": account_id, "account_name": account_name,
            "user_name": user_name, "address": address, "platform_id": platform_id,
            "platform_name": platform_names.get(platform_id or ""),
            "attributes": {
                "account_type": _account_text(account, "accountType", "account_type") or None,
                "category": _account_text(account, "category"),
                **_secret_management_attributes(account),
            },
        })
    return normalized, skipped
