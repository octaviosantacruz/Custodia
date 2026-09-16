from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, StringConstraints

from ...auth import require_permission, require_permission_read
from ...repositories.access_control import (
    create_composite_role,
    create_permission,
    create_role,
    list_domain_levels,
    list_permissions,
    list_roles,
    update_composite_role,
    update_role,
)

router = APIRouter(prefix="/api/access", tags=["Acceso y permisos"])


class RolePayload(BaseModel):
    role_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{2,63}$")] = ""
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
    domain_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]
    permission_codes: list[str] = Field(default_factory=list, max_length=100)


class RoleUpdatePayload(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
    domain_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]
    permission_codes: list[str] = Field(default_factory=list, max_length=100)


class PermissionPayload(BaseModel):
    permission_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,32}:[a-z][a-z0-9_-]{1,48}$")]
    domain_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]
    resource_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,48}$")]
    action_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,32}$")]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]


class RoleLevelRef(BaseModel):
    domain_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]
    level_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,31}$")]


class CompositeRolePayload(BaseModel):
    role_code: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{2,63}$")] = ""
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
    level_refs: list[RoleLevelRef] = Field(min_length=1, max_length=100)


class CompositeRoleUpdatePayload(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
    level_refs: list[RoleLevelRef] = Field(min_length=1, max_length=100)


@router.get("/permissions", summary="Listar permisos", description="Devuelve el catálogo de permisos internos de DS Hub. Requiere access:manage.")
async def permissions(request: Request, actor_id: str = Depends(require_permission_read("access:manage"))):
    return {"rows": await list_permissions(request.app.state.db)}


@router.get("/roles", summary="Listar roles internos", description="Devuelve roles, permisos, estado y cantidad de usuarios asignados. Requiere access:manage.")
async def roles(request: Request, actor_id: str = Depends(require_permission_read("access:manage"))):
    return {"rows": await list_roles(request.app.state.db)}


@router.get("/domains", summary="Listar dominios y niveles", description="Devuelve los dominios funcionales y niveles de acceso disponibles para armar roles compuestos. Requiere access:manage.")
async def domains(request: Request, actor_id: str = Depends(require_permission_read("access:manage"))):
    return {"rows": await list_domain_levels(request.app.state.db)}


@router.post("/permissions", status_code=status.HTTP_201_CREATED, summary="Crear permiso personalizado", description="Da de alta un permiso nuevo en el catálogo interno; el código debe coincidir con recurso:acción. Requiere access:manage.")
async def create_permission_route(payload: PermissionPayload, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    expected_code = f"{payload.resource_code}:{payload.action_code}"
    if payload.permission_code != expected_code:
        raise HTTPException(status_code=422, detail="El código debe coincidir con recurso:acción")
    try:
        permission_code = await create_permission(request.app.state.db, **payload.model_dump(), actor_id=actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ese permiso ya existe") from exc
        raise
    return {"created": True, "permission_code": permission_code}


@router.post("/roles", status_code=status.HTTP_201_CREATED, summary="Crear rol", description="Crea un rol interno con un conjunto explícito de permisos, asociado a un dominio funcional. Requiere access:manage.")
async def create_role_route(payload: RolePayload, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    if not payload.role_code:
        raise HTTPException(status_code=422, detail="El código del rol es obligatorio")
    try:
        role_code = await create_role(request.app.state.db, **payload.model_dump(), actor_id=actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ese código de rol ya existe") from exc
        raise
    return {"created": True, "role_code": role_code}


def _composite_response(result: dict, *, created: bool = False, updated: bool = False):
    duplicate = result.get("duplicate_of")
    warning = None
    if duplicate:
        warning = {
            "code": "duplicate_combination",
            "matching_role_code": duplicate["role_code"],
            "matching_role_name": duplicate["display_name"],
        }
    return {"created": created, "updated": updated, "role_code": result["role_code"], "warning": warning}


@router.post("/roles/composite", status_code=status.HTTP_201_CREATED, summary="Crear rol compuesto", description="Crea un rol combinando un nivel de acceso por cada dominio funcional indicado (por ejemplo lector en PAM + admin en Netskope). Requiere access:manage.")
async def create_composite_role_route(payload: CompositeRolePayload, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    if not payload.role_code:
        raise HTTPException(status_code=422, detail="El código del rol es obligatorio")
    try:
        result = await create_composite_role(
            request.app.state.db,
            role_code=payload.role_code,
            display_name=payload.display_name,
            description=payload.description,
            level_refs=[item.model_dump() for item in payload.level_refs],
            actor_id=actor_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Ese código de rol ya existe") from exc
        raise
    return _composite_response(result, created=True)


@router.patch("/roles/{role_code}", summary="Actualizar rol", description="Modifica nombre, descripción, dominio o permisos de un rol directo existente. Requiere access:manage.")
async def update_role_route(role_code: str, payload: RoleUpdatePayload, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    try:
        updated = await update_role(request.app.state.db, role_code=role_code, **payload.model_dump(), actor_id=actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return {"updated": True}


@router.patch("/roles/{role_code}/composite", summary="Actualizar rol compuesto", description="Modifica nombre, descripción o los niveles de dominio combinados de un rol compuesto existente. Requiere access:manage.")
async def update_composite_role_route(role_code: str, payload: CompositeRoleUpdatePayload, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    try:
        result = await update_composite_role(
            request.app.state.db,
            role_code=role_code,
            display_name=payload.display_name,
            description=payload.description,
            level_refs=[item.model_dump() for item in payload.level_refs],
            actor_id=actor_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return _composite_response(result, updated=True)
