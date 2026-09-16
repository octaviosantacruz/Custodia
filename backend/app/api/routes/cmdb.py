from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...auth import require_any_permission_read, require_read_access
from ...repositories.access_queries import list_access_assets
from ...repositories.cmdb import get_cmdb_coverage
from ...repositories.identity_admin_queries import (
    get_identity_federation_detail, get_identity_role_detail, get_identity_user_detail,
    list_active_identity_federations_for_resolution, list_identity_federations,
    list_identity_roles, list_identity_users,
)
from ...repositories.identity_pam_bridge import (
    annotate_identity_standard_seats,
    get_identity_user_pam_chain,
    list_standard_seat_source_ids,
)
from ...repositories.pam_chain_queries import (
    get_pam_user_chain, list_aim_applications, list_pam_components, list_pam_connectors,
    list_pam_platforms, list_pam_users, list_platform_catalogs, list_platform_targets, list_psm_connector_types,
)
from ...repositories.pam_role_queries import get_pam_role_detail, list_pam_roles
from ...repositories.sia_queries import (
    get_sia_policy_detail, list_sia_connectors, list_sia_database_accounts, list_sia_destinations,
    list_sia_policies, list_sia_resources,
)
from ...services.identity_federation_resolution import resolve_users_federations

router = APIRouter(tags=["CMDB normalizado"], dependencies=[Depends(require_read_access)])
# PAM technical catalogs (platforms/connectors/components/AIM/access-assets) used to require
# access:manage -- the same permission as full user/role administration. These now also accept
# the narrower pam:catalogs_read, so PAM operator/admin roles can see PAM's own catalogs without
# needing user-admin rights. access:manage keeps working unchanged (see migration 044).
# PENTEST-005: these are read-only catalogs; the *_read variants never accept X-Access-Token
# (the automation token is for writes only, not for browsing admin/PAM/SIA catalogs).
PAM_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "pam:catalogs_read"))]
SIA_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "sia:catalogs_read"))]
IDENTITY_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "identity:catalogs_read"))]

@router.get('/api/cmdb/coverage', summary='Cobertura del CMDB normalizado', description='Muestra objetos y relaciones disponibles para las cadenas PAM y SIA.')
async def cmdb_coverage(request: Request):
    return await get_cmdb_coverage(request.app.state.db)


@router.get('/api/cmdb/identity-users', summary='Usuarios de Identity Administration', description='Usuarios SCIM normalizados, separados de la cadena PAM. El asiento Standard se anota por UUID PAM coincidente, no por email.')
async def identity_users(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    active: Annotated[str, Query(pattern="^(|active|inactive)$")] = "",
    standard_seat: Annotated[str, Query(pattern="^(|reconciled|unreconciled)$")] = "",
):
    source_ids = None
    exclude_source_ids = None
    if standard_seat:
        seat_ids = await list_standard_seat_source_ids(request.app.state.db)
        if standard_seat == "reconciled":
            source_ids = seat_ids
        else:
            exclude_source_ids = seat_ids
    result = await list_identity_users(
        request.app.state.db, q.strip(), limit, offset, active, source_ids, exclude_source_ids,
    )
    federations = await list_active_identity_federations_for_resolution(request.app.state.db)
    resolve_users_federations(result["rows"], federations)
    result["rows"] = await annotate_identity_standard_seats(request.app.state.db, result["rows"])
    result["standard_seat"] = standard_seat
    return result


