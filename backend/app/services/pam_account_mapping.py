"""Pure normalization of CyberArk account payloads."""

from typing import Any


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
            },
        })
    return normalized, skipped
