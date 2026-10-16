"""Admin-configured compliance baselines for the Netskope inventory
(NSK-VER-001 / NSK-FLT-001). Reads are plain; every write is audited in the
same transaction as the change."""

from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.repositories.audit import record_audit

BASELINE_KEYS = ("client_golden_releases", "os_minimum_versions")


async def get_netskope_baselines(pool: AsyncConnectionPool) -> dict[str, dict[str, Any] | None]:
    rows = await fetch_all(pool, """
        SELECT baseline_key, value, note, updated_by, updated_at
        FROM public.netskope_baselines
    """)
    baselines: dict[str, dict[str, Any] | None] = {key: None for key in BASELINE_KEYS}
    for row in rows:
        baselines[row["baseline_key"]] = {key: row[key] for key in ("value", "note", "updated_by", "updated_at")}
    return baselines


async def save_netskope_baseline(
    pool: AsyncConnectionPool, baseline_key: str, value: dict[str, Any], note: str | None, actor_id: str,
) -> dict[str, Any]:
    if baseline_key not in BASELINE_KEYS:
        raise ValueError("Línea base Netskope desconocida")
    async with pool.connection() as conn:
        async with conn.transaction():
            cursor = await conn.execute(
                "SELECT value, note FROM public.netskope_baselines WHERE baseline_key = %s FOR UPDATE",
                (baseline_key,),
            )
            before = await cursor.fetchone()
            cursor = await conn.execute(
                """INSERT INTO public.netskope_baselines (baseline_key, value, note, updated_by, updated_at)
                   VALUES (%s, %s, %s, %s, now())
                   ON CONFLICT (baseline_key) DO UPDATE
                       SET value = EXCLUDED.value, note = EXCLUDED.note,
                           updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
                   RETURNING value, note, updated_by, updated_at""",
                (baseline_key, Jsonb(value), note, actor_id),
            )
            saved = await cursor.fetchone()
            await record_audit(
                pool, connection=conn, actor_id=actor_id,
                action="update" if before else "create",
                entity_type="netskope_baseline", entity_id=baseline_key,
                before_data=dict(before) if before else None,
                after_data={"value": saved["value"], "note": saved["note"]},
            )
    return dict(saved)
