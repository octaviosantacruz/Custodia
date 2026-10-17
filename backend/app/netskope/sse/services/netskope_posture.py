"""NSK-POSTURE-001: Netskope posture checks over data Custodia already synchronizes.

Every check is the exact inventory query its "Ver en inventario" drill opens
(same filters, same scope), so a group's count always equals the list behind
it. Nothing is persisted: checks are evaluated at read time over the current
inventory, so a fix in Netskope or a human review decision is reflected on
the next read. A check whose admin baseline is missing reports
``not_configured``; UCI checks report ``not_permitted`` unless the actor holds
``netskope:uba_read`` (the same strict permission as the UCI view).
"""

from __future__ import annotations

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.netskope.sse.integrations.netskope import netskope_uci_configured
from app.netskope.sse.repositories.netskope_baselines import get_netskope_baselines
from app.netskope.sse.services.netskope_read_models import (
    get_netskope_source_evidence,
    list_netskope_objects,
    list_netskope_user_uci,
)

SAMPLE_SIZE = 10
UBA_PERMISSION = "netskope:uba_read"

# id, entity, severity, title, description, baseline key and inventory filter.
# Filters use the whole active inventory (freshness "all"), exactly like the
# inventory drill of a compliance, duplicate or coverage criterion.
DEVICE_CHECKS: tuple[dict[str, Any], ...] = (
    {
        "id": "client_protection_off", "severity": "high", "baseline": None,
        "title": "Cliente desinstalado o deshabilitado",
        "description": "El último evento del cliente es Uninstalled, Disconnected By Uninstall o Admin Disabled: el equipo dejó de estar protegido por Netskope.",
        "query": {"coverage_risk": "1"},
    },
    {
        "id": "stale_undiagnosed", "severity": "medium", "baseline": None,
        "title": "Sin señal hace más de 30 días",
        "description": "El cliente no reporta hace más de 30 días. El detalle los agrupa por lo que explica Netskope (desinstalación informada, reemplazo, registro histórico o sin explicación).",
        "query": {"event_age": "gt_30d", "review_diagnosis": "undetermined"},
    },
    {
        "id": "duplicate_hostname", "severity": "low", "baseline": None,
        "title": "Hostname con varios equipos activos",
        "description": "El mismo hostname aparece en más de un device_id activo, por coincidencia exacta. Puede ser una reinstalación o un registro repetido.",
        "query": {"duplicate": "hostname"},
    },
)

# Not evaluated and not shown in Postura (decisión del dueño, 2026-10-12): they need a version policy
# (golden releases and minimum OS versions) that the team still has to define with management. The
# definitions stay here, ready to move back into DEVICE_CHECKS once the baselines exist; the baseline
# editor, its API and the inventory `client_compliance`/`os_compliance` filters are unchanged.
# Tracker: `NSK-POLICY-001`.
DEFERRED_POLICY_CHECKS: tuple[dict[str, Any], ...] = (
    {
        "id": "client_two_plus_behind", "severity": "medium", "baseline": "client_golden_releases",
        "title": "Cliente 2 o más releases golden atrás",
        "description": "La versión del cliente está al menos dos releases golden por detrás de las configuradas por un administrador.",
        "query": {"client_compliance": "two_plus_behind"},
    },
    {
        "id": "os_below_minimum", "severity": "medium", "baseline": "os_minimum_versions",
        "title": "Sistema operativo debajo del mínimo",
        "description": "La versión del sistema operativo es menor que el mínimo configurado para ese sistema.",
        "query": {"os_compliance": "below_minimum"},
    },
    {
        "id": "client_one_behind", "severity": "low", "baseline": "client_golden_releases",
        "title": "Cliente 1 release golden atrás",
        "description": "La versión del cliente está una release golden por detrás de la más reciente configurada.",
        "query": {"client_compliance": "one_behind"},
    },
)

