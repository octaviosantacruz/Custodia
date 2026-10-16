from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_read_access
from app.cyberark.access.services.access_read_models import (
    list_access_assets,
)
from app.cross.api.routes.cmdb_dependencies import ACCESS_CATALOG_DEPENDENCIES
from app.cyberark.access.api.routes.cmdb_access_models import AccessAssetsResponse

router = APIRouter(tags=["Access space"], dependencies=[Depends(require_read_access)])


@router.get('/api/cmdb/access-assets', response_model=AccessAssetsResponse, summary='Assets del Access space', description='Catálogo de assets accesibles vía Access space. Nunca incluye dirección/host ni usuario de la cuenta.', dependencies=ACCESS_CATALOG_DEPENDENCIES)
async def access_assets(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    asset_type: Annotated[str, Query(max_length=80)] = "",
):
    return await list_access_assets(request.app.state.db, q.strip(), limit, offset, asset_type.strip())
