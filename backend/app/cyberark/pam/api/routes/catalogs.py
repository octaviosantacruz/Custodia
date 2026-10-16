from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.auth import require_permission, require_read_access

from app.cyberark.pam.services.catalog_admin import (
    DuplicateCatalogEntryError,
    add_business_unit,
    add_responsible,
    change_business_unit,
    change_responsible,
    load_catalogs,
)
from app.cyberark.pam.schemas import BusinessUnitCreate, ResponsibleCreate, BusinessUnitUpdate, ResponsibleUpdate
from app.cyberark.pam.api.routes.catalog_models import BusinessUnitResponse, CatalogsResponse, ResponsibleResponse

router = APIRouter(tags=["Catálogos"])


@router.get("/api/catalogs", response_model=CatalogsResponse, summary="Listar catálogos", description="Devuelve unidades, responsables y tipos de cuenta disponibles.")
async def catalogs(request: Request, actor_id: str = Depends(require_read_access)):
    return await load_catalogs(request.app.state.db)


@router.post("/api/business-units", response_model=BusinessUnitResponse, status_code=status.HTTP_201_CREATED, summary="Crear unidad de negocio", description="Requiere catalogs:write y registra el cambio en auditoría.")
async def create_business_unit_route(request: Request, payload: BusinessUnitCreate, actor_id: str = Depends(require_permission('catalogs:manage'))):
    try:
        return await add_business_unit(request.app.state.db, payload.unit_code, payload.unit_name, actor_id)
    except DuplicateCatalogEntryError as exc:
        raise HTTPException(status_code=409, detail="La unidad ya existe") from exc


@router.post("/api/responsibles", response_model=ResponsibleResponse, status_code=status.HTTP_201_CREATED, summary="Crear responsable", description="Requiere catalogs:write y registra el cambio en auditoría.")
async def create_responsible_route(request: Request, payload: ResponsibleCreate, actor_id: str = Depends(require_permission('catalogs:manage'))):
    try:
        return await add_responsible(request.app.state.db, payload.display_name, payload.email, actor_id)
    except DuplicateCatalogEntryError as exc:
        raise HTTPException(status_code=409, detail="El responsable ya existe") from exc


@router.patch("/api/business-units/{business_unit_id}", response_model=BusinessUnitResponse)
async def update_business_unit_route(request: Request, business_unit_id: int, payload: BusinessUnitUpdate, actor_id: str = Depends(require_permission("catalogs:manage"))):
    try:
        result = await change_business_unit(request.app.state.db, business_unit_id, payload, actor_id)
    except DuplicateCatalogEntryError as exc:
        raise HTTPException(status_code=409, detail="La unidad ya existe") from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    return result


@router.patch("/api/responsibles/{responsible_id}", response_model=ResponsibleResponse)
async def update_responsible_route(request: Request, responsible_id: int, payload: ResponsibleUpdate, actor_id: str = Depends(require_permission("catalogs:manage"))):
    try:
        result = await change_responsible(request.app.state.db, responsible_id, payload, actor_id)
    except DuplicateCatalogEntryError as exc:
        raise HTTPException(status_code=409, detail="El responsable ya existe") from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Responsable no encontrado")
    return result
