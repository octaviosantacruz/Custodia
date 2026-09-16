from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...auth import require_permission, require_read_access
from ...repositories.findings import get_finding, list_findings, refresh_findings, update_finding
from ...repositories.audit import record_audit
from ...schemas import FindingUpdate

router = APIRouter(tags=["Hallazgos"])


@router.get(
    "/api/findings",
    summary="Listar hallazgos",
    description="Devuelve hallazgos versionados y basados en evidencia persistida, sin secretos.",
)
async def findings(
    request: Request,
    status: Annotated[str, Query(pattern="^(|open|acknowledged|resolved|excepted)$")] = "",
    rule_id: Annotated[str, Query(max_length=100)] = "",
    severity: Annotated[str, Query(pattern="^(|low|medium|high|critical)$")] = "",
    include_internal: bool = Query(True),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_id: str = Depends(require_read_access),
):
    return await list_findings(request.app.state.db, status.strip(), rule_id.strip(), severity, limit, offset, include_internal)


@router.post(
    "/api/findings/refresh",
    summary="Actualizar hallazgos",
    description="Evalúa reglas versionadas sobre el inventario actual y resuelve hallazgos ausentes.",
)
async def findings_refresh(request: Request, actor_id: str = Depends(require_permission("findings:manage"))):
    count = await refresh_findings(request.app.state.db)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="refresh",
        entity_type="findings", entity_id="current",
        after_data={"current_findings": count},
    )
    return {"status": "completed", "current_findings": count}


@router.patch(
    "/api/findings/{finding_id}",
    summary="Actualizar estado de hallazgo",
    description="Permite reconocer, resolver o exceptuar un hallazgo; requiere inventory:write.",
)
async def finding_update(
    request: Request, finding_id: int, payload: FindingUpdate,
    actor_id: str = Depends(require_permission("findings:manage")),
):
    before = await get_finding(request.app.state.db, finding_id)
    if before is None:
        raise HTTPException(status_code=404, detail="Hallazgo no encontrado")
    if payload.status == "excepted" and not payload.exception_reason:
        raise HTTPException(status_code=422, detail="Una excepción requiere motivo")
    row = await update_finding(
        request.app.state.db, finding_id, payload.status,
        payload.exception_reason, payload.exception_until,
    )
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="update",
        entity_type="finding", entity_id=str(finding_id),
        before_data={"status": before["status"], "exception_reason": before["exception_reason"]},
        after_data={"status": row["status"], "exception_reason": row["exception_reason"]},
    )
    return row
