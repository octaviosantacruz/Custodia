from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cyberark.pam.repositories.account_sync import persist_account_sync
from app.cyberark.pam.services.pam_account_mapping import normalize_accounts


async def sync_accounts(
    pool: AsyncConnectionPool,
    accounts: list[dict[str, Any]],
    safe_ids_by_name: dict[str, str],
    platform_names: dict[str, str],
    source_run_id: UUID,
) -> dict[str, int]:
    """Persist account identity and placement without retaining secrets."""
    normalized, skipped = normalize_accounts(accounts, safe_ids_by_name, platform_names)
    retired = await persist_account_sync(pool, normalized, skipped, source_run_id)
    return {"accounts": len(normalized), "skipped_accounts": skipped, "retired_accounts": retired}
