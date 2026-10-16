from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from app.auth import require_permission, require_read_access
from app.cross.services.sync_control import (
    enqueue_sync_runs,
    get_ingestion_run,
    get_ingestion_schedule,
    latest_stage_freshness,
    list_ingestion_runs,
    list_stage_history,
    list_sync_schedule_overrides,
    list_sync_stages,
    list_sync_task_history,
    set_sync_schedule_override,
)
from app.cross.api.routes.ingestion_models import IngestionStart
from app.sources import (
    SOURCES_BY_SYSTEM,
    configured_optional_source_jobs,
    manual_source_jobs,
    registered_routers,
    TASKS,
    source_tasks,
)
from app.cross.services.sync_schedule import (
    STALE_AFTER_INTERVALS, SourceRunHistory, effective_task_interval_minutes, next_attempt_delay_seconds, task_freshness,
)
from app.cross.api.routes.ingestion_models import (
    IngestionAllEnqueuedResponse,
    IngestionRunRow,
    IngestionRunsResponse,
    IngestionEnqueuedResponse,
    IngestionScheduleResponse,
    SyncTaskSchedulesResponse,
    SyncScheduleOverrideUpdate,
    StageFreshnessResponse,
    StageHistoryResponse,
    SyncStagesResponse,
)

router = APIRouter(tags=["Ingesta"])
for source_router in registered_routers("ingestion_routers"):
    router.include_router(source_router)


@router.get(
    "/api/ingestion/runs",
    response_model=IngestionRunsResponse,
    summary="Listar sincronizaciones",
    description="Devuelve el historial reciente de corridas.",
)
async def ingestion_runs(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    actor_id: str = Depends(require_read_access),
):
    return {"rows": await list_ingestion_runs(request.app.state.db, limit)}


@router.get(
    "/api/ingestion/schedule",
    response_model=IngestionScheduleResponse,
    summary="Consultar cadencia de sincronización",
    description="Devuelve la última y próxima ejecución automática calculadas desde la cola durable.",
)
async def ingestion_schedule(
    request: Request, actor_id: str = Depends(require_read_access)
):
    return await get_ingestion_schedule(
        request.app.state.db,
        request.app.state.settings.ingestion_interval_minutes,
    )


@router.get(
    "/api/ingestion/schedules",
    response_model=SyncTaskSchedulesResponse,
    summary="Consultar agenda de sincronización por tarea",
    description="Devuelve la cadencia efectiva, historial y próximo intento de cada tarea configurada.",
)
async def ingestion_schedules(request: Request, actor_id: str = Depends(require_read_access)):
    settings = request.app.state.settings
    overrides = await list_sync_schedule_overrides(request.app.state.db)
    history = await list_sync_task_history(request.app.state.db)
    rows = []
    now = datetime.now(timezone.utc)
    for task_key, (spec, policy) in TASKS.items():
        task = next((candidate for candidate in source_tasks(spec) if candidate.task_key == task_key), None)
        configured = task is not None
        if configured and task.is_configured is not None:
            configured = task.is_configured()
        if configured and spec.settings_type is not None:
            try:
                spec.settings_type.from_environment()
            except spec.not_configured:
                configured = False
        interval, source = effective_task_interval_minutes(
            task_key=task_key, source_system=spec.source_system, policy=policy,
            global_default=settings.ingestion_interval_minutes,
            environment_overrides=settings.sync_source_intervals, admin_overrides=overrides,
        )
        record = history.get(task_key, {})
        if task_key in overrides:
            source = "administrative"
        failures = int(record.get("consecutive_failures", 0) or 0)
        success = record.get("last_success_at")
        last_attempt = record.get("last_attempt_at")
        last_status = record.get("last_status")
        delay = next_attempt_delay_seconds(
            SourceRunHistory(
                last_success_at=success,
                last_failure_at=record.get("last_failure_at"),
                consecutive_failures=failures,
                active=False,
            ), interval, policy, now=now,
        )
        freshness, overdue = task_freshness(
            configured=configured, interval_minutes=interval, last_success_at=success, now=now)
        rows.append({
            "task_key": task_key,
            "source_system": spec.source_system,
            "source_file": task.source_file if task else spec.source_file or task_key,
            "configured": configured,
            "active": bool(record.get("active")),
            "interval_minutes": interval,
            "interval_source": source,
            "admin_override": float(overrides[task_key]["interval_minutes"]) if task_key in overrides else None,
            "last_success_at": success,
            "last_attempt_at": last_attempt,
            "last_status": last_status,
            "consecutive_failures": failures,
            "freshness": freshness,
            "intervals_since_success": overdue,
            "stale_after_intervals": STALE_AFTER_INTERVALS,
            "next_scheduled_at": now + timedelta(seconds=delay) if configured and delay is not None and not record.get("active") else None,
            "updated_at": overrides[task_key].get("updated_at") if task_key in overrides else None,
        })
    rows.sort(key=lambda row: (row["source_system"], row["task_key"]))
    return {"rows": rows}


@router.put(
    "/api/ingestion/schedules/{task_key}",
    summary="Cambiar intervalo de una tarea de sincronización",
    description="Persiste un override administrativo auditable; null vuelve a heredar entorno/política. Requiere access:manage.",
)
async def update_ingestion_schedule(
    task_key: str, payload: SyncScheduleOverrideUpdate, request: Request,
    actor_id: str = Depends(require_permission("access:manage")),
):
    if task_key not in TASKS:
        raise HTTPException(status_code=404, detail="Tarea de sincronización no encontrada")
    await set_sync_schedule_override(
        request.app.state.db, task_key=task_key,
        interval_minutes=payload.interval_minutes, actor_id=actor_id,
    )
    request.app.state.sync_coordinator.wake()
    return {"updated": True, "task_key": task_key, "interval_minutes": payload.interval_minutes}


