"""NSK-UBA-002: latest UCI (User Confidence Index) per user, behind a strict permission.

Only ``netskope:uba_read`` opens these routes; ``netskope:read`` and
``access:manage`` deliberately do not. Reads are audited with counts and filter
names, never with user values.
"""

import time
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel

from app import auth as auth_module
from app.auth import require_authenticated_read_access
from app.cross.services.audit_trail import (
    record_audit,
)
from app.netskope.sse.integrations.netskope import (
    NetskopeClient, NetskopeError, NetskopeSettings, netskope_office_experience_configured, netskope_uci_configured,
)
from app.netskope.sse.services.netskope_office_experience_view import office_experience_view, office_person_view, office_timeline_view
from app.netskope.sse.services.netskope_anomalies import summarize_anomalies
from app.netskope.sse.services.netskope_attention import attention_emails, build_attention
from app.netskope.sse.services.netskope_read_models import (
    get_experience_user,
    get_users_presence,
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
    company: str | None = None
    user_id: str | None
    uci_rating: Literal["Poor", "Moderate"] | None
    uci_score: int | None
    uci_previous: int | None
    adem_score: float | None
    reasons: list[Literal["uci", "adem"]]
    presence: Literal["office", "remote", "unknown"] = "unknown"
    office_days: int = 0
    performance_band: Literal["poor", "fair", "good"] | None = None


class NetskopeAttentionSummary(BaseModel):
    adem_listed: int
    office_listed: int
    office_poor: int
    office_fair: int
    remote_listed: int
    unknown_presence: int


class NetskopeAttentionResponse(BaseModel):
    rows: list[NetskopeAttentionRow]
    performance_rows: list[NetskopeAttentionRow] = []
    adem_available: bool
    summary: NetskopeAttentionSummary


@router.get(
    "/api/cmdb/netskope/experience/attention",
    response_model=NetskopeAttentionResponse,
    summary="Personas para revisar (UCI) y menores puntajes ADEM",
    description=(
        "rows: cola de riesgo de hasta 50 personas con UCI bajo o moderado guardado (Poor antes que Moderate, menor "
        "puntaje primero); un puntaje ADEM bajo por sí solo no entra. performance_rows: los 100 usuarios de peor "
        "puntaje ADEM de las últimas 24 h (límite de Netskope: no hay distribución del tenant completo). "
        "Cada persona trae su presencia (office/remote/unknown) de los últimos 7 días según la detección on-prem de "
        "Netskope en los snapshots de sus equipos activos, unidos por usuario igual al correo: office si reportó "
        "desde la oficina al menos un día (office_days cuenta los días), remote si sólo reportó fuera; sin equipo "
        "o sin dato es unknown, nunca remote. "
        "performance_rows va peor primero, para la vista Rendimiento. "
        "Con company solo se listan personas con UCI de esa empresa (la de su usuario Netskope); ADEM no trae empresa, "
        "así que en ese caso no se consulta y no hay filas de rendimiento. "
        "Un puntaje de la fuente que no lo listó es null, no 0. Si ADEM falla, devuelve solo UCI con "
        "adem_available=false. Requiere netskope:uba_read."
    ),
)
async def netskope_attention(
    request: Request, actor_id: str = Depends(require_uba_read),
    company: Annotated[str, Query(max_length=160)] = "",
):
    company = company.strip()
    uci = await list_netskope_user_uci(request.app.state.db, "", "", "score", 100, 0, company=company)
    adem: list[dict] = []
    adem_available = True
    end = int(time.time())
    try:
        if not company:  # ADEM rows carry no company, so a company view does not query them
            async with NetskopeClient(NetskopeSettings.from_environment()) as client:
                adem = await client.get_adem_worst_users(end - 24 * 3600, end)
    except NetskopeError:
        adem_available = False
    presence = await get_users_presence(request.app.state.db, attention_emails(uci["rows"], adem))
    result = build_attention(uci["rows"], adem, presence)
    rows, summary = result["rows"], result["summary"]
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_user_uci",
        entity_id="attention", after_data={"row_count": len(rows), "adem_available": adem_available, **summary},
    )
    return {"rows": rows, "performance_rows": result["performance_rows"], "adem_available": adem_available, "summary": summary}


