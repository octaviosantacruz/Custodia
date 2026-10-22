import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from app.auth import require_read_access
from app.netskope.sse.services.netskope_read_models import (
    DEVICE_FRESHNESS_DEFAULT,
    get_netskope_alert_aggregates,
    get_netskope_client_compliance,
    get_netskope_client_events,
    get_netskope_device_changes,
    get_netskope_device_facets,
    get_netskope_device_freshness,
    get_netskope_device_history,
    get_netskope_duplicates,
    FLEET_GROUPS,
    get_netskope_fleet,
    get_netskope_fleet_groups,
    get_netskope_metrics,
    get_netskope_presence,
    get_netskope_source_evidence,
    list_netskope_dem_sites,
    list_netskope_group_members,
    list_netskope_groups,
    list_netskope_objects,
    list_netskope_policy_groups,
    list_retired_users_with_device_activity,
)
from app.netskope.sse.integrations.netskope import (
    NetskopeClient, NetskopeError, NetskopeSettings, netskope_alerts_configured,
    netskope_dem_sites_configured, netskope_dlp_alert_export_configured, netskope_groups_configured,
    netskope_policy_groups_configured,
)
from app.cross.api.routes.cmdb_dependencies import NETSKOPE_CATALOG_DEPENDENCIES
from app.netskope.sse.api.routes.cmdb_netskope_models import (
    NetskopeAlertsResponse,
    NetskopeClientComplianceResponse,
    NetskopeClientEventsResponse,
    NetskopeDeviceChangesResponse,
    NetskopeDeviceFacetsResponse,
    NetskopeDeviceFreshnessResponse,
    NetskopeDeviceHistoryResponse,
    NetskopeDemSitesResponse,
    NetskopeExperiencePopsResponse,
    NetskopeDuplicatesResponse,
    NetskopeFleetGroupsResponse,
    NetskopeFleetResponse,
    NetskopeGroupMembersResponse,
    NetskopeGroupsResponse,
    NetskopePolicyGroupsResponse,
    NetskopeMetricsResponse,
    NetskopeSourceEvidence,
    NetskopeObservedPoliciesResponse,
    NetskopeObjectsResponse,
    NetskopePostureResponse,
    NetskopePresenceResponse,
    NetskopeRetiredActivityResponse,
)
from app.netskope.sse.services.netskope_observed_policies import get_observed_policies
from app.netskope.sse.services.netskope_posture import get_netskope_posture

router = APIRouter(tags=["Inventario Netskope"], dependencies=[Depends(require_read_access)])


