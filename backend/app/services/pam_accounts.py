from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .pam_account_mapping import normalize_accounts

async def sync_accounts(
    pool: AsyncConnectionPool,
    accounts: list[dict[str, Any]],
    safe_ids_by_name: dict[str, str],
    platform_names: dict[str, str],
    source_run_id: UUID,
) -> dict[str, int]:
    """Persist account identity and placement without retaining secrets."""
    normalized, skipped = normalize_accounts(accounts, safe_ids_by_name, platform_names)

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                for item in normalized:
                    await cursor.execute(
                        """
                        INSERT INTO public.cyberark_accounts
                          (safe_number, account_id, account_name, user_name, address,
                           platform_id, platform_name, lifecycle_status, source_run_id, attributes)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s)
                        ON CONFLICT (safe_number, account_id) DO UPDATE SET
                          account_name = EXCLUDED.account_name,
                          user_name = EXCLUDED.user_name,
                          address = EXCLUDED.address,
                          platform_id = EXCLUDED.platform_id,
                          platform_name = EXCLUDED.platform_name,
                          lifecycle_status = 'active',
                          last_seen_at = now(),
                          source_run_id = EXCLUDED.source_run_id,
                          attributes = EXCLUDED.attributes,
                          updated_at = now()
                        """,
                        (item["safe_number"], item["account_id"], item["account_name"],
                         item["user_name"], item["address"], item["platform_id"],
                         item["platform_name"], source_run_id, Jsonb(item["attributes"])),
                    )
                retired = 0
                if skipped == 0:
                    await cursor.execute(
                        """
                        UPDATE public.cyberark_accounts
                        SET lifecycle_status = 'retired',
                            updated_at = now()
                        WHERE lifecycle_status = 'active'
                          AND source_run_id IS DISTINCT FROM %s
                        """,
                        (source_run_id,),
                    )
                    retired = cursor.rowcount
    return {"accounts": len(normalized), "skipped_accounts": skipped, "retired_accounts": retired}
