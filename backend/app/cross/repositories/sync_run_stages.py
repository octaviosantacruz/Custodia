"""Persistence for per-stage sync outcomes (``public.sync_run_stages``)."""

from __future__ import annotations

import logging
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.services.sync_stages import StageOutcome
from app.db import fetch_all


LOGGER = logging.getLogger(__name__)


async def save_sync_stages(pool: AsyncConnectionPool, run_id: UUID, outcomes: list[StageOutcome]) -> None:
    """Best effort: losing stage telemetry must never fail or mask a sync."""
    if not outcomes:
        return
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM public.sync_run_stages WHERE run_id = %s", (run_id,))
                for position, item in enumerate(outcomes):
                    await conn.execute(
                        """INSERT INTO public.sync_run_stages
                               (run_id, position, stage, required, status, item_count,
                                duration_ms, error_kind, detail)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (run_id, position, item.stage, item.required, item.status, item.item_count,
                         item.duration_ms, item.error_kind, item.detail),
                    )
    except Exception:
        LOGGER.exception("No se pudieron guardar las capas de la corrida %s", run_id)


async def list_sync_stages(pool: AsyncConnectionPool, run_id: UUID) -> list[dict]:
    return await fetch_all(pool, """
        SELECT s.stage, s.required, s.status, s.item_count, s.duration_ms, s.error_kind, s.detail,
               r.source_system
        FROM public.sync_run_stages s
        JOIN public.cyberark_ingestion_runs r USING (run_id)
        WHERE s.run_id = %s
        ORDER BY s.position
    """, (run_id,))


async def latest_stage_freshness(pool: AsyncConnectionPool, source_system: str) -> list[dict]:
    """Per layer: last successful and last attempted finished run (skipped stages ignored)."""
    return await fetch_all(pool, """
        SELECT s.stage,
               max(r.completed_at) FILTER (WHERE s.status = 'completed') AS last_success_at,
               (array_agg(s.status ORDER BY r.completed_at DESC))[1] AS last_status,
               max(r.completed_at) AS last_attempt_at
        FROM public.sync_run_stages s
        JOIN public.cyberark_ingestion_runs r USING (run_id)
        WHERE r.source_system = %s AND r.completed_at IS NOT NULL AND s.status <> 'skipped'
        GROUP BY s.stage
        ORDER BY s.stage
    """, (source_system,))


async def list_stage_history(pool: AsyncConnectionPool, source_system: str, runs: int) -> list[dict]:
    """Stage outcomes of the source's latest ``runs`` finished runs, newest first (skipped ignored)."""
    return await fetch_all(pool, """
        WITH recent AS (
            SELECT run_id, completed_at
            FROM public.cyberark_ingestion_runs
            WHERE source_system = %s AND completed_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.sync_run_stages s WHERE s.run_id = cyberark_ingestion_runs.run_id)
            ORDER BY completed_at DESC
            LIMIT %s
        )
        SELECT recent.run_id, recent.completed_at, s.stage, s.status, s.item_count, s.duration_ms
        FROM recent
        JOIN public.sync_run_stages s USING (run_id)
        WHERE s.status <> 'skipped'
        ORDER BY recent.completed_at DESC, s.position
    """, (source_system, runs))
