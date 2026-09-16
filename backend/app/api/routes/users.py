from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, StringConstraints, field_validator, model_validator

from ...auth import require_permission, require_permission_read
from ...repositories.access_control import role_exists, role_grants_permission
from ...repositories.user_admin import InvalidUserPassword, create_user, delete_user, list_users, reissue_temporary_password, update_user
from ...schemas import validate_email_format

router = APIRouter(tags=["Usuarios y permisos"])


class UserCreate(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    role_code: str = "reader"

    _validate_email = field_validator("email")(validate_email_format)


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


@router.get("/api/auth/users")
async def list_users_route(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    role: Annotated[str, Query(max_length=80)] = "",
    status: Annotated[str, Query(pattern="^(|active|inactive|pending)$")] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_permission_read("access:manage")),
):
    return await list_users(request.app.state.db, q.strip(), role, status, limit, offset)


@router.post("/api/auth/users", status_code=201)
async def create_user_route(payload: UserCreate, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    if not await role_exists(request.app.state.db, payload.role_code):
        raise HTTPException(status_code=422, detail="Rol inválido")
    try:
        user_id, temporary_password = await create_user(request.app.state.db, payload.email, payload.display_name, payload.role_code, actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except UniqueViolation as exc:
        # IF-021: matched on the driver's actual SQLSTATE (23505) and the
        # specific constraints this table can violate, not on the text of
        # the exception -- a driver upgrade, a different locale, or an
        # unrelated future unique constraint on the same table used to be
        # able to silently misclassify as a duplicate email (or fall
        # through to an opaque 500 if the message ever stopped containing
        # "duplicate key"). actor_id is derived from the lowercased email
        # (user_admin.create_user), so either its primary key or the
        # dedicated case-insensitive email index can be the one that fires.
        if getattr(exc.diag, "constraint_name", None) in {"access_users_pkey", "uq_access_users_email_lower"}:
            raise HTTPException(status_code=409, detail="El email ya está registrado") from exc
        raise
    return {"created": True, "actor_id": user_id, "temporary_password": temporary_password}


@router.patch("/api/auth/users/{user_id}")
async def update_user_route(user_id: str, payload: UserUpdate, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    if user_id == actor_id and payload.is_active is False:
        raise HTTPException(status_code=409, detail="No podés desactivar tu propio usuario")
    if user_id == actor_id and payload.role_code is not None and not await role_grants_permission(request.app.state.db, payload.role_code, "access:manage"):
        raise HTTPException(status_code=409, detail="No podés quitarte el rol administrador")
    if payload.role_code is not None and not await role_exists(request.app.state.db, payload.role_code):
        raise HTTPException(status_code=422, detail="Rol inválido")
    try:
        updated = await update_user(request.app.state.db, user_id, payload.display_name, payload.is_active, payload.role_code, payload.password, actor_id)
    except InvalidUserPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"updated": True}


@router.post("/api/auth/users/{user_id}/reissue-temp-password")
async def reissue_temp_password_route(user_id: str, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    try:
        temporary_password = await reissue_temporary_password(request.app.state.db, user_id, actor_id)
    except InvalidUserPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if temporary_password is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado o inactivo")
    return {"temporary_password": temporary_password}


@router.delete("/api/auth/users/{user_id}")
async def delete_user_route(user_id: str, request: Request, actor_id: str = Depends(require_permission("access:manage"))):
    if user_id == actor_id:
        raise HTTPException(status_code=409, detail="No podés eliminar tu propio usuario")
    try:
        deleted = await delete_user(request.app.state.db, user_id, actor_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"deleted": True, "actor_id": user_id}
