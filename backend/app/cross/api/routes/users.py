from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, StringConstraints, field_validator, model_validator

from app.auth import get_actor_permissions, require_any_permission, require_any_permission_read
from app.cross.services.user_management import (
    DelegationCeilingError,
    DuplicateUserError,
    InvalidUserPassword,
    OidcManagedRoleError,
    SelfAdminLockoutError,
    SelfRoleChangeError,
    UnknownRoleError,
    assign_role,
    find_people,
    find_users,
    modify_user,
    register_user,
    reissue_password,
    remove_user,
    review_access,
    unassign_role,
)
from app.cross.services.email_validation import validate_email_format
from app.cross.services.oidc_groups import list_observed_oidc_groups
from app.cross.api.routes.users_models import (
    AccessReviewResponse,
    PeopleResponse,
    ObservedOidcGroupsResponse,
    TemporaryPasswordResponse,
    UserCreatedResponse,
    UserDeletedResponse,
    UserRoleGrantedResponse,
    UserRoleRevokedResponse,
    UsersResponse,
    UserUpdatedResponse,
)

router = APIRouter(tags=["Usuarios y permisos"])


@router.get("/api/auth/oidc-groups", response_model=ObservedOidcGroupsResponse,
            summary="Grupos mapeados y miembros observados al iniciar sesión",
            description="Última observación del issuer configurado, hasta 100 miembros por grupo. No es un directorio completo del proveedor.")
async def oidc_groups(request: Request, actor_id: str = Depends(require_any_permission_read(
    "access:manage", "access:directory_read", "access:local_users_manage", "access:role_assignments_manage",
))):
    await _require_admin_permissions(request, actor_id, "access:oidc_mappings_read")
    return await list_observed_oidc_groups(request.app.state.db)


async def _require_admin_permissions(request: Request, actor_id: str, *required: str) -> None:
    permissions = set(getattr(getattr(request, "state", None), "actor_permissions", ()))
    if not permissions:
        permissions = set(await get_actor_permissions(request.app.state.db, actor_id))
    if "access:manage" in permissions or all(permission in permissions for permission in required):
        return
    raise HTTPException(status_code=403, detail=f"El actor no tiene los permisos requeridos: {', '.join(required)}")


class UserCreate(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    role_code: str = "reader"

    _validate_email = field_validator("email")(validate_email_format)


class UserRoleGrant(BaseModel):
    role_code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class UserUpdate(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)] | None = None
    is_active: bool | None = None
    role_code: str | None = None
    password: str | None = None

    @model_validator(mode="after")
    def _reject_empty_patch(self):
        # IF-003: a payload with every field omitted used to reach
        # update_user(), which ran no query at all and still returned
        # success -- a caller couldn't tell "nothing changed because you
        # asked for nothing" from "your target user doesn't exist".
        # Rejected here as a validation error (422), before any lookup.
        if self.display_name is None and self.is_active is None and self.role_code is None and self.password is None:
            raise ValueError("El parche no modifica ningún campo")
        return self


@router.get("/api/auth/users", response_model=UsersResponse)
async def list_users_route(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    role: Annotated[str, Query(max_length=80)] = "",
    status: Annotated[str, Query(pattern="^(|active|inactive|pending)$")] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_any_permission_read("access:manage", "access:directory_read", "access:local_users_manage", "access:role_assignments_manage")),
):
    return await find_users(request.app.state.db, q.strip(), role, status, limit, offset)


@router.get(
    "/api/auth/people",
    response_model=PeopleResponse,
    summary="Listar personas del directorio",
    description="Agrupa identidades locales y OIDC por email para mostrarlas como una sola persona, conservando cada acceso por separado; requiere access:manage o access:directory_read.",
)
async def list_people_route(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    role: Annotated[str, Query(max_length=80)] = "",
    status: Annotated[str, Query(pattern="^(|active|inactive|pending)$")] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_any_permission_read("access:manage", "access:directory_read", "access:local_users_manage", "access:role_assignments_manage")),
):
    permissions = set(getattr(request.state, "actor_permissions", ()) or await get_actor_permissions(request.app.state.db, actor_id))
    return await find_people(
        request.app.state.db, q.strip(), role, status, limit, offset,
        include_oidc_groups=bool(permissions & {"access:manage", "access:oidc_mappings_read"}),
    )


@router.get(
    "/api/auth/access-review",
    response_model=AccessReviewResponse,
    summary="Revisión periódica de accesos",
    description=(
        "Una fila por rol asignado con origen (Okta o manual), fecha y autor de la asignación manual, último inicio de "
        "sesión de la identidad Okta y señales de revisión: cuenta local inactiva con roles, asignación manual de al menos "
        "N días e identidad Okta sin ingreso hace al menos N días. Las cuentas locales no registran ingreso y los roles de "
        "Okta se reescriben en cada login, así que esos datos quedan en null y no se infieren. Sólo lectura; requiere "
        "access:manage, access:directory_read, access:local_users_manage o access:role_assignments_manage."
    ),
)
async def access_review_route(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    flag: Annotated[str, Query(pattern="^(|attention|inactive_account|manual_old|stale_login)$")] = "",
    days: Annotated[int, Query(ge=1, le=730)] = 90,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_any_permission_read("access:manage", "access:directory_read", "access:local_users_manage", "access:role_assignments_manage")),
):
    return await review_access(request.app.state.db, q.strip(), flag, days, limit, offset)


