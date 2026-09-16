from fastapi import APIRouter, Depends, Request

from ...db import fetch_one
from ...integrations import get_integration_status
from ...auth import require_read_access

router = APIRouter(tags=["Health y autenticación"])


@router.get("/health/live")
@router.get("/api/health/live")
async def liveness():
    """Process liveness: deliberately independent of database readiness."""
    return {"status": "ok"}


@router.get("/health")
@router.get("/api/health")
@router.get("/health/ready")
@router.get("/api/health/ready")
async def health(request: Request):
    """Readiness: confirms the application can reach PostgreSQL."""
    await fetch_one(request.app.state.db, "SELECT 1")
    return {"status": "ok"}


@router.get("/api/integrations/status", dependencies=[Depends(require_read_access)])
async def integration_status():
    status = get_integration_status()
    return {"identity_administration": status.identity_administration, "sia": status.sia}
