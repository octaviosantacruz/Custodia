from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI

from .config import AppSettings
from .db import create_pool
from .integrations.access import AccessNotConfigured, AccessSettings
from .integrations.identity_admin import IdentityAdminNotConfigured, IdentityAdminSettings
from .integrations.sia import SiaNotConfigured, SiaSettings
from .repositories.rate_limiting import purge_expired_attempts
from .repositories.sync_queue import enqueue_sync_runs
from .schema import assert_schema_ready
from .services.oidc_mapping import warn_if_default_role_is_unscoped
from .sync_coordinator import ACCESS_SOURCE, IDENTITY_SOURCE, PAM_SOURCE, SIA_SOURCE, SyncCoordinator


LOGGER = logging.getLogger(__name__)


def configured_optional_source_jobs() -> list[tuple[str, str, dict[str, object]]]:
    """Return (source_system, source_file, options) only for sources whose
    contract is actually configured -- shared by the scheduler and by the
    manual 'sync all sources' endpoint so both honor the same rule: an
    unconfigured source is never enqueued, instead of enqueueing a job that
    is doomed to fail against a missing contract.
    """
    jobs: list[tuple[str, str, dict[str, object]]] = []
    optional_sources = (
        (IDENTITY_SOURCE, "identity-administration-scim", IdentityAdminSettings.from_environment, IdentityAdminNotConfigured),
        (SIA_SOURCE, "sia-api", SiaSettings.from_environment, SiaNotConfigured),
        (ACCESS_SOURCE, "access-api", AccessSettings.from_environment, AccessNotConfigured),
    )
    for source_system, source_file, load_settings, not_configured in optional_sources:
        try:
            load_settings()
        except not_configured:
            LOGGER.info("Fuente %s omitida: contrato no configurado", source_system)
            continue
        jobs.append((source_system, source_file, {}))
    return jobs


def scheduled_source_jobs() -> list[tuple[str, str, dict[str, object]]]:
    """Return only configured source jobs for one scheduled sync cycle."""
    jobs: list[tuple[str, str, dict[str, object]]] = [
        (
            PAM_SOURCE,
            "cyberark-api",
            {
                "page_size": 100,
                "member_delay_seconds": 0.3,
                "reconcile_complete": True,
            },
        ),
        (PAM_SOURCE, "cyberark-psm-api", {"psm_only": True, "page_size": 100}),
    ]
    jobs.extend(configured_optional_source_jobs())
    return jobs


async def scheduled_ingestion_loop(app: FastAPI, settings: AppSettings) -> None:
    interval_seconds = settings.ingestion_interval_minutes * 60
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            jobs = [
                {
                    "run_id": uuid4(),
                    "source_system": source_system,
                    "source_file": source_file,
                    "options": options,
                }
                for source_system, source_file, options in scheduled_source_jobs()
            ]
            await enqueue_sync_runs(
                app.state.db, jobs, triggered_by="system:scheduler"
            )
            app.state.sync_coordinator.wake()
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("No se pudo encolar la ingesta programada")


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
        pool = create_pool(settings.database_url)
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
        coordinator = SyncCoordinator(pool)
        app.state.sync_coordinator = coordinator
        coordinator.start()
        app.state.ingestion_tasks = set()
        if settings.ingestion_interval_minutes > 0:
            scheduler_task = asyncio.create_task(
                scheduled_ingestion_loop(app, settings), name="scheduled-cyberark-ingestion"
            )
            app.state.ingestion_tasks.add(scheduler_task)
            scheduler_task.add_done_callback(app.state.ingestion_tasks.discard)
        purge_task = asyncio.create_task(rate_limit_purge_loop(app), name="rate-limit-attempts-purge")
        app.state.ingestion_tasks.add(purge_task)
        purge_task.add_done_callback(app.state.ingestion_tasks.discard)
        yield
        await coordinator.close()
        tasks = list(app.state.ingestion_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await pool.close()

    return lifespan
