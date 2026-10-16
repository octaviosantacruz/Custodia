from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.cross.repositories.audit import record_audit
from app.cross.repositories.operational_logs import record_operational_log
from app.cross.services.sync_schedule import SourceRunHistory


_RUN_COLUMNS = """
        run_id, source_system, source_file, task_key, status, enqueued_at, started_at, completed_at,
        status_message, attempt_count,
        worker_id, heartbeat_at, lease_expires_at,
        expected_safe_count, received_safe_count, received_member_count,
        received_object_count, received_relationship_count,
        retired_object_count, retired_relationship_count,
        error_count, error_details, triggered_by,
        safes_created, safes_updated, safes_retired,
        members_created, members_updated, members_retired, pam_synced
"""


async def list_ingestion_runs(pool: AsyncConnectionPool, limit: int):
    return await fetch_all(pool, f"""
        SELECT {_RUN_COLUMNS}
        FROM public.cyberark_ingestion_runs
        ORDER BY started_at DESC
        LIMIT %s
    """, (limit,))


async def get_ingestion_run(pool: AsyncConnectionPool, run_id: UUID):
    return await fetch_one(pool, f"""
        SELECT {_RUN_COLUMNS}
        FROM public.cyberark_ingestion_runs
        WHERE run_id = %s
    """, (run_id,))


async def last_scheduled_ingestion_at(pool: AsyncConnectionPool) -> datetime | None:
    """Return the enqueue time of the last automatic cycle.

    It deliberately uses ``enqueued_at`` rather than completion time: the
    cadence governs when work is admitted, while source workers may run in
    parallel and finish at different times.
    """
    row = await fetch_one(pool, """
        SELECT max(enqueued_at) AS last_scheduled_at
        FROM public.cyberark_ingestion_runs
        WHERE triggered_by = 'system:scheduler'
    """)
    return row["last_scheduled_at"] if row else None


async def source_run_history(pool: AsyncConnectionPool) -> dict[str, SourceRunHistory]:
    """Per-task outcome history that drives the scheduler (SYNC-TASK-001).

    Keyed by ``task_key``, which equals ``source_system`` for every source
    that has a single task; PAM's two jobs still share one. ``partial``
    counts as a refresh (the run finished and wrote data);
    ``consecutive_failures`` counts failed runs since the last success.
    """
    rows = await fetch_all(pool, """
        WITH per_task AS (
             SELECT task_key,
                    max(completed_at) FILTER (WHERE status IN ('completed', 'partial')) AS last_success_at,
                    max(completed_at) FILTER (WHERE status = 'failed') AS last_failure_at,
                    max(coalesce(completed_at, started_at, enqueued_at)) AS last_attempt_at,
                    bool_or(status IN ('queued', 'running')) AS active
            FROM public.cyberark_ingestion_runs
            GROUP BY task_key
        )
        SELECT p.task_key, p.last_success_at, p.last_failure_at, p.last_attempt_at, p.active,
               (SELECT r.status FROM public.cyberark_ingestion_runs r
                  WHERE r.task_key = p.task_key
                  ORDER BY coalesce(r.completed_at, r.started_at, r.enqueued_at) DESC LIMIT 1) AS last_status,
               (SELECT count(*) FROM public.cyberark_ingestion_runs r
                 WHERE r.task_key = p.task_key AND r.status = 'failed'
                   AND (p.last_success_at IS NULL OR r.completed_at > p.last_success_at)) AS consecutive_failures
        FROM per_task p
    """)
    return {
        row["task_key"]: SourceRunHistory(
            last_success_at=row["last_success_at"], last_failure_at=row["last_failure_at"],
            consecutive_failures=int(row["consecutive_failures"] or 0), active=bool(row["active"]),
            last_attempt_at=row["last_attempt_at"], last_status=row["last_status"],
        )
        for row in rows
    }


async def list_sync_schedule_overrides(pool: AsyncConnectionPool) -> dict[str, dict[str, Any]]:
    rows = await fetch_all(pool, """
        SELECT task_key, interval_minutes, updated_by, updated_at
        FROM public.sync_schedule_overrides
        ORDER BY task_key
    """)
    return {row["task_key"]: row for row in rows}


