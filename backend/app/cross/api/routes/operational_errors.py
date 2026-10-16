from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_any_permission_read
from app.cross.services.operational_diagnostics import (
    list_operational_errors,
    list_operational_logs,
)
from app.cross.api.routes.activity_models import OperationalErrorsResponse, OperationalLogsResponse

router = APIRouter(tags=["Actividad"])


@router.get(
    "/api/operational-errors",
    response_model=OperationalErrorsResponse,
    summary="Listar errores operativos sanitizados",
    description=(
        "Muestra referencias de errores internos, ruta y tipo técnico sin mensajes, "
        "trazas, headers, cuerpos ni secretos. Requiere access:manage o audit:read."
    ),
)
async def operational_errors(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_any_permission_read("access:manage", "audit:read")),
):
    return await list_operational_errors(request.app.state.db, limit=limit, offset=offset, q=q.strip())


@router.get(
    "/api/operational-logs",
    response_model=OperationalLogsResponse,
    summary="Listar logs operativos estructurados",
    description="Muestra eventos sanitizados de sincronización y workers; no expone el archivo de logs crudos.",
)
async def operational_logs(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=160)] = "",
    level: Annotated[str, Query(pattern="^(|info|warning|error)$")] = "",
    source_system: Annotated[str, Query(max_length=80)] = "",
    actor_id: str = Depends(require_any_permission_read("access:manage", "audit:read")),
):
    return await list_operational_logs(
        request.app.state.db, limit=limit, offset=offset, q=q.strip(),
        level=level, source_system=source_system.strip(),
    )
