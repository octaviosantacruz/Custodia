"""cyberark/sia owns its source contract, adapters and router registration."""

from __future__ import annotations
from uuid import UUID
from psycopg_pool import AsyncConnectionPool
from app.source_contract import ProgressCallback
from app.source_contract import SourceSpec, ToolRegistration
from app.cyberark.sia.sia_sync import sync_sia_inventory
from app.cyberark.sia.integrations.sia import SiaNotConfigured, SiaSettings

SIA_SOURCE = "sia"


async def _sync_sia(
    pool: AsyncConnectionPool,
    run_id: UUID,
    progress: ProgressCallback | None = None,
) -> dict[str, int]:
    return await sync_sia_inventory(pool, run_id)


def register() -> ToolRegistration:
    from app.cyberark.sia.api.routes.cmdb_sia import router as cmdb_sia_router
    from app.cyberark.sia.api.routes.ingestion import router as ingestion_router

    return ToolRegistration(
        source=SourceSpec(
            source_system=SIA_SOURCE,
            source_file="sia-api",
            settings_type=SiaSettings,
            not_configured=(SiaNotConfigured,),
            synchronizer=_sync_sia,
            status_required_env=(
                "CA_SIA_URL",
                "CA_SIA_TOKEN_URL",
                "CA_SIA_CLIENT_ID",
                "CA_SIA_POLICIES_PATH",
            ),
            status_secret_env="CA_SIA_CLIENT_SECRET",
            status_secret_file_env="CA_SIA_SECRET_FILE",
        ),
        cmdb_routers=((2, cmdb_sia_router),),
        ingestion_routers=((2, ingestion_router),),
    )
