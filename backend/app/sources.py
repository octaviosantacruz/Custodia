"""Single explicit registry. Each tool owns its contract and router definition.

Add the tool folder and one registration here; consumers iterate registrations.
No dynamic loaders and no source is enabled without its approved configuration.
"""

from __future__ import annotations
import logging
from app.source_contract import ScheduledTask, SourceSpec as SourceSpec, SyncPolicy
from app.cyberark.pam.source import PAM_SOURCE as PAM_SOURCE, register as register_pam
from app.cyberark.identity_administration.source import (
    IDENTITY_SOURCE as IDENTITY_SOURCE,
    register as register_identity_administration,
)
from app.cyberark.sia.source import SIA_SOURCE as SIA_SOURCE, register as register_sia
from app.cyberark.access.source import (
    ACCESS_SOURCE as ACCESS_SOURCE,
    register as register_access,
)
from app.netskope.sse.source import (
    NETSKOPE_SOURCE as NETSKOPE_SOURCE,
    register as register_sse,
)
from app.cyberark.risk_management.source import register as register_risk_management
from app.cyberark.connector_manager.source import register as register_connector_manager

LOGGER = logging.getLogger(__name__)

TOOLS = (
    register_pam(),
    register_identity_administration(),
    register_sia(),
    register_access(),
    register_sse(),
    register_risk_management(),
    register_connector_manager(),
)

SOURCES: tuple[SourceSpec, ...] = tuple(
    tool.source for tool in TOOLS if tool.source is not None
)
SOURCES_BY_SYSTEM = {spec.source_system: spec for spec in SOURCES}
OPTIONAL_SOURCES = tuple(spec for spec in SOURCES if spec.settings_type is not None)


def registered_routers(kind: str = "routers"):
    """Iterate existing routers in their unchanged public composition order."""
    return tuple(
        router
        for _, router in sorted(
            (entry for tool in TOOLS for entry in getattr(tool, kind)),
            key=lambda entry: entry[0],
        )
    )


def manual_source_jobs(payload):
    return [
        job
        for spec in SOURCES
        if spec.manual_jobs is not None
        for job in spec.manual_jobs(payload)
    ]


def source_tasks(spec: SourceSpec) -> tuple[ScheduledTask, ...]:
    """The spec's scheduled tasks; a source without any is one task named after itself."""
    if spec.tasks:
        return spec.tasks
    if spec.source_file is None:
        return ()
    return (ScheduledTask(task_key=spec.source_system, source_file=spec.source_file),)


# task_key -> (owning source, effective policy).
TASKS: dict[str, tuple[SourceSpec, SyncPolicy]] = {}
for _spec in SOURCES:
    for _task in source_tasks(_spec):
        TASKS[_task.task_key] = (_spec, _task.policy or _spec.policy)


def task_policy(task_key: str) -> SyncPolicy:
    return TASKS[task_key][1]


def configured_optional_source_jobs() -> list[tuple[str, str, dict[str, object], str]]:
    """Return (source_system, source_file, options, task_key) only for tasks
    whose contract is actually configured -- shared by the scheduler and by the
    manual 'sync all sources' endpoint so both honor the same rule: an
    unconfigured source is never enqueued, instead of enqueueing a job that
    is doomed to fail against a missing contract.
    """
    jobs: list[tuple[str, str, dict[str, object], str]] = []
    for spec in OPTIONAL_SOURCES:
        if spec.settings_type is None or spec.source_file is None:
            continue
        try:
            spec.settings_type.from_environment()
        except spec.not_configured:
            LOGGER.info(
                "Fuente %s omitida: contrato no configurado", spec.source_system
            )
            continue
        for task in source_tasks(spec):
            if task.is_configured is not None and not task.is_configured():
                LOGGER.info("Tarea %s omitida: endpoint no configurado", task.task_key)
                continue
            jobs.append((spec.source_system, task.source_file, {}, task.task_key))
    return jobs


def scheduled_source_jobs() -> list[tuple[str, str, dict[str, object], str]]:
    """Return only configured jobs, as (source_system, source_file, options, task_key)."""
    jobs = [
        (spec.source_system, task.source_file, dict(task.options), task.task_key)
        for spec in SOURCES
        if spec.settings_type is None
        for task in spec.tasks
    ]
    jobs.extend(configured_optional_source_jobs())
    return jobs
