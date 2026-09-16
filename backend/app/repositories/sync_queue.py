"""Durable queue operations for source-isolated synchronization runs."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .audit import record_audit


async def enqueue_sync_run(
    pool: AsyncConnectionPool,
    run_id: UUID,
    *,
    source_system: str,
    source_file: str,
    triggered_by: str,
    options: dict[str, Any],
    idempotency_key: UUID | None = None,
) -> dict[str, Any]:
    """Persist a job and its audit record before any external API call."""
    async with pool.connection() as conn:
        async with conn.transaction():
            if idempotency_key is not None:
                cursor = await conn.execute(
                    """SELECT run_id, status FROM public.cyberark_ingestion_runs
                       WHERE triggered_by = %s AND idempotency_key = %s""",
                    (triggered_by, idempotency_key),
                )
                existing = await cursor.fetchone()
                if existing is not None:
                    return existing
            cursor = await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                   (run_id, source_system, source_file, status, triggered_by, run_options, idempotency_key)
                   VALUES (%s, %s, %s, 'queued', %s, %s, %s)
                   RETURNING run_id, status""",
                (run_id, source_system, source_file, triggered_by, Jsonb(options), idempotency_key),
            )
            row = await cursor.fetchone()
            await record_audit(
                pool,
                connection=conn,
                actor_id=triggered_by,
                action="sync_queued",
                entity_type="ingestion_run",
                entity_id=str(run_id),
                after_data={"source_system": source_system, "status": "queued"},
            )
            return row


async def enqueue_sync_runs(
    pool: AsyncConnectionPool,
    jobs: list[dict[str, Any]],
    *,
    triggered_by: str,
) -> list[dict[str, Any]]:
    """Enqueue one isolated job per source in a single transaction."""
    rows: list[dict[str, Any]] = []
    async with pool.connection() as conn:
        async with conn.transaction():
            for job in jobs:
                cursor = await conn.execute(
                    """INSERT INTO public.cyberark_ingestion_runs
                       (run_id, source_system, source_file, status, triggered_by, run_options)
                       VALUES (%s, %s, %s, 'queued', %s, %s)
                       RETURNING run_id, status, source_system""",
                    (job["run_id"], job["source_system"], job["source_file"], triggered_by, Jsonb(job["options"])),
                )
                row = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=triggered_by,
                    action="sync_queued",
                    entity_type="ingestion_run",
                    entity_id=str(job["run_id"]),
                    after_data={"source_system": job["source_system"], "status": "queued"},
                )
                rows.append(row)
    return rows


async def list_queued_sync_sources(pool: AsyncConnectionPool) -> list[str]:
    """Return sources with work, preserving each source's enqueue order."""
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """SELECT DISTINCT ON (source_system) source_system
               FROM public.cyberark_ingestion_runs
               WHERE status = 'queued'
               ORDER BY source_system, enqueued_at"""
        )
        return [row["source_system"] for row in await cursor.fetchall()]


async def claim_next_sync_run(
    pool: AsyncConnectionPool, *, source_system: str, worker_id: str
) -> dict[str, Any] | None:
    """Atomically mark the next queued job for one source as running."""
    async with pool.connection() as conn:
        async with conn.transaction():
            cursor = await conn.execute(
                """SELECT run_id, source_system, source_file, triggered_by, run_options
                   FROM public.cyberark_ingestion_runs
                   WHERE source_system = %s AND status = 'queued'
                   ORDER BY enqueued_at
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1""",
                (source_system,),
            )
            run = await cursor.fetchone()
            if run is None:
                return None
            await conn.execute(
                """UPDATE public.cyberark_ingestion_runs
                   SET status = 'running', started_at = now(), attempt_count = attempt_count + 1,
                       worker_id = %s, heartbeat_at = now(),
                       lease_expires_at = now() + interval '15 minutes',
                       status_message = 'Sincronización iniciada'
                   WHERE run_id = %s""",
                (worker_id, run["run_id"]),
            )
            await record_audit(
                pool,
                connection=conn,
                actor_id=run["triggered_by"] or "system:ingestion",
                action="sync_start",
                entity_type="ingestion_run",
                entity_id=str(run["run_id"]),
                after_data={
                    "source_system": run["source_system"],
                    "source_file": run["source_file"],
                    "status": "running",
                },
            )
            return run


async def requeue_expired_sync_runs(pool: AsyncConnectionPool) -> int:
    """Return jobs abandoned by a dead worker to the durable queue."""
    async with pool.connection() as conn:
        async with conn.transaction():
            cursor = await conn.execute(
                """UPDATE public.cyberark_ingestion_runs
                   SET status = 'queued', worker_id = NULL, heartbeat_at = NULL,
                       lease_expires_at = NULL,
                       status_message = 'La concesión del worker venció; corrida reencolada'
                   WHERE status = 'running' AND lease_expires_at < now()
                   RETURNING run_id, source_system, triggered_by"""
            )
            rows = await cursor.fetchall()
            for row in rows:
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=row["triggered_by"] or "system:ingestion",
                    action="sync_requeued",
                    entity_type="ingestion_run",
                    entity_id=str(row["run_id"]),
                    after_data={
                        "source_system": row["source_system"],
                        "status": "queued",
                        "reason": "worker_lease_expired",
                    },
                )
            return len(rows)


async def renew_sync_lease(
    pool: AsyncConnectionPool, run_id: UUID, *, worker_id: str
) -> bool:
    """Keep a live worker's lease valid without exposing progress changes."""
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """UPDATE public.cyberark_ingestion_runs
               SET heartbeat_at = now(), lease_expires_at = now() + interval '15 minutes'
               WHERE run_id = %s AND status = 'running' AND worker_id = %s""",
            (run_id, worker_id),
        )
        await conn.commit()
        return cursor.rowcount == 1


@asynccontextmanager
async def source_sync_lock(pool: AsyncConnectionPool, source_system: str):
    """Hold a PostgreSQL session lock so only one process syncs a source."""
    async with pool.connection() as conn:
        cursor = await conn.execute(
            "SELECT pg_try_advisory_lock(hashtextextended('dshub:sync:' || %s, 0)) AS acquired",
            (source_system,),
        )
        acquired = (await cursor.fetchone())["acquired"]
        try:
            yield bool(acquired)
        finally:
            if acquired:
                await conn.execute(
                    "SELECT pg_advisory_unlock(hashtextextended('dshub:sync:' || %s, 0))",
                    (source_system,),
                )