@router.get('/api/cmdb/netskope/sync-evidence', response_model=NetskopeSourceEvidence,
            summary='Evidencia del último intento de sincronización del inventario Netskope',
            description='Estado, fecha de cierre y vigencia del último intento de sincronizar clientes Netskope. Sólo una corrida completa dentro de las últimas 24 horas aporta evidencia vigente; las capturas de otras funciones no renuevan esta evidencia. Sin payloads ni credenciales.',
            dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_sync_evidence(request: Request):
    return await get_netskope_source_evidence(request.app.state.db)


@router.get('/api/cmdb/netskope/experience/pops', response_model=NetskopeExperiencePopsResponse,
            summary='POPs usados por usuarios activos',
            description='Consulta ADEM poplist para una ventana acotada. Devuelve códigos de POP, no usuarios, sesiones, latencia ni IP de egreso.',
            dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_experience_pops(hours: Annotated[int, Query(ge=2, le=48)] = 24):
    if hours not in (2, 24, 48):
        raise HTTPException(status_code=422, detail="hours debe ser 2, 24 o 48")
    endtime = int(time.time())
    starttime = endtime - hours * 3600
    try:
        settings = NetskopeSettings.from_environment()
        async with NetskopeClient(settings) as client:
            pops = await client.get_adem_pops(starttime, endtime)
    except NetskopeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {'pops': pops, 'total': len(pops), 'window_start': starttime, 'window_end': endtime}


@router.get('/api/cmdb/netskope/dem/sites', response_model=NetskopeDemSitesResponse, summary='Sitios DEM Netskope', description='Inventario de sitios DEM con campos operativos allowlisteados, sin ubicación, redes ni recursos embebidos.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_dem_sites(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    search = q.strip()
    result = await list_netskope_dem_sites(request.app.state.db, search, limit, offset)
    return {**result, "configured": netskope_dem_sites_configured(), "limit": limit, "offset": offset, "search": search}

@router.get('/api/cmdb/netskope/groups', response_model=NetskopeGroupsResponse, summary='Grupos Netskope', description='Inventario de grupos con conteo de miembros observado (relaciones activas) y el informado por Netskope; sin fechas de modificación ni identidades de quien los modificó.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_groups(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    provisioner: Annotated[str, Query(max_length=40)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    search, origin = q.strip(), provisioner.strip()
    result = await list_netskope_groups(request.app.state.db, search, origin, limit, offset)
    return {**result, "configured": netskope_groups_configured(), "limit": limit, "offset": offset, "search": search, "provisioner": origin}


@router.get('/api/cmdb/netskope/policy-groups', response_model=NetskopePolicyGroupsResponse, summary='Grupos de políticas de Netskope', description='Grupos de Real-time Protection (Header Policies, Default, Footer Policies…) con id, nombre, tipo y si un administrador puede editarlos; sin quién los creó ni modificó. Las reglas de cada grupo no se leen todavía.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_policy_groups(request: Request):
    result = await list_netskope_policy_groups(request.app.state.db)
    return {**result, "configured": netskope_policy_groups_configured()}


@router.get('/api/cmdb/netskope/groups/{group_id}/members', response_model=NetskopeGroupMembersResponse, summary='Miembros de un grupo Netskope', description='Usuarios Netskope activos vinculados al grupo por la cuenta que los referencia; el vínculo se lee de Netskope, no se infiere.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_group_members(
    request: Request,
    group_id: Annotated[str, Path(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    result = await list_netskope_group_members(request.app.state.db, group_id, limit, offset)
    if result is None:
        raise HTTPException(status_code=404, detail="Grupo Netskope no encontrado")
    return {**result, "limit": limit, "offset": offset}

# NSK-DLP-001: the user/incident DLP routes were revived for the narrow
# `netskope:dlp_read` permission (see api/routes/netskope_dlp.py). The
# per-device summary stays retired: the approved allowlist has no device
# field, so it answers 410 Gone for every actor rather than inventing a
# correlation. The historical cache tables remain untouched (no capture, no
# purge) until a separate explicit authorization.
RETIRED_DLP_DETAIL = (
    "La investigación de incidentes y eventos DLP individuales por dispositivo "
    "está retirada: Custodia sólo mantiene agregados y alertas mínimas por usuario."
)


def _retired_dlp_endpoint() -> None:
    raise HTTPException(status_code=410, detail=RETIRED_DLP_DETAIL)


@router.get(
    '/api/cmdb/netskope/devices/alerts/summary',
    summary='Retirado: resumen de alertas DLP por dispositivo',
    description='Retirado (410 Gone). No correlaciona incidentes DLP por dispositivo.',
    deprecated=True,
    include_in_schema=False,
    dependencies=NETSKOPE_CATALOG_DEPENDENCIES,
)
async def netskope_device_alert_summary_retired():
    _retired_dlp_endpoint()


@router.get('/api/cmdb/netskope/users', response_model=NetskopeObjectsResponse, summary='Usuarios Netskope', description='Inventario de usuarios reportados directamente por Netskope; no se cruza con CyberArk.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_users(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    device_count: Annotated[str, Query(pattern="^(|0|1|2plus)$")] = "",
    recent_device_age: Annotated[str, Query(pattern="^(|lt_24h|d1_7|d7_30|gt_30d|unknown)$")] = "",
    activity_days: Annotated[int, Query(description="Actividad observada de dispositivos resueltos en 7, 14 o 30 días (0 = sin filtro).")] = 0,
    account_status: Annotated[str, Query(pattern="^(|enabled|disabled|unknown)$", description="Estado según accounts[]: habilitado (alguna cuenta activa), deshabilitado o sin dato.")] = "",
):
    if activity_days not in (0, 7, 14, 30):
        raise HTTPException(status_code=422, detail="activity_days debe ser 7, 14 o 30")
    try:
        return await list_netskope_objects(
            request.app.state.db, "user", q.strip(), limit, offset,
            device_count=device_count, recent_device_age=recent_device_age, activity_days=activity_days,
            account_status=account_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/api/cmdb/netskope/users/retired-activity', response_model=NetskopeRetiredActivityResponse, summary='Usuarios dados de baja con equipos activos', description='Usuarios retirados del inventario (todas sus cuentas borradas en Netskope) cuyos equipos siguen reportando eventos en la ventana. La consola de Netskope los cuenta como activos; el inventario no. Vinculo exacto por source_id o correo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_retired_users_activity(request: Request, days: Annotated[int, Query(description="Ventana de 7, 14 o 30 días.")] = 7):
    if days not in (7, 14, 30):
        raise HTTPException(status_code=422, detail="days debe ser 7, 14 o 30")
    rows = await list_retired_users_with_device_activity(request.app.state.db, days)
    return {"days": days, "total": len(rows), "rows": rows}


@router.get('/api/cmdb/netskope/metrics', response_model=NetskopeMetricsResponse, response_model_exclude_unset=True, summary='Métricas Netskope', description='Conteos operativos del inventario Netskope aislado; no infiere relaciones con otras fuentes. Acepta filtros opcionales por SO, empresa y clasificación para los widgets del panel.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_metrics(
    request: Request,
    os: Annotated[str, Query(max_length=160)] = "",
    company: Annotated[str, Query(max_length=160)] = "",
    classification_status: Annotated[str, Query(max_length=160)] = "",
    widgets: Annotated[list[str] | None, Query(max_length=28)] = None,
):
    filters = {
        key: value.strip()
        for key, value in (("os", os), ("company", company), ("classification_status", classification_status))
        if value.strip()
    }
    try:
        if widgets is None:
            return await get_netskope_metrics(request.app.state.db, filters or None)
        return await get_netskope_metrics(request.app.state.db, filters or None, widgets=widgets)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/api/cmdb/netskope/alerts', response_model=NetskopeAlertsResponse, summary='Agregados de alertas Netskope', description='Conteos allowlisteados de alertas en ventanas de 7, 30 y 90 días. Nunca devuelve eventos ni datos personales.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_alerts(request: Request):
    aggregates = await get_netskope_alert_aggregates(request.app.state.db)
    return {
        **aggregates,
        "configured": netskope_alerts_configured(),
        "dlp_export_configured": netskope_dlp_alert_export_configured(),
    }


@router.get('/api/cmdb/netskope/observed-policies', response_model=NetskopeObservedPoliciesResponse, summary='Políticas observadas en eventos Netskope', description='Nombres de policy observados en alertas agregadas, con volumen por ventana y primera/última captura. Sólo políticas que dispararon; no representa el catálogo configurado ni marca políticas ausentes como deshabilitadas. Nunca devuelve eventos ni datos personales.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_observed_policies(request: Request):
    policies = await get_observed_policies(request.app.state.db)
    return {**policies, "configured": netskope_alerts_configured()}


@router.get('/api/cmdb/netskope/posture', response_model=NetskopePostureResponse, summary='Postura Netskope', description='Chequeos de postura evaluados al leer sobre el inventario ya sincronizado: cliente desinstalado o deshabilitado, versión de cliente y de SO contra las líneas base configuradas, equipos sin señal y sin diagnóstico, hostnames duplicados y, sólo con netskope:uba_read, usuarios con UCI Poor o Moderate. Cada conteo es el de la lista del inventario que abre su detalle; devuelve una muestra acotada por chequeo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_posture(request: Request):
    return await get_netskope_posture(request.app.state.db, getattr(request.state, "actor_permissions", frozenset()))


@router.get('/api/cmdb/netskope/experience/presence', response_model=NetskopePresenceResponse, summary='Dónde se conectan los equipos Netskope (oficina o remoto)', description='Equipos activos con señal en 7 días clasificados por la On-Premises Detection de Netskope (on-prem, off-prem, sin configurar, desconocido), por client config y por empresa. Sólo categorías: nunca IPs ni la dirección de egreso. Un equipo sin el dato aún no sincronizado cuenta como "Sin dato", no como remoto.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_presence(request: Request):
    return {**await get_netskope_presence(request.app.state.db), "source_evidence": await get_netskope_source_evidence(request.app.state.db)}


@router.get('/api/cmdb/netskope/devices', response_model=NetskopeObjectsResponse, summary='Dispositivos Netskope', description='Inventario reciente de dispositivos Netskope. La correlación de usuario usa username contra id/email exactos del mismo tenant; user_key permanece como atributo. No incluye conteos de alertas DLP por dispositivo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_devices(
    request: Request,
    q: Annotated[str, Query(max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    os: Annotated[str, Query(max_length=160)] = "",
    client_version: Annotated[str, Query(max_length=160)] = "",
    classification_status: Annotated[str, Query(max_length=160)] = "",
    user_status: Annotated[str, Query(max_length=160)] = "",
    company: Annotated[str, Query(max_length=160)] = "",
    last_seen_event: Annotated[str, Query(max_length=160)] = "",
    device_make: Annotated[str, Query(max_length=160)] = "",
    device_model: Annotated[str, Query(max_length=160)] = "",
    client_compliance: Annotated[str, Query(pattern="^(|current|one_behind|two_plus_behind|unrecognized)$")] = "",
    os_compliance: Annotated[str, Query(pattern="^(|supported|below_minimum|no_baseline|unrecognized)$")] = "",
    duplicate: Annotated[str, Query(pattern="^(|hostname|username)$")] = "",
    hostname: Annotated[str, Query(max_length=240)] = "",
    username: Annotated[str, Query(max_length=240)] = "",
    observed_user_status: Annotated[str, Query(pattern="^(|matched|ambiguous|unmatched)$")] = "",
    observed_user: Annotated[str, Query(max_length=240)] = "",
    onprem_status: Annotated[str, Query(max_length=60)] = "",
    client_config: Annotated[str, Query(max_length=60)] = "",
    uci_rating: Annotated[str, Query(pattern="^(|Poor|Moderate|Sin alerta|Sin dato)$")] = "",
    coverage_risk: Annotated[str, Query(pattern="^(|1)$")] = "",
    event_age: Annotated[str, Query(pattern="^(|lt_24h|d1_7|d7_30|gt_30d|unknown)$")] = "",
    change: Annotated[str, Query(pattern="^(|added|upgraded|downgraded|version_changed|os_changed|classification_changed)$")] = "",
    freshness: Annotated[str, Query(pattern="^(|recent|all)$")] = DEVICE_FRESHNESS_DEFAULT,
    evidence_state: Annotated[str, Query(pattern="^(|recent|not_recent|review|unknown)$")] = "",
    observed_user_id: Annotated[int | None, Query(ge=1)] = None,
    device_object_id: Annotated[int | None, Query(ge=1)] = None,
    review_diagnosis: Annotated[str, Query(pattern="^(|undetermined|uninstalled_reported|replaced|decommissioned|in_use_not_reporting|historical_record|temporary_exception)$")] = "",
    review_status: Annotated[str, Query(pattern="^(|pending|investigating|ticket_open|resolved)$")] = "",
    review_attention: Annotated[str, Query(pattern="^(|open_incident|expired_exception|reported_again)$")] = "",
    review_suggestion: Annotated[str, Query(pattern="^(|uninstalled_reported|replaced|historical_record|none)$")] = "",
):
    filters = {
        "os": os.strip(), "client_version": client_version.strip(), "classification_status": classification_status.strip(),
        "user_status": user_status.strip(), "company": company.strip(), "last_seen_event": last_seen_event.strip(),
        "device_make": device_make.strip(), "device_model": device_model.strip(),
        "hostname": hostname.strip(), "username": username.strip().lower(),
        "observed_user_status": observed_user_status.strip(), "observed_user": observed_user.strip(),
        "onprem_status": onprem_status.strip(), "client_config": client_config.strip(),
        "uci_rating": uci_rating.strip(),
    }
    try:
        # Drill-downs from posture/quality cards describe the whole active
        # inventory. The default table scope is recent (7 days), but applying
        # a change, compliance, duplicate or coverage-risk criterion must not
        # silently hide older matching devices from the detail view.
        quality_drill = any((change, client_compliance, os_compliance, duplicate, coverage_risk, evidence_state, observed_user_id, device_object_id, review_diagnosis, review_status, review_attention, review_suggestion))
        effective_freshness = "all" if event_age in {"d7_30", "gt_30d", "unknown"} or quality_drill else (freshness or DEVICE_FRESHNESS_DEFAULT)
        return await list_netskope_objects(request.app.state.db, "device", q.strip(), limit, offset, filters, event_age, change,
                                           client_compliance, os_compliance, duplicate, effective_freshness, coverage_risk=coverage_risk,
                                           evidence_state=evidence_state, observed_user_id=observed_user_id, device_object_id=device_object_id,
                                           review_diagnosis=review_diagnosis, review_status=review_status,
                                           review_attention=review_attention, review_suggestion=review_suggestion)
    except ValueError as exc:
        # e.g. a compliance filter before an admin configured its baseline.
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/api/cmdb/netskope/devices/facets', response_model=NetskopeDeviceFacetsResponse, summary='Valores de filtro de dispositivos Netskope', description='Valores distintos y conteos por atributo filtrable (SO, cliente, clasificación, estado de usuario, empresa) del inventario activo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_device_facets(request: Request):
    return await get_netskope_device_facets(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/freshness', response_model=NetskopeDeviceFreshnessResponse, summary='Frescura de reporte de dispositivos Netskope', description='Antigüedad del último evento reportado por el cliente, cruzada con clasificación. Es frescura de reporte, no estado de encendido del equipo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_device_freshness(request: Request):
    return await get_netskope_device_freshness(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/client-events', response_model=NetskopeClientEventsResponse, summary='Último evento del cliente Netskope', description='Distribución de last_seen_event con los literales exactos de desinstalación/deshabilitación marcados como cobertura en riesgo.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_client_events(request: Request):
    return await get_netskope_client_events(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/changes', response_model=NetskopeDeviceChangesResponse, summary='Cambios de dispositivos Netskope entre corridas', description='Diferencia entre las dos últimas corridas Netskope completas: altas, retiros, cambios de versión de cliente, SO y clasificación. Nunca compara corridas fallidas o parciales.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_device_changes(request: Request):
    return await get_netskope_device_changes(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/client-compliance', response_model=NetskopeClientComplianceResponse, summary='Cumplimiento de versión del cliente Netskope', description='Dispositivos por distancia a las releases golden configuradas por un admin, total y por SO. Sin línea base configurada devuelve configured=false.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_client_compliance(request: Request):
    return await get_netskope_client_compliance(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/fleet', response_model=NetskopeFleetResponse, summary='Composición de flota Netskope', description='Distribución por fabricante, modelo, SO/versión y empresa, más cumplimiento de versión mínima de SO si un admin la configuró.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_fleet(request: Request):
    return await get_netskope_fleet(request.app.state.db)


@router.get('/api/cmdb/netskope/devices/fleet-groups', response_model=NetskopeFleetGroupsResponse, summary='Flota Netskope agrupada', description='Por empresa, SO, client config, fabricante, dónde trabaja o UCI: equipos activos con evento en 7 días, con señal en 24 h, cliente al día, SO en o sobre el mínimo, en oficina y con UCI bajo del usuario. Sin línea base, la columna no se evalúa.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_fleet_groups(request: Request, group_by: Annotated[str, Query(pattern="^(company|os|client_config|device_make|onprem_status|uci_rating)$")] = "company"):
    if group_by not in FLEET_GROUPS:
        raise HTTPException(status_code=422, detail="group_by no soportado")
    return await get_netskope_fleet_groups(request.app.state.db, group_by)


@router.get('/api/cmdb/netskope/devices/duplicates', response_model=NetskopeDuplicatesResponse, summary='Posibles duplicados de dispositivos Netskope', description='Mismo hostname con varios device_id activos y mismo usuario en varios dispositivos, por coincidencia exacta. Por defecto considera todo el inventario para no ocultar problemas de calidad; admite freshness=recent para revisar sólo equipos recientes.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_duplicates(request: Request, freshness: Annotated[str, Query(pattern="^(|recent|all)$")] = "all"):
    return await get_netskope_duplicates(request.app.state.db, freshness=freshness or "all")


@router.get('/api/cmdb/netskope/devices/{device_id}/history', response_model=NetskopeDeviceHistoryResponse, summary='Historial de dispositivo Netskope', description='Historial allowlisteado de snapshots del mismo device_id; no devuelve payloads crudos.', dependencies=NETSKOPE_CATALOG_DEPENDENCIES)
async def netskope_device_history(
    request: Request,
    device_id: Annotated[str, Path(min_length=1, max_length=240)],
):
    return await get_netskope_device_history(request.app.state.db, device_id.strip())
