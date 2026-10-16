"""NSK-UBA-002: latest UCI (User Confidence Index) per user, behind a strict permission.

Only ``netskope:uba_read`` opens these routes; ``netskope:read`` and
``access:manage`` deliberately do not. Reads are audited with counts and filter
names, never with user values.
"""

import time
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel

from app import auth as auth_module
from app.auth import require_authenticated_read_access
from app.cross.services.audit_trail import (
    record_audit,
)
from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeError, NetskopeSettings, netskope_uci_configured
from app.netskope.sse.services.netskope_anomalies import summarize_anomalies
from app.netskope.sse.services.netskope_attention import build_attention_queue
from app.netskope.sse.services.netskope_read_models import (
    get_experience_user,
    list_netskope_user_uci,
    uci_by_company,
)

router = APIRouter(tags=["UCI Netskope"])

UBA_PERMISSION = "netskope:uba_read"


class NetskopeUciRow(BaseModel):
    email: str
    user_id: str | None
    name: str | None
    rating: Literal["Poor", "Moderate"]
    score: int
    previous_score: int | None
    scored_at: datetime


class NetskopeUciResponse(BaseModel):
    configured: bool
    rows: list[NetskopeUciRow]
    total: int
    by_rating: dict[str, int]
    captured_at: datetime | None


class NetskopeUciCounts(BaseModel):
    users: int
    poor: int
    moderate: int


class NetskopeUciCompany(NetskopeUciCounts):
    company: str
    previous: NetskopeUciCounts | None


class NetskopeUciCompaniesResponse(BaseModel):
    companies: list[NetskopeUciCompany]
    omitted_users: int
    previous_week: date | None


async def require_uba_read(request: Request) -> str:
    actor_id = await require_authenticated_read_access(request)
    if UBA_PERMISSION not in await auth_module.get_actor_permissions(request.app.state.db, actor_id):
        raise HTTPException(status_code=403, detail=f"Requiere el permiso {UBA_PERMISSION}.")
    return actor_id


@router.get(
    "/api/cmdb/netskope/uci",
    response_model=NetskopeUciResponse,
    summary="Índice de confianza (UCI) de usuarios Netskope",
    description=(
        "Último UCI de los usuarios activos con calificación Poor o Moderate, con el valor de hace una "
        "semana cuando existe. No incluye serie ni anomalías; un usuario ausente no está calificado como "
        "bueno: puede ser Good o no haber estado activo. Requiere netskope:uba_read."
    ),
)
async def netskope_uci(
    request: Request,
    actor_id: str = Depends(require_uba_read),
    rating: Annotated[Literal["", "Poor", "Moderate"], Query()] = "",
    search: Annotated[str, Query(max_length=120)] = "",
    order: Annotated[Literal["score", "name"], Query()] = "score",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    result = await list_netskope_user_uci(request.app.state.db, rating, search.strip(), order, limit, offset)
    await record_audit(
        request.app.state.db,
        actor_id=actor_id,
        action="read",
        entity_type="netskope_user_uci",
        entity_id="list",
        after_data={"row_count": len(result["rows"]), "rating": rating or "all", "searched": bool(search.strip())},
    )
    return {**result, "configured": netskope_uci_configured()}


@router.get(
    "/api/cmdb/netskope/uci/companies",
    response_model=NetskopeUciCompaniesResponse,
    summary="Usuarios con UCI bajo o moderado por empresa",
    description=(
        "Por empresa: usuarios activos con correo y cuántos tienen UCI Poor o Moderate. Es una proporción, "
        "no un promedio: los usuarios Good no se guardan. Ordenada por la proporción en riesgo y limitada a "
        "25 empresas (el resto se suma en omitted_users). Requiere netskope:uba_read."
    ),
)
async def netskope_uci_companies(request: Request, actor_id: str = Depends(require_uba_read)):
    result = await uci_by_company(request.app.state.db)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_user_uci",
        entity_id="companies", after_data={"row_count": len(result["companies"])},
    )
    return {"companies": result["companies"], "omitted_users": result["omitted_users"], "previous_week": result["previous_week"]}


