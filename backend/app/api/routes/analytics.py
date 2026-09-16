from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from ...auth import require_read_access
import asyncio

from ...repositories import get_access_concentration, get_account_platform_coverage, get_analytics, get_connection_coverage, get_inventory_freshness, get_summary
from ...repositories.license_reconciliation import get_standard_seat_reconciliation

router = APIRouter(tags=["Analítica"], dependencies=[Depends(require_read_access)])


@router.get("/api/summary", summary="Resumen de cobertura", description="Devuelve los conteos de Safes, alcance, calidad y la última sincronización.")
async def summary(request: Request, include_internal: bool = Query(True)):
    return await get_summary(request.app.state.db, include_internal)


@router.get("/api/analytics", summary="Analítica filtrable", description="Agrupa estados, acciones y tipos de cuenta aplicando los filtros indicados.")
async def analytics(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = '',
    workflow_status: Annotated[str, Query(pattern="^(|pending|in_progress|blocked|resolved|retired)$")] = '',
    classification_status: Annotated[str, Query(pattern="^(|pending|assigned|review)$")] = '',
    account_type: Annotated[str, Query(max_length=80)] = '',
    inventory_scope: Annotated[str, Query(pattern="^(|pending|business|internal)$")] = '',
    data_quality_status: Annotated[str, Query(pattern="^(|pending|clean|obsolete|duplicate)$")] = '',
    scope_hint: Annotated[str, Query(pattern="^(|possible_internal_accounts_safe)$")] = '',
    health_filter: Annotated[str, Query(pattern="^(|missing_cpm|no_accounts|olac_disabled|retention_unconfigured|manage_safe_concentration)$")] = '',
    next_action: Annotated[str, Query(max_length=80)] = '',
    business_unit: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = '',
    responsible: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = '',
    include_internal: bool = Query(True),
):
    return await get_analytics(
        request.app.state.db, q.strip(), workflow_status, classification_status, account_type.strip(),
        inventory_scope, data_quality_status, scope_hint, health_filter, include_internal, next_action.strip(),
        business_unit, responsible,
    )


@router.get(
    "/api/analytics/concentration",
    summary="Concentración de acceso",
    description="Usuarios y roles PAM con más Safes alcanzables por la cadena usuarios -> roles -> safes.",
)
async def access_concentration(request: Request, limit: Annotated[int, Query(ge=1, le=25)] = 10, include_internal: bool = Query(True)):
    return await get_access_concentration(request.app.state.db, limit, include_internal)


@router.get(
    "/api/analytics/license-reconciliation",
    summary="Conciliación de asientos Standard de Privilege Cloud",
    description="Cruza usuarios PAM EPVUser con los roles Privilege Cloud configurados. No es una fuente de facturación.",
)
async def license_reconciliation(request: Request):
    return await get_standard_seat_reconciliation(request.app.state.db)


@router.get(
    "/api/analytics/executive",
    summary="Lectura ejecutiva PAM y SIA",
    description="Cobertura exacta por IP del inventario importado y concentración de alcance PAM. No representa uso ni licencias.",
)
async def executive_analytics(request: Request, include_internal: bool = Query(True)):
    coverage, concentration = await asyncio.gather(
        get_connection_coverage(request.app.state.db, include_internal),
        get_access_concentration(request.app.state.db, 6, include_internal),
    )
    return {"connection_coverage": coverage, "access_concentration": concentration}


@router.get(
    "/api/analytics/freshness",
    summary="Frescura del inventario",
    description="Antigüedad de la última modificación de cada Safe y estado del inventario de cuentas. No es rotación de credenciales.",
)
async def inventory_freshness(request: Request, include_internal: bool = Query(True)):
    return await get_inventory_freshness(request.app.state.db, include_internal)


@router.get(
    "/api/analytics/account-platform-coverage",
    summary="Cobertura de cuentas y plataformas",
    description="Resume cuentas activas, plataformas observadas y relaciones de plataforma incompletas; no evalúa credenciales.",
)
async def account_platform_coverage(request: Request, include_internal: bool = Query(True)):
    rows = await get_account_platform_coverage(request.app.state.db, include_internal)
    return rows[0] if rows else {
        "accounts_active": 0, "accounts_with_platform": 0, "accounts_without_platform": 0,
        "accounts_with_partial_platform": 0, "platforms_observed": 0, "safes_without_accounts": 0,
    }
