from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from ...auth import require_permission, require_read_access

from ...ingestion import IngestionOptions, preview_ingestion
from ...lifecycle import configured_optional_source_jobs
from ...repositories import enqueue_sync_run, enqueue_sync_runs, get_ingestion_run, list_ingestion_runs
from ...schemas import IngestionPreview, IngestionStart
from ...sync_coordinator import ACCESS_SOURCE, IDENTITY_SOURCE, PAM_SOURCE, SIA_SOURCE

# PENTEST-005: this router used to apply require_read_access (session only)
# to every route, including the writes below whose own dependency
# (require_permission -> require_write_access) is meant to also accept
# X-Access-Token for automation. That blanket dependency ran first and
# 401'd token-only callers before the route-level check ever got a chance
# to authorize them. Each GET route now declares require_read_access
# explicitly instead.
router = APIRouter(tags=["Ingesta"])

@router.post("/api/ingestion/preview", summary="Previsualizar sincronización", description="Compara CyberArk con la base sin aplicar cambios; requiere inventory:write.")
async def ingestion_preview(request: Request, payload: IngestionPreview, actor_id: str = Depends(require_permission('ingestion:preview'))):
    return await preview_ingestion(
        request.app.state.db,
        IngestionOptions(
            max_safes=payload.max_safes,
            page_size=payload.page_size,
            member_delay_seconds=payload.member_delay_seconds,
        ),
    )


@router.get("/api/ingestion/runs", summary="Listar sincronizaciones", description="Devuelve el historial reciente de corridas.")
async def ingestion_runs(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    actor_id: str = Depends(require_read_access),
):
    return {"rows": await list_ingestion_runs(request.app.state.db, limit)}


@router.get("/api/ingestion/runs/{run_id}", summary="Consultar sincronización", description="Devuelve el estado y resultados de una corrida.")
async def ingestion_run(request: Request, run_id: UUID, actor_id: str = Depends(require_read_access)):
    row = await get_ingestion_run(request.app.state.db, run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Corrida no encontrada")
    return row


@router.post("/api/ingestion/runs", status_code=status.HTTP_202_ACCEPTED, summary="Iniciar sincronización", description="Encola una corrida de CyberArk; requiere inventory:write.")
async def start_ingestion(request: Request, payload: IngestionStart, actor_id: str = Depends(require_permission('ingestion:run'))):
    if payload.reconcile_complete and payload.max_safes:
        raise HTTPException(status_code=400, detail="reconcile_complete requiere una corrida completa")
    return await _enqueue(
        request,
        run_id=uuid4(),
        source_system=PAM_SOURCE,
        source_file="cyberark-api",
        actor_id=actor_id,
        options=payload.model_dump(),
    )


@router.post(
    "/api/ingestion/pam-connectors/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Actualizar catálogo PSM",
    description="Encola una corrida aislada del catálogo de servidores PSM; no depende de la ingesta de Safes.",
)
async def start_pam_connectors_ingestion(
    request: Request, actor_id: str = Depends(require_permission('ingestion:run')),
):
    return await _enqueue(
        request,
        run_id=uuid4(),
        source_system=PAM_SOURCE,
        source_file="cyberark-psm-api",
        actor_id=actor_id,
        options={"psm_only": True, "page_size": 100},
    )

@router.post(
    "/api/ingestion/all/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización completa",
    description="Encola PAM, un refresh aislado del catálogo PSM y, para cada fuente cuyo contrato esté configurado, Identity Administration, SIA y/o Access space como corridas aisladas; requiere ingestion:run.",
)
async def start_all_ingestion(request: Request, payload: IngestionStart, actor_id: str = Depends(require_permission('ingestion:run'))):
    if payload.reconcile_complete and payload.max_safes:
        raise HTTPException(status_code=400, detail="reconcile_complete requiere una corrida completa")
    jobs = [
        {"run_id": uuid4(), "source_system": PAM_SOURCE, "source_file": "cyberark-api", "options": payload.model_dump()},
        # Keep the catalog refresh in the same operator action. It is queued
        # after the full PAM run for the same source and can still update PSM
        # names when the Safe snapshot is partial or another PAM catalog fails.
        {"run_id": uuid4(), "source_system": PAM_SOURCE, "source_file": "cyberark-psm-api", "options": {"psm_only": True, "page_size": payload.page_size}},
    ]
    jobs.extend(
        {"run_id": uuid4(), "source_system": source_system, "source_file": source_file, "options": options}
        for source_system, source_file, options in configured_optional_source_jobs()
    )
    runs = await enqueue_sync_runs(request.app.state.db, jobs, triggered_by=actor_id)
    request.app.state.sync_coordinator.wake()
    return {"runs": [{"run_id": run["run_id"], "status": run["status"], "source_system": run["source_system"]} for run in runs]}


@router.post(
    "/api/ingestion/sia/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización SIA",
    description="Encola la sincronización de políticas SIA; requiere inventory:write.",
)
async def start_sia_ingestion(request: Request, actor_id: str = Depends(require_permission('ingestion:run'))):
    return await _enqueue(
        request, run_id=uuid4(), source_system=SIA_SOURCE, source_file="sia-api",
        actor_id=actor_id, options={},
    )


@router.post(
    "/api/ingestion/identity-admin/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización Identity Administration",
    description="Encola la sincronización de usuarios y roles de Identity Administration; requiere inventory:write.",
)
async def start_identity_admin_ingestion(request: Request, actor_id: str = Depends(require_permission('ingestion:run'))):
    return await _enqueue(
        request, run_id=uuid4(), source_system=IDENTITY_SOURCE,
        source_file="identity-administration-scim", actor_id=actor_id, options={},
    )


@router.post(
    "/api/ingestion/access/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización Access space",
    description="Encola la sincronización de assets del Access space; requiere inventory:write.",
)
async def start_access_ingestion(request: Request, actor_id: str = Depends(require_permission('ingestion:run'))):
    return await _enqueue(
        request, run_id=uuid4(), source_system=ACCESS_SOURCE,
        source_file="access-api", actor_id=actor_id, options={},
    )


async def _enqueue(
    request: Request, *, run_id: UUID, source_system: str, source_file: str,
    actor_id: str, options: dict,
):
    run = await enqueue_sync_run(
        request.app.state.db, run_id, source_system=source_system,
        source_file=source_file, triggered_by=actor_id, options=options,
    )
    request.app.state.sync_coordinator.wake()
    return {"run_id": run["run_id"], "status": run["status"]}
