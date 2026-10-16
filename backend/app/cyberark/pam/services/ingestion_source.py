"""Shared CyberArk Safe and member acquisition for ingestion flows."""

from typing import Any

from app.cyberark.pam.client import CyberArkClient, CyberArkError


async def fetch_safes(
    client: CyberArkClient, *, page_size: int, max_safes: int = 0, reject_duplicates: bool = False
) -> tuple[list[dict[str, Any]], int | None]:
    safes, reported_count = await client.get_safes(page_size=page_size)
    if max_safes:
        safes = safes[:max_safes]
    if reject_duplicates:
        safe_numbers = [item.get("safeNumber") for item in safes]
        if len(safe_numbers) != len(set(safe_numbers)):
            raise CyberArkError("CyberArk devolvió safeNumber duplicado; se cancela el preview")
    return safes, reported_count


async def fetch_safe_members(
    client: CyberArkClient, safe_data: dict[str, Any], *, page_size: int, delay_seconds: float, index: int
) -> tuple[str, list[dict[str, Any]]]:
    safe_name = safe_data.get("safeName", f"entry-{index}")
    members, _ = await client.get_members(safe_name, page_size=page_size, delay_seconds=delay_seconds)
    return safe_name, members
