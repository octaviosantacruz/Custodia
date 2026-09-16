"""Async dispatcher for durable, source-isolated synchronization jobs."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from uuid import uuid4

from psycopg_pool import AsyncConnectionPool

from .identity_admin_sync import sync_identity_admin_inventory
from .access_sync import sync_access_inventory
from .ingestion import IngestionOptions, run_ingestion
from .pam_inventory import sync_pam_connectors_inventory
from .repositories.findings import refresh_findings
from .repositories.ingestion import finish_ingestion_run
from .repositories.sync_queue import (
    claim_next_sync_run,
    list_queued_sync_sources,
    renew_sync_lease,
    requeue_expired_sync_runs,
    source_sync_lock,
)
from .sia_sync import sync_sia_inventory


LOGGER = logging.getLogger(__name__)

PAM_SOURCE = "cyberark"
SIA_SOURCE = "sia"
IDENTITY_SOURCE = "identity_administration"
ACCESS_SOURCE = "access"
KNOWN_SOURCES = frozenset({PAM_SOURCE, SIA_SOURCE, IDENTITY_SOURCE, ACCESS_SOURCE})


class SyncCoordinator:
    """Dispatch queued jobs without allowing one source to block another."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self.pool = pool
        self.worker_id = f"sync-coordinator-{uuid4()}"
        self._wake_event = asyncio.Event()
        self._dispatch_task: asyncio.Task[None] | None = None
        self._source_tasks: set[asyncio.Task[None]] = set()

    def start(self) -> None:
        self._dispatch_task = asyncio.create_task(
            self._dispatch_loop(), name="sync-queue-dispatcher"
        )
        self.wake()

    def wake(self) -> None:
        """Request prompt queue dispatch after an enqueue."""
        self._wake_event.set()

    async def close(self) -> None:
        tasks = [*self._source_tasks]
        if self._dispatch_task is not None:
            tasks.append(self._dispatch_task)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _dispatch_loop(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._wake_event.wait(), timeout=30)
            except TimeoutError:
                pass
            self._wake_event.clear()
            try:
                if await requeue_expired_sync_runs(self.pool):
                    LOGGER.warning("Se reencolaron sincronizaciones con concesión vencida")
                queued_sources = await list_queued_sync_sources(self.pool)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("No se pudo consultar la cola de sincronización")
                continue
            for source_system in queued_sources:
                if source_system not in KNOWN_SOURCES:
                    LOGGER.error("La cola contiene una fuente no admitida: %s", source_system)
                    continue
                if any(task.get_name() == f"sync-source-{source_system}" for task in self._source_tasks):
                    continue
                task = asyncio.create_task(
                    self._run_source(source_system), name=f"sync-source-{source_system}"
                )
                self._source_tasks.add(task)
                task.add_done_callback(self._on_source_task_done)

    def _on_source_task_done(self, task: asyncio.Task[None]) -> None:
        """Discard the finished task and re-trigger dispatch immediately.

        Without this, a second run enqueued for the same source while the
        first one was still executing (or claimed a run before locking, e.g.
        two ingestion calls hitting '/api/ingestion/all/runs' twice in quick
        succession) would sit in the queue until the next 30s poll: the
        first wake() was a no-op because a task for that source_system was
        already active (line above), and nothing else calls wake() once that
        task finishes. Re-waking here closes that gap without adding a
        tighter poll interval overall.
        """
        self._source_tasks.discard(task)
        self.wake()

    async def _run_source(self, source_system: str) -> None:
        """Use a DB session lock while claiming and executing one source."""
        async with source_sync_lock(self.pool, source_system) as acquired:
            if not acquired:
                return
            run = await claim_next_sync_run(
                self.pool, source_system=source_system, worker_id=self.worker_id
            )
            if run is None:
                return
            run_id = run["run_id"]
            heartbeat = asyncio.create_task(
                self._renew_lease(run_id), name=f"sync-heartbeat-{run_id}"
            )
            try:
                if source_system == PAM_SOURCE:
                    options = _pam_options(run["run_options"])
                    if options.psm_only:
                        result = await sync_pam_connectors_inventory(
                            self.pool, run_id, page_size=options.page_size,
                        )
                        await finish_ingestion_run(
                            self.pool, run_id, "completed", 0, 0, [], source_counts=result,
                        )
                        await refresh_findings(self.pool, run_id)
                    else:
                        await run_ingestion(
                            self.pool,
                            options,
                            run_id,
                            triggered_by=run["triggered_by"],
                            run_already_claimed=True,
                        )
                else:
                    result = await _sync_normalized_source(
                        self.pool, source_system, run_id
                    )
                    await finish_ingestion_run(
                        self.pool, run_id, "completed", 0, 0, [], source_counts=result
                    )
                    await refresh_findings(self.pool, run_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("Sincronización %s (%s) falló", run_id, source_system)
                await finish_ingestion_run(
                    self.pool,
                    run_id,
                    "failed",
                    0,
                    0,
                    [{
                        "source": source_system,
                        "error": "La sincronización falló; revisar logs del servidor.",
                    }],
                )
            finally:
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
                self.wake()

    async def _renew_lease(self, run_id) -> None:
        while True:
            await asyncio.sleep(60)
            if not await renew_sync_lease(self.pool, run_id, worker_id=self.worker_id):
                return


def _pam_options(options: Mapping[str, object]) -> IngestionOptions:
    """Construct only the persisted, validated Safe-ingestion options."""
    return IngestionOptions(
        max_safes=int(options.get("max_safes", 0)),
        page_size=int(options.get("page_size", 100)),
        member_delay_seconds=float(options.get("member_delay_seconds", 0.3)),
        reconcile_complete=bool(options.get("reconcile_complete", False)),
        psm_only=bool(options.get("psm_only", False)),
    )


async def _sync_normalized_source(
    pool: AsyncConnectionPool, source_system: str, run_id
) -> dict[str, int]:
    if source_system == SIA_SOURCE:
        return await sync_sia_inventory(pool, run_id)
    if source_system == IDENTITY_SOURCE:
        return await sync_identity_admin_inventory(pool, run_id)
    if source_system == ACCESS_SOURCE:
        return await sync_access_inventory(pool, run_id)
    raise ValueError(f"Fuente no admitida: {source_system}")
