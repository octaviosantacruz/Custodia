from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.auth import require_permission
from app.cyberark.pam.ingestion import IngestionOptions, preview_ingestion
from app.cyberark.pam.schemas import IngestionPreview, IngestionStart
from app.cyberark.pam.source import PAM_SOURCE, TASK_PSM, TASK_SAFES
from app.cross.services.sync_control import enqueue_manual_sync
from app.cross.api.routes.ingestion_models import IngestionEnqueuedResponse, IngestionPreviewResponse

router = APIRouter()

@router.post("/api/ingestion/preview", response_model=IngestionPreviewResponse, summary="Previsualizar sincronización", description="Compara CyberArk con la base sin aplicar cambios; requiere ingestion:preview.")
async def ingestion_preview(request: Request, payload: IngestionPreview, actor_id: str = Depends(require_permission('ingestion:preview'))):
    return await preview_ingestion(
        request.app.state.db,
        IngestionOptions(
            max_safes=payload.max_safes,
            page_size=payload.page_size,
            member_delay_seconds=payload.member_delay_seconds,
            member_concurrency=payload.member_concurrency,
        ),
    )


@router.post("/api/ingestion/runs", response_model=IngestionEnqueuedResponse, status_code=status.HTTP_202_ACCEPTED, summary="Iniciar sincronización", description="Encola una corrida de CyberArk; requiere ingestion:run.")
async def start_ingestion(request: Request, payload: IngestionStart, actor_id: str = Depends(require_permission('ingestion:run'))):
    if payload.reconcile_complete and payload.max_safes:
        raise HTTPException(status_code=400, detail="reconcile_complete requiere una corrida completa")
    return await enqueue_manual_sync(
        request.app.state.db, wake=request.app.state.sync_coordinator.wake,
        run_id=uuid4(),
        source_system=PAM_SOURCE,
        source_file="cyberark-api",
        task_key=TASK_SAFES,
        actor_id=actor_id,
        options=payload.model_dump(),
    )


@router.post(
    "/api/ingestion/pam-connectors/runs",
    response_model=IngestionEnqueuedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Actualizar catálogo PSM",
    description="Encola una corrida aislada del catálogo de servidores PSM; no depende de la ingesta de Safes.",
)
async def start_pam_connectors_ingestion(
    request: Request, actor_id: str = Depends(require_permission('ingestion:run')),
):
    return await enqueue_manual_sync(
        request.app.state.db, wake=request.app.state.sync_coordinator.wake,
        run_id=uuid4(),
        source_system=PAM_SOURCE,
        source_file="cyberark-psm-api",
        task_key=TASK_PSM,
        actor_id=actor_id,
        options={"psm_only": True, "page_size": 100},
    )