USER_CHECKS: tuple[dict[str, Any], ...] = (
    {
        "id": "uci_poor", "severity": "high", "rating": "Poor",
        "title": "Usuario con confianza baja",
        "description": "Netskope calificó la confianza del usuario como baja en su último cálculo (Poor). Un puntaje menor indica mayor riesgo y requiere revisión.",
    },
    {
        "id": "uci_moderate", "severity": "medium", "rating": "Moderate",
        "title": "Usuario con confianza moderada",
        "description": "Netskope calificó la confianza del usuario como moderada en su último cálculo (Moderate). Requiere revisar las señales que afectan a la cuenta.",
    },
)

CHECK_IDS = tuple(check["id"] for check in (*DEVICE_CHECKS, *USER_CHECKS))


def _device_finding(row: dict[str, Any]) -> dict[str, Any]:
    """Allowlisted projection: never the raw attributes payload."""
    attributes = row.get("attributes") or {}
    evidence = row.get("device_evidence") or {}

    def text(key: str) -> str:
        value = attributes.get(key)
        return value if isinstance(value, str) else ""

    return {
        "object_id": row["object_id"],
        "name": row.get("display_name") or text("hostname") or row.get("source_id") or "",
        "user": text("username"),
        "os": " ".join(part for part in (text("os"), text("os_version")) if part),
        "client_version": text("client_version"),
        "last_event": text("last_seen_event"),
        "detected_at": evidence.get("last_signal_at"),
    }


def _check_shell(check: dict[str, Any], entity: str) -> dict[str, Any]:
    return {
        "id": check["id"], "entity": entity, "severity": check["severity"],
        "title": check["title"], "description": check["description"],
        "status": "evaluated", "count": 0, "findings": [],
    }


async def get_netskope_posture(pool: AsyncConnectionPool, permissions: frozenset[str] | set[str]) -> dict[str, Any]:
    # Baselines are only read when a device check depends on one.
    baselines = await get_netskope_baselines(pool) if any(check["baseline"] for check in DEVICE_CHECKS) else {}
    checks: list[dict[str, Any]] = []
    for check in DEVICE_CHECKS:
        result = _check_shell(check, "device")
        result["query"] = dict(check["query"])
        if check["baseline"] and not baselines.get(check["baseline"]):
            result["status"] = "not_configured"
            checks.append(result)
            continue
        query = check["query"]
        listing = await list_netskope_objects(
            pool, "device", "", SAMPLE_SIZE, 0, None,
            event_age=query.get("event_age", ""),
            client_compliance=query.get("client_compliance", ""),
            os_compliance=query.get("os_compliance", ""),
            duplicate=query.get("duplicate", ""),
            freshness="all",
            coverage_risk=query.get("coverage_risk", ""),
            review_diagnosis=query.get("review_diagnosis", ""),
        )
        result["count"] = listing["total"]
        result["findings"] = [_device_finding(row) for row in listing["rows"]]
        checks.append(result)

    can_read_uci = UBA_PERMISSION in permissions
    uci_captured_at = None
    for check in USER_CHECKS:
        result = _check_shell(check, "user")
        result["query"] = {"rating": check["rating"]}
        if not can_read_uci:
            result["status"] = "not_permitted"
        elif not netskope_uci_configured():
            result["status"] = "not_configured"
        else:
            listing = await list_netskope_user_uci(pool, check["rating"], "", "score", SAMPLE_SIZE, 0)
            result["count"] = listing["by_rating"].get(check["rating"], 0)
            uci_captured_at = listing["captured_at"]
            result["findings"] = [{
                "object_id": None, "name": row.get("name") or row["email"], "user": row["email"],
                "os": "", "client_version": "", "last_event": "",
                "score": row["score"], "detected_at": row["scored_at"],
            } for row in listing["rows"]]
        checks.append(result)

    return {
        "checks": checks,
        "source_evidence": await get_netskope_source_evidence(pool),
        "uci_captured_at": uci_captured_at,
    }
