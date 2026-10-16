"""netskope/sse owns its source contract, adapters and router registration."""

from __future__ import annotations
from app.source_contract import ScheduledTask, SourceSpec, ToolRegistration
from app.netskope.sse.netskope_sync import (
    TASK_ALERTS,
    TASK_DLP,
    TASK_INVENTORY,
    TASK_UCI,
    dispatch_netskope_run,
)
from app.netskope.sse.integrations.netskope import (
    NetskopeNotConfigured,
    NetskopeSettings,
    netskope_alerts_configured,
    netskope_dlp_incidents_configured,
    netskope_uci_configured,
)

NETSKOPE_SOURCE = "netskope"

# SYNC-TASK-001 (+ NSK-UBA-002): independent jobs of one data source. The inventory keeps
# source_file "netskope-api", which freshness and coverage readers filter on.
NETSKOPE_TASKS = (
    ScheduledTask(TASK_INVENTORY, "netskope-api"),
    ScheduledTask(TASK_ALERTS, "netskope-alerts-api", is_configured=netskope_alerts_configured),
    ScheduledTask(TASK_DLP, "netskope-dlp-api", is_configured=netskope_dlp_incidents_configured),
    ScheduledTask(TASK_UCI, "netskope-uci-api", is_configured=netskope_uci_configured),
)


def register() -> ToolRegistration:
    from app.netskope.sse.api.routes.chains_netskope import (
        router as chains_netskope_router,
    )
    from app.netskope.sse.api.routes.netskope_dashboard_preferences import (
        router as netskope_dashboard_preferences_router,
    )
    from app.netskope.sse.api.routes.netskope_baselines import (
        router as netskope_baselines_router,
    )
    from app.netskope.sse.api.routes.netskope_aa import router as netskope_aa_router
    from app.netskope.sse.api.routes.netskope_device_reviews import router as netskope_device_reviews_router
    from app.netskope.sse.api.routes.netskope_dlp import router as netskope_dlp_router
    from app.netskope.sse.api.routes.netskope_admins import router as netskope_admins_router
    from app.netskope.sse.api.routes.netskope_uci import router as netskope_uci_router
    from app.netskope.sse.api.routes.cmdb_netskope import router as cmdb_netskope_router
    from app.netskope.sse.api.routes.cmdb_netskope_experience import (
        router as cmdb_netskope_experience_router,
    )
    from app.netskope.sse.api.routes.ingestion import router as ingestion_router

    return ToolRegistration(
        source=SourceSpec(
            source_system=NETSKOPE_SOURCE,
            platform="netskope",
            source_file="netskope-api",
            settings_type=NetskopeSettings,
            not_configured=(NetskopeNotConfigured,),
            dispatcher=dispatch_netskope_run,
            tasks=NETSKOPE_TASKS,
            status_required_env=(
                "NETSKOPE_URL",
                "NETSKOPE_DEVICE_STATUS_PATH",
                "NETSKOPE_USERS_PATH",
                "NETSKOPE_USER_COUNTS_PATH",
            ),
            status_secret_env="NETSKOPE_API_TOKEN",
            status_secret_file_env="NETSKOPE_API_TOKEN_FILE",
        ),
        routers=(
            (9, chains_netskope_router),
            (14, netskope_dashboard_preferences_router),
            (15, netskope_baselines_router),
            (16, netskope_dlp_router),
            (17, netskope_aa_router),
            (18, netskope_uci_router),
            (20, netskope_device_reviews_router),
            (21, netskope_admins_router),
        ),
        cmdb_routers=(
            (3, cmdb_netskope_router),
            (4, cmdb_netskope_experience_router),
        ),
        ingestion_routers=((5, ingestion_router),),
    )
