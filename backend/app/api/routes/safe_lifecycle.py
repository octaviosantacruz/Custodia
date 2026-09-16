from fastapi import APIRouter, Depends, HTTPException, Request

from ...auth import require_read_access
from ...repositories import count_retired_candidates, get_retired_candidates, list_safe_audit


router = APIRouter()


@router.get("/api/safes/{safe_number}/audit")
async def safe_audit(request: Request, safe_number: int, limit: int = 100, actor_id: str = Depends(require_read_access)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit debe estar entre 1 y 500")
    return {"rows": await list_safe_audit(request.app.state.db, safe_number, limit)}


@router.get("/api/lifecycle/retired")
async def retired_candidates(request: Request, limit: int = 100, actor_id: str = Depends(require_read_access)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit debe estar entre 1 y 500")
    rows = await get_retired_candidates(request.app.state.db, limit)
    return {"rows": rows, "total": await count_retired_candidates(request.app.state.db), "deletion_enabled": False}
