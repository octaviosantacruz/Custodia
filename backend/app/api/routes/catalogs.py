from fastapi import APIRouter, Depends, HTTPException, Request, status
from ...auth import require_permission, require_read_access

from ...repositories import create_business_unit, create_responsible, get_catalogs, update_business_unit, update_responsible
from ...repositories.catalogs import is_unique_violation
from ...schemas import BusinessUnitCreate, ResponsibleCreate, BusinessUnitUpdate, ResponsibleUpdate

router = APIRouter(tags=["Catálogos"])


@router.get("/api/catalogs", summary="Listar catálogos", description="Devuelve unidades, responsables y tipos de cuenta disponibles.")
async def catalogs(request: Request, actor_id: str = Depends(require_read_access)):
    return await get_catalogs(request.app.state.db)


@router.post("/api/business-units", status_code=status.HTTP_201_CREATED, summary="Crear unidad de negocio", description="Requiere catalogs:write y registra el cambio en auditoría.")
async def create_business_unit_route(request: Request, payload: BusinessUnitCreate, actor_id: str = Depends(require_permission('catalogs:manage'))):
    try:
        return await create_business_unit(request.app.state.db, payload.unit_code, payload.unit_name, actor_id)
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="La unidad ya existe") from exc
        raise


@router.post("/api/responsibles", status_code=status.HTTP_201_CREATED, summary="Crear responsable", description="Requiere catalogs:write y registra el cambio en auditoría.")
async def create_responsible_route(request: Request, payload: ResponsibleCreate, actor_id: str = Depends(require_permission('catalogs:manage'))):
    try:
        return await create_responsible(request.app.state.db, payload.display_name, payload.email, actor_id)
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="El responsable ya existe") from exc
        raise


@router.patch("/api/business-units/{business_unit_id}")
async def update_business_unit_route(request: Request, business_unit_id: int, payload: BusinessUnitUpdate, actor_id: str = Depends(require_permission("catalogs:manage"))):
    try:
        result = await update_business_unit(request.app.state.db, business_unit_id, payload, actor_id)
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="La unidad ya existe") from exc
        raise
    if result is None:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    return result


@router.patch("/api/responsibles/{responsible_id}")
async def update_responsible_route(request: Request, responsible_id: int, payload: ResponsibleUpdate, actor_id: str = Depends(require_permission("catalogs:manage"))):
    try:
        result = await update_responsible(request.app.state.db, responsible_id, payload, actor_id)
    except Exception as exc:
        if is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="El responsable ya existe") from exc
        raise
    if result is None:
        raise HTTPException(status_code=404, detail="Responsable no encontrado")
    return result
