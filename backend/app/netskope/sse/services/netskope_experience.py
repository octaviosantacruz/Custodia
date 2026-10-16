"""Narrow ADEM projections. No IP, geography, gateway or raw payload escapes."""

from typing import Any


def _optional_text(value: Any, limit: int = 320) -> str | None:
    if value is None or value == '':
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError('ADEM devolvió un campo de texto inválido')
    return value.strip() or None


def map_adem_devices(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list) or len(payload) > 1000:
        raise ValueError('ADEM getlist no devolvió una lista acotada de dispositivos')
    devices = []
    seen = set()
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError('ADEM getlist devolvió un dispositivo inválido')
        device_id = row.get('deviceId')
        if not isinstance(device_id, str) or not device_id.strip() or len(device_id) > 160 or device_id in seen:
            raise ValueError('ADEM getlist devolvió un identificador inválido o duplicado')
        seen.add(device_id)
        devices.append({'device_id': device_id, 'device_name': _optional_text(row.get('deviceName')), 'device_os': _optional_text(row.get('deviceOs'))})
    return devices


def map_adem_device_details(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError('ADEM getdetails no devolvió un objeto')
    activity = payload.get('lastActivity')
    if activity is not None and (type(activity) is not int or not 0 <= activity < 253402300800):
        raise ValueError('ADEM getdetails devolvió lastActivity inválido')
    return {'pop': _optional_text(payload.get('pop'), 120), 'last_activity': activity or None}


def _score(value: Any) -> int | float | None:
    """ADEM scores are 0-100; a missing or malformed one is "Sin dato", never 0."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
        raise ValueError('ADEM devolvió un puntaje fuera de 0-100')
    return value


def map_adem_user_score(payload: Any) -> int | float | None:
    if not isinstance(payload, dict):
        raise ValueError('ADEM getinfo no devolvió un objeto')
    return _score(payload.get('expScore'))


SCORE_COMPONENTS = {'deviceScore': 'device', 'networkScore': 'network', 'appScore': 'app'}


def map_adem_device_scores(payload: Any) -> dict[str, int | float | None]:
    """Overall score plus the device, network and application components."""
    metrics = payload.get('metrics') if isinstance(payload, dict) else None
    if not isinstance(metrics, dict):
        raise ValueError('ADEM getaggregatedscores no devolvió métricas')
    return {'exp_score': _score(metrics.get('expScore')),
            **{f'{name}_score': _score(metrics.get(key)) for key, name in SCORE_COMPONENTS.items()}}


def weakest_component(scores: list[dict[str, Any]]) -> str | None:
    """Lowest component across the devices; ties and "Sin dato" never name one."""
    lowest: tuple[float, str] | None = None
    for row in scores:
        for name in SCORE_COMPONENTS.values():
            value = row.get(f'{name}_score')
            if value is not None and (lowest is None or value < lowest[0]):
                lowest = (value, name)
    return lowest[1] if lowest else None