async def list_sync_task_history(pool: AsyncConnectionPool) -> dict[str, dict[str, Any]]:
    rows = await fetch_all(pool, """
        WITH per_task AS (
            SELECT task_key,
                   max(completed_at) FILTER (WHERE status IN ('completed', 'partial')) AS last_success_at,
                   max(coalesce(completed_at, started_at, enqueued_at)) AS last_attempt_at,
                    max(completed_at) FILTER (WHERE status = 'failed') AS last_failure_at,
                    bool_or(status IN ('queued', 'running')) AS active
            FROM public.cyberark_ingestion_runs
            GROUP BY task_key
        ), latest AS (
            SELECT DISTINCT ON (task_key) task_key, status, completed_at, started_at, enqueued_at
            FROM public.cyberark_ingestion_runs
            ORDER BY task_key, coalesce(completed_at, started_at, enqueued_at) DESC
        )
        SELECT p.task_key, p.last_success_at, p.last_attempt_at, p.last_failure_at,
               p.active, latest.status AS last_status,
               (SELECT count(*) FROM public.cyberark_ingestion_runs r
                 WHERE r.task_key = p.task_key AND r.status = 'failed'
                   AND (p.last_success_at IS NULL OR r.completed_at > p.last_success_at)) AS consecutive_failures
        FROM per_task p JOIN latest USING (task_key)
    """)
    return {row["task_key"]: row for row in rows}


async def set_sync_schedule_override(
    pool: AsyncConnectionPool, *, task_key: str, interval_minutes: float | None, actor_id: str,
) -> None:
    """Persist a task cadence and its audit event atomically; None removes it."""
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended('dshub:sync-schedule:' || %s, 0))",
                (task_key,),
            )
            cursor = await conn.execute(
                "SELECT task_key, interval_minutes FROM public.sync_schedule_overrides WHERE task_key = %s FOR UPDATE",
                (task_key,),
            )
            before = await cursor.fetchone()
            if before is not None:
                before = {**before, "interval_minutes": float(before["interval_minutes"])}
            if interval_minutes is None:
                await conn.execute("DELETE FROM public.sync_schedule_overrides WHERE task_key = %s", (task_key,))
                after = None
            else:
                cursor = await conn.execute("""
                    INSERT INTO public.sync_schedule_overrides (task_key, interval_minutes, updated_by)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (task_key) DO UPDATE
                    SET interval_minutes = EXCLUDED.interval_minutes,
                        updated_by = EXCLUDED.updated_by, updated_at = now()
                    RETURNING task_key, interval_minutes
                """, (task_key, interval_minutes, actor_id))
                after = await cursor.fetchone()
                after = {**after, "interval_minutes": float(after["interval_minutes"])}
            await record_audit(
                pool, connection=conn, actor_id=actor_id, action="update",
                entity_type="sync_schedule", entity_id=task_key,
                before_data=before, after_data=after,
            )


def scheduled_cycle_delay_seconds(
    last_scheduled_at: datetime | None, interval_minutes: float, *, now: datetime | None = None,
) -> float:
    """Return how long a restarted scheduler should wait before its cycle.

    No previous cycle means it is due immediately. Datetimes from PostgreSQL
    are timezone-aware; normalizing an injected naive test value keeps this
    helper deterministic without changing production behavior.
    """
    if last_scheduled_at is None:
        return 0.0
    current = now or datetime.now(timezone.utc)
    if last_scheduled_at.tzinfo is None:
        last_scheduled_at = last_scheduled_at.replace(tzinfo=timezone.utc)
    return max((last_scheduled_at + timedelta(minutes=interval_minutes) - current).total_seconds(), 0.0)


async def get_ingestion_schedule(pool: AsyncConnectionPool, interval_minutes: float) -> dict[str, object]:
    last_scheduled_at = await last_scheduled_ingestion_at(pool)
    delay_seconds = scheduled_cycle_delay_seconds(last_scheduled_at, interval_minutes)
    return {
        "enabled": interval_minutes > 0,
        "interval_minutes": interval_minutes,
        "last_scheduled_at": last_scheduled_at,
        "next_scheduled_at": (
            datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
            if interval_minutes > 0 else None
        ),
    }


async def create_ingestion_run(
    pool: AsyncConnectionPool, run_id: UUID, expected_safe_count: int | None = None,
    triggered_by: str | None = None, source_system: str = "cyberark",
    source_file: str | None = None,
) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            resolved_source_file = source_file or f"{source_system}-api"
            await conn.execute(
                """INSERT INTO public.cyberark_ingestion_runs
                     (run_id, source_system, source_file, status, expected_safe_count, triggered_by)
                   VALUES (%s, %s, %s, 'running', %s, %s)""",
                (run_id, source_system, resolved_source_file, expected_safe_count, triggered_by),
            )
            await record_audit(
                pool,
                connection=conn,
                actor_id=triggered_by or "system:ingestion",
                action="sync_start",
                entity_type="ingestion_run",
                entity_id=str(run_id),
                after_data={
                    "source_system": source_system,
                    "source_file": resolved_source_file,
                    "status": "running",
                    "expected_safe_count": expected_safe_count,
                },
            )


async def update_ingestion_expected(pool: AsyncConnectionPool, run_id: UUID, expected_count: int | None) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE public.cyberark_ingestion_runs SET expected_safe_count = %s WHERE run_id = %s",
            (expected_count, run_id),
        )
        await conn.commit()


