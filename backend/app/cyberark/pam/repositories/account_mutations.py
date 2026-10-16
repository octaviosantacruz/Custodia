from __future__ import annotations

import json

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.audit import record_audit


async def update_account_inventory_classification(
    pool: AsyncConnectionPool,
    safe_number: int,
    account_id: str,
    inventory_account_type: str | None,
    actor_id: str,
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """SELECT to_jsonb(a) AS data
                       FROM public.cyberark_accounts a
                       WHERE a.safe_number = %s AND a.account_id = %s""",
                    (safe_number, account_id),
                )
                before = await cursor.fetchone()
                if before is None:
                    return None
                await cursor.execute(
                    """UPDATE public.cyberark_accounts
                       SET inventory_account_type = %s, updated_at = now()
                       WHERE safe_number = %s AND account_id = %s
                       RETURNING safe_number, account_id, account_name, user_name, address,
                                 platform_id, platform_name, lifecycle_status, last_seen_at,
                                 attributes, inventory_account_type""",
                    (inventory_account_type, safe_number, account_id),
                )
                after = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="account_inventory_classification",
                    entity_id=f"{safe_number}:{account_id}",
                    before_data=before["data"],
                    after_data=after,
                    dumps=lambda value: json.dumps(value, default=str),
                )
                return after