@router.get('/api/cmdb/identity-users/{object_id}', summary='Detalle de un usuario de Identity Administration')
async def identity_user_detail(request: Request, object_id: int):
    user, roles = await get_identity_user_detail(request.app.state.db, object_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await annotate_identity_standard_seats(request.app.state.db, [user])
    federations = await list_active_identity_federations_for_resolution(request.app.state.db)
    resolve_users_federations([user], federations)
    return {"user": user, "roles": roles}


@router.get(
    '/api/cmdb/identity-users/{object_id}/pam-chain',
    summary='Cadena PAM de un usuario de Identity Administration (puente sancionado por UUID)',
    description=(
        'Lectura cross-source sancionada: vincula al usuario PAM con el mismo source_id '
        '(UUID de CyberArk Identity) y devuelve roles -> Safes -> plataformas -> PSM. '
        'Sólo por igualdad exacta de identificador, sólo lectura, no alimenta cobertura ni KPIs. '
        'Ver docs/architecture/integration-contracts.md.'
    ),
)
async def identity_user_pam_chain(request: Request, object_id: int):
    user, _ = await get_identity_user_detail(request.app.state.db, object_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return await get_identity_user_pam_chain(request.app.state.db, user["source_id"])


@router.get('/api/cmdb/identity-roles', summary='Roles de Identity Administration')
async def identity_roles(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: Annotated[str, Query(pattern="^(|role|okta_group)$")] = "",
):
    return await list_identity_roles(request.app.state.db, q.strip(), limit, offset, kind)


@router.get('/api/cmdb/identity-roles/{object_id}', summary='Detalle de un rol de Identity Administration')
async def identity_role_detail(request: Request, object_id: int):
    role, members = await get_identity_role_detail(request.app.state.db, object_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return {"role": role, "members": members}


@router.get('/api/cmdb/identity-federations', summary='Federaciones de Identity Administration', description='Catálogo de federaciones. Sólo campos núcleo (tipo/activa/rol/uso); nunca certificados SAML/SSO ni dominios/apps federados.', dependencies=IDENTITY_CATALOG_DEPENDENCIES)
async def identity_federations(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_identity_federations(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/identity-federations/{object_id}', summary='Detalle de una federación de Identity Administration', dependencies=IDENTITY_CATALOG_DEPENDENCIES)
async def identity_federation_detail(request: Request, object_id: int):
    federation = await get_identity_federation_detail(request.app.state.db, object_id)
    if federation is None:
        raise HTTPException(status_code=404, detail="Federación no encontrada")
    return federation


@router.get('/api/cmdb/pam-roles', summary='Roles de la cadena PAM', description='Roles CyberArk con sus usuarios, Safes y cuentas alcanzables.')
async def pam_roles(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    kind: Annotated[str, Query(pattern="^(|user|okta_group|cyberark_role)$")] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_internal: bool = Query(True),
):
    return await list_pam_roles(request.app.state.db, q.strip(), limit, offset, kind, include_internal)


@router.get('/api/cmdb/pam-users', summary='Usuarios de la cadena PAM', description='Usuarios CyberArk disponibles para explorar su cadena end-to-end.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_users(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_internal: bool = Query(True),
    standard_seat: Annotated[str, Query(pattern="^(|reconciled|unreconciled)$")] = "",
    status: Annotated[str, Query(pattern="^(|suspended|disabled)$")] = "",
):
    return await list_pam_users(request.app.state.db, q.strip(), limit, offset, include_internal, standard_seat, status)


@router.get('/api/cmdb/pam-platforms', summary='Plataformas de la cadena PAM', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_platforms(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_pam_platforms(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-connectors', summary='Conectores PSM de la cadena PAM', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_connectors(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_pam_connectors(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-psm-connector-types', summary='Catálogo de tipos de conector de sesión PSM', description='Ej. PSM-RDP, PSM-SSH. No son servidores PSM (ver /pam-connectors).', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_psm_connector_types(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_psm_connector_types(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-components', summary='Salud de componentes PAM', description='Conectividad y versión de Portal/CPM/PSM. Sin métricas de host ni secretos.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_components(request: Request):
    return await list_pam_components(request.app.state.db)


@router.get('/api/cmdb/pam-platform-catalogs', summary='Catálogos de plataformas dependent/group/rotational', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_platform_catalogs(request: Request):
    return await list_platform_catalogs(request.app.state.db)


@router.get(
    '/api/cmdb/pam-platform-targets',
    summary='Política CPM/workflow por plataforma destino',
    description='Catálogo separado de "target platforms": dual control, verify/change/reconcile y PSMServerId. No se fusiona con /pam-platforms porque su ID no siempre coincide.',
    dependencies=PAM_CATALOG_DEPENDENCIES,
)
async def pam_platform_targets(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_platform_targets(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-aim-applications', summary='Inventario AIM de aplicaciones', description='Catálogo de aplicaciones AIM. Nunca incluye datos del propietario de negocio.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_aim_applications(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_aim_applications(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/access-assets', summary='Assets del Access space', description='Catálogo de assets accesibles vía Access space. Nunca incluye dirección/host ni usuario de la cuenta.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def access_assets(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    asset_type: Annotated[str, Query(max_length=80)] = "",
):
    return await list_access_assets(request.app.state.db, q.strip(), limit, offset, asset_type.strip())


@router.get('/api/cmdb/pam-users/{object_id}/chain', summary='Cadena end-to-end de un usuario PAM', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_user_chain(request: Request, object_id: int, include_internal: bool = Query(True)):
    chain = await get_pam_user_chain(request.app.state.db, object_id, include_internal)
    if chain is None:
        raise HTTPException(status_code=404, detail="Usuario PAM no encontrado")
    return chain


@router.get('/api/cmdb/pam-roles/{object_id}', summary='Detalle de un rol PAM')
async def pam_role_detail(request: Request, object_id: int, include_internal: bool = Query(True)):
    detail = await get_pam_role_detail(request.app.state.db, object_id, include_internal)
    if detail is None:
        raise HTTPException(status_code=404, detail="Rol PAM no encontrado")
    return detail


@router.get('/api/cmdb/sia-policies', summary='Políticas de acceso SIA', description='Políticas de acceso normalizadas, con sus usuarios/roles/grupos otorgados como atributos.')
async def sia_policies(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Annotated[str, Query(max_length=40)] = "",
    linkage_status: Annotated[str, Query(pattern="^(|linked|multiple|unlinked)$")] = "",
):
    return await list_sia_policies(request.app.state.db, q.strip(), limit, offset, status.strip(), linkage_status.strip())


@router.get('/api/cmdb/sia-policies/{object_id}', summary='Detalle de una política de acceso SIA')
async def sia_policy_detail(request: Request, object_id: int):
    policy = await get_sia_policy_detail(request.app.state.db, object_id)
    if policy is None:
        raise HTTPException(status_code=404, detail="Política no encontrada")
    return {"policy": policy}


@router.get('/api/cmdb/sia-destinations', summary='Destinos/assets SIA persistidos')
async def sia_destinations(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    destination_type: Annotated[str, Query(pattern="^(|ip|fqdn|logical_name)$")] = "",
):
    return await list_sia_destinations(request.app.state.db, q.strip(), limit, offset, destination_type.strip())


@router.get('/api/cmdb/sia-connectors', summary='Conectores SIA', description='Catálogo de conectores SIA. Nunca incluye dirección/host ni red del conector.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_connectors(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_sia_connectors(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/sia-resources', summary='Recursos SIA (VM)', description='Catálogo de recursos de infraestructura SIA (VMs). Nunca incluye IP/FQDN/red.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_resources(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    resource_type: Annotated[str, Query(max_length=80)] = "",
):
    return await list_sia_resources(request.app.state.db, q.strip(), limit, offset, resource_type.strip())


@router.get('/api/cmdb/sia-database-accounts', summary='Cuentas fuertes de base de datos SIA', description='Catálogo de cuentas fuertes de base de datos SIA. Nunca incluye dirección/host ni usuario de la cuenta.', dependencies=SIA_CATALOG_DEPENDENCIES)
async def sia_database_accounts(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_sia_database_accounts(request.app.state.db, q.strip(), limit, offset)
