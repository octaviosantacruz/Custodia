from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_read_access
from app.cross.services.audit_trail import (
    list_activity_events,
)
from app.cross.api.routes.activity_models import ActivityEventsResponse


router = APIRouter(tags=["Eventos"], dependencies=[Depends(require_read_access)])


@router.get(
    "/api/events",
    response_model=ActivityEventsResponse,
    summary="Consultar eventos recientes",
    description="Devuelve señales livianas para refrescar vistas entre sesiones; no incluye datos de inventario.",
)
async def activity_events(
    request: Request,
    since: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
):
    return await list_activity_events(request.app.state.db, since=since, limit=limit)
