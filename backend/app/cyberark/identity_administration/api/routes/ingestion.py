from uuid import uuid4
from fastapi import APIRouter, Depends, Request, status
from app.auth import require_permission
from app.cyberark.identity_administration.source import IDENTITY_SOURCE
from app.cross.services.sync_control import enqueue_manual_sync
from app.cross.api.routes.ingestion_models import IngestionEnqueuedResponse

router = APIRouter()

@router.post(
    "/api/ingestion/identity-admin/runs",
    response_model=IngestionEnqueuedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización Identity Administration",
    description="Encola la sincronización de usuarios y roles de Identity Administration; requiere ingestion:run.",
)
async def start_identity_admin_ingestion(request: Request, actor_id: str = Depends(require_permission('ingestion:run'))):
    return await enqueue_manual_sync(
        request.app.state.db, wake=request.app.state.sync_coordinator.wake, run_id=uuid4(), source_system=IDENTITY_SOURCE,
        source_file="identity-administration-scim", actor_id=actor_id, options={},
    )
