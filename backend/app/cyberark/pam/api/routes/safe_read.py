import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.responses import Response

from app.auth import require_permission_read
from app.cyberark.pam.services.pam_read_models import (
    export_accounts,
    export_safes,
    get_safe_accounts,
    get_safe_detail,
    list_accounts,
    list_safes,
)
from app.cross.services.audit_trail import (
    record_audit,
)
from app.cyberark.pam.api.routes.safe_read_models import AccountListResponse, SafeDetailResponse, SafeListResponse


router = APIRouter()


@router.get(
    "/api/safes",
    response_model=SafeListResponse,
    summary="Listar Safes",
    description="Inventario paginado de Safes con filtros de workflow, clasificación, alcance y salud operativa. include_accounts=true amplía q para buscar en nombre, usuario y dirección de cuentas activas; por defecto es false. La sesión o un token Bearer personal otorgan la lectura.",
)
async def safes(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    workflow_status: Annotated[str, Query(pattern="^(|pending|in_progress|blocked|resolved|retired|retention_hold)$")] = "",
    classification_status: Annotated[str, Query(pattern="^(|pending|assigned|review)$")] = "",
    account_type: Annotated[str, Query(max_length=80)] = "",
    inventory_scope: Annotated[str, Query(pattern="^(|pending|business|internal)$")] = "",
    data_quality_status: Annotated[str, Query(pattern="^(|pending|clean|obsolete|duplicate)$")] = "",
    scope_hint: Annotated[str, Query(pattern="^(|possible_internal_accounts_safe)$")] = "",
    health_filter: Annotated[str, Query(pattern="^(|missing_cpm|no_accounts|olac_disabled|retention_unconfigured|manage_safe_concentration)$")] = "",
    next_action: Annotated[str, Query(max_length=80)] = "",
    business_unit: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = "",
    responsible: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = "",
    include_internal: bool = Query(True),
    include_accounts: bool = Query(False, description="Si es true, q también busca nombre, usuario y dirección en cuentas activas."),
    actor_id: str = Depends(require_permission_read("safes:read")),
):
    return await list_safes(
        request.app.state.db, q.strip(), limit, offset, workflow_status,
        classification_status, account_type.strip(), inventory_scope,
        data_quality_status, scope_hint, health_filter, include_internal, next_action.strip(),
        business_unit, responsible, include_accounts,
    )


def _csv_cell(value):
    """Keep exported text from being interpreted as a spreadsheet formula."""
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    value = str(value)
    # OWASP: a leading tab or carriage return also makes a spreadsheet read the cell as a formula.
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value