async def update_ingestion_progress(
    pool: AsyncConnectionPool, run_id: UUID, status_message: str, source_system: str = "ingestion",
) -> None:
    """Refresh the visible heartbeat without creating an audit event per stage."""
    async with pool.connection() as conn:
        await conn.execute(
            """UPDATE public.cyberark_ingestion_runs
               SET status_message = %s, heartbeat_at = now(),
                   lease_expires_at = now() + interval '15 minutes'
               WHERE run_id = %s AND status = 'running'""",
            (status_message, run_id),
        )
        await conn.commit()
    await record_operational_log(
        pool, level="info", source_system=source_system, event="sync_progress",
        message=status_message, run_id=run_id,
    )


async def finish_ingestion_run(
    pool: AsyncConnectionPool, run_id: UUID, status: str, safe_count: int, member_count: int,
    errors: list[dict[str, str]], breakdown: dict[str, int | bool] | None = None,
    source_counts: dict[str, int] | None = None,
) -> None:
    counts = breakdown or {}
    generic = source_counts or {}
    # Additive, run-level counters worth keeping next to the completion log:
    # PSM reference resolution and mapping gaps. Fixed run columns cannot hold
    # them, so they travel in the operational log metadata.
    run_counters = {
        key: value
        for source in (counts, generic)
        for key, value in source.items()
        if key.startswith(("psm_references_", "skipped_"))
    }
    async with pool.connection() as conn:
        received_objects = int(generic.get("objects", safe_count))
        received_relationships = int(generic.get("relationships", member_count))
        retired_objects = int(generic.get("retired_objects", counts.get("safes_retired", 0)))
        retired_relationships = int(generic.get("retired_relationships", counts.get("members_retired", 0)))
        async with conn.transaction():
            cursor = await conn.execute(
                """UPDATE public.cyberark_ingestion_runs
                   SET status = %s, completed_at = now(), received_safe_count = %s,
                       received_member_count = %s, error_count = %s, error_details = %s,
                       received_object_count = %s, received_relationship_count = %s,
                       retired_object_count = %s, retired_relationship_count = %s,
                       safes_created = %s, safes_updated = %s, safes_retired = %s,
                       members_created = %s, members_updated = %s, members_retired = %s,
                       pam_synced = %s
                   WHERE run_id = %s
                   RETURNING source_system, source_file, triggered_by""",
                (
                    status, safe_count, member_count, len(errors), Jsonb(errors),
                    received_objects, received_relationships, retired_objects, retired_relationships,
                    int(counts.get("safes_created", 0)), int(counts.get("safes_updated", 0)),
                    int(counts.get("safes_retired", 0)), int(counts.get("members_created", 0)),
                    int(counts.get("members_updated", 0)), int(counts.get("members_retired", 0)),
                    bool(counts.get("pam_synced", False)), run_id,
                ),
            )
            run = await cursor.fetchone()
            if run is None:
                return
            await record_audit(
                pool,
                connection=conn,
                actor_id=run["triggered_by"] or "system:ingestion",
                action="sync_complete",
                entity_type="ingestion_run",
                entity_id=str(run_id),
                after_data={
                    "source_system": run["source_system"],
                    "source_file": run["source_file"],
                    "status": status,
                    "received_objects": received_objects,
                    "received_relationships": received_relationships,
                    "retired_objects": retired_objects,
                    "retired_relationships": retired_relationships,
                    "error_count": len(errors),
                },
            )
            await record_operational_log(
                pool, connection=conn,
                level={"completed": "info", "partial": "warning"}.get(status, "error"),
                source_system=run["source_system"],
                event={"completed": "sync_completed", "partial": "sync_partial"}.get(status, "sync_failed"),
                message={"completed": "Sincronización completada", "partial": "Sincronización completada con avisos"}.get(status, "Sincronización fallida"),
                run_id=run_id, metadata={"error_count": len(errors), **run_counters},
            )


async def current_inventory(pool: AsyncConnectionPool) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""
                SELECT safe_number, safe_name, safe_url_id, location, creator_id, creator_name,
                       olac_enabled, number_of_versions_retention, number_of_days_retention,
                       auto_purge_enabled, creation_time, last_modification_time, description,
                       managing_cpm, is_expired_member
                FROM public.safes WHERE lifecycle_status = 'active'
            """)
            safes = await cursor.fetchall()
            await cursor.execute("""
                SELECT safe_number, member_id, member_name, member_type,
                       membership_expiration_date, is_expired_membership_enable,
                       is_predefined_user, is_read_only, permissions
                FROM public.safe_members WHERE lifecycle_status = 'active'
            """)
            members = await cursor.fetchall()
    return safes, members
