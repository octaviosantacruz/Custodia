from fastapi import APIRouter, Depends, Request

from app.db import fetch_one
from app.cross.integrations.status import get_integration_status
from app.auth import require_read_access

router = APIRouter(tags=["Salud y estado"])


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
    return get_integration_status()