class NetskopeOfficePerson(BaseModel):
    email: str
    name: str | None
    company: str | None
    office_days: int
    office_minutes: int
    office_score: float | None
    office_band: Literal["poor", "fair", "good"] | None
    remote_score: float | None
    worse_in_office: bool


class NetskopeOfficeSummary(BaseModel):
    office_people: int
    measured: int
    poor: int
    fair: int
    good: int
    worse_in_office: int
    days_measured: int
    office_avg: float | None = None
    remote_avg: float | None = None
    paired: int = 0


class NetskopeOfficeWeek(BaseModel):
    week_start: date
    days_measured: int
    office_people: int | None
    measured: int | None
    poor: int | None
    fair: int | None
    worse_in_office: int | None
    office_avg: float | None = None
    remote_avg: float | None = None


class NetskopeOfficeWeekday(BaseModel):
    weekday: int
    name: str
    days_measured: int
    office_people_per_day: float | None
    office_avg: float | None
    flagged_person_days: int | None


class NetskopeOfficeCompany(BaseModel):
    company: str
    office_people: int
    measured: int
    flagged: int
    worse_in_office: int
    office_avg: float | None


class NetskopeOfficeCompanies(BaseModel):
    rows: list[NetskopeOfficeCompany]
    omitted_people: int


class NetskopeOfficeRun(BaseModel):
    status: str
    started_at: datetime | None
    completed_at: datetime | None


class NetskopeOfficeExperienceResponse(BaseModel):
    configured: bool
    window_start: date
    window_end: date
    last_measured_at: datetime | None
    office_gap: int
    summary: NetskopeOfficeSummary
    measurement: NetskopeOfficeRun | None = None
    people: list[NetskopeOfficePerson]
    people_total: int
    series: list[NetskopeOfficeWeek]
    weekdays: list[NetskopeOfficeWeekday] = []
    companies: NetskopeOfficeCompanies | None = None



@router.get(
    "/api/cmdb/netskope/experience/office",
    response_model=NetskopeOfficeExperienceResponse,
    summary="Experiencia digital medida en la oficina (últimos 7 días y evolución semanal)",
    description=(
        "Personas que fueron a la oficina en los últimos 7 días completos (UTC, hasta ayer) con su puntaje ADEM "
        "medido sólo en sus tramos en la oficina, promediado por minutos, y el de sus tramos remotos para comparar. "
        "worse_in_office marca un puntaje en oficina al menos office_gap puntos menor que el remoto. series trae la "
        "evolución por semana (lunes a domingo, UTC); una semana sin días medidos tiene conteos null, no cero. "
        "Un puntaje ausente es null («Sin dato»), nunca cero. Lista hasta 200 personas, peor puntaje primero. "
        "office_avg/remote_avg promedian el puntaje por persona (remoto: sólo quienes también tienen puntaje en oficina). "
        "weekdays desglosa por día de la semana los días medidos de la serie; companies agrupa a las personas de la ventana. "
        "measurement es la última corrida de esa tarea (queued, running, completed o failed) para mostrar el avance. "
        "Sólo lee lo que guardó la tarea netskope_office_experience; no consulta Netskope. Requiere netskope:uba_read."
    ),
)
async def netskope_office_experience(
    request: Request, actor_id: str = Depends(require_uba_read),
    weeks: Annotated[int, Query(ge=2, le=26)] = 8,
):
    view = await office_experience_view(request.app.state.db, weeks, datetime.now(timezone.utc).date())
    summary = view["summary"]
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_office_experience",
        entity_id="office", after_data={"weeks": weeks, **summary},
    )
    return {"configured": netskope_office_experience_configured(), **view}


class NetskopeOfficePersonDay(BaseModel):
    day: date
    place: Literal["office", "remote", "no_signal"]
    measured: bool
    office_minutes: int
    office_score: float | None
    remote_minutes: int
    remote_score: float | None


