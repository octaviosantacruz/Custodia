"""CMDB normalized read routes, composed per source.

Each tool keeps its own route module -- `cmdb_pam.py`, `cmdb_identity.py`,
`cmdb_sia.py`, `cmdb_netskope.py`, `cmdb_access.py` -- so adding a tool is a
new module plus its tool registration, instead of another edit to an all-sources
file. `/api/cmdb/coverage` stays here because it is cross-source by design.
"""

from fastapi import APIRouter, Depends, Request

from app.auth import require_read_access
from app.cross.services.inventory_views import (
    get_cmdb_coverage,
)
from app.sources import registered_routers

router = APIRouter()
for source_router in registered_routers("cmdb_routers"):
    router.include_router(source_router)


@router.get(
    '/api/cmdb/coverage',
    summary='Cobertura del CMDB normalizado',
    description='Muestra objetos y relaciones normalizadas disponibles para todas las fuentes: PAM, Identity, SIA, Access space y Netskope.',
    tags=['Cobertura CMDB'],
    dependencies=[Depends(require_read_access)],
)
async def cmdb_coverage(request: Request):
    return await get_cmdb_coverage(request.app.state.db)
