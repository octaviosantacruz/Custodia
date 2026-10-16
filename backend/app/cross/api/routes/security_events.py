from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_any_permission_read
from app.cross.services.audit_trail import (
    list_security_events,
)
from app.cross.api.routes.activity_models import SecurityEventsResponse

router = APIRouter(tags=["Actividad"])


@router.get(
    "/api/security-events",
    response_model=SecurityEventsResponse,
    summary="Listar eventos de seguridad de autenticación",
    description=(
        "Bitácora separada de la auditoría funcional: login exitoso/fallido, logout, "
        "bootstrap/autorregistro, rechazo de token técnico, bloqueo por rate limit, "
        "sincronización de roles OIDC y sesiones rechazadas por versión desactualizada. "
        "Requiere access:manage o security:events_read. IP y email quedan siempre como digest, nunca en claro."
    ),
)
async def security_events(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    event_type: Annotated[str, Query(max_length=80)] = "",
    result: Annotated[str, Query(max_length=20)] = "",
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_any_permission_read("access:manage", "security:events_read")),
):
    return await list_security_events(
        request.app.state.db,
        limit=limit,
        offset=offset,
        event_type=event_type.strip(),
        result=result.strip(),
        q=q.strip(),
    )
