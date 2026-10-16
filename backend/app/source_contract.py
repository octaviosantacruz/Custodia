"""Static registration contracts; no concrete tool dependencies."""

from __future__ import annotations
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID
from fastapi import APIRouter
from psycopg_pool import AsyncConnectionPool

# A synchronizer sets this result counter to 1 when it finished but left work
# for the next cycle (e.g. a bounded DLP capture): the run ends as "partial".
RUN_PARTIAL_KEY = "run_partial"

ProgressCallback = Callable[[str], Awaitable[None]]
Synchronizer = Callable[
    [AsyncConnectionPool, UUID, ProgressCallback | None],
    Awaitable[dict[str, int]],
]


RunDispatcher = Callable[
    [AsyncConnectionPool, Mapping[str, Any], ProgressCallback | None],
    Awaitable[dict[str, int] | None],
]
ManualJobs = Callable[[Any], list[dict[str, Any]]]


@dataclass(frozen=True)
class SyncPolicy:
    """Per-source scheduling policy (SYNC-POLICY-001).

    ``interval_minutes=None`` inherits ``INGESTION_INTERVAL_MINUTES`` (or a
    ``SYNC_SOURCE_INTERVALS`` override). After a failed run the scheduler
    retries after ``backoff_base_seconds * 2**(failures-1)`` (capped at
    ``backoff_max_seconds``) up to ``max_retries`` times, then waits a full
    interval. ``timeout_seconds=None`` means no timeout. Lower ``priority``
    is dispatched first when sources compete for a concurrency slot.
    """

    interval_minutes: float | None = None
    timeout_seconds: float | None = None
    max_retries: int = 3
    backoff_base_seconds: float = 300.0
    backoff_max_seconds: float = 3600.0
    priority: int = 0


@dataclass(frozen=True)
class ScheduledTask:
    """One independently scheduled job of an optional source (SYNC-TASK-001).

    ``task_key`` identifies the job for cadence, backoff and run history; the
    owner of the data stays ``SourceSpec.source_system``. ``policy=None``
    inherits the source policy. ``is_configured`` lets a task opt out when its
    own endpoint is missing, without disabling the rest of the source.
    """

    task_key: str
    source_file: str
    policy: SyncPolicy | None = None
    is_configured: Callable[[], bool] | None = None
    # Run options persisted with every run of this task (PAM declares them;
    # optional sources run with none).
    options: Mapping[str, object] = field(default_factory=dict)
    # Optional options for the manual per-task action. This can be safer than
    # scheduled defaults (e.g. PAM Safes skip retirement reconciliation unless
    # the operator confirms the preview workflow).
    manual_options: Mapping[str, object] | None = None


@dataclass(frozen=True)
class SourceSpec:
    """One isolated tool: contract, jobs, synchronizer and status contract."""

    source_system: str
    # Job source_file used by the scheduler and by "sync all"; None for PAM,
    # whose jobs are declared as tasks.
    source_file: str | None = None
    # A source with a settings_type is optional: it is never enqueued when its
    # from_environment() raises not_configured.
    settings_type: type[Any] | None = None
    not_configured: tuple[type[BaseException], ...] = ()
    # Normalized synchronizer; PAM keeps its own Safe pipeline in ingestion.py.
    synchronizer: Synchronizer | None = None
    # Environment contract reported by get_integration_status().
    status_required_env: tuple[str, ...] = ()
    status_secret_env: str | None = None
    status_secret_file_env: str | None = None

    platform: str = "cyberark"
    # A source with several jobs declares them here; empty means the single
    # job (source_file) whose task_key is the source_system itself.
    tasks: tuple[ScheduledTask, ...] = ()
    manual_jobs: ManualJobs | None = None
    dispatcher: RunDispatcher | None = None
    policy: SyncPolicy = SyncPolicy()


@dataclass(frozen=True)
class ToolRegistration:
    """One tool's source (if approved) and its existing HTTP routers.

    Ranks preserve the public router order; they are composition metadata,
    never source identity or permissions. Risk Management has routes but no
    approved synchronization source.
    """

    source: SourceSpec | None = None
    routers: tuple[tuple[int, APIRouter], ...] = ()
    cmdb_routers: tuple[tuple[int, APIRouter], ...] = ()
    ingestion_routers: tuple[tuple[int, APIRouter], ...] = ()
