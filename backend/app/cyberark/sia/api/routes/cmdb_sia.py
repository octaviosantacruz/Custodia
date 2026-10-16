from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_read_access
from app.cross.services.account_security import (
    get_actor_permissions,
)
from app.cross.services.inventory_views import (
    resolve_sia_policy_grantees,
)
from app.cyberark.sia.services.sia_read_models import (
    get_sia_policy_detail,
    list_sia_connectors,
    list_sia_database_accounts,
    list_sia_destinations,
    list_sia_policies,
    list_sia_resources,
    list_sia_target_sets,
)
from app.cross.api.routes.cmdb_dependencies import SIA_CATALOG_DEPENDENCIES
from app.cyberark.sia.api.routes.cmdb_sia_models import (
    SiaConnectorsResponse,
    SiaDatabaseAccountsResponse,
    SiaDestinationsResponse,
    SiaPoliciesResponse,
    SiaPolicyDetailResponse,
    SiaResourcesResponse,
    SiaTargetSetsResponse,
)

router = APIRouter(tags=["SIA"], dependencies=[Depends(require_read_access)])


@router.get('/api/cmdb/sia-policies', response_model=SiaPoliciesResponse, response_model_exclude_unset=True, summary='Políticas de acceso SIA', description='Políticas de acceso normalizadas, con sus usuarios/roles/grupos otorgados como atributos y resoluciones de correo por fuente autorizada.')
async def sia_policies(
    request: Request,
    actor_id: str = Depends(require_read_access),
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Annotated[str, Query(max_length=40)] = "",
    linkage_status: Annotated[str, Query(pattern="^(|linked|multiple|unlinked)$")] = "",
):
    result = await list_sia_policies(request.app.state.db, q.strip(), limit, offset, status.strip(), linkage_status.strip())
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    readable_sides = _person_link_readable_sides(permissions)
    result["rows"] = await resolve_sia_policy_grantees(
        request.app.state.db, result["rows"], readable_sides=readable_sides,
    )
    return result


@router.get('/api/cmdb/sia-policies/{object_id}', response_model=SiaPolicyDetailResponse, response_model_exclude_unset=True, summary='Detalle de una política de acceso SIA', description='Política SIA con sus usuarios, roles y grupos otorgados como atributos.')
async def sia_policy_detail(request: Request, object_id: int, actor_id: str = Depends(require_read_access)):
    policy = await get_sia_policy_detail(request.app.state.db, object_id)
    if policy is None:
        raise HTTPException(status_code=404, detail="Política no encontrada")
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    readable_sides = _person_link_readable_sides(permissions)
    policy = (await resolve_sia_policy_grantees(
        request.app.state.db, [policy], readable_sides=readable_sides,
    ))[0]
    return {"policy": policy}


def _person_link_readable_sides(permissions: list[str]) -> set[str]:
    can_manage = "access:manage" in permissions
    readable: set[str] = set()
    if can_manage or "identity:catalogs_read" in permissions:
        readable.add("identity")
    if can_manage or "pam:catalogs_read" in permissions:
        readable.add("pam")
    return readable


@router.get('/api/cmdb/sia-destinations', response_model=SiaDestinationsResponse, summary='Destinos/assets SIA persistidos', description='Destinos SIA (IP, FQDN o nombre lógico) con su estado de vinculación a políticas.')
async def sia_destinations(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    destination_type: Annotated[str, Query(pattern="^(|ip|fqdn|logical_name)$")] = "",
):
    return await list_sia_destinations(request.app.state.db, q.strip(), limit, offset, destination_type.strip())


@router.get('/api/cmdb/sia-connectors', response_model=SiaConnectorsResponse, summary='Conectores SIA', description='Catálogo de conectores SIA. Nunca incluye dirección/host ni red del conector.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_connectors(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_sia_connectors(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/sia-resources', response_model=SiaResourcesResponse, summary='Recursos SIA (VM)', description='Catálogo de recursos de infraestructura SIA (VMs). Nunca incluye IP/FQDN/red.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_resources(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    resource_type: Annotated[str, Query(max_length=80)] = "",
):
    return await list_sia_resources(request.app.state.db, q.strip(), limit, offset, resource_type.strip())


@router.get('/api/cmdb/sia-database-accounts', response_model=SiaDatabaseAccountsResponse, summary='Cuentas fuertes de base de datos SIA', description='Catálogo de cuentas fuertes de base de datos SIA. Nunca incluye dirección/host ni usuario de la cuenta.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_database_accounts(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_sia_database_accounts(request.app.state.db, q.strip(), limit, offset)


@router.get(
    "/api/cmdb/sia-target-sets",
    response_model=SiaTargetSetsResponse,
    summary="Target sets SIA; nunca incluye secretos ni entradas de red",
    description="Catálogo read-only de target sets SIA; nunca incluye secretos ni entradas de red.",
    dependencies=SIA_CATALOG_DEPENDENCIES,
)
async def sia_target_sets(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_sia_target_sets(request.app.state.db, q.strip(), limit, offset)
