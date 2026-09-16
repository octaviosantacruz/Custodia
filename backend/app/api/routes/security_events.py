from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from ...auth import require_permission_read
from ...repositories.security_events import list_security_events

router = APIRouter(tags=["Actividad"])


@router.get(
    "/api/security-events",
    summary="Listar eventos de seguridad de autenticación",
    description=(
        "Bitácora separada de la auditoría funcional: login exitoso/fallido, logout, "
        "bootstrap/autorregistro, rechazo de token técnico, bloqueo por rate limit, "
        "sincronización de roles OIDC y sesiones rechazadas por versión desactualizada. "
        "Requiere access:manage. IP y email quedan siempre como digest, nunca en claro."
    ),
)
async def security_events(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    event_type: Annotated[str, Query(max_length=80)] = "",
    result: Annotated[str, Query(max_length=20)] = "",
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_permission_read("access:manage")),
):
    return await list_security_events(
        request.app.state.db,
        limit=limit,
        offset=offset,
        event_type=event_type.strip(),
        result=result.strip(),
        q=q.strip(),
    )
