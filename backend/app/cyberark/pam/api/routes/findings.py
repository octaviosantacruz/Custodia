from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_permission, require_read_access
from app.cyberark.pam.services.findings_management import (
    ExceptionReasonRequiredError,
    FindingNotFoundError,
    refresh_current_findings,
    review_finding,
    search_findings,
)
from app.cyberark.pam.schemas import FindingUpdate
from app.cyberark.pam.api.routes.findings_models import FindingRow, FindingsRefreshResponse, FindingsResponse

router = APIRouter(tags=["Hallazgos"])


@router.get(
    "/api/findings",
    response_model=FindingsResponse,
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
    return await search_findings(request.app.state.db, status.strip(), rule_id.strip(), severity, limit, offset, include_internal)


@router.post(
    "/api/findings/refresh",
    response_model=FindingsRefreshResponse,
    summary="Actualizar hallazgos",
    description="Evalúa reglas versionadas sobre el inventario actual y resuelve hallazgos ausentes.",
)
async def findings_refresh(request: Request, actor_id: str = Depends(require_permission("findings:manage"))):
    count = await refresh_current_findings(request.app.state.db, actor_id)
    return {"status": "completed", "current_findings": count}


@router.patch(
    "/api/findings/{finding_id}",
    response_model=FindingRow,
    summary="Actualizar estado de hallazgo",
    description="Permite reconocer, resolver o exceptuar un hallazgo; requiere inventory:write.",
)
async def finding_update(
    request: Request, finding_id: int, payload: FindingUpdate,
    actor_id: str = Depends(require_permission("findings:manage")),
):
    try:
        return await review_finding(
            request.app.state.db, finding_id, payload.status,
            payload.exception_reason, payload.exception_until, actor_id,
        )
    except FindingNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Hallazgo no encontrado") from exc
    except ExceptionReasonRequiredError as exc:
        raise HTTPException(status_code=422, detail="Una excepción requiere motivo") from exc
