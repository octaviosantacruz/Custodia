"""Async dispatcher for durable, source-isolated synchronization jobs."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.ingestion import finish_ingestion_run
from app.cross.repositories.ingestion import update_ingestion_progress
from app.cross.repositories.operational_errors import safe_error_kind
from app.cross.repositories.sync_run_stages import list_sync_stages
from app.cross.services.connection_inventory_import import COVERAGE_SOURCES, record_coverage_snapshot
from app.cross.services.sync_stages import degraded_stage_errors
from app.cross.repositories.sync_queue import (
    claim_next_sync_run,
    list_queued_sync_sources,
    renew_sync_lease,
    requeue_expired_sync_runs,
    source_sync_lock,
)
from app.source_contract import RUN_PARTIAL_KEY
from app.sources import (
    SOURCES_BY_SYSTEM,
    TASKS,
)


LOGGER = logging.getLogger(__name__)

# The registry is the single declaration site for sources; these names stay
# importable from here for existing callers.
KNOWN_SOURCES = frozenset(SOURCES_BY_SYSTEM)
# The application pool has eight connections. A source synchronization keeps
# one session for its cross-process advisory lock, so cap active sources at
# three and leave room for requests, run leases and persistence.
MAX_CONCURRENT_SOURCE_SYNCS = 3


GENERIC_FAILURE = "La sincronización falló; revisar el detalle técnico."


def failure_message(error: BaseException, worker_id: str) -> str:
    """The sanitized text of a failed run. A missing configuration is recognised by its type or by the fixed
    "obligatorio" phrase of the settings checks (they name variables, never values), because it usually means a
    second backend without credentials took a run from the shared queue, and the generic text hides that."""
    name = type(error).__name__
    configuration_gap = name.endswith("NotConfigured") or (name == "CyberArkError" and "obligatorio" in str(error))
    if not configuration_gap:
        return GENERIC_FAILURE
    return (
        f"La fuente no está configurada en el backend que tomó la corrida (worker {worker_id[-8:]}). "
        "Si hay más de un backend sobre la misma base, revisá cuál no tiene las credenciales."
    )


class SyncCoordinator:
    """Dispatch queued jobs without allowing one source to block another."""

    def __init__(
        self,
        pool: AsyncConnectionPool,
        *,
        max_concurrent_sources: int = MAX_CONCURRENT_SOURCE_SYNCS,
    ) -> None:
        self.pool = pool
        if max_concurrent_sources < 1:
            raise ValueError("max_concurrent_sources debe ser al menos 1")
        self.worker_id = f"sync-coordinator-{uuid4()}"
        self._wake_event = asyncio.Event()
        self._dispatch_task: asyncio.Task[None] | None = None
        self._source_tasks: set[asyncio.Task[None]] = set()
        self._source_semaphore = asyncio.Semaphore(max_concurrent_sources)

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
                    LOGGER.warning(
                        "Se reencolaron sincronizaciones con concesión vencida"
                    )
                queued_sources = await list_queued_sync_sources(self.pool)
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.exception("No se pudo consultar la cola de sincronización")
                continue
            # Lower policy priority first: it decides who gets a free slot.
            queued_sources.sort(key=lambda name: SOURCES_BY_SYSTEM[name].policy.priority if name in SOURCES_BY_SYSTEM else 0)
            for source_system in queued_sources:
                if source_system not in KNOWN_SOURCES:
                    LOGGER.error(
                        "La cola contiene una fuente no admitida: %s", source_system
                    )
                    continue
                if any(
                    task.get_name() == f"sync-source-{source_system}"
                    for task in self._source_tasks
                ):
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
        async with self._source_semaphore:
            await self._run_locked_source(source_system)

    async def _run_locked_source(self, source_system: str) -> None:
        """Execute one source after it has acquired the process-local budget."""
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
            stage = f"Conectando con {source_system}"

            async def report_progress(message: str) -> None:
                nonlocal stage
                stage = message
                await update_ingestion_progress(
                    self.pool, run_id, message, source_system
                )

            try:
                await report_progress(stage)
                spec = SOURCES_BY_SYSTEM.get(source_system)
                if spec is None or (
                    spec.dispatcher is None and spec.synchronizer is None
                ):
                    raise ValueError(f"Fuente no admitida: {source_system}")
                # A timeout cancels the source's work and fails the run with a
                # sanitized TimeoutError kind; None keeps the previous behavior.
                task = TASKS.get(run.get("task_key") or source_system)
                policy = task[1] if task is not None and task[0] is spec else spec.policy
                async with asyncio.timeout(policy.timeout_seconds):
                    if spec.dispatcher is not None:
                        result = await spec.dispatcher(self.pool, run, report_progress)
                    else:
                        result = await spec.synchronizer(self.pool, run_id, report_progress)
                # PAM's Safe pipeline persists its own completion. PSM and
                # normalized sources return counts for the shared completion.
                if result is not None:
                    # Failed optional stages end the run as "partial" (with
                    # warnings) instead of hiding the gap behind "completed".
                    warnings = degraded_stage_errors(await list_sync_stages(self.pool, run_id))
                    if result.get(RUN_PARTIAL_KEY):
                        warnings.append({
                            "source": source_system,
                            "stage": run.get("task_key") or source_system,
                            "error_kind": "PartialRun",
                            "error": "La tarea terminó con trabajo pendiente; el siguiente ciclo la continúa.",
                        })
                    await finish_ingestion_run(
                        self.pool,
                        run_id,
                        "partial" if warnings else "completed",
                        0,
                        0,
                        warnings,
                        source_counts=result,
                    )
                if source_system in COVERAGE_SOURCES:
                    await record_coverage_snapshot(self.pool, "sync")
            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.exception("Sincronización %s (%s) falló", run_id, source_system)
                await finish_ingestion_run(
                    self.pool,
                    run_id,
                    "failed",
                    0,
                    0,
                    [
                        {
                            "source": source_system,
                            "stage": stage[:200],
                            "error_kind": safe_error_kind(error),
                            "error": failure_message(error, self.worker_id),
                        }
                    ],
                )
            finally:
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
                self.wake()

    async def _renew_lease(self, run_id) -> None:
        while True:
            await asyncio.sleep(30)
            if not await renew_sync_lease(self.pool, run_id, worker_id=self.worker_id):
                return
