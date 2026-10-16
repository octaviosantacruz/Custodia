"""Read-only evidence of client reporting, never ownership or device power state.

The state depends only on the age of the last event the client reported. The
Netskope ``heart_beat`` flag is deliberately not used (NSK-HB-001): it swings
with the time of the sync (about 2,900 devices at night, 4,800 on a weekday
afternoon, for the same fleet) and stays set on devices silent for months.
"""

from datetime import datetime, timezone
from math import isfinite

RECENT_DAYS = 7
REVIEW_DAYS = 30
SOURCE_FRESHNESS_HOURS = 24
# DEM heartbeats are stamped slightly ahead of the real clock (observed: 22-53 devices, up to ~50 min).
# An event at most this far in the future still counts as reported now; beyond it the timestamp is untrusted.
FUTURE_TOLERANCE_SECONDS = 3600


def device_evidence(row: dict) -> dict:
    """Project the narrow device fields and classify against the DB read time.

    last_seen_at is deliberately excluded: it is the inventory sync time,
    not evidence of client use. No classification mutates the observed link.
    """
    attributes = row.get("attributes") or {}
    as_of = row.get("evidence_as_of") or datetime.now(timezone.utc)
    completed_at = row.get("source_completed_at")
    source_status = row.get("source_status")
    fresh = (
        source_status == "completed" and completed_at is not None
        and 0 <= (as_of - completed_at).total_seconds() <= SOURCE_FRESHNESS_HOURS * 3600
    )
    timestamp = attributes.get("last_event_timestamp")
    valid = (
        isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool)
        and 0 < timestamp <= as_of.timestamp() + FUTURE_TOLERANCE_SECONDS and isfinite(timestamp)
    )
    last_signal_at = datetime.fromtimestamp(timestamp, timezone.utc) if valid else None
    age_days = (as_of - last_signal_at).total_seconds() / 86400 if last_signal_at else None
    state = "unknown"
    if not fresh:
        reason = "Sin sincronización Netskope completa y vigente en las últimas 24 h; no se evalúa abandono."
    elif age_days is None:
        reason = "La última señal falta o su fecha es inválida; no se infiere inactividad."
    elif age_days <= RECENT_DAYS:
        state = "recent"
        reason = "El cliente reportó una señal en los últimos 7 días; no demuestra uso humano ni equipo encendido."
    elif age_days > REVIEW_DAYS:
        state = "review"
        reason = "Más de 30 días sin señal: revisar asignación, no dar de baja automáticamente."
    else:
        state = "not_recent"
        reason = "Sin señal en los últimos 7 días; no hay evidencia suficiente para afirmar abandono."
    return {
        "state": state, "reason": reason, "last_signal_at": last_signal_at,
        "age_days": int(age_days) if age_days is not None else None,  # whole days elapsed, never a fraction
        "source_fresh": fresh,
        "source_status": source_status, "source_completed_at": completed_at,
        "as_of": as_of, "recent_days": RECENT_DAYS, "review_days": REVIEW_DAYS,
        "source_freshness_hours": SOURCE_FRESHNESS_HOURS,
        **{key: attributes.get(key) if isinstance(attributes.get(key), str) else ""
           for key in ("client_version", "os", "os_version", "last_seen_event")},
    }
