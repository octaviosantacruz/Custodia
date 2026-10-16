"""NSK-DLP-001: minimal DLP alerts, count-first with a per-user drill-down.

These are the routes the product had retired with a consistent ``410 Gone``
when individual DLP investigation was postponed. They are revived only for an
actor holding the narrow ``netskope:dlp_read`` permission; every other actor
keeps the compatible 410 (including ``access:manage``, which is deliberately
not widened). Reads of alert rows are audited without copying any filter
value that could carry personal data.

The per-device summary stays retired: the approved allowlist has no device
field, so a device correlation cannot be built without inventing one.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app import auth as auth_module
from app.auth import require_authenticated_read_access
from app.netskope.sse.integrations.netskope import netskope_dlp_incidents_configured
from app.cross.services.audit_trail import (
    record_audit,
)
from app.netskope.sse.services.netskope_read_models import (
    get_netskope_dlp_capture_state,
    get_netskope_dlp_policies,
    list_netskope_dlp_alerts,
)
from app.netskope.sse.api.routes.netskope_dlp_models import (
    NetskopeDlpAlertsResponse,
    NetskopeDlpPoliciesResponse,
    NetskopeDlpStatusResponse,
)

router = APIRouter(tags=["Alertas DLP Netskope"])

RETIRED_SUMMARY_DETAIL = "Este resumen DLP está retirado; la vista de alertas DLP usa el resumen por política."

RETIRED_DLP_DETAIL = (
    "La investigación de incidentes y eventos DLP individuales está retirada "
    "para este actor: requiere el permiso netskope:dlp_read."
)


async def require_dlp_read(request: Request) -> str:
    """Authenticate a read and require the narrow DLP permission.

    A missing permission answers 410 Gone -- not 403 -- so every actor
    without ``netskope:dlp_read`` (including ``access:manage`` holders) keeps
    exactly the response the retired routes already returned.
    """
    actor_id = await require_authenticated_read_access(request)
    if "netskope:dlp_read" not in await auth_module.get_actor_permissions(request.app.state.db, actor_id):
        raise HTTPException(status_code=410, detail=RETIRED_DLP_DETAIL)
    return actor_id


async def _audit_dlp_read(request: Request, actor_id: str, *, entity_id: str, row_count: int, **extra) -> None:
    """Audit a DLP alert read. Only counts and filter names, never values."""
    await record_audit(
        request.app.state.db,
        actor_id=actor_id,
        action="read",
        entity_type="netskope_dlp_alert",
        entity_id=entity_id,
        after_data={"row_count": row_count, **extra},
    )


@router.get(
    '/api/cmdb/netskope/incidents/summary',
    summary='Retirado: resumen de alertas DLP',
    description='Retirado (410 Gone) en NSK-INV-002: la vista usa dlp/policies.',
    deprecated=True,
    include_in_schema=False,
)
async def netskope_dlp_summary_retired(_: str = Depends(require_dlp_read)):
    raise HTTPException(status_code=410, detail=RETIRED_SUMMARY_DETAIL)


@router.get(
    '/api/cmdb/netskope/investigations',
    response_model=NetskopeDlpAlertsResponse,
    summary='Alertas DLP mínimas',
    description=(
        'Alertas DLP individuales mínimas de los últimos 30 días: ID opaco de incidente, timestamp UTC, '
        'estado, severidad, política, acción e ID opaco de usuario resuelto sólo por igualdad exacta contra '
        'el inventario Netskope existente. Filtrable y paginada. Requiere netskope:dlp_read.'
    ),
)
async def netskope_dlp_alerts(
    request: Request,
    severity: Annotated[str, Query(max_length=120)] = "",
    status: Annotated[str, Query(max_length=120)] = "",
    action: Annotated[str, Query(max_length=120)] = "",
    policy: Annotated[str, Query(max_length=200)] = "",
    resolution: Annotated[str, Query(pattern="^(|resolved|unresolved)$")] = "",
    user_id: Annotated[str, Query(max_length=240)] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_dlp_read),
):
    try:
        result = await list_netskope_dlp_alerts(
            request.app.state.db,
            severity=severity.strip(), status=status.strip(), action=action.strip(),
            policy=policy.strip(), resolution=resolution, user_id=user_id.strip(),
            limit=limit, offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit_dlp_read(
        request, actor_id, entity_id="filtered", row_count=result["total"],
        returned=len(result["rows"]), limit=limit, offset=offset,
        filtered=bool(severity.strip() or status.strip() or action.strip() or policy.strip() or resolution or user_id.strip()),
    )
    return result


@router.get(
    '/api/cmdb/netskope/users/alerts/summary',
    summary='Retirado: alertas DLP por usuario',
    description='Retirado (410 Gone) en NSK-INV-002: la vista de alertas DLP dejó la tabla por usuario.',
    deprecated=True,
    include_in_schema=False,
)
async def netskope_dlp_users_summary_retired(_: str = Depends(require_dlp_read)):
    raise HTTPException(status_code=410, detail=RETIRED_SUMMARY_DETAIL)


@router.get(
    '/api/cmdb/netskope/dlp/status',
    response_model=NetskopeDlpStatusResponse,
    summary='Estado de captura de alertas DLP',
    description=(
        'Frescura y cobertura de la última captura de alertas DLP mínimas (sin cursores ni payloads). '
        'Permite no presentar falta de datos como cero. Requiere netskope:dlp_read.'
    ),
)
async def netskope_dlp_status(request: Request, actor_id: str = Depends(require_dlp_read)):
    state = await get_netskope_dlp_capture_state(request.app.state.db)
    return {
        "configured": netskope_dlp_incidents_configured(),
        "captured_at": state["captured_at"] if state else None,
        "coverage_start": state["coverage_start"] if state else None,
        "coverage_end": state["coverage_end"] if state else None,
        "partial": state["partial"] if state else None,
        "scanned_events": state["scanned_events"] if state else 0,
        "captured_alerts": state["captured_alerts"] if state else 0,
    }


@router.get(
    '/api/cmdb/netskope/dlp/policies',
    response_model=NetskopeDlpPoliciesResponse,
    summary='Alertas DLP por política',
    description=(
        'Una fila por política (nombre que Netskope registra en el incidente) de los últimos 30 días: volumen, '
        'últimos 7 días contra los 7 anteriores, mezcla de severidad y acción y última alerta. No relaciona la '
        'política con un grupo ni una regla: las reglas aún no son legibles. Requiere netskope:dlp_read.'
    ),
)
async def netskope_dlp_policies(request: Request, actor_id: str = Depends(require_dlp_read)):
    state = await get_netskope_dlp_capture_state(request.app.state.db)
    result = await get_netskope_dlp_policies(request.app.state.db)
    await _audit_dlp_read(request, actor_id, entity_id="by_policy", row_count=len(result["policies"]))
    return {
        **result,
        "configured": netskope_dlp_incidents_configured(),
        "captured_at": state["captured_at"] if state else None,
        "partial": state["partial"] if state else None,
    }
