"""Administra el arranque y cierre de recursos compartidos de la API.

Abre el pool PostgreSQL, valida el esquema y mantiene las tareas de cola y
planificación. La recuperación de credenciales se conecta aquí; los clientes
y sincronizadores concretos se obtienen del registro de fuentes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI

from app.config import AppSettings
from app.db import create_pool
from app.cross.repositories.rate_limiting import purge_expired_attempts
from app.cross.repositories.ingestion import source_run_history
from app.cross.repositories.ingestion import list_sync_schedule_overrides
from app.cross.services.sync_schedule import SourceRunHistory, effective_task_interval_minutes, next_attempt_delay_seconds
from app.cross.repositories.sync_queue import enqueue_sync_runs, scheduler_cycle_lock
from app.schema import assert_schema_ready
from app.cross.services.database_credentials import DatabaseCredentialProvider
from app.cross.services.oidc_mapping import warn_if_default_role_is_unscoped
from app.sources import SOURCES_BY_SYSTEM, TASKS, scheduled_source_jobs, task_policy
from app.sync_coordinator import SyncCoordinator


LOGGER = logging.getLogger(__name__)


# The scheduler re-reads run history at least this often so a failure's
# backoff, a finished run or a changed policy is noticed without a restart.
SCHEDULER_MAX_SLEEP_SECONDS = 60


def source_interval_minutes(
    settings: AppSettings, task_key: str, admin_overrides: dict[str, dict] | None = None,
) -> float:
    """Cadence of one scheduled task; a source's single task is named after it.

    ``SYNC_SOURCE_INTERVALS`` may name a task or, for every task of a source,
    the source; the task entry wins.
    """
    source_system = TASKS[task_key][0].source_system
    return effective_task_interval_minutes(
        task_key=task_key, source_system=source_system, policy=task_policy(task_key),
        global_default=settings.ingestion_interval_minutes,
        environment_overrides=settings.sync_source_intervals, admin_overrides=admin_overrides,
    )[0]


def validate_sync_settings(settings: AppSettings) -> None:
    unknown = sorted(set(settings.sync_source_intervals) - set(SOURCES_BY_SYSTEM) - set(TASKS))
    if unknown:
        raise RuntimeError(f"SYNC_SOURCE_INTERVALS contiene fuentes o tareas no registradas: {', '.join(unknown)}")


def due_sources(
    source_systems: set[str], history: dict[str, SourceRunHistory], settings: AppSettings,
    *, now: datetime | None = None, admin_overrides: dict[str, dict] | None = None,
) -> tuple[set[str], float | None]:
    """Task keys (a source's own name when it has one task) due now and the wait until the next deadline (None: nothing scheduled).

    A source with a queued or running run is busy, never due; it is
    reconsidered on the next short pass.
    """
    admin_overrides = admin_overrides or {}
    due: set[str] = set()
    waits: list[float] = []
    for source in source_systems:
        record = history.get(source, SourceRunHistory())
        delay = next_attempt_delay_seconds(
            record, source_interval_minutes(settings, source, admin_overrides), task_policy(source), now=now,
        )
        if delay is None:
            continue
        if record.active:
            waits.append(SCHEDULER_MAX_SLEEP_SECONDS)
        elif delay == 0:
            due.add(source)
        else:
            waits.append(delay)
    return due, (min(waits) if waits else None)


async def scheduled_ingestion_loop(app: FastAPI, settings: AppSettings) -> None:
    """Enqueue configured sources by their own policy: cadence from the last
    success, exponential backoff after failures (SYNC-POLICY-001)."""
    while True:
        try:
            source_jobs = scheduled_source_jobs()
            task_keys = {task_key for _source, _file, _options, task_key in source_jobs}
            due, wait = due_sources(
                task_keys, await source_run_history(app.state.db), settings,
                admin_overrides=await list_sync_schedule_overrides(app.state.db),
            )
            if not due:
                await asyncio.sleep(min(wait, SCHEDULER_MAX_SLEEP_SECONDS) if wait is not None else SCHEDULER_MAX_SLEEP_SECONDS)
                continue
            async with scheduler_cycle_lock(app.state.db) as acquired:
                if not acquired:
                    await asyncio.sleep(1)
                    continue
                # Re-check every source inside the shared lock: another
                # process may have admitted one while this process waited.
                source_jobs = scheduled_source_jobs()
                task_keys = {task_key for _source, _file, _options, task_key in source_jobs}
                due, _wait = due_sources(
                    task_keys, await source_run_history(app.state.db), settings,
                    admin_overrides=await list_sync_schedule_overrides(app.state.db),
                )
                if not due:
                    continue
                jobs = [
                    {
                        "run_id": uuid4(),
                        "source_system": source_system,
                        "source_file": source_file,
                        "options": options,
                        "task_key": task_key,
                    }
                    for source_system, source_file, options, task_key in source_jobs
                    if task_key in due
                ]
                rows = await enqueue_sync_runs(
                    app.state.db, jobs, triggered_by="system:scheduler", skip_active_sources=True,
                )
                if rows:
                    app.state.sync_coordinator.wake()
                else:
                    await asyncio.sleep(SCHEDULER_MAX_SLEEP_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("No se pudo encolar la ingesta programada")
            await asyncio.sleep(SCHEDULER_MAX_SLEEP_SECONDS)


RATE_LIMIT_PURGE_INTERVAL_SECONDS = 60 * 60
RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60


async def rate_limit_purge_loop(app: FastAPI) -> None:
    """IF-001: bounds public.rate_limit_attempts independent of how many
    distinct bucket_keys unauthenticated traffic ever created -- a
    successful login clears its own buckets, but an attacker who never
    succeeds (or targets many distinct emails) would otherwise leave rows
    behind forever."""
    while True:
        await asyncio.sleep(RATE_LIMIT_PURGE_INTERVAL_SECONDS)
        try:
            deleted = await purge_expired_attempts(app.state.db, RATE_LIMIT_RETENTION_SECONDS)
            if deleted:
                LOGGER.info("Rate limiter: purgadas %s filas vencidas", deleted)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("No se pudo purgar rate_limit_attempts")


def build_lifespan(settings: AppSettings, oidc_enabled: bool):
    """Build the FastAPI lifespan handler from validated runtime settings."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Routes expose the configured cadence as operational read-only state.
        # Keep the setting on the composition root rather than re-reading the
        # environment on every request.
        app.state.settings = settings
        # A callable conninfo (instead of a fixed string) lets the pool pick
        # up a rotated RDS password without a process restart: psycopg_pool
        # calls it fresh on every new connection attempt, and
        # `on_reconnect_failed` fires the same guarded AWS Secrets Manager
        # fallback that `run_with_database_secret.py` runs at startup.
        credential_provider = DatabaseCredentialProvider(
            settings.database_url,
            settings.database_secret_id,
            region=settings.database_secret_region,
        )
        app.state.database_credential_provider = credential_provider
        pool = create_pool(
            credential_provider,
            reconnect_failed=credential_provider.on_reconnect_failed,
        )
        await pool.open()
        await pool.wait()
        try:
            await assert_schema_ready(pool)
        except Exception:
            await pool.close()
            raise
        app.state.db = pool
        app.state.oidc_enabled = oidc_enabled
        if oidc_enabled:
            warn_if_default_role_is_unscoped()
        validate_sync_settings(settings)
        coordinator = SyncCoordinator(pool, max_concurrent_sources=settings.sync_max_concurrent_sources)
        app.state.sync_coordinator = coordinator
        coordinator.start()
        app.state.ingestion_tasks = set()
        # Persistent administrator overrides can enable scheduling even when
        # all environment/global intervals are zero, so the loop must always
        # poll durable overrides (it sleeps when no task is enabled).
        scheduler_task = asyncio.create_task(
            scheduled_ingestion_loop(app, settings), name="scheduled-cyberark-ingestion"
        )
        app.state.ingestion_tasks.add(scheduler_task)
        scheduler_task.add_done_callback(app.state.ingestion_tasks.discard)
        purge_task = asyncio.create_task(rate_limit_purge_loop(app), name="rate-limit-attempts-purge")
        app.state.ingestion_tasks.add(purge_task)
        purge_task.add_done_callback(app.state.ingestion_tasks.discard)
        # NSK-DLP-001: minimal DLP alerts are captured inside each Netskope
        # sync run (bounded, allowlisted, 30-day retention); there is no
        # separate cache poller here. Only the per-device summary stays
        # retired and answers 410.
        yield
        await coordinator.close()
        tasks = list(app.state.ingestion_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await pool.close()

    return lifespan
