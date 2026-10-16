"""NSK-RBAC-001: Netskope administrators, their roles and the permissions of each role, behind a strict permission.

Only ``netskope:admin_inventory_read`` opens these routes; ``netskope:read`` and ``access:manage`` deliberately do
not, because the rows identify privileged accounts. Reads are audited with counts and filter names, never with
administrator values. No credential or creator/editor identity is ever stored (see ``netskope_rbac_mapping``).
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict

from app import auth as auth_module
from app.auth import require_authenticated_read_access
from app.cross.services.audit_trail import record_audit
from app.netskope.sse.integrations.netskope import netskope_rbac_configured
from app.netskope.sse.services.netskope_read_models import (
    get_netskope_admin_role,
    list_netskope_admin_roles,
    list_netskope_admins,
)

router = APIRouter(tags=["Administradores Netskope"])

ADMIN_INVENTORY_PERMISSION = "netskope:admin_inventory_read"


class NetskopeAdminRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    active: bool | None
    is_locked: bool | None
    record_type: str | None
    last_login: str | None
    mfa_enabled: bool | None
    role_id: str | None
    role_name: str | None


class NetskopeAdminsResponse(BaseModel):
    configured: bool
    rows: list[NetskopeAdminRow]
    total: int
    filtered_total: int
    active: int
    active_without_role: int
    service_accounts: int
    active_people_without_mfa: int
    last_observed_at: datetime | None


class NetskopeAdminRoleRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    reported_user_count: int | None
    last_edited: str | None
    api_groups_total: int | None
    admins: int
    read_groups: int
    write_groups: int
    admin_groups: int
    last_seen_at: datetime


class NetskopeAdminRolesResponse(BaseModel):
    configured: bool
    rows: list[NetskopeAdminRoleRow]
    total: int
    last_observed_at: datetime | None


class NetskopeRolePermission(BaseModel):
    group_id: int
    group: str
    permission: str
    pages: list[str]


class NetskopeRoleAdmin(BaseModel):
    id: str
    name: str
    active: bool | None
    record_type: str | None


class NetskopeAdminRoleDetail(BaseModel):
    id: str
    name: str
    last_edited: str | None
    api_groups_total: int | None
    permissions: list[NetskopeRolePermission]
    admins: list[NetskopeRoleAdmin]


async def require_admin_inventory_read(request: Request) -> str:
    actor_id = await require_authenticated_read_access(request)
    if ADMIN_INVENTORY_PERMISSION not in await auth_module.get_actor_permissions(request.app.state.db, actor_id):
        raise HTTPException(status_code=403, detail=f"Requiere el permiso {ADMIN_INVENTORY_PERMISSION}.")
    return actor_id


@router.get(
    "/api/cmdb/netskope/admins",
    response_model=NetskopeAdminsResponse,
    summary="Administradores de Netskope",
    description=(
        "Administradores del tenant con su rol, estado, tipo de cuenta, último acceso y MFA, leídos de Netskope. "
        "Una cuenta sin rol resuelto aparece con rol nulo. No incluye credenciales ni quién creó o editó cada rol. "
        "Requiere netskope:admin_inventory_read."
    ),
)
async def netskope_admins(
    request: Request,
    actor_id: str = Depends(require_admin_inventory_read),
    search: Annotated[str, Query(max_length=120)] = "",
    record_type: Annotated[Literal["", "USER", "SERVICE_ACCOUNT"], Query()] = "",
    state: Annotated[Literal["", "active", "inactive"], Query()] = "",
    role: Annotated[str, Query(max_length=20, pattern=r"^(|none|-?[0-9]+)$")] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    result = await list_netskope_admins(request.app.state.db, search.strip(), record_type, state, role, limit, offset)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_admin", entity_id="list",
        after_data={
            "row_count": len(result["rows"]), "searched": bool(search.strip()), "record_type": record_type or "all",
            "state": state or "all", "role": "none" if role == "none" else ("one" if role else "all"),
        },
    )
    return {**result, "configured": netskope_rbac_configured()}


@router.get(
    "/api/cmdb/netskope/admin-roles",
    response_model=NetskopeAdminRolesResponse,
    summary="Roles de administración de Netskope",
    description=(
        "Roles con cuántos administradores observados tienen y cuántos grupos de API abren en lectura, "
        "escritura y administración. Un rol sin administradores se lista igual. Requiere netskope:admin_inventory_read."
    ),
)
async def netskope_admin_roles(request: Request, actor_id: str = Depends(require_admin_inventory_read)):
    result = await list_netskope_admin_roles(request.app.state.db)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_admin_role", entity_id="list",
        after_data={"row_count": len(result["rows"])},
    )
    return {**result, "configured": netskope_rbac_configured()}


@router.get(
    "/api/cmdb/netskope/admin-roles/{role_id}",
    response_model=NetskopeAdminRoleDetail,
    summary="Permisos de un rol de administración de Netskope",
    description=(
        "Grupos de API del rol con su nivel (lectura, escritura o administración) y las páginas de la consola que "
        "abre cada uno, más los administradores que lo tienen. Requiere netskope:admin_inventory_read."
    ),
)
async def netskope_admin_role_detail(
    request: Request,
    role_id: Annotated[str, Path(pattern=r"^-?[0-9]+$", max_length=12)],
    actor_id: str = Depends(require_admin_inventory_read),
):
    result = await get_netskope_admin_role(request.app.state.db, role_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Rol de administración no encontrado")
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_admin_role", entity_id=role_id,
        after_data={"permission_count": len(result["permissions"]), "admin_count": len(result["admins"])},
    )
    return result
