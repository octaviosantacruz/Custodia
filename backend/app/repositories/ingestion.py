from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all, fetch_one
from .audit import record_audit


_RUN_COLUMNS = """
        run_id, source_system, source_file, status, enqueued_at, started_at, completed_at,
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


async def finish_ingestion_run(
    pool: AsyncConnectionPool, run_id: UUID, status: str, safe_count: int, member_count: int,
    errors: list[dict[str, str]], breakdown: dict[str, int | bool] | None = None,
    source_counts: dict[str, int] | None = None,
) -> None:
    counts = breakdown or {}
    generic = source_counts or {}
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
