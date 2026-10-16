"""Cadenas: read-only person view across the integrated tools (CHAIN-010).

The view is reachable with any of the four tool read permissions; each source
is only queried and only returned when the actor can read it, so an absent
tool never reveals that a record exists elsewhere.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_any_permission_read, require_authenticated_read_access
from app.cross.services.account_security import (
    get_actor_permissions,
)
from app.cross.services.inventory_views import (
    get_person_summary,
    search_person_candidates,
)
from app.cross.services.person_client_coverage import get_person_client_coverage, get_person_client_coverage_detail
from app.cross.services.person_email_matching import normalize_person_email
from app.cross.api.routes.chain_models import PersonSearchResponse, PersonSummaryResponse
from app.cross.api.routes.person_client_coverage_models import PersonClientCoverageDetail, PersonClientCoverageSummary

READ = require_any_permission_read(
    "access:manage", "pam:catalogs_read", "identity:catalogs_read", "netskope:read",
)

router = APIRouter(tags=["Cadenas Persona"])


async def require_person_client_coverage_read(request: Request) -> str:
    """CONN-001 is a two-source read; deny before its repository is called."""
    actor_id = await require_authenticated_read_access(request)
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    can_manage = "access:manage" in permissions
    if not can_manage and not {
        "identity:catalogs_read", "netskope:read",
    }.issubset(permissions):
        raise HTTPException(
            status_code=403,
            detail="CONN-001 requiere lectura de Identity Administration y Netskope",
        )
    request.state.actor_permissions = frozenset(permissions)
    return actor_id


def _readable_sources(permissions: list[str]) -> set[str]:
    """Sources the actor can read; SIA only adds its reference node."""
    can_manage = "access:manage" in permissions
    sources: set[str] = set()
    if can_manage or "pam:catalogs_read" in permissions:
        sources.add("pam")
    if can_manage or "identity:catalogs_read" in permissions:
        sources.add("identity")
    if can_manage or "netskope:read" in permissions:
        sources.add("netskope")
    if can_manage or "sia:catalogs_read" in permissions:
        sources.add("sia")
    return sources


@router.get(
    "/api/chains/person/search",
    response_model=PersonSearchResponse,
    summary="Buscar personas entre herramientas",
    description=(
        "Busca por correo o nombre en las fuentes que el actor puede leer y agrupa por "
        "correo normalizado: dos personas con el mismo nombre y distinto correo son dos "
        "resultados. Hasta 20 personas. Requiere al menos un permiso de lectura de "
        "PAM, Identity o Netskope (access:manage, pam:catalogs_read, "
        "identity:catalogs_read o netskope:read); sia:catalogs_read no alcanza por sí solo."
    ),
)
async def person_search(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=160)],
    actor_id: str = Depends(READ),
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="q debe contener al menos 2 caracteres")
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return await search_person_candidates(
        request.app.state.db, query=query, sources=_readable_sources(permissions),
    )


@router.get(
    "/api/chains/person",
    response_model=PersonSummaryResponse,
    summary="Resumen por persona y herramienta",
    description=(
        "Resuelve la persona por correo normalizado con la regla sancionada 1 a 1 y "
        "devuelve un resumen por herramienta legible, sólo con datos persistidos. Sin "
        "permiso para una fuente, esa herramienta no aparece. SIA se agrega como "
        "referencia por nombre sólo si hay usuario PAM resuelto."
    ),
)
async def person_summary(
    request: Request,
    email: Annotated[str, Query(min_length=3, max_length=320)],
    actor_id: str = Depends(READ),
):
    normalized = normalize_person_email(email)
    if normalized is None:
        raise HTTPException(status_code=422, detail="email debe ser una dirección completa")
    permissions = await get_actor_permissions(request.app.state.db, actor_id)
    return await get_person_summary(
        request.app.state.db, email=normalized, sources=_readable_sources(permissions),
    )


@router.get(
    "/api/chains/person/coverage",
    response_model=PersonClientCoverageSummary,
    summary="Cobertura de cliente Netskope por persona",
    description=(
        "Métrica CONN-001/v1: población de usuarios humanos activos de Identity "
        "Administration y evidencia de dispositivos Netskope activos con evento "
        "reciente. Requiere conjuntamente identity:catalogs_read y netskope:read, "
        "o access:manage. No mide política DLP ni conexión en vivo."
    ),
)
async def person_client_coverage(
    request: Request,
    actor_id: str = Depends(require_person_client_coverage_read),
):
    return await get_person_client_coverage(request.app.state.db)


@router.get(
    "/api/chains/person/coverage/detail",
    response_model=PersonClientCoverageDetail,
    summary="Detalle CONN-001 de una persona",
    description=(
        "Devuelve el estado y los conteos de la persona seleccionada, sin crear "
        "relaciones persistidas. Requiere conjuntamente lectura de Identity y Netskope."
    ),
)
async def person_client_coverage_detail(
    request: Request,
    email: Annotated[str, Query(min_length=3, max_length=320)],
    actor_id: str = Depends(require_person_client_coverage_read),
):
    normalized = normalize_person_email(email)
    if normalized is None:
        raise HTTPException(status_code=422, detail="email debe ser una dirección completa")
    return await get_person_client_coverage_detail(request.app.state.db, email=normalized)
