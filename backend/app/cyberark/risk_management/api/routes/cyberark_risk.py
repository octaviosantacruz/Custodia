"""Read-only live CyberArk Risk Management routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_permission_read
from app.cross.services.account_security import (
    get_actor_permissions,
)
from app.cyberark.risk_management.integrations.risk_management import (
    RiskManagementClient,
    RiskManagementError,
    RiskManagementLimitError,
    RiskManagementSettings,
)
from app.cross.services.audit_trail import (
    record_audit,
)
from app.cyberark.risk_management.services.cyberark_risk import get_public_all_findings, get_public_findings, get_public_overview

router = APIRouter(
    prefix="/api/cyberark-risk",
    tags=["CyberArk Risk Management"],
    dependencies=[Depends(require_permission_read("pam:risk_read"))],
)


def _remote_error() -> HTTPException:
    return HTTPException(
        502,
        "No se pudo consultar CyberArk Risk Management. Verificá disponibilidad y permisos de sólo lectura.",
    )


@router.get(
    "/overview",
    summary="Resumen y catálogos de riesgo CyberArk",
    description="Consulta en vivo el resumen, tipos, remediaciones sugeridas y progreso allowlisted; no persiste payloads ni ejecuta acciones remotas.",
)
async def risk_overview(request: Request):
    try:
        async with RiskManagementClient(RiskManagementSettings.from_environment()) as client:
            result = await get_public_overview(client)
    except RiskManagementError:
        raise _remote_error() from None
    await record_audit(
        request.app.state.db,
        actor_id=request.state.actor_id,
        action="read",
        entity_type="cyberark_risk_overview",
        entity_id="live",
        after_data={
            "risk_types": len(result["risk_types"]),
            "remediations": len(result["remediations"]),
            "progress_points": len(result["progress"]["points"]),
        },
    )
    return result


@router.get(
    "/findings",
    summary="Hallazgos vivos de riesgo CyberArk por entidad",
    description="Devuelve una página allowlisted de hallazgos CyberArk con IDs opacos, severidad, estado y fechas; sólo incluye el nombre de entidad con pam:risk_entities_read y nunca atributos de entidad.",
)
async def risk_findings(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    include_entity_names = "pam:risk_entities_read" in await get_actor_permissions(
        request.app.state.db,
        request.state.actor_id,
    )
    try:
        async with RiskManagementClient(RiskManagementSettings.from_environment()) as client:
            result = await get_public_findings(client, limit, offset, include_entity_names=include_entity_names)
    except RiskManagementError:
        raise _remote_error() from None
    await record_audit(
        request.app.state.db,
        actor_id=request.state.actor_id,
        action="read",
        entity_type="cyberark_risk_findings",
        entity_id="live",
        after_data={"count": len(result["rows"]), "offset": offset, "entity_names": include_entity_names},
    )
    return result


@router.get(
    "/findings/all",
    summary="Todos los hallazgos vivos de riesgo CyberArk (vista agrupada)",
    description="Recorre todas las páginas de hallazgos con el mismo allowlist que /findings, hasta un límite acotado; si se supera responde 422 y la UI vuelve a la lectura paginada. No persiste ni ejecuta acciones remotas.",
)
async def risk_findings_all(request: Request):
    include_entity_names = "pam:risk_entities_read" in await get_actor_permissions(
        request.app.state.db,
        request.state.actor_id,
    )
    try:
        async with RiskManagementClient(RiskManagementSettings.from_environment()) as client:
            result = await get_public_all_findings(client, include_entity_names=include_entity_names)
    except RiskManagementLimitError:
        raise HTTPException(
            422,
            f"CyberArk informó más de {RiskManagementClient.MAX_GROUPED_FINDINGS} hallazgos; usá la lectura paginada.",
        ) from None
    except RiskManagementError:
        raise _remote_error() from None
    await record_audit(
        request.app.state.db,
        actor_id=request.state.actor_id,
        action="read",
        entity_type="cyberark_risk_findings",
        entity_id="live:all",
        after_data={"count": len(result["rows"]), "complete": True, "entity_names": include_entity_names},
    )
    return result
