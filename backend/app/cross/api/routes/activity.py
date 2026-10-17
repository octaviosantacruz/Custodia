from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.auth import require_any_permission_read, require_permission_read
from app.cross.services.audit_trail import (
    export_activity_csv,
    list_activity,
)
from app.cross.api.routes.activity_models import ActivityResponse

router = APIRouter(tags=["Actividad"])


@router.get(
    "/api/activity",
    response_model=ActivityResponse,
    summary="Listar actividad administrativa",
    description="Devuelve la bitácora de cambios; requiere access:manage o audit:read.",
)
async def activity(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str, Query(max_length=80)] = "",
    entity_type: Annotated[str, Query(max_length=80)] = "",
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_any_permission_read("access:manage", "audit:read")),
):
    return await list_activity(
        request.app.state.db,
        limit=limit,
        offset=offset,
        action=action.strip(),
        entity_type=entity_type.strip(),
        q=q.strip(),
    )


@router.get(
    "/api/activity/export.csv",
    summary="Exportar actividad administrativa filtrada",
    description="CSV de la bitácora con los filtros de la vista (hasta 10000 filas, más recientes primero), fórmulas neutralizadas y auditado. Requiere inventory:export.",
)
async def export_activity(
    request: Request,
    action: Annotated[str, Query(max_length=80)] = "",
    entity_type: Annotated[str, Query(max_length=80)] = "",
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_permission_read("inventory:export")),
):
    content = await export_activity_csv(
        request.app.state.db, actor_id, action=action.strip(), entity_type=entity_type.strip(), q=q.strip(),
    )
    return Response(
        content="\ufeff" + content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"custodia-actividad.csv\""},
    )
