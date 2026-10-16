"""Read/query facade for the routes of this tool (ARCH-LAYERS-002).

Routes (Controller) depend on ``services/``; this module is the single place
where they reach the repositories below. SQL and audit stay in the
repositories; add domain logic here, not in the route.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cross.repositories.ingestion import (
    get_ingestion_run,
    get_ingestion_schedule,
    list_ingestion_runs,
    list_sync_schedule_overrides,
    list_sync_task_history,
    set_sync_schedule_override,
)
from app.cross.repositories.sync_queue import (
    enqueue_sync_run,
    enqueue_sync_runs,
)
from app.cross.repositories.sync_run_stages import (
    latest_stage_freshness,
    list_stage_history,
    list_sync_stages,
)

__all__ = [
    "enqueue_manual_sync",
    "enqueue_sync_run",
    "enqueue_sync_runs",
    "get_ingestion_run",
    "get_ingestion_schedule",
    "latest_stage_freshness",
    "list_ingestion_runs",
    "list_stage_history",
    "list_sync_schedule_overrides",
    "list_sync_stages",
    "list_sync_task_history",
    "set_sync_schedule_override",
]


async def enqueue_manual_sync(
    pool: AsyncConnectionPool,
    *,
    wake: Callable[[], None],
    run_id: UUID,
    source_system: str,
    source_file: str,
    actor_id: str,
    options: dict,
    task_key: str | None = None,
) -> dict:
    """Persist the audited job before notifying the shared dispatcher."""
    run = await enqueue_sync_run(
        pool, run_id, source_system=source_system, source_file=source_file,
        triggered_by=actor_id, options=options, task_key=task_key,
    )
    wake()
    return {"run_id": run["run_id"], "status": run["status"]}
