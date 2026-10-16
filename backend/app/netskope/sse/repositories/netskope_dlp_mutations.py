"""Write-side persistence for the minimal DLP alerts (NSK-DLP-001).

Only the allowlisted projection built by ``services/netskope_dlp_alerts.py``
reaches these functions; they never see a raw event payload.
"""

from collections.abc import Sequence
from contextlib import nullcontext
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool


async def upsert_netskope_dlp_alerts(
    pool: AsyncConnectionPool,
    run_id: UUID,
    alerts: Sequence[dict[str, Any]],
    *,
    connection: AsyncConnection | None = None,
) -> None:
    """Upsert by incident ID; an older event never overwrites a newer one."""
    if not alerts:
        return
    params = [(
        alert["incident_id"], alert["event_timestamp"], alert["status"],
        alert["severity"], alert["policy"], alert["action"], alert["user_id"], run_id,
    ) for alert in alerts]
    async with (nullcontext(connection) if connection is not None else pool.connection()) as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """
                    INSERT INTO public.netskope_dlp_alerts
                        (incident_id, event_timestamp, status, severity, policy, action, user_id, source_run_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (incident_id) DO UPDATE SET
                        event_timestamp = EXCLUDED.event_timestamp,
                        status = EXCLUDED.status,
                        severity = EXCLUDED.severity,
                        policy = EXCLUDED.policy,
                        action = EXCLUDED.action,
                        user_id = EXCLUDED.user_id,
                        source_run_id = EXCLUDED.source_run_id,
                        captured_at = now()
                    WHERE public.netskope_dlp_alerts.event_timestamp <= EXCLUDED.event_timestamp
                    """,
                    params,
                )


async def record_netskope_dlp_capture_state(
    pool: AsyncConnectionPool,
    *,
    iterator_index: str,
    coverage_start: datetime,
    coverage_end: datetime,
    partial: bool,
    scanned_events: int,
    captured_alerts: int,
    captured_at: datetime | None,
    run_id: UUID,
    connection: AsyncConnection | None = None,
) -> None:
    async with (nullcontext(connection) if connection is not None else pool.connection()) as conn:
        await conn.execute(
            """
            INSERT INTO public.netskope_dlp_capture_state
                (cache_key, iterator_index, coverage_start, coverage_end, partial,
                 scanned_events, captured_alerts, captured_at, last_run_id)
            VALUES ('default', %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (cache_key) DO UPDATE SET
                iterator_index = EXCLUDED.iterator_index,
                coverage_start = EXCLUDED.coverage_start,
                coverage_end = EXCLUDED.coverage_end,
                partial = EXCLUDED.partial,
                scanned_events = EXCLUDED.scanned_events,
                captured_alerts = EXCLUDED.captured_alerts,
                captured_at = EXCLUDED.captured_at,
                last_run_id = EXCLUDED.last_run_id
            """,
            (iterator_index, coverage_start, coverage_end, partial,
             scanned_events, captured_alerts, captured_at, run_id),
        )


async def purge_netskope_dlp_alerts(pool: AsyncConnectionPool, retention_days: int) -> int:
    """Delete alerts older than the retention window; returns rows removed."""
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """
            DELETE FROM public.netskope_dlp_alerts
            WHERE event_timestamp < now() - make_interval(days => %s)
            """,
            (retention_days,),
        )
        return cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0


async def persist_netskope_dlp_page(
    pool: AsyncConnectionPool,
    run_id: UUID,
    alerts: Sequence[dict[str, Any]],
    **state: Any,
) -> None:
    """Commit the projected page and its progress together, or neither."""
    async with pool.connection() as conn:
        async with conn.transaction():
            await upsert_netskope_dlp_alerts(pool, run_id, alerts, connection=conn)
            await record_netskope_dlp_capture_state(pool, run_id=run_id, connection=conn, **state)
