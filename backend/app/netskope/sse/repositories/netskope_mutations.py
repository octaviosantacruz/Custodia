"""Write-side persistence for the isolated Netskope inventory."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.netskope.sse.repositories.netskope_shared import valid_event_epoch

# NSK-EXP-PRESENCE-001: office/remote event days kept for weekly views and their trend.
PRESENCE_RETENTION_DAYS = 90


async def record_device_snapshots(
    pool: AsyncConnectionPool,
    run_id: UUID,
    devices: Sequence[dict[str, Any]],
) -> None:
    """Persist only the normalized, non-sensitive device projection."""
    if not devices:
        return
    params = [(run_id, device["source_id"], Jsonb(device["attributes"])) for device in devices]
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """
                    INSERT INTO public.netskope_device_snapshots
                        (source_run_id, device_id, attributes)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (source_run_id, device_id) DO UPDATE
                        SET attributes = EXCLUDED.attributes
                    """,
                    params,
                )
            # NSK-EXP-PRESENCE-001: the run's office/remote event days, in the same transaction; the span
            # (first and last event of the day) widens as later runs see newer events (NSK-EXP-OFFICE-001).
            await conn.execute(
                f"""
                INSERT INTO public.netskope_device_presence_days
                    (device_id, event_day, onprem_status, first_event_at, last_event_at)
                SELECT device_id, (to_timestamp(event_epoch) AT TIME ZONE 'UTC')::date, onprem_status,
                       to_timestamp(min(event_epoch)), to_timestamp(max(event_epoch))
                FROM (
                    SELECT device_id, attributes->>'onprem_status' AS onprem_status,
                           {valid_event_epoch('captured_at')} AS event_epoch
                    FROM public.netskope_device_snapshots
                    WHERE source_run_id = %s AND attributes->>'onprem_status' IN ('on-prem', 'off-prem')
                ) AS classified
                WHERE event_epoch IS NOT NULL
                GROUP BY 1, 2, 3
                ON CONFLICT (device_id, event_day, onprem_status) DO UPDATE
                    SET first_event_at = LEAST(netskope_device_presence_days.first_event_at, EXCLUDED.first_event_at),
                        last_event_at = GREATEST(netskope_device_presence_days.last_event_at, EXCLUDED.last_event_at)
                """,
                (run_id,),
            )
            await conn.execute(
                "DELETE FROM public.netskope_device_presence_days WHERE event_day < (now() AT TIME ZONE 'UTC')::date - %s",
                (PRESENCE_RETENTION_DAYS,),
            )


async def record_alert_aggregates(
    pool: AsyncConnectionPool,
    run_id: UUID,
    aggregates: Sequence[dict[str, Any]],
) -> None:
    """Persist only count-only, allowlisted rolling-window aggregates."""
    if not aggregates:
        return
    params = [(
        run_id, item["window_days"], item["window_start"], item["window_end"],
        item["dimension"], item["dimension_value"], item["alert_count"],
    ) for item in aggregates]
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """
                    INSERT INTO public.netskope_alert_aggregates
                        (source_run_id, window_days, window_start, window_end,
                         dimension, dimension_value, alert_count)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source_run_id, window_days, dimension, dimension_value) DO UPDATE
                        SET window_start = EXCLUDED.window_start,
                            window_end = EXCLUDED.window_end,
                            alert_count = EXCLUDED.alert_count,
                            captured_at = now()
                    """,
                    params,
                )


# Individual DLP incident/event persistence was removed with the DLP cache
# poller: Custodia keeps only the count-only alert aggregates above. The
# historical tables (netskope_dlp_event_cache/netskope_dlp_cache_state) are
# intentionally not dropped or purged here; that requires a separate explicit
# authorization.


async def purge_netskope_alert_aggregates(pool: AsyncConnectionPool, retention_days: int) -> int:
    """Delete count-only alert snapshots older than the retention window.

    ``source_run_id`` references ``cyberark_ingestion_runs``, but the FK only
    protects the parent: aging out snapshots deletes children, leaves every
    run row intact and creates no orphans (nothing else references an
    aggregate). Returns rows removed.
    """
    async with pool.connection() as conn:
        cursor = await conn.execute(
            """
            DELETE FROM public.netskope_alert_aggregates
            WHERE captured_at < now() - make_interval(days => %s)
            """,
            (retention_days,),
        )
        return cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0


REPORTED_COUNT_FIELDS = ("active_accounts", "inactive_accounts", "total_groups", "total_ous", "repeated_user_rows")


async def record_reported_counts(
    pool: AsyncConnectionPool, run_id: UUID, total_users: int, reported_at: datetime | None,
    extra: dict[str, int | None] | None = None,
) -> None:
    """NSK-REF-001: keep the totals Netskope reports next to the run that read the users."""
    extra = extra or {}
    values = [extra.get(field) for field in REPORTED_COUNT_FIELDS]
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO public.netskope_reported_counts
                (source_run_id, total_users, reported_at, active_accounts, inactive_accounts, total_groups, total_ous, repeated_user_rows)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_run_id) DO UPDATE
                SET total_users = EXCLUDED.total_users, reported_at = EXCLUDED.reported_at,
                    active_accounts = EXCLUDED.active_accounts, inactive_accounts = EXCLUDED.inactive_accounts,
                    total_groups = EXCLUDED.total_groups, total_ous = EXCLUDED.total_ous, repeated_user_rows = EXCLUDED.repeated_user_rows, captured_at = now()
            """,
            (run_id, total_users, reported_at, *values),
        )
