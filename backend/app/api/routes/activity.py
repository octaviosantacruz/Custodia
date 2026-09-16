from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from ...auth import require_permission_read
from ...repositories.audit import list_activity

router = APIRouter(tags=["Actividad"])


@router.get(
    "/api/activity",
    summary="Listar actividad administrativa",
    description="Devuelve la bitácora de cambios; requiere access:manage.",
)
async def activity(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str, Query(max_length=80)] = "",
    entity_type: Annotated[str, Query(max_length=80)] = "",
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_permission_read("access:manage")),
):
    return await list_activity(
        request.app.state.db,
        limit=limit,
        offset=offset,
        action=action.strip(),
        entity_type=entity_type.strip(),
        q=q.strip(),
    )
