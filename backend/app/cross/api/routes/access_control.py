from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, StringConstraints

from app.auth import get_actor_permissions, require_any_permission, require_any_permission_read
from app.cross.services.oidc_health import collect_oidc_health
from app.cross.services.access_management import (
    DelegationCeilingError,
    DuplicatePermissionError,
    DuplicateRoleError,
    UnknownMappedRoleError,
    add_composite_role,
    add_permission,
    add_role,
    change_composite_role,
    change_oidc_group_roles,
    change_role,
    domain_catalog,
    permission_catalog,
    role_catalog,
)
from app.cross.api.routes.access_models import (
    CompositeRoleResponse,
    CreatedPermissionResponse,
    CreatedRoleResponse,
    DomainsResponse,
    OidcGroupRolesResponse,
    OidcHealthResponse,
    PermissionsResponse,
    RolesResponse,
    UpdatedResponse,
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


@router.get("/permissions", response_model=PermissionsResponse, summary="Listar permisos", description="Devuelve el catálogo de permisos internos de Custodia a lectores y administradores delegados de acceso.")
async def permissions(request: Request, actor_id: str = Depends(require_any_permission_read("access:manage", "access:roles_read", "access:roles_manage", "access:permissions_manage", "access:role_assignments_manage", "access:oidc_mappings_read"))):
    return {"rows": await permission_catalog(request.app.state.db)}


@router.get("/roles", response_model=RolesResponse, summary="Listar roles internos", description="Devuelve roles, permisos, estado y asignaciones a lectores y administradores delegados; los grupos OIDC además requieren access:oidc_mappings_read.")
async def roles(request: Request, actor_id: str = Depends(require_any_permission_read("access:manage", "access:roles_read", "access:roles_manage", "access:permissions_manage", "access:role_assignments_manage", "access:oidc_mappings_read"))):
    actor_permissions = set(getattr(getattr(request, "state", None), "actor_permissions", ()))
    if not actor_permissions:
        actor_permissions = set(await get_actor_permissions(request.app.state.db, actor_id))
    can_read_oidc_mappings = "access:manage" in actor_permissions or "access:oidc_mappings_read" in actor_permissions
    return {"rows": await role_catalog(request.app.state.db, include_oidc_groups=can_read_oidc_mappings)}


@router.get("/domains", response_model=DomainsResponse, summary="Listar dominios y niveles", description="Devuelve los dominios funcionales y niveles disponibles a lectores y administradores delegados de acceso.")
async def domains(request: Request, actor_id: str = Depends(require_any_permission_read("access:manage", "access:roles_read", "access:roles_manage", "access:permissions_manage", "access:role_assignments_manage", "access:oidc_mappings_read"))):
    return {"rows": await domain_catalog(request.app.state.db)}


@router.get(
    "/oidc-health",
    response_model=OidcHealthResponse,
    summary="Diagnóstico OIDC read-only",
    description=(
        "Devuelve sólo configuración OIDC no secreta (issuer, scopes, claim de grupos, mapping de roles, default role), "
        "el estado de los roles destino y el último login OIDC observado, con advertencias deterministas. "
        "Nunca devuelve client id/secret, tokens, credenciales de callback ni payloads de identidad. "
        "Requiere access:manage o access:oidc_mappings_read."
    ),
)
async def oidc_health(request: Request, actor_id: str = Depends(require_any_permission_read("access:manage", "access:oidc_mappings_read"))):
    return await collect_oidc_health(request.app.state.db)


@router.post("/permissions", response_model=CreatedPermissionResponse, status_code=status.HTTP_201_CREATED, summary="Crear permiso personalizado", description="Da de alta un permiso nuevo en el catálogo interno; el código debe coincidir con recurso:acción. Requiere access:manage.")
async def create_permission_route(payload: PermissionPayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:permissions_manage"))):
    expected_code = f"{payload.resource_code}:{payload.action_code}"
    if payload.permission_code != expected_code:
        raise HTTPException(status_code=422, detail="El código debe coincidir con recurso:acción")
    try:
        permission_code = await add_permission(request.app.state.db, **payload.model_dump(), actor_id=actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DuplicatePermissionError as exc:
        raise HTTPException(status_code=409, detail="Ese permiso ya existe") from exc
    return {"created": True, "permission_code": permission_code}


@router.post("/roles", response_model=CreatedRoleResponse, status_code=status.HTTP_201_CREATED, summary="Crear rol", description="Crea un rol interno con un conjunto explícito de permisos, asociado a un dominio funcional. Requiere access:manage.")
async def create_role_route(payload: RolePayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:roles_manage"))):
    if not payload.role_code:
        raise HTTPException(status_code=422, detail="El código del rol es obligatorio")
    try:
        role_code = await add_role(request.app.state.db, **payload.model_dump(), actor_id=actor_id)
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DuplicateRoleError as exc:
        raise HTTPException(status_code=409, detail="Ese código de rol ya existe") from exc
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


@router.post("/roles/composite", response_model=CompositeRoleResponse, status_code=status.HTTP_201_CREATED, summary="Crear rol compuesto", description="Crea un rol combinando un nivel de acceso por cada dominio funcional indicado (por ejemplo lector en PAM + admin en Netskope). Requiere access:manage.")
async def create_composite_role_route(payload: CompositeRolePayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:roles_manage"))):
    if not payload.role_code:
        raise HTTPException(status_code=422, detail="El código del rol es obligatorio")
    try:
        result = await add_composite_role(
            request.app.state.db,
            role_code=payload.role_code,
            display_name=payload.display_name,
            description=payload.description,
            level_refs=[item.model_dump() for item in payload.level_refs],
            actor_id=actor_id,
        )
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DuplicateRoleError as exc:
        raise HTTPException(status_code=409, detail="Ese código de rol ya existe") from exc
    return _composite_response(result, created=True)


@router.patch("/roles/{role_code}", response_model=UpdatedResponse, summary="Actualizar rol", description="Modifica nombre, descripción, dominio o permisos de un rol directo existente. Requiere access:manage.")
async def update_role_route(role_code: str, payload: RoleUpdatePayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:roles_manage"))):
    try:
        updated = await change_role(request.app.state.db, role_code=role_code, **payload.model_dump(), actor_id=actor_id)
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return {"updated": True}


@router.patch("/roles/{role_code}/composite", response_model=CompositeRoleResponse, summary="Actualizar rol compuesto", description="Modifica nombre, descripción o los niveles de dominio combinados de un rol compuesto existente. Requiere access:manage.")
async def update_composite_role_route(role_code: str, payload: CompositeRoleUpdatePayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:roles_manage"))):
    try:
        result = await change_composite_role(
            request.app.state.db,
            role_code=role_code,
            display_name=payload.display_name,
            description=payload.description,
            level_refs=[item.model_dump() for item in payload.level_refs],
            actor_id=actor_id,
        )
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return _composite_response(result, updated=True)


class OidcGroupRolesPayload(BaseModel):
    group: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
    role_codes: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]] = Field(default_factory=list, max_length=50)


@router.put(
    "/oidc-group-roles", response_model=OidcGroupRolesResponse,
    summary="Definir los roles que otorga un grupo de Okta",
    description=(
        "ACCESS-UI-001: reemplaza los roles de Custodia que otorga un grupo de Okta; una lista vacía quita el grupo. "
        "La primera edición adopta OIDC_ROLE_MAP_JSON y desde entonces el login sólo lee este mapeo. "
        "Rige en el próximo login de cada miembro. Aplica el techo de delegación a cada rol que agrega o quita. Auditada."
    ),
)
async def update_oidc_group_roles_route(payload: OidcGroupRolesPayload, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:role_assignments_manage"))):
    granted = set(getattr(request.state, "actor_permissions", ()) or await get_actor_permissions(request.app.state.db, actor_id))
    if "access:manage" not in granted and "access:oidc_mappings_read" not in granted:
        raise HTTPException(status_code=403, detail="El actor no tiene los permisos requeridos: access:oidc_mappings_read")
    try:
        role_codes = await change_oidc_group_roles(request.app.state.db, payload.group, payload.role_codes, actor_id)
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except UnknownMappedRoleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"group": payload.group, "role_codes": role_codes}
