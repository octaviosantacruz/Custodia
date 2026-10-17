"""NSK-DLP-001: minimal DLP incident capture with a strict field allowlist.

The external ``dataexport/events/incident`` iterator returns a wide event
payload (file paths, URLs, hashes, mail recipients, locations, forensic
arrays). This module projects each row down to the approved allowlist before
anything reaches the database:

    incident ID (opaque), UTC timestamp, status, severity, policy, action and
    the opaque Netskope user ID.

Application/channel, file type and classification are deliberately NOT
persisted or returned yet: the versioned probe confirmed the fields exist but
not that they are discrete, safe categorical values (``site`` is
URL-adjacent). Never invent or derive them from free text.

Capture is bounded and idempotent: one sync run walks at most
``DLP_CAPTURE_MAX_PAGES`` pages, resumes a persisted cursor when a previous
run was partial, commits each projected page with its checkpoint (newer event wins) and then
purges rows older than 30 days. Alerts are events, not inventory: no run ever
retires a row for being absent, so a partial response can never create a
false retirement.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from psycopg_pool import AsyncConnectionPool

from app.netskope.sse.integrations.netskope import (
    NetskopeClient,
    NetskopeError,
    NetskopeNotConfigured,
    NetskopeSettings,
    netskope_dlp_incidents_configured,
)
from app.netskope.sse.repositories.netskope_dlp_mutations import (
    purge_netskope_dlp_alerts,
    record_netskope_dlp_capture_state,
    persist_netskope_dlp_page,
)
from app.netskope.sse.repositories.netskope_dlp_queries import get_netskope_dlp_capture_state

LOGGER = logging.getLogger(__name__)

DLP_RETENTION_DAYS = 30
DLP_CAPTURE_MAX_PAGES = 12
DLP_CAUGHT_UP_EPSILON = timedelta(minutes=5)
DLP_MAX_STALLED_PAGES = 3
# Epoch seconds below this value (2000-01-01) or above now+1 day are treated
# as an invalid unit/shape instead of being interpreted as a real date.
MIN_EVENT_TIMESTAMP = 946684800.0

# The persisted projection. Kept as a tuple so tests can assert the exact
# allowlist: any new field must be added here and justified by a probe.
ALLOWED_ALERT_FIELDS = (
    "incident_id",
    "event_timestamp",
    "status",
    "severity",
    "policy",
    "action",
    "user_id",
)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _identifier(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else ""
    if isinstance(value, str):
        return value.strip()
    return ""


def _timestamp(value: Any, *, now: datetime) -> datetime | None:
    if isinstance(value, bool):
        return None
    seconds: float | None = None
    if isinstance(value, int):
        seconds = float(value)
    elif isinstance(value, float):
        seconds = value
    elif isinstance(value, str) and value.strip().isdigit():
        seconds = float(value.strip())
    if seconds is None or not MIN_EVENT_TIMESTAMP <= seconds <= now.timestamp() + 86400:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _first_match_text(matches: Any, field: str) -> str:
    """First non-empty allowlisted value across ``dlp_match_info`` entries.

    Only the named subfield is read; the match objects also carry forensic
    identifiers (``dlp_forensic_id``, rule internals) that are never copied.
    """
    if not isinstance(matches, list):
        return ""
    for match in matches:
        if not isinstance(match, dict):
            continue
        text = _text(match.get(field))
        if text:
            return text
    return ""


def sanitize_dlp_incident(row: Any, *, now: datetime | None = None) -> dict[str, Any] | None:
    """Project one incident row down to the approved allowlist, or drop it.

    A row without an opaque incident ID or with an unusable timestamp is
    dropped instead of being stored with an invented value.
    """
    if not isinstance(row, dict):
        return None
    incident_id = _identifier(row.get("dlp_incident_id"))
    event_timestamp = _timestamp(row.get("timestamp"), now=now or datetime.now(timezone.utc))
    if not incident_id or event_timestamp is None:
        return None
    return {
        "incident_id": incident_id,
        "event_timestamp": event_timestamp,
        "status": _text(row.get("status")),
        "severity": _text(row.get("severity")),
        "policy": _first_match_text(row.get("dlp_match_info"), "dlp_policy"),
        "action": _first_match_text(row.get("dlp_match_info"), "dlp_action"),
        "user_id": _text(row.get("user_id")),
    }


def incident_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("result"), list):
        return [row for row in payload["result"] if isinstance(row, dict)]
    return []


def payload_high_water_mark(payload: Any, fallback: datetime) -> datetime:
    """Netskope's own progress marker, present even on empty pages."""
    value = payload.get("timestamp_hwm") if isinstance(payload, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    try:
        candidate = datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return fallback
    return max(candidate, fallback)


def is_caught_up(coverage_end: datetime, now: datetime) -> bool:
    return now - coverage_end <= DLP_CAUGHT_UP_EPSILON


def _merge_alert(collected: dict[str, dict[str, Any]], alert: dict[str, Any]) -> None:
    """Deduplicate by incident ID inside one run, keeping the newest event."""
    current = collected.get(alert["incident_id"])
    if current is None or alert["event_timestamp"] >= current["event_timestamp"]:
        collected[alert["incident_id"]] = alert


async def capture_netskope_dlp_alerts(
    pool: AsyncConnectionPool,
    run_id: UUID,
    progress=None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Capture at most one bounded batch of minimal DLP incidents.

    Best-effort by design: a Netskope failure is logged and reported in the
    result instead of failing the whole Netskope inventory run. Previously
    committed pages remain available on failure; pending pages are replayed.
    """
    if not netskope_dlp_incidents_configured():
        return {"configured": False, "scanned_events": 0, "captured_alerts": 0, "partial": True, "error": False}
    try:
        settings = NetskopeSettings.from_environment()
    except NetskopeNotConfigured:
        return {"configured": False, "scanned_events": 0, "captured_alerts": 0, "partial": True, "error": False}

    captured_at = now or datetime.now(timezone.utc)
    state = await get_netskope_dlp_capture_state(pool)
    resumable = bool(
        state
        and state.get("iterator_index")
        and state.get("partial")
        and state.get("coverage_end")
    )
    if resumable:
        index = state["iterator_index"]
        operation = "resend"
        coverage_start = state.get("coverage_start") or (captured_at - timedelta(days=DLP_RETENTION_DAYS))
        coverage_end = state["coverage_end"]
        if coverage_end == coverage_start:
            # A crash before the first fetch may leave no page to resend.
            # Reinitialize at the original epoch; replay is idempotent.
            operation = str(int(coverage_start.timestamp()))
    else:
        index = f"custodia-dlp-{uuid4()}"
        coverage_start = max(
            state.get("coverage_end") if state and state.get("coverage_end") else captured_at - timedelta(days=DLP_RETENTION_DAYS),
            captured_at - timedelta(days=DLP_RETENTION_DAYS),
        )
        coverage_end = coverage_start
        operation = str(int(coverage_start.timestamp()))

    if progress:
        await progress("Capturando alertas DLP Netskope")

    # Persist a new index before its first request: a lost response must not
    # strand a remote cursor that the next run cannot identify. This is not a
    # successful capture, so preserve the last successful freshness timestamp.
    if not resumable:
        await record_netskope_dlp_capture_state(
            pool, iterator_index=index, coverage_start=coverage_start,
            coverage_end=coverage_end, partial=True, scanned_events=0,
            captured_alerts=0, captured_at=state.get("captured_at") if state else None,
            run_id=run_id,
        )

    started = time.monotonic()
    collected: set[str] = set()
    scanned_events = 0
    pages = 0
    stalled_pages = 0
    next_request_at = started
    persistence_seconds = 0.0
    waited_seconds = 0.0
    client = None
    try:
        async with NetskopeClient(settings) as client:
            while pages < DLP_CAPTURE_MAX_PAGES:
                if pages:
                    remaining_wait = max(0.0, next_request_at - time.monotonic())
                    if remaining_wait:
                        began_wait = time.monotonic()
                        await asyncio.sleep(remaining_wait)
                        waited_seconds += time.monotonic() - began_wait
                payload = await client.get_dlp_incident_page(operation, index)
                received_at = time.monotonic()
                wait = payload.get("wait_time", 0)
                if isinstance(wait, bool) or not isinstance(wait, (int, float)) or not math.isfinite(wait) or wait < 0:
                    raise NetskopeError("wait_time de incidentes DLP inválido")
                # Processing and committing a page count toward the server's
                # pause. Never add the full pause again after persistence.
                next_request_at = received_at + max(settings.page_delay_seconds, wait)
                rows = incident_rows(payload)
                scanned_events += len(rows)
                page_alerts: dict[str, dict[str, Any]] = {}
                for row in rows:
                    alert = sanitize_dlp_incident(row, now=captured_at)
                    if alert is not None:
                        _merge_alert(page_alerts, alert)
                collected.update(page_alerts)
                previous_end = coverage_end
                coverage_end = payload_high_water_mark(payload, coverage_end)
                pages += 1
                stalled_pages = 0 if coverage_end > previous_end or rows else stalled_pages + 1
                began_persistence = time.monotonic()
                await persist_netskope_dlp_page(
                    pool, run_id, list(page_alerts.values()), iterator_index=index,
                    coverage_start=coverage_start, coverage_end=coverage_end,
                    partial=not is_caught_up(coverage_end, captured_at),
                    scanned_events=scanned_events, captured_alerts=len(collected),
                    captured_at=captured_at,
                )
                persistence_seconds += time.monotonic() - began_persistence
                operation = "next"
                if is_caught_up(coverage_end, captured_at) or stalled_pages >= DLP_MAX_STALLED_PAGES:
                    break
    except NetskopeError as error:
        # Never a payload, value or token: the class plus the client's own
        # message (counts, offsets, status codes), cut short, so a failure leaves a cause.
        LOGGER.warning("La captura de alertas DLP Netskope falló (%s: %s)", error.__class__.__name__, str(error)[:200])
        return {
            "persistence_ms": round(persistence_seconds * 1000),
            "wait_ms": round(waited_seconds * 1000),
            "pages": pages,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "lag_seconds": max(0, int((captured_at - coverage_end).total_seconds())),
            "requests": getattr(client, "request_count", 0),
            "retries": getattr(client, "retry_count", 0),
            "configured": True,
            "scanned_events": scanned_events,
            "captured_alerts": len(collected),
            "partial": True,
            "error": True,
        }

    # A run that read several pages, saw no event and whose progress marker did
    # not move has nothing pending: Netskope has no newer data to hand over. The
    # persisted cursor keeps its place (the next run resumes it), and the lag is
    # still reported, so the run is "idle", not "partial work left to continue".
    idle = stalled_pages >= DLP_MAX_STALLED_PAGES and scanned_events == 0
    partial = not is_caught_up(coverage_end, captured_at) and not idle
    # Retention is time-based, not a reconciliation: expired rows are removed
    # after every successful capture, partial or complete.
    await purge_netskope_dlp_alerts(pool, DLP_RETENTION_DAYS)
    elapsed_ms = round((time.monotonic() - started) * 1000)
    LOGGER.info(
        "Captura DLP Netskope: páginas=%d eventos=%d incidentes=%d duración_ms=%d persistencia_ms=%d espera_ms=%d reintentos=%d parcial=%s sin_novedades=%s",
        pages, scanned_events, len(collected), elapsed_ms, round(persistence_seconds * 1000),
        round(waited_seconds * 1000), getattr(client, "retry_count", 0), partial, idle,
    )
    return {
        "persistence_ms": round(persistence_seconds * 1000),
        "wait_ms": round(waited_seconds * 1000),
        "pages": pages,
        "requests": getattr(client, "request_count", 0),
        "retries": getattr(client, "retry_count", 0),
        "elapsed_ms": elapsed_ms,
        "lag_seconds": max(0, int((captured_at - coverage_end).total_seconds())),
        "configured": True,
        "scanned_events": scanned_events,
        "captured_alerts": len(collected),
        "partial": partial,
        "idle": idle,
        "error": False,
    }
