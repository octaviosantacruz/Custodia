"""cyberark/identity_administration owns its source contract, adapters and router registration."""

from __future__ import annotations
from uuid import UUID
from psycopg_pool import AsyncConnectionPool
from app.source_contract import ProgressCallback
from app.source_contract import SourceSpec, ToolRegistration
from app.cyberark.identity_administration.identity_admin_sync import (
    sync_identity_admin_inventory,
)
from app.cyberark.identity_administration.integrations.identity_admin import (
    IdentityAdminNotConfigured,
    IdentityAdminSettings,
)

IDENTITY_SOURCE = "identity_administration"


async def _sync_identity_admin(
    pool: AsyncConnectionPool,
    run_id: UUID,
    progress: ProgressCallback | None = None,
) -> dict[str, int]:
    return await sync_identity_admin_inventory(pool, run_id)


def register() -> ToolRegistration:
    from app.cyberark.identity_administration.api.routes.cmdb_identity import (
        router as cmdb_identity_router,
    )
    from app.cyberark.identity_administration.api.routes.ingestion import (
        router as ingestion_router,
    )

    return ToolRegistration(
        source=SourceSpec(
            source_system=IDENTITY_SOURCE,
            source_file="identity-administration-scim",
            settings_type=IdentityAdminSettings,
            not_configured=(IdentityAdminNotConfigured,),
            synchronizer=_sync_identity_admin,
            status_required_env=(
                "CA_IDENTITY_ADMIN_URL",
                "CA_IDENTITY_ADMIN_TOKEN_URL",
                "CA_IDENTITY_ADMIN_CLIENT_ID",
                "CA_IDENTITY_ADMIN_USERS_PATH",
                "CA_IDENTITY_ADMIN_ROLES_PATH",
            ),
            status_secret_env="CA_IDENTITY_ADMIN_CLIENT_SECRET",
            status_secret_file_env="CA_IDENTITY_ADMIN_SECRET_FILE",
        ),
        cmdb_routers=((1, cmdb_identity_router),),
        ingestion_routers=((3, ingestion_router),),
    )
