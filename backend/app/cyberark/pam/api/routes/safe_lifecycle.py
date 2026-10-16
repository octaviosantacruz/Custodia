from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import require_read_access
from app.cyberark.pam.services.safe_classification import retired_candidates as load_retired_candidates, safe_audit_rows
from app.cyberark.pam.api.routes.safe_lifecycle_models import RetiredCandidatesResponse, SafeAuditResponse


router = APIRouter()


@router.get("/api/safes/{safe_number}/audit", response_model=SafeAuditResponse)
async def safe_audit(request: Request, safe_number: int, limit: int = 100, actor_id: str = Depends(require_read_access)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit debe estar entre 1 y 500")
    return {"rows": await safe_audit_rows(request.app.state.db, safe_number, limit)}


@router.get("/api/lifecycle/retired", response_model=RetiredCandidatesResponse)
async def retired_candidates(request: Request, limit: int = 100, actor_id: str = Depends(require_read_access)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit debe estar entre 1 y 500")
    return await load_retired_candidates(request.app.state.db, limit)
