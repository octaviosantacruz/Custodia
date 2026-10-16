"""cyberark/access owns its source contract, adapters and router registration."""

from __future__ import annotations
from uuid import UUID
from psycopg_pool import AsyncConnectionPool
from app.source_contract import ProgressCallback
from app.source_contract import SourceSpec, ToolRegistration
from app.cyberark.access.access_sync import sync_access_inventory
from app.cyberark.access.integrations.access import AccessNotConfigured, AccessSettings

ACCESS_SOURCE = "access"


async def _sync_access(
    pool: AsyncConnectionPool,
    run_id: UUID,
    progress: ProgressCallback | None = None,
) -> dict[str, int]:
    return await sync_access_inventory(pool, run_id)


def register() -> ToolRegistration:
    from app.cyberark.access.api.routes.cmdb_access import router as cmdb_access_router
    from app.cyberark.access.api.routes.ingestion import router as ingestion_router

    return ToolRegistration(
        source=SourceSpec(
            source_system=ACCESS_SOURCE,
            source_file="access-api",
            settings_type=AccessSettings,
            not_configured=(AccessNotConfigured,),
            synchronizer=_sync_access,
            status_required_env=(
                "CA_ACCESS_URL",
                "CA_ACCESS_TOKEN_URL",
                "CA_ACCESS_CLIENT_ID",
                "CA_ACCESS_ASSETS_PATH",
            ),
            status_secret_env="CA_ACCESS_CLIENT_SECRET",
            status_secret_file_env="CA_ACCESS_SECRET_FILE",
        ),
        cmdb_routers=((5, cmdb_access_router),),
        ingestion_routers=((4, ingestion_router),),
    )
