"""Stale Netskope devices grouped by what Netskope explains (NSK-DEVREV-001, NSK-INV-002).

Only the read-only summary remains. The per-device classification routes (read, save and
batch-accept a decision) were retired with the classification UI in NSK-INV-002; decisions
saved before stay in the table and keep their meaning in the listing filters."""

from fastapi import APIRouter, Depends, Request

from app.auth import require_any_permission_read
from app.netskope.sse.api.routes.cmdb_netskope_models import NetskopeDeviceReviewSummaryResponse
from app.netskope.sse.services.netskope_state import get_device_review_summary

router = APIRouter(prefix="/api/cmdb/netskope", tags=["Inventario Netskope"])
READ = [Depends(require_any_permission_read("access:manage", "netskope:read"))]


@router.get("/device-reviews/summary", response_model=NetskopeDeviceReviewSummaryResponse, summary="Resumen de revisión de equipos sin eventos", description="Equipos activos con último evento de más de 30 días por diagnóstico. Los conteos por diagnóstico son observación; «sin clasificar» es una evaluación y es nulo sin un sync completo vigente.", dependencies=READ)
async def device_review_summary(request: Request):
    return await get_device_review_summary(request.app.state.db)
