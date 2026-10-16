from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_read_access
from app.cyberark.identity_administration.services.identity_read_models import (
    get_identity_federation_detail,
    get_identity_membership_data,
    get_identity_role_detail,
    get_identity_role_review_data,
    get_identity_user_detail,
    list_active_identity_federations_for_resolution,
    list_identity_federations,
    list_identity_roles,
    list_identity_users,
)
from app.cross.services.inventory_views import (
    annotate_identity_standard_seats,
    get_identity_user_pam_chain,
    list_standard_seat_emails,
)
from app.cyberark.identity_administration.services.identity_membership import membership_graph
from app.cyberark.identity_administration.services.role_membership_review import review_role_memberships_detailed
from app.cyberark.identity_administration.services.identity_federation_resolution import resolve_users_federations
from app.cross.api.routes.cmdb_dependencies import IDENTITY_CATALOG_DEPENDENCIES
from app.cyberark.identity_administration.api.routes.cmdb_identity_models import (
    IdentityMembershipResponse, IdentityFederationDetailRow,
    IdentityFederationsResponse,
    IdentityPamChainResponse,
    IdentityRoleDetailResponse,
    IdentityRolesResponse,
    IdentityRoleMatchesResponse,
    IdentityUserDetailResponse,
    IdentityUsersResponse,
)

router = APIRouter(tags=["Identity Administration"], dependencies=[Depends(require_read_access)])


@router.get('/api/cmdb/identity-users', response_model=IdentityUsersResponse, summary='Usuarios de Identity Administration', description='Usuarios SCIM normalizados. El asiento Standard se anota por email exacto y único con evidencia PAM.')
async def identity_users(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    active: Annotated[str, Query(pattern="^(|active|inactive)$")] = "",
    standard_seat: Annotated[str, Query(pattern="^(|reconciled|unreconciled)$")] = "",
):
    seat_emails = None
    exclude_seat_emails = None
    if standard_seat:
        emails = await list_standard_seat_emails(request.app.state.db)
        if standard_seat == "reconciled":
            seat_emails = emails
        else:
            exclude_seat_emails = emails
    result = await list_identity_users(
        request.app.state.db, q.strip(), limit, offset, active, seat_emails, exclude_seat_emails,
    )
    federations = await list_active_identity_federations_for_resolution(request.app.state.db)
    resolve_users_federations(result["rows"], federations)
    result["rows"] = await annotate_identity_standard_seats(request.app.state.db, result["rows"])
    result["standard_seat"] = standard_seat
    return result


@router.get('/api/cmdb/identity-users/{object_id}', response_model=IdentityUserDetailResponse, summary='Detalle de un usuario de Identity Administration', description='Usuario SCIM con sus roles y federaciones resueltas.')
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
    response_model=IdentityPamChainResponse,
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
    return await get_identity_user_pam_chain(
        request.app.state.db,
        user["source_id"],
        (user.get("attributes") or {}).get("email"),
    )


@router.get('/api/cmdb/identity-roles', response_model=IdentityRolesResponse, summary='Roles de Identity Administration', description='Roles y grupos Okta normalizados de CyberArk Identity.')
async def identity_roles(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: Annotated[str, Query(pattern="^(|role|okta_group)$")] = "",
    sort: Annotated[str, Query(pattern="^(name|members|modified)$")] = "name",
    direction: Annotated[str, Query(pattern="^(asc|desc)$")] = "asc",
    object_ids: Annotated[str | None, Query(pattern=r"^\d+(,\d+)*$", max_length=4000,
                                            description="Restringe a estos object_id (separados por coma).")] = None,
):
    ids = [int(value) for value in object_ids.split(",")] if object_ids else None
    return await list_identity_roles(request.app.state.db, q.strip(), limit, offset, kind, sort, direction, ids)


@router.get('/api/cmdb/identity-roles/member-matches', response_model=IdentityRoleMatchesResponse,
            summary='Coincidencia de miembros entre roles de Identity Administration',
            description='Coincidencia de miembros; no prueba permisos iguales ni autoriza retirar roles.',
            dependencies=IDENTITY_CATALOG_DEPENDENCIES)
async def identity_role_member_matches(request: Request):
    objects, relationships, run = await get_identity_role_review_data(request.app.state.db)
    result = review_role_memberships_detailed(objects, relationships)
    roles_analyzed = sum(obj.object_type == 'role' for obj in objects)
    excluded = result['roles_excluded_count']
    return {
        **result,
        'scope': 'Coincidencia de miembros; no prueba permisos iguales ni autoriza retirar roles',
        'source': {
            'source_system': 'identity_administration',
            'last_run_status': run['status'] if run else None,
            'last_run_finished_at': run['completed_at'] if run else None,
        },
        'complete': excluded == 0 and run is not None and run['status'] == 'completed',
        'roles_analyzed': roles_analyzed,
        'roles_excluded': excluded,
    }


@router.get('/api/cmdb/identity-roles/{object_id}', response_model=IdentityRoleDetailResponse, summary='Detalle de un rol de Identity Administration', description='Rol o grupo Okta con sus miembros normalizados.')
async def identity_role_detail(request: Request, object_id: int):
    role, members = await get_identity_role_detail(request.app.state.db, object_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return {"role": role, "members": members}


@router.get('/api/cmdb/identity-federations', response_model=IdentityFederationsResponse, summary='Federaciones de Identity Administration', description='Catálogo de federaciones. Sólo campos núcleo (tipo/activa/rol/uso); nunca certificados SAML/SSO ni dominios/apps federados.', dependencies=IDENTITY_CATALOG_DEPENDENCIES)
async def identity_federations(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await list_identity_federations(request.app.state.db, q.strip(), limit, offset)


@router.get('/api/cmdb/identity-federations/{object_id}', response_model=IdentityFederationDetailRow, summary='Detalle de una federación de Identity Administration', description='Federación con sólo campos núcleo; nunca certificados SAML/SSO ni dominios/apps federados.', dependencies=IDENTITY_CATALOG_DEPENDENCIES)
async def identity_federation_detail(request: Request, object_id: int):
    federation = await get_identity_federation_detail(request.app.state.db, object_id)
    if federation is None:
        raise HTTPException(status_code=404, detail="Federación no encontrada")
    return federation


@router.get('/api/cmdb/identity-roles/{object_id}/membership', response_model=IdentityMembershipResponse,
            summary='Capas de membresía directa de Identity Administration',
            description='Roles, grupos de Okta y usuarios activos vinculados por IDs SCIM exactos. Incluye referencias pendientes y límite de recorrido; no cruza PAM ni implica permisos efectivos.')
async def identity_role_membership(request: Request, object_id: int):
    nodes, edges = await get_identity_membership_data(request.app.state.db, object_id)
    result = membership_graph(object_id, nodes, edges)
    if result is None:
        raise HTTPException(status_code=404, detail="Rol activo no encontrado")
    return result