class NetskopeOfficePersonResponse(BaseModel):
    email: str
    window_start: date
    window_end: date
    days: list[NetskopeOfficePersonDay]


@router.get(
    "/api/cmdb/netskope/experience/office/person",
    response_model=NetskopeOfficePersonResponse,
    summary="Últimos 7 días de una persona: dónde trabajó y su experiencia medida",
    description=(
        "Por cada día completo (UTC, hasta ayer): place office si algún equipo activo de la persona (usuario igual "
        "al correo) reportó desde la oficina, remote si sólo desde fuera y no_signal si ningún equipo reportó un evento "
        "clasificado. measured=false es un día que la tarea todavía no midió: el lugar se conoce, el puntaje no. "
        "Los puntajes ausentes son null, nunca cero. No consulta Netskope. Requiere netskope:uba_read."
    ),
)
async def netskope_office_person(
    request: Request, actor_id: str = Depends(require_uba_read),
    email: Annotated[str, Query(min_length=3, max_length=320)] = "",
):
    view = await office_person_view(request.app.state.db, email.strip().lower(), datetime.now(timezone.utc).date())
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_office_experience",
        entity_id="person", after_data={"days": len(view["days"]), "office_days": sum(1 for day in view["days"] if day["place"] == "office")},
    )
    return view


class NetskopeOfficeTimelinePoint(BaseModel):
    day: date
    measured: bool
    office_avg: float | None
    office_people: int | None
    remote_avg: float | None
    remote_people: int | None
    person_office: float | None = None
    person_office_minutes: int = 0
    person_remote: float | None = None
    person_remote_minutes: int = 0


class NetskopeOfficeTimelineCompany(BaseModel):
    company: str
    people: int


class NetskopeOfficeTimelinePerson(BaseModel):
    email: str
    name: str | None
    company: str | None


class NetskopeOfficeTimelineResponse(BaseModel):
    first: date
    last: date
    company: str | None
    min_people: int
    companies: list[NetskopeOfficeTimelineCompany]
    person: NetskopeOfficeTimelinePerson | None
    points: list[NetskopeOfficeTimelinePoint]


@router.get(
    "/api/cmdb/netskope/experience/office/timeline",
    response_model=NetskopeOfficeTimelineResponse,
    summary="Evolución diaria del rendimiento en oficina y remoto, por empresa y por persona",
    description=(
        "Un punto por día completo (UTC, hasta ayer) desde el primer hasta el último día medido de los últimos "
        "`days` días: puntaje ADEM promedio por persona (todas pesan igual) en sus tramos en la oficina y en remoto, "
        "con cuántas personas cubre cada promedio (por debajo de min_people el promedio es poco representativo). "
        "Remoto cubre a quienes también van a la oficina, que son los únicos que mide la tarea. Con company, sólo "
        "esa empresa (la de su usuario Netskope, unido por correo exacto; «Sin empresa» si no hay uno único). Con "
        "email, además los puntajes de esa persona. Con start/end (fechas UTC) se usa ese rango en lugar de days, "
        "acotado a los últimos 180 días completos (hasta ayer); un rango vacío o invertido es 422. "
        "Un día sin medir tiene measured=false y valores null, nunca cero. "
        "No consulta Netskope. Requiere netskope:uba_read."
    ),
)
async def netskope_office_timeline(
    request: Request, actor_id: str = Depends(require_uba_read),
    days: Annotated[int, Query(ge=7, le=180)] = 30,
    company: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    email: Annotated[str | None, Query(min_length=3, max_length=320)] = None,
    start: date | None = None,
    end: date | None = None,
):
    person_email = email.strip().lower() if email else None
    try:
        view = await office_timeline_view(request.app.state.db, days, company, person_email, datetime.now(timezone.utc).date(), start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await record_audit(
        request.app.state.db, actor_id=actor_id, action="read", entity_type="netskope_office_experience",
        entity_id="timeline", after_data={"days": days, "dates": start is not None or end is not None, "company": company is not None, "person": person_email is not None, "points": len(view["points"])},
    )
    return view
