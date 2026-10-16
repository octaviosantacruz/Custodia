from uuid import uuid4
from fastapi import APIRouter, Depends, Request, status
from app.auth import require_permission
from app.netskope.sse.source import NETSKOPE_SOURCE, NETSKOPE_TASKS
from app.cross.services.sync_control import (
    enqueue_sync_runs,
)
from app.cross.api.routes.ingestion_models import IngestionEnqueuedResponse

router = APIRouter()

@router.post(
    "/api/ingestion/netskope/runs",
    response_model=IngestionEnqueuedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización Netskope",
    description="Encola las tareas aisladas de Netskope: inventario (usuarios, dispositivos y DEM) y, si su endpoint está configurado, agregados de alertas y captura DLP. Devuelve la corrida de inventario; requiere ingestion:run.",
)
async def start_netskope_ingestion(request: Request, actor_id: str = Depends(require_permission('ingestion:run'))):
    tasks = [
        task for task in NETSKOPE_TASKS
        if task.is_configured is None or task.is_configured()
    ]
    runs = await enqueue_sync_runs(
        request.app.state.db,
        [
            {
                "run_id": uuid4(), "source_system": NETSKOPE_SOURCE,
                "source_file": task.source_file, "options": {}, "task_key": task.task_key,
            }
            for task in tasks
        ],
        triggered_by=actor_id,
    )
    request.app.state.sync_coordinator.wake()
    # run_id is the inventory run; `runs` lists every enqueued task so a caller
    # can wait for all of them instead of reporting success after the first.
    return {
        "run_id": runs[0]["run_id"], "status": runs[0]["status"],
        "runs": [
            {"run_id": run["run_id"], "status": run["status"], "source_system": run["source_system"], "task_key": run["task_key"]}
            for run in runs
        ],
    }