def _safes_csv(rows: list[dict]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow([
        "Safe", "Safe URL ID", "Ubicación", "Cuentas", "Miembros", "Tipo de cuenta",
        "Unidad", "Responsable", "Estado", "Acción siguiente", "Alcance KR1", "Calidad",
    ])
    for row in rows:
        account_types = row.get("account_type_counts") or {}
        writer.writerow([
            _csv_cell(row["internal_name"] or row["safe_name"]), _csv_cell(row["safe_url_id"]), _csv_cell(row["location"] or ""),
            _csv_cell(row["account_count"]), _csv_cell(row["member_count"]),
            _csv_cell("; ".join(f"{key} ({value})" for key, value in sorted(account_types.items()))),
            _csv_cell(row["business_unit_name"] or ""), _csv_cell(row["responsible_name"] or ""),
            _csv_cell(row["workflow_status"]), _csv_cell(row["next_action"] or ""), _csv_cell(row["inventory_scope"]), _csv_cell(row["data_quality_status"]),
        ])
    return output.getvalue()


def _accounts_csv(rows: list[dict]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Safe", "Safe URL ID", "Cuenta", "Usuario", "Plataforma", "Dirección", "Estado", "Última sincronización"])
    for row in rows:
        writer.writerow([
            _csv_cell(row["safe_name"]), _csv_cell(row["safe_url_id"]), _csv_cell(row["account_name"]), _csv_cell(row["user_name"] or ""),
            _csv_cell(row["platform_name"] or row["platform_id"] or ""), _csv_cell(row["address"] or ""),
            _csv_cell(row["lifecycle_status"]), _csv_cell(row["last_seen_at"]),
        ])
    return output.getvalue()


@router.get("/api/accounts/export.csv", summary="Exportar cuentas filtradas", description="Descarga cuentas activas sin secretos; requiere inventory:export.")
async def export_accounts_csv(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    actor_id: str = Depends(require_permission_read("inventory:export")),
    platform_status: Annotated[str, Query(pattern="^(|with_platform|without_platform|partial_platform)$")] = "",
):
    rows = await export_accounts(request.app.state.db, q.strip(), platform_status)
    await record_audit(
        request.app.state.db,
        actor_id=actor_id,
        action="export",
        entity_type="account_inventory",
        entity_id="filtered",
        after_data={"row_count": len(rows)},
    )
    return Response(
        content="\ufeff" + _accounts_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"custodia-accounts.csv\""},
    )


@router.get("/api/safes/export.csv", summary="Exportar Safes filtrados", description="Descarga localmente el inventario visible según los filtros aplicados; requiere inventory:export.")
async def export_safes_csv(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    workflow_status: Annotated[str, Query(pattern="^(|pending|in_progress|blocked|resolved|retired|retention_hold)$")] = "",
    classification_status: Annotated[str, Query(pattern="^(|pending|assigned|review)$")] = "",
    account_type: Annotated[str, Query(max_length=80)] = "",
    inventory_scope: Annotated[str, Query(pattern="^(|pending|business|internal)$")] = "",
    data_quality_status: Annotated[str, Query(pattern="^(|pending|clean|obsolete|duplicate)$")] = "",
    scope_hint: Annotated[str, Query(pattern="^(|possible_internal_accounts_safe)$")] = "",
    health_filter: Annotated[str, Query(pattern="^(|missing_cpm|no_accounts|olac_disabled|retention_unconfigured|manage_safe_concentration)$")] = "",
    next_action: Annotated[str, Query(max_length=80)] = "",
    business_unit: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = "",
    responsible: Annotated[str, Query(pattern="^(|unassigned|[1-9][0-9]*)$")] = "",
    include_accounts: bool = Query(False, description="Con q, incluir coincidencias en cuentas activas."),
    actor_id: str = Depends(require_permission_read("inventory:export")),
):
    rows = await export_safes(
        request.app.state.db, q.strip(), workflow_status, classification_status,
        account_type.strip(), inventory_scope, data_quality_status, scope_hint, health_filter,
        next_action.strip(), business_unit, responsible, include_accounts,
    )
    csv_content = _safes_csv(rows)
    await record_audit(
        request.app.state.db,
        actor_id=actor_id,
        action="export",
        entity_type="safe_inventory",
        entity_id="filtered",
        after_data={"row_count": len(rows)},
    )
    return Response(
        content="\ufeff" + csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"custodia-safes.csv\""},
    )


@router.get("/api/accounts", response_model=AccountListResponse, summary="Inventario plano de cuentas", description="Devuelve cuentas activas sin secretos para búsqueda y revisión transversal.")
async def accounts(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    platform_status: Annotated[str, Query(pattern="^(|with_platform|without_platform|partial_platform)$")] = "",
    actor_id: str = Depends(require_permission_read("safes:read")),
):
    return await list_accounts(request.app.state.db, q.strip(), limit, offset, platform_status)


@router.get("/api/safes/{safe_number}", response_model=SafeDetailResponse)
async def safe_detail(request: Request, safe_number: int, actor_id: str = Depends(require_permission_read("safes:read"))):
    safe, members = await get_safe_detail(request.app.state.db, safe_number)
    if safe is None:
        raise HTTPException(status_code=404, detail="Safe no encontrada")
    return {"safe": safe, "members": members}


@router.get("/api/safes/{safe_number}/accounts", response_model=AccountListResponse, summary="Cuentas de una Safe", description="Devuelve el inventario actual de cuentas sin secretos ni credenciales.")
async def safe_accounts(
    request: Request,
    safe_number: int,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
    lifecycle: Annotated[str, Query(pattern="^(active|retired)$", description="retired lista las cuentas que una corrida completa dejó de ver (posible retención de CyberArk).")] = "active",
    actor_id: str = Depends(require_permission_read("safes:read")),
):
    return await get_safe_accounts(request.app.state.db, safe_number, q.strip(), limit, offset, lifecycle)
