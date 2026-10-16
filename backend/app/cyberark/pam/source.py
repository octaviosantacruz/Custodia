"""cyberark/pam owns its source contract, adapters and router registration."""

from __future__ import annotations
from collections.abc import Mapping
from app.source_contract import ScheduledTask, SourceSpec, SyncPolicy, ToolRegistration
from app.cyberark.pam.ingestion import IngestionOptions, run_ingestion
from app.cyberark.pam.pam_inventory import sync_pam_connectors_inventory

PAM_SOURCE = "cyberark"
# SYNC-TASK-002: Safes and the isolated PSM catalog refresh are independent
# tasks of the cyberark source, each with its own history and backoff.
TASK_SAFES = "pam_safes"
TASK_PSM = "pam_psm"


async def dispatch_pam_run(pool, run, progress=None):
    """Preserve the Safe pipeline's own completion and isolated PSM refresh."""
    options = _pam_options(run["run_options"])
    if options.psm_only:
        return await sync_pam_connectors_inventory(
            pool, run["run_id"], page_size=options.page_size
        )
    await run_ingestion(
        pool,
        options,
        run["run_id"],
        triggered_by=run["triggered_by"],
        run_already_claimed=True,
    )
    return None


def manual_pam_jobs(payload):
    return [
        {
            "source_system": PAM_SOURCE,
            "source_file": "cyberark-api",
            "options": payload.model_dump(),
            "task_key": TASK_SAFES,
        },
        {
            "source_system": PAM_SOURCE,
            "source_file": "cyberark-psm-api",
            "options": {"psm_only": True, "page_size": payload.page_size},
            "task_key": TASK_PSM,
        },
    ]


def _pam_options(options: Mapping[str, object]) -> IngestionOptions:
    """Construct only the persisted, validated Safe-ingestion options."""
    return IngestionOptions(
        max_safes=int(options.get("max_safes", 0)),
        page_size=int(options.get("page_size", 100)),
        member_delay_seconds=float(options.get("member_delay_seconds", 0.3)),
        member_concurrency=int(options.get("member_concurrency", 4)),
        reconcile_complete=bool(options.get("reconcile_complete", False)),
        psm_only=bool(options.get("psm_only", False)),
    )


PAM_TASKS = (
    ScheduledTask(
        TASK_SAFES, "cyberark-api",
        options={"page_size": 100, "member_delay_seconds": 0.3, "member_concurrency": 4, "reconcile_complete": True},
        manual_options={"max_safes": 0, "page_size": 100, "member_delay_seconds": 0.3, "member_concurrency": 4, "reconcile_complete": False},
    ),
    ScheduledTask(
        TASK_PSM, "cyberark-psm-api", options={"psm_only": True, "page_size": 100},
        manual_options={"psm_only": True, "page_size": 100},
    ),
)


def register() -> ToolRegistration:
    from app.cyberark.pam.api.routes.findings import router as findings_router
    from app.cyberark.pam.api.routes.analytics import router as analytics_router
    from app.cyberark.pam.api.routes.catalogs import router as catalogs_router
    from app.cyberark.pam.api.routes.chains import router as chains_router
    from app.cyberark.pam.api.routes.dashboard_preferences import (
        router as dashboard_preferences_router,
    )
    from app.cyberark.pam.api.routes.safes import router as safes_router
    from app.cyberark.pam.api.routes.cmdb_pam import router as cmdb_pam_router
    from app.cyberark.pam.api.routes.ingestion import router as ingestion_router

    return ToolRegistration(
        source=SourceSpec(
            source_system=PAM_SOURCE,
            tasks=PAM_TASKS,
            manual_jobs=manual_pam_jobs,
            dispatcher=dispatch_pam_run,
            # PAM is the heaviest source: lighter sources get a free slot first.
            policy=SyncPolicy(priority=1),
        ),
        routers=(
            (1, findings_router),
            (6, analytics_router),
            (7, catalogs_router),
            (8, chains_router),
            (13, dashboard_preferences_router),
            (23, safes_router),
        ),
        cmdb_routers=((0, cmdb_pam_router),),
        ingestion_routers=((0, ingestion_router),),
    )
