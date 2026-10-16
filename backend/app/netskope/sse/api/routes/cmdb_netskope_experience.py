"""On-demand user/device ADEM reads; external POSTs are queries, never writes."""

import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel

from app.netskope.sse.integrations.netskope import NetskopeClient, NetskopeError, NetskopeSettings
from app.auth import require_read_access
from app.netskope.sse.services.netskope_device_link import link_devices_by_exact_name
from app.netskope.sse.services.netskope_experience import weakest_component
from app.netskope.sse.services.netskope_read_models import (
    get_experience_user,
    list_user_inventory_device_names,
)
from app.cross.api.routes.cmdb_dependencies import NETSKOPE_CATALOG_DEPENDENCIES

router = APIRouter(tags=['Inventario Netskope'], dependencies=[Depends(require_read_access), *NETSKOPE_CATALOG_DEPENDENCIES])
UserId = Annotated[int, Path(ge=1)]
DeviceId = Annotated[str, Path(min_length=1, max_length=160)]


class ExperienceWindow(BaseModel):
    window_start: int
    window_end: int
    source: Literal['netskope_adem'] = 'netskope_adem'


class ExperienceDevice(BaseModel):
    device_id: str
    device_name: str | None
    device_os: str | None


class ExperienceDevices(ExperienceWindow):
    devices: list[ExperienceDevice]


class ExperienceDetail(ExperienceWindow):
    device_id: str
    pop: str | None
    last_activity: int | None
    activity_status: Literal['in_window', 'outside_window', 'unknown']


SCORE_DEVICE_LIMIT = 5


class ExperienceDeviceScore(BaseModel):
    device_id: str
    inventory_device_id: int | None
    device_name: str | None
    device_os: str | None
    exp_score: float | None
    device_score: float | None
    network_score: float | None
    app_score: float | None


class ExperienceScore(ExperienceWindow):
    score: float | None
    weakest: Literal['device', 'network', 'app'] | None
    devices: list[ExperienceDeviceScore]
    devices_total: int


async def _user(request: Request, object_id: int) -> str:
    row = await get_experience_user(request.app.state.db, object_id)
    if row is None:
        raise HTTPException(404, 'Usuario Netskope activo no encontrado')
    email = row.get('email')
    if not isinstance(email, str) or not email.strip() or len(email) > 320:
        raise HTTPException(409, 'El usuario Netskope no tiene correo disponible para consultar ADEM')
    return email


def _remote_error() -> HTTPException:
    # Remote errors can echo identity, IP or request bodies. Never forward them.
    return HTTPException(502, 'No se pudo consultar ADEM. Verificá disponibilidad y permiso de lectura del token.')


@router.get('/api/cmdb/netskope/users/{object_id}/experience/devices', response_model=ExperienceDevices,
            summary='Dispositivos ADEM observados para un usuario Netskope',
            description='Consulta bajo demanda los dispositivos de un usuario Netskope activo en una ventana de 2, 24 o 48 horas; expone sólo ID, nombre y SO, sin IP ni ubicación.')
async def experience_devices(request: Request, object_id: UserId, hours: Annotated[int, Query(ge=2, le=48)] = 2):
    if hours not in (2, 24, 48):
        raise HTTPException(422, 'hours debe ser 2, 24 o 48')
    user = await _user(request, object_id)
    end = int(time.time())
    start = end - hours * 3600
    try:
        async with NetskopeClient(NetskopeSettings.from_environment()) as client:
            devices = await client.get_adem_devices(user, start, end)
    except NetskopeError:
        raise _remote_error() from None
    return {'devices': devices, 'window_start': start, 'window_end': end}


@router.get('/api/cmdb/netskope/users/{object_id}/experience/devices/{device_id}', response_model=ExperienceDetail,
            summary='POP y actividad informados por ADEM para un dispositivo',
            description='Verifica el dispositivo literal en el listado del usuario para la misma ventana y devuelve POP y actividad informada con estado temporal. No confirma conexión en vivo ni frescura cuando la fecha queda fuera del período.')
async def experience_detail(request: Request, object_id: UserId, device_id: DeviceId,
                            window_start: Annotated[int, Query(ge=0)], window_end: Annotated[int, Query(ge=1)]):
    now = int(time.time())
    if not 0 < window_end - window_start <= 48 * 3600 or window_end > now or window_start < now - 30 * 86400:
        raise HTTPException(422, 'Ventana ADEM inválida: hasta 48 horas dentro de los últimos 30 días')
    user = await _user(request, object_id)
    try:
        async with NetskopeClient(NetskopeSettings.from_environment()) as client:
            devices = await client.get_adem_devices(user, window_start, window_end)
            if not any(row['device_id'] == device_id for row in devices):
                raise HTTPException(404, 'Dispositivo no observado para este usuario y ventana')
            detail = await client.get_adem_device_details(user, device_id, window_start, window_end)
    except NetskopeError:
        raise _remote_error() from None
    activity = detail['last_activity']
    status = 'unknown' if activity is None else 'in_window' if window_start <= activity <= window_end else 'outside_window'
    return {**detail, 'device_id': device_id, 'window_start': window_start, 'window_end': window_end, 'activity_status': status}


@router.get('/api/cmdb/netskope/users/{object_id}/experience/score', response_model=ExperienceScore,
            summary='Puntaje de experiencia ADEM de un usuario y de sus equipos',
            description='Consulta bajo demanda el puntaje del usuario y, de hasta cinco de sus equipos, el puntaje general y sus componentes (equipo, red, aplicaciones). "weakest" es el componente más bajo observado; sin dato no cuenta como cero. No expone IP, ubicación ni causa raíz.')
async def experience_score(request: Request, object_id: UserId, hours: Annotated[int, Query(ge=2, le=48)] = 24):
    if hours not in (2, 24, 48):
        raise HTTPException(422, 'hours debe ser 2, 24 o 48')
    user = await _user(request, object_id)
    end = int(time.time())
    start = end - hours * 3600
    try:
        async with NetskopeClient(NetskopeSettings.from_environment()) as client:
            score = await client.get_adem_user_score(user, start, end)
            devices = await client.get_adem_devices(user, start, end)
            rows = []
            for device in devices[:SCORE_DEVICE_LIMIT]:
                rows.append({**device, **await client.get_adem_device_scores(user, device['device_id'], start, end)})
    except NetskopeError:
        raise _remote_error() from None
    # ADR 006: exact, unique name within this user's two lists; the link is never stored.
    links = link_devices_by_exact_name(await list_user_inventory_device_names(request.app.state.db, object_id), devices)
    for row in rows:
        row['inventory_device_id'] = links.get(row['device_id'])
    return {'score': score, 'weakest': weakest_component(rows), 'devices': rows, 'devices_total': len(devices),
            'window_start': start, 'window_end': end}
