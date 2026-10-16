"""Persistencia SQL de la sincronización de cuentas PAM (ARCH-LAYERS-001).

El servicio ``pam_accounts`` normaliza y decide; este repositorio ejecuta el
SQL y conserva en una única transacción la escritura de cuentas, el retiro de
ausentes, la retención de bajas (decisión 004) y su auditoría.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.audit import record_audit

SYNC_ACTOR_ID = "system:sync"

async def hold_decommissions_for_deleted_accounts(pool: AsyncConnectionPool, conn, cursor, safe_numbers: list[int]) -> list[int]:
    """Move a Safe that is being decommissioned to ``retention_hold`` once an account of it disappears.

    CyberArk keeps a deleted account through the Safe's retention and refuses to delete the Safe
    meanwhile, so for a Safe the team already marked "Dar de baja" the disappearance means the
    decommission is now waiting on that retention. Deliberately narrow: only Safes whose human
    next action is "Dar de baja" and whose status is still open (pending / in_progress / blocked) are
    touched, one status field only, and each change is audited in the same transaction. Any other
    Safe losing an account keeps the classification a person gave it.
    """
    if not safe_numbers:
        return []
    await cursor.execute(
        """
        SELECT m.safe_number, m.workflow_status
        FROM public.cyberark_safe_metadata m
        JOIN public.safes s ON s.safe_number = m.safe_number AND s.lifecycle_status = 'active'
        WHERE m.safe_number = ANY(%s)
          AND lower(btrim(m.next_action)) = 'dar de baja'
          AND m.workflow_status IN ('pending', 'in_progress', 'blocked')
        FOR UPDATE OF m
        """,
        (safe_numbers,),
    )
    held = await cursor.fetchall()
    for row in held:
        await cursor.execute(
            "UPDATE public.cyberark_safe_metadata SET workflow_status = 'retention_hold', updated_at = now() WHERE safe_number = %s",
            (row["safe_number"],),
        )
        await record_audit(
            pool, connection=conn, actor_id=SYNC_ACTOR_ID, action="update", entity_type="safe_metadata",
            entity_id=str(row["safe_number"]),
            before_data={"workflow_status": row["workflow_status"]},
            after_data={"workflow_status": "retention_hold", "reason": "account_retired_by_sync"},
        )
    return [row["safe_number"] for row in held]


async def persist_account_sync(
    pool: AsyncConnectionPool,
    normalized: list[dict[str, Any]],
    skipped: int,
    source_run_id: UUID,
) -> int:
    """Upsert the normalized accounts and, only for a complete run, retire the absent ones.

    Returns the number of retired accounts.
    """
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
                          retired_at = NULL,
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
                            retired_at = COALESCE(retired_at, now()),
                            updated_at = now()
                        WHERE lifecycle_status = 'active'
                          AND source_run_id IS DISTINCT FROM %s
                        RETURNING safe_number
                        """,
                        (source_run_id,),
                    )
                    retiring = await cursor.fetchall()
                    retired = len(retiring)
                    await hold_decommissions_for_deleted_accounts(
                        pool, conn, cursor, sorted({row["safe_number"] for row in retiring}),
                    )
    return retired