@router.post(
    "/api/ingestion/schedules/{task_key}/runs",
    response_model=IngestionEnqueuedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Sincronizar una tarea ahora",
    description="Encola únicamente la tarea seleccionada; requiere ingestion:run.",
)
async def run_sync_task(
    task_key: str, request: Request, actor_id: str = Depends(require_permission("ingestion:run")),
):
    if task_key not in TASKS:
        raise HTTPException(status_code=404, detail="Tarea de sincronización no encontrada")
    spec, _policy = TASKS[task_key]
    task = next((candidate for candidate in source_tasks(spec) if candidate.task_key == task_key), None)
    if task is None or spec.dispatcher is None and spec.synchronizer is None:
        raise HTTPException(status_code=409, detail="La tarea no tiene una sincronización disponible")
    if task.is_configured is not None and not task.is_configured():
        raise HTTPException(status_code=409, detail="La tarea no está configurada")
    if spec.settings_type is not None:
        try:
            spec.settings_type.from_environment()
        except spec.not_configured as exc:
            raise HTTPException(status_code=409, detail="La fuente no está configurada") from exc
    runs = await enqueue_sync_runs(
        request.app.state.db,
        [{"run_id": uuid4(), "source_system": spec.source_system, "source_file": task.source_file,
          "task_key": task_key, "options": dict(task.manual_options if task.manual_options is not None else task.options)}],
        triggered_by=actor_id, skip_active_sources=True,
    )
    if not runs:
        raise HTTPException(status_code=409, detail="La tarea ya tiene una corrida en cola o en curso")
    request.app.state.sync_coordinator.wake()
    return {"run_id": runs[0]["run_id"], "status": runs[0]["status"]}


@router.get(
    "/api/ingestion/runs/{run_id}",
    response_model=IngestionRunRow,
    summary="Consultar sincronización",
    description="Devuelve el estado y resultados de una corrida.",
)
async def ingestion_run(
    request: Request, run_id: UUID, actor_id: str = Depends(require_read_access)
):
    row = await get_ingestion_run(request.app.state.db, run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Corrida no encontrada")
    return row


@router.get(
    "/api/ingestion/runs/{run_id}/stages",
    response_model=SyncStagesResponse,
    summary="Consultar capas de una sincronización",
    description="Devuelve el resultado por capa (obligatoria u opcional) de una corrida; sin payloads ni detalle de excepciones.",
)
async def ingestion_run_stages(
    request: Request, run_id: UUID, actor_id: str = Depends(require_read_access)
):
    if await get_ingestion_run(request.app.state.db, run_id) is None:
        raise HTTPException(status_code=404, detail="Corrida no encontrada")
    return {"rows": await list_sync_stages(request.app.state.db, run_id)}


@router.get(
    "/api/ingestion/sources/{source_system}/stages/latest",
    response_model=StageFreshnessResponse,
    summary="Frescura por capa de una fuente",
    description="Última corrida correcta y último intento de cada capa de la fuente; sin payloads.",
)
async def ingestion_source_stage_freshness(
    request: Request, source_system: str, actor_id: str = Depends(require_read_access)
):
    if source_system not in SOURCES_BY_SYSTEM:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")
    return {"rows": await latest_stage_freshness(request.app.state.db, source_system)}


@router.get(
    "/api/ingestion/sources/{source_system}/stages/history",
    response_model=StageHistoryResponse,
    summary="Historial de duración y filas por capa",
    description="Resultado por capa de las últimas corridas finalizadas de la fuente; sin payloads.",
)
async def ingestion_source_stage_history(
    request: Request, source_system: str, runs: Annotated[int, Query(ge=1, le=50)] = 10,
    actor_id: str = Depends(require_read_access),
):
    if source_system not in SOURCES_BY_SYSTEM:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")
    return {"rows": await list_stage_history(request.app.state.db, source_system, runs)}


@router.post(
    "/api/ingestion/all/runs",
    response_model=IngestionAllEnqueuedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Encolar sincronización completa",
    description="Encola PAM, un refresh aislado del catálogo PSM y las fuentes configuradas. Con scope=cyberark excluye Netskope; con scope=all (predeterminado) lo incluye si está configurado. Requiere ingestion:run.",
)
async def start_all_ingestion(
    request: Request,
    payload: IngestionStart,
    actor_id: str = Depends(require_permission("ingestion:run")),
    scope: Literal["all", "cyberark"] = "all",
):
    if payload.reconcile_complete and payload.max_safes:
        raise HTTPException(
            status_code=400, detail="reconcile_complete requiere una corrida completa"
        )
    jobs = [{"run_id": uuid4(), **job} for job in manual_source_jobs(payload)]
    jobs.extend(
        {
            "run_id": uuid4(),
            "source_system": source_system,
            "source_file": source_file,
            "options": options,
            "task_key": task_key,
        }
        for source_system, source_file, options, task_key in configured_optional_source_jobs()
        if scope == "all" or SOURCES_BY_SYSTEM[source_system].platform == scope
    )
    runs = await enqueue_sync_runs(request.app.state.db, jobs, triggered_by=actor_id)
    request.app.state.sync_coordinator.wake()
    return {
        "runs": [
            {
                "run_id": run["run_id"],
                "status": run["status"],
                "source_system": run["source_system"],
                "task_key": run.get("task_key"),
            }
            for run in runs
        ]
    }
