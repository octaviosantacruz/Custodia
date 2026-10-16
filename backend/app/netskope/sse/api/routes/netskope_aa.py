"""AA metrics read from Netskope, never persisted as local alert data."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import require_permission_read
from app.cross.services.audit_trail import (
    record_audit,
)
from app.netskope.sse.integrations.advanced_analytics import AdvancedAnalyticsError
from app.netskope.sse.services.netskope_aa_charts import AaChartCache, aa_charts
from app.netskope.sse.services.netskope_aa_metrics import AnalyticsContractError, SeverityMetricsCache

router = APIRouter(tags=["Inventario Netskope"], dependencies=[Depends(require_permission_read("netskope:read"))])


class SeverityBucket(BaseModel):
    key: Literal["critical", "high", "medium", "low", "informational", "unknown"]
    count: int


class SeverityMetricsResponse(BaseModel):
    source: Literal["advanced_analytics"]
    state: Literal["ready", "empty", "not_configured", "pending_validation"]
    window_days: int | None
    timezone: str | None
    scope: Literal["all_alerts", "dlp"] | None
    unit: Literal["events", "incidents"] | None
    buckets: list[SeverityBucket]
    total: int | None
    fetched_at: str | None
    cache_expires_at: str | None
    contract_version: int | None = None


@router.get("/api/cmdb/netskope/aa/severity", response_model=SeverityMetricsResponse,
            summary="Severidad desde Advanced Analytics",
            description="Consulta un widget agregado explícito de Netskope AA; caché en memoria de cinco minutos, sin persistencia de resultados.")
async def severity_metrics(request: Request):
    cache = getattr(request.app.state, "netskope_aa_severity_cache", None)
    if cache is None:
        cache = SeverityMetricsCache()
        request.app.state.netskope_aa_severity_cache = cache
    try:
        value = await cache.get()
    except AnalyticsContractError:
        raise HTTPException(503, "El contrato del widget AA de severidad está incompleto o es inválido.") from None
    except AdvancedAnalyticsError:
        raise HTTPException(502, "No se pudo obtener el agregado de severidad de Netskope AA. Verificá el widget y su disponibilidad.") from None
    await record_audit(request.app.state.db, actor_id=request.state.actor_id, action="read",
                       entity_type="netskope_aa_metric", entity_id="severity",
                       after_data={"state": value["state"], "bucket_count": len(value["buckets"])})
    return value


class AaChartBucket(BaseModel):
    key: str
    count: int


class AaChartResponse(BaseModel):
    source: Literal["advanced_analytics"]
    key: str
    title: str
    unit: str
    period: str
    state: Literal["ready", "empty"]
    buckets: list[AaChartBucket]
    total: int | None
    fetched_at: str
    cache_expires_at: str


class AaChartSummary(BaseModel):
    id: str
    title: str
    unit: str
    period: str


@router.get("/api/cmdb/netskope/aa/charts", response_model=list[AaChartSummary],
            summary="Gráficos AA declarados para el tenant",
            description="Lista los gráficos del mapa del tenant (título, unidad y período declarados); no consulta Netskope ni expone IDs de reporte o widget.")
async def aa_chart_list():
    try:
        charts = aa_charts()
    except AnalyticsContractError:
        raise HTTPException(503, "El mapa de gráficos AA es inválido.") from None
    return [{"id": chart.widget, "title": chart.title, "unit": chart.unit, "period": chart.period} for chart in charts.values()]


@router.get("/api/cmdb/netskope/aa/charts/{key}", response_model=AaChartResponse,
            summary="Resultado de un gráfico AA",
            description="Consulta el widget declarado con la misma forma etiqueta + conteo; caché en memoria de cinco minutos, sin persistir resultados.")
async def aa_chart(key: str, request: Request):
    try:
        chart = aa_charts().get(key)
    except AnalyticsContractError:
        raise HTTPException(503, "El mapa de gráficos AA es inválido.") from None
    if chart is None:
        raise HTTPException(404, "Gráfico AA no declarado.")
    cache = getattr(request.app.state, "netskope_aa_chart_cache", None)
    if cache is None:
        cache = AaChartCache()
        request.app.state.netskope_aa_chart_cache = cache
    try:
        value = await cache.get(chart)
    except AdvancedAnalyticsError:
        raise HTTPException(502, "No se pudo obtener el gráfico de Netskope AA. Verificá el widget y su disponibilidad.") from None
    await record_audit(request.app.state.db, actor_id=request.state.actor_id, action="read",
                       entity_type="netskope_aa_metric", entity_id=f"chart:{key}",
                       after_data={"state": value["state"], "bucket_count": len(value["buckets"])})
    return value
