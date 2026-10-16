"""Read historical Netskope device decisions after classification retired (NSK-INV-002).

Saved decisions remain separate from inventory syncs. Filters, summaries and
suggestions may read them; the application no longer writes classifications.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import (
    COVERAGE_RISK_EVENTS, SOURCE_EVIDENCE_CTES, SOURCE_SYSTEM, get_netskope_source_evidence,
    recent_device_condition, stale_device_condition, valid_event_epoch,
)

DIAGNOSES = (
    "undetermined", "uninstalled_reported", "replaced", "decommissioned",
    "in_use_not_reporting", "historical_record", "temporary_exception",
)
STATUSES = ("pending", "investigating", "ticket_open", "resolved")
# NSK-DEVREV-002: the diagnoses DS Hub can suggest from its own evidence. Everything else is a human decision.
SUGGESTIONS = ("uninstalled_reported", "replaced", "historical_record")
HISTORICAL_DAYS = 180
ATTENTIONS = ("open_incident", "expired_exception", "reported_again")

# An exception past its date is attention-worthy again: the stored status is kept,
# the effective one says pending.
EFFECTIVE_STATUS_SQL = """CASE WHEN r.diagnosis = 'temporary_exception' AND r.exception_expires_at <= now()
    THEN 'pending' ELSE r.status END"""
EXPIRED_EXCEPTION_SQL = "(r.diagnosis = 'temporary_exception' AND r.exception_expires_at <= now())"
_REVIEW_COLUMNS = f"""r.object_id, r.diagnosis, r.status, {EFFECTIVE_STATUS_SQL} AS effective_status,
    (r.diagnosis = 'temporary_exception' AND r.exception_expires_at <= now()) AS exception_expired,
    r.owner, r.reference, r.note, r.exception_expires_at, r.next_review_at, r.evidence,
    r.decided_by, r.decided_at, r.created_at, r.updated_at"""


def _unclassified(object_ref: str) -> str:
    return f"NOT EXISTS (SELECT 1 FROM public.netskope_device_reviews r WHERE r.object_id = {object_ref} AND r.diagnosis <> 'undetermined')"


def suggestion_sql(object_ref: str = "cyberark_inventory_objects.object_id") -> str:
    """The diagnosis DS Hub suggests for a device, or NULL. Needs the source_evidence CTE.

    A suggestion is an evaluation, so it exists only with a complete, recent sync, only for a device
    nobody classified, and only from evidence Netskope reported. Precedence: an uninstall or disable
    event, then a single recent record with the same hostname and user, then more than 180 days with
    no other signal. A hostname or user alone never suggests anything."""
    risk = ", ".join(f"'{event}'" for event in COVERAGE_RISK_EVENTS)
    return f"""CASE
    WHEN NOT (SELECT source_fresh FROM source_evidence) THEN NULL
    WHEN NOT ({stale_device_condition('now()')}) OR ({stale_device_condition('now()')}) IS NULL THEN NULL
    WHEN NOT ({_unclassified(object_ref)}) THEN NULL
    WHEN attributes->>'last_seen_event' IN ({risk}) THEN 'uninstalled_reported'
    WHEN nullif(btrim(attributes->>'hostname'), '') IS NOT NULL AND nullif(btrim(attributes->>'username'), '') IS NOT NULL
         AND (lower(btrim(attributes->>'hostname')), lower(btrim(attributes->>'username'))) IN (
            SELECT lower(btrim(rec.attributes->>'hostname')), lower(btrim(rec.attributes->>'username'))
            FROM public.cyberark_inventory_objects rec
            WHERE rec.source_system = 'netskope' AND rec.object_type = 'device' AND rec.lifecycle_status = 'active'
              AND {recent_device_condition('now()')}
              AND nullif(btrim(rec.attributes->>'hostname'), '') IS NOT NULL AND nullif(btrim(rec.attributes->>'username'), '') IS NOT NULL
            GROUP BY 1, 2 HAVING count(*) = 1) THEN 'replaced'
    WHEN {valid_event_epoch('now()')} < extract(epoch FROM now() - make_interval(days => {HISTORICAL_DAYS})) THEN 'historical_record'
    END"""


def review_filter_clause(diagnosis: str, status: str, attention: str = "", suggestion: str = "") -> tuple[str, list[object]]:
    """WHERE fragment on cyberark_inventory_objects; 'undetermined' includes devices with no decision."""
    clauses: list[str] = []
    params: list[object] = []
    if suggestion:
        if suggestion == "none":
            clauses.extend([
                "(SELECT source_fresh FROM source_evidence)",
                f"({stale_device_condition('now()')})",
                _unclassified("cyberark_inventory_objects.object_id"),
                f"({suggestion_sql()}) IS NULL",
            ])
        elif suggestion in SUGGESTIONS:
            clauses.append(f"({suggestion_sql()}) = %s")
            params.append(suggestion)
        else:
            raise ValueError("Filtro de sugerencia de equipo no soportado")
    if attention:
        if attention not in ATTENTIONS:
            raise ValueError("Filtro de atención de equipo no soportado")
        base = "EXISTS (SELECT 1 FROM public.netskope_device_reviews r WHERE r.object_id = cyberark_inventory_objects.object_id AND "
        if attention == "open_incident":
            clauses.append(f"({stale_device_condition('now()')} AND {base}r.diagnosis = 'in_use_not_reporting' AND ({EFFECTIVE_STATUS_SQL}) <> 'resolved'))")
        elif attention == "expired_exception":
            clauses.append(f"({stale_device_condition('now()')} AND {base}{EXPIRED_EXCEPTION_SQL}))")
        else:
            clauses.append(f"(NOT coalesce({stale_device_condition('now()')}, false) AND {base}r.diagnosis <> 'undetermined' AND {valid_event_epoch('now()')} > extract(epoch FROM r.decided_at)))")
    if diagnosis:
        if diagnosis not in DIAGNOSES:
            raise ValueError("Filtro de diagnóstico de equipo no soportado")
        exists = "EXISTS (SELECT 1 FROM public.netskope_device_reviews r WHERE r.object_id = cyberark_inventory_objects.object_id AND r.diagnosis = %s)"
        if diagnosis == "undetermined":
            clauses.append(f"(NOT EXISTS (SELECT 1 FROM public.netskope_device_reviews r WHERE r.object_id = cyberark_inventory_objects.object_id) OR {exists})")
        else:
            clauses.append(exists)
        params.append(diagnosis)
    if status:
        if status not in STATUSES:
            raise ValueError("Filtro de seguimiento de equipo no soportado")
        clauses.append(f"EXISTS (SELECT 1 FROM public.netskope_device_reviews r WHERE r.object_id = cyberark_inventory_objects.object_id AND ({EFFECTIVE_STATUS_SQL}) = %s)")
        params.append(status)
    return " AND ".join(clauses), params


async def reviews_for_objects(pool: AsyncConnectionPool, object_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not object_ids:
        return {}
    rows = await fetch_all(pool, f"""
        SELECT {_REVIEW_COLUMNS},
               CASE WHEN ({valid_event_epoch('now()')}) > extract(epoch FROM r.decided_at)
                    THEN true ELSE false END AS reported_since_decision
        FROM public.netskope_device_reviews r
        JOIN public.cyberark_inventory_objects o ON o.object_id = r.object_id
        WHERE r.object_id = ANY(%s)
    """, (object_ids,))
    return {row["object_id"]: row for row in rows}


async def get_device_review_summary(pool: AsyncConnectionPool) -> dict[str, Any]:
    """Counts of the devices whose last event is older than 30 days, by diagnosis.

    The buckets are observation: they stay readable whatever the sync state. The unclassified count
    and the suggestions are evaluations and are None without a fresh complete sync. Every figure
    has a listing filter that returns exactly the devices it counts."""
    row = await fetch_one(pool, f"""
        WITH {SOURCE_EVIDENCE_CTES}, devices AS (
            SELECT o.object_id, ({stale_device_condition('now()')}) AS stale,
                   ({valid_event_epoch('now()')}) AS event_epoch,
                   ({suggestion_sql('o.object_id')}) AS suggestion
            FROM public.cyberark_inventory_objects o
            WHERE o.source_system = %s AND o.object_type = 'device' AND o.lifecycle_status = 'active'
        ), joined AS (
            SELECT d.stale, d.event_epoch, d.suggestion, r.diagnosis, r.decided_at, {EFFECTIVE_STATUS_SQL} AS effective_status,
                   {EXPIRED_EXCEPTION_SQL} AS expired
            FROM devices d LEFT JOIN public.netskope_device_reviews r ON r.object_id = d.object_id
        )
        SELECT count(*) FILTER (WHERE stale)::int AS candidates,
               {', '.join(f"count(*) FILTER (WHERE stale AND coalesce(diagnosis, 'undetermined') = '{key}')::int AS {key}" for key in DIAGNOSES)},
               {', '.join(f"count(*) FILTER (WHERE suggestion = '{key}')::int AS suggest_{key}" for key in SUGGESTIONS)},
               count(*) FILTER (WHERE stale AND diagnosis = 'in_use_not_reporting' AND effective_status <> 'resolved')::int AS open_incidents,
               count(*) FILTER (WHERE stale AND expired)::int AS expired_exceptions,
               count(*) FILTER (WHERE NOT coalesce(stale, false) AND diagnosis IS NOT NULL AND diagnosis <> 'undetermined'
                                AND event_epoch > extract(epoch FROM decided_at))::int AS reported_again
        FROM joined
    """, (SOURCE_SYSTEM,))
    evidence = await get_netskope_source_evidence(pool)
    buckets = [{"key": key, "count": row[key]} for key in DIAGNOSES]
    return {
        "candidates": row["candidates"], "buckets": buckets,
        "unclassified": row["undetermined"] if evidence["source_fresh"] else None,
        "suggestions": [{"key": key, "count": row[f"suggest_{key}"]} for key in SUGGESTIONS] if evidence["source_fresh"] else None,
        "historical_days": HISTORICAL_DAYS,
        "open_incidents": row["open_incidents"], "expired_exceptions": row["expired_exceptions"],
        "reported_again": row["reported_again"], "source_evidence": evidence,
    }
