from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_read_access
from app.cyberark.pam.services.pam_read_models import (
    get_pam_cleanup_signals,
    get_pam_role_detail,
    get_pam_user_chain,
    list_pam_components,
    list_pam_connectors,
    list_pam_platforms,
    list_pam_roles,
    list_pam_users,
    list_platform_catalogs,
    list_platform_targets,
    list_psm_connector_types,
)
from app.cross.api.routes.cmdb_dependencies import PAM_CATALOG_DEPENDENCIES
from app.cyberark.pam.api.routes.cmdb_pam_models import (
    PamComponentsResponse,
    PamCleanupSignalsResponse,
    PamConnectorsResponse,
    PamPlatformCatalogsResponse,
    PamPlatformsResponse,
    PamPlatformTargetsResponse,
    PamRoleDetailResponse,
    PamRolesResponse,
    PamUserChainResponse,
    PamUsersResponse,
    PsmConnectorTypesResponse,
)

router = APIRouter(tags=["PAM"], dependencies=[Depends(require_read_access)])


@router.get(
    '/api/cmdb/pam-cleanup-signals',
    response_model=PamCleanupSignalsResponse,
    summary='Señales de limpieza PAM',
    description='Consulta de sólo lectura sobre grupos, conectores PSM, plataformas y Safes activos del inventario ingerido.',
    dependencies=PAM_CATALOG_DEPENDENCIES,
)
async def pam_cleanup_signals(request: Request):
    return await get_pam_cleanup_signals(request.app.state.db)


@router.get('/api/cmdb/pam-roles', response_model=PamRolesResponse, summary='Roles de la cadena PAM', description='Roles CyberArk con sus usuarios, Safes y cuentas alcanzables.')
async def pam_roles(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    kind: Annotated[str, Query(pattern="^(|user|okta_group|cyberark_role)$")] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_internal: bool = Query(True),
):
    return await list_pam_roles(request.app.state.db, q.strip(), limit, offset, kind, include_internal)


@router.get('/api/cmdb/pam-users', response_model=PamUsersResponse, summary='Usuarios de la cadena PAM', description='Usuarios CyberArk disponibles para explorar su cadena end-to-end.', dependencies=PAM_CATALOG_DEPENDENCIES)
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


@router.get('/api/cmdb/pam-platforms', response_model=PamPlatformsResponse, summary='Plataformas de la cadena PAM', description='Plataformas CyberArk con sus políticas CPM/workflow y conexiones conocidas.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_platforms(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_pam_platforms(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-connectors', response_model=PamConnectorsResponse, summary='Conectores PSM de la cadena PAM', description='Servidores PSM/connectors que ejecutan sesiones privilegiadas.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_connectors(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_pam_connectors(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-psm-connector-types', response_model=PsmConnectorTypesResponse, summary='Catálogo de tipos de conector de sesión PSM', description='Ej. PSM-RDP, PSM-SSH. No son servidores PSM (ver /pam-connectors).', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_psm_connector_types(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_psm_connector_types(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/pam-components', response_model=PamComponentsResponse, summary='Salud de componentes PAM', description='Conectividad y versión de Portal/CPM/PSM. Sin métricas de host ni secretos.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_components(request: Request):
    return await list_pam_components(request.app.state.db)


@router.get('/api/cmdb/pam-platform-catalogs', response_model=PamPlatformCatalogsResponse, summary='Catálogos de plataformas dependent/group/rotational', description='Catálogos técnicos de plataformas dependent, group y rotational.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_platform_catalogs(request: Request):
    return await list_platform_catalogs(request.app.state.db)


@router.get(
    '/api/cmdb/pam-platform-targets',
    response_model=PamPlatformTargetsResponse,
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


@router.get('/api/cmdb/pam-users/{object_id}/chain', response_model=PamUserChainResponse, summary='Cadena end-to-end de un usuario PAM', description='Recorre usuarios -> roles -> Safes -> plataformas -> PSM para un usuario PAM.', dependencies=PAM_CATALOG_DEPENDENCIES)
async def pam_user_chain(request: Request, object_id: int, include_internal: bool = Query(True)):
    chain = await get_pam_user_chain(request.app.state.db, object_id, include_internal)
    if chain is None:
        raise HTTPException(status_code=404, detail="Usuario PAM no encontrado")
    return chain


@router.get('/api/cmdb/pam-roles/{object_id}', response_model=PamRoleDetailResponse, summary='Detalle de un rol PAM', description='Detalle de un rol CyberArk con sus miembros, Safes y cuentas alcanzables.')
async def pam_role_detail(request: Request, object_id: int, include_internal: bool = Query(True)):
    detail = await get_pam_role_detail(request.app.state.db, object_id, include_internal)
    if detail is None:
        raise HTTPException(status_code=404, detail="Rol PAM no encontrado")
    return detail