class NetskopeAnomaly(BaseModel):
    severity: Literal["high", "medium", "low", "informational", "unknown"]
    scenario: str | None
    sub_scenario: str | None
    rule: str | None
    activity: str | None
    app: str | None
    score: float | None
    time: str | None


class NetskopeAnomaliesResponse(BaseModel):
    total: int
    returned: int
    truncated: bool
    by_severity: dict[str, int]
    by_scenario: list[dict[str, str | int | None]]
    top_rules: list[dict[str, str | int]]
    recent: list[NetskopeAnomaly]
    window_days: int


@router.get(
    "/api/cmdb/netskope/users/{object_id}/anomalies",
    response_model=NetskopeAnomaliesResponse,
    summary="Anomalías UEBA de un usuario Netskope (últimos 30 días)",
    description=(
        "Lectura en vivo de las anomalías del usuario en 30 días (máximo que acepta Netskope), hasta 1000 filas. "
        "Devuelve conteos por severidad y escenario, las reglas más frecuentes y las 10 más graves y recientes, "
        "sin direcciones IP, identificadores ni valores del evento. Nada se persiste. Requiere netskope:uba_read."
    ),
)
async def netskope_user_anomalies(
    request: Request, object_id: Annotated[int, Path(ge=1)], actor_id: str = Depends(require_uba_read),
):
    user = await get_experience_user(request.app.state.db, object_id)
    email = user.get("email") if user else None
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario Netskope activo no encontrado")
    if not isinstance(email, str) or not email.strip() or len(email) > 320:
        raise HTTPException(status_code=409, detail="El usuario Netskope no tiene correo disponible para consultar UEBA")
    try:
        async with NetskopeClient(NetskopeSettings.from_environment()) as client:
            rows, total = await client.get_user_anomalies(email)
    except NetskopeError:
        # Remote errors can echo identity or request bodies. Never forward them.
        raise HTTPException(status_code=502, detail="No se pudo consultar las anomalías. Verificá disponibilidad y permiso de lectura del token.") from None
    summary = summarize_anomalies(rows, total)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_user_anomalies",
        entity_id=str(object_id), after_data={"total": summary["total"], "returned": summary["returned"]},
    )
    return {**summary, "window_days": 30}


class NetskopeAttentionRow(BaseModel):
    email: str
    name: str | None
    user_id: str | None
    uci_rating: Literal["Poor", "Moderate"] | None
    uci_score: int | None
    uci_previous: int | None
    adem_score: float | None
    reasons: list[Literal["uci", "adem"]]


class NetskopeAttentionResponse(BaseModel):
    rows: list[NetskopeAttentionRow]
    adem_available: bool


@router.get(
    "/api/cmdb/netskope/experience/attention",
    response_model=NetskopeAttentionResponse,
    summary="Usuarios a atender: UCI y experiencia (ADEM) juntos",
    description=(
        "Cola de hasta 50 usuarios que combina el UCI bajo o moderado guardado y los 100 usuarios de peor "
        "puntaje ADEM de las últimas 24 h (límite de Netskope: no hay distribución del tenant completo). "
        "Un puntaje de la fuente que no lo listó es null, no 0. Si ADEM falla, devuelve solo UCI con "
        "adem_available=false. Requiere netskope:uba_read."
    ),
)
async def netskope_attention(request: Request, actor_id: str = Depends(require_uba_read)):
    uci = await list_netskope_user_uci(request.app.state.db, "", "", "score", 100, 0)
    adem: list[dict] = []
    adem_available = True
    end = int(time.time())
    try:
        async with NetskopeClient(NetskopeSettings.from_environment()) as client:
            adem = await client.get_adem_worst_users(end - 24 * 3600, end)
    except NetskopeError:
        adem_available = False
    rows = build_attention_queue(uci["rows"], adem)
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_user_uci",
        entity_id="attention", after_data={"row_count": len(rows), "adem_available": adem_available},
    )
    return {"rows": rows, "adem_available": adem_available}
