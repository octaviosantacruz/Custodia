from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_read_access
from app.cross.services.inventory_views import (
    search_inventory,
)

MAX_QUERY_LENGTH = 160

router = APIRouter(tags=["Búsqueda"], dependencies=[Depends(require_read_access)])


@router.get(
    "/api/search",
    summary="Buscar inventario",
    description="Busca registros activos no secretos y devuelve resultados navegables, agrupados por dominio.",
)
async def search(
    request: Request,
    q: Annotated[str, Query(max_length=MAX_QUERY_LENGTH)],
    include_internal: bool = Query(True),
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="q debe contener al menos 2 caracteres")
    return await search_inventory(
        request.app.state.db,
        query,
        include_internal=include_internal,
    )