@router.post("/api/auth/users", response_model=UserCreatedResponse, status_code=201)
async def create_user_route(payload: UserCreate, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:local_users_manage"))):
    await _require_admin_permissions(request, actor_id, "access:local_users_manage", "access:role_assignments_manage")
    try:
        user_id, temporary_password = await register_user(request.app.state.db, payload.email, payload.display_name, payload.role_code, actor_id)
    except UnknownRoleError as exc:
        raise HTTPException(status_code=422, detail="Rol inválido") from exc
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail="El email ya está registrado") from exc
    return {"created": True, "actor_id": user_id, "temporary_password": temporary_password}


@router.patch("/api/auth/users/{user_id}", response_model=UserUpdatedResponse)
async def update_user_route(user_id: str, payload: UserUpdate, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:local_users_manage", "access:role_assignments_manage"))):
    if payload.display_name is not None or payload.is_active is not None or payload.password is not None:
        await _require_admin_permissions(request, actor_id, "access:local_users_manage")
    if payload.role_code is not None:
        await _require_admin_permissions(request, actor_id, "access:role_assignments_manage")
    if user_id == actor_id and payload.is_active is False:
        raise HTTPException(status_code=409, detail="No podés desactivar tu propio usuario")
    try:
        updated = await modify_user(request.app.state.db, user_id, payload.display_name, payload.is_active, payload.role_code, payload.password, actor_id)
    except SelfAdminLockoutError as exc:
        raise HTTPException(status_code=409, detail="No podés quitarte el rol administrador") from exc
    except UnknownRoleError as exc:
        raise HTTPException(status_code=422, detail="Rol inválido") from exc
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except InvalidUserPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"updated": True}


@router.post("/api/auth/users/{user_id}/reissue-temp-password", response_model=TemporaryPasswordResponse)
async def reissue_temp_password_route(user_id: str, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:local_users_manage"))):
    try:
        temporary_password = await reissue_password(request.app.state.db, user_id, actor_id)
    except InvalidUserPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if temporary_password is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado o inactivo")
    return {"temporary_password": temporary_password}


@router.delete("/api/auth/users/{user_id}", response_model=UserDeletedResponse)
async def delete_user_route(user_id: str, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:local_users_manage"))):
    if user_id == actor_id:
        raise HTTPException(status_code=409, detail="No podés eliminar tu propio usuario")
    try:
        deleted = await remove_user(request.app.state.db, user_id, actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"deleted": True, "actor_id": user_id}


@router.post(
    "/api/auth/users/{user_id}/roles", response_model=UserRoleGrantedResponse, status_code=201,
    summary="Asignar un rol de DS Hub a una identidad",
    description="Suma un rol asignado en DS Hub a una identidad local u Okta; convive con los roles que mapean sus grupos y ningún login lo quita. Aplica el techo de delegación; nadie cambia sus propios roles. Auditada.",
)
async def grant_user_role_route(user_id: str, payload: UserRoleGrant, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:role_assignments_manage"))):
    try:
        granted = await assign_role(request.app.state.db, user_id, payload.role_code, actor_id)
    except SelfRoleChangeError as exc:
        raise HTTPException(status_code=409, detail="No podés cambiar tus propios roles") from exc
    except UnknownRoleError as exc:
        raise HTTPException(status_code=422, detail="Rol inválido") from exc
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if granted is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if granted is False:
        raise HTTPException(status_code=409, detail="La identidad ya tiene ese rol")
    return {"granted": True, "actor_id": user_id, "role_code": payload.role_code}


@router.delete(
    "/api/auth/users/{user_id}/roles/{role_code}", response_model=UserRoleRevokedResponse,
    summary="Quitar un rol de DS Hub a una identidad",
    description="Quita un rol asignado en DS Hub. Un rol que viene de un grupo de Okta responde 409: se cambia en Okta. Aplica el techo de delegación y nunca deja a DS Hub sin administrador activo. Auditada.",
)
async def revoke_user_role_route(user_id: str, role_code: str, request: Request, actor_id: str = Depends(require_any_permission("access:manage", "access:role_assignments_manage"))):
    try:
        revoked = await unassign_role(request.app.state.db, user_id, role_code, actor_id)
    except SelfRoleChangeError as exc:
        raise HTTPException(status_code=409, detail="No podés cambiar tus propios roles") from exc
    except DelegationCeilingError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except OidcManagedRoleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not revoked:
        raise HTTPException(status_code=404, detail="La identidad no tiene ese rol")
    return {"revoked": True, "actor_id": user_id, "role_code": role_code}
