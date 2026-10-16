"""Inventory listing, facets, freshness, changes and duplicate queries."""

from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.device_evidence import device_evidence
from app.netskope.sse.repositories.netskope_compliance import (
    CLIENT_COMPLIANCE_BUCKETS, OS_COMPLIANCE_BUCKETS, _client_compliance_case,
    _golden_params, _os_compliance_case,
)
from app.netskope.sse.repositories.netskope_device_reviews import review_filter_clause, reviews_for_objects, suggestion_sql
from app.netskope.sse.repositories.netskope_cross_metrics import list_user_device_activity, list_user_ids_by_device_stats
from app.netskope.sse.repositories.netskope_shared import (
    COVERAGE_RISK_EVENTS, DEVICE_FILTER_EXPRESSIONS, DEVICE_FRESHNESS_DEFAULT,
    DEVICE_FRESHNESS_VALUES, EVENT_AGE_BUCKETS, EVENT_AGE_THRESHOLDS,
    FACET_KEYS, FACET_LIMIT, RECENT_DEVICE_CONDITION, SOURCE_EVIDENCE_CTES, SOURCE_SYSTEM,
    _baseline_value, _bucket, _event_age_case, _version_key, device_evidence_state_sql, get_netskope_source_evidence,
)

# NSK-XMET-001: exact observed-user match for a device row, mirroring the
# per-row LEFT JOIN LATERAL of the listing projection below. Used only by the
# dedicated filters so a KPI drill shows exactly the devices it counted.
_OBSERVED_USER_CANDIDATE_PREDICATE = """
    FROM public.cyberark_inventory_objects candidate
    WHERE candidate.source_system = 'netskope' AND candidate.object_type = 'user' AND candidate.lifecycle_status = 'active'
      AND nullif(btrim(cyberark_inventory_objects.attributes->>'username'), '') IS NOT NULL
      AND (
          lower(btrim(cyberark_inventory_objects.attributes->>'username')) = lower(btrim(candidate.source_id))
          OR lower(btrim(cyberark_inventory_objects.attributes->>'username')) = lower(btrim(candidate.attributes->>'email'))
      )
"""
OBSERVED_USER_STATUSES = frozenset({"matched", "ambiguous", "unmatched"})
OBSERVED_USER_FILTERS = frozenset({"observed_user_status", "observed_user"})

_DEVICE_EVIDENCE_STATE_SQL = device_evidence_state_sql()


def _observed_user_status_case() -> str:
    return f"""CASE
        WHEN (SELECT count(DISTINCT candidate.object_id){_OBSERVED_USER_CANDIDATE_PREDICATE}) = 1 THEN 'matched'
        WHEN (SELECT count(DISTINCT candidate.object_id){_OBSERVED_USER_CANDIDATE_PREDICATE}) > 1 THEN 'ambiguous'
        ELSE 'unmatched'
    END"""


def _observed_user_source_id() -> str:
    return f"(SELECT max(candidate.source_id){_OBSERVED_USER_CANDIDATE_PREDICATE})"


async def list_netskope_objects(
    pool: AsyncConnectionPool, object_type: str, search: str, limit: int, offset: int,
    filters: dict[str, str] | None = None,
    event_age: str = "",
    change: str = "",
    client_compliance: str = "",
    os_compliance: str = "",
    duplicate: str = "",
    freshness: str = DEVICE_FRESHNESS_DEFAULT,
    coverage_risk: str = "",
    device_count: str = "",
    recent_device_age: str = "",
    activity_days: int = 0,
    evidence_state: str = "",
    observed_user_id: int | None = None,
    device_object_id: int | None = None,
    review_diagnosis: str = "",
    review_status: str = "",
    review_attention: str = "",
    review_suggestion: str = "",
    account_status: str = "",
):
    if object_type not in {"user", "device"}:
        raise ValueError("Tipo de objeto Netskope no soportado")
    where = ["source_system = %s", "object_type = %s", "lifecycle_status = 'active'"]
    params: list[object] = [SOURCE_SYSTEM, object_type]
    if evidence_state:
        if object_type != "device" or evidence_state not in {"recent", "not_recent", "review", "unknown"}:
            raise ValueError("Filtro de evidencia de dispositivo no soportado")
        where.append(f"({_DEVICE_EVIDENCE_STATE_SQL}) = %s")
        params.append(evidence_state)
    if review_diagnosis or review_status or review_attention or review_suggestion:
        if object_type != "device":
            raise ValueError("Los filtros de revisión sólo aplican a dispositivos Netskope")
        review_clause, review_params = review_filter_clause(review_diagnosis, review_status, review_attention, review_suggestion)
        where.append(review_clause)
        params.extend(review_params)
    if observed_user_id is not None:
        if object_type != "device" or observed_user_id <= 0:
            raise ValueError("Filtro de usuario observado no soportado")
        where.append(f"({_observed_user_status_case()}) = 'matched' AND (SELECT max(candidate.object_id){_OBSERVED_USER_CANDIDATE_PREDICATE}) = %s")
        params.append(observed_user_id)
    if device_object_id is not None:
        if object_type != "device" or device_object_id <= 0:
            raise ValueError("Filtro de equipo no soportado")
        where.append("object_id = %s")
        params.append(device_object_id)
    if freshness not in DEVICE_FRESHNESS_VALUES:
        raise ValueError("Filtro de frescura Netskope no soportado")
    duplicate_freshness_condition = f" AND {RECENT_DEVICE_CONDITION}" if freshness == "recent" else ""
    if object_type == "device" and freshness == "recent":
        where.append(RECENT_DEVICE_CONDITION)
    if search:
        like = f"%{search}%"
        if object_type == "user":
            where.append("(display_name ILIKE %s OR source_id ILIKE %s OR attributes->>'email' ILIKE %s OR attributes->>'company' ILIKE %s)")
            params.extend([like, like, like, like])
        else:
            where.append("(display_name ILIKE %s OR source_id ILIKE %s OR attributes->>'hostname' ILIKE %s OR attributes->>'username' ILIKE %s OR attributes->>'user_key' ILIKE %s)")
            params.extend([like, like, like, like, like])
    active_filters = {key: value for key, value in (filters or {}).items() if value}
    if active_filters and object_type != "device":
        raise ValueError("Los filtros de atributo sólo aplican a dispositivos Netskope")
    for key, value in active_filters.items():
        if key in OBSERVED_USER_FILTERS:
            # NSK-XMET-001 drills: the same exact match the projection shows.
            if key == "observed_user_status":
                if value not in OBSERVED_USER_STATUSES:
                    raise ValueError("Filtro de usuario observado no soportado")
                where.append(f"({_observed_user_status_case()}) = %s")
            else:
                where.append(f"({_observed_user_status_case()}) = 'matched' AND ({_observed_user_source_id()}) = %s")
            params.append(value)
            continue
        if key not in DEVICE_FILTER_EXPRESSIONS:
            raise ValueError(f"Filtro Netskope no soportado: {key}")
        where.append(f"{_bucket(DEVICE_FILTER_EXPRESSIONS[key])} = %s")
        params.append(value)
    if coverage_risk:
        if object_type != "device" or coverage_risk != "1":
            raise ValueError("Filtro de cobertura en riesgo no soportado")
        where.append("attributes->>'last_seen_event' = ANY(%s)")
        params.append(list(COVERAGE_RISK_EVENTS))
    if account_status:
        # NSK-USR-001: the console's enabled/disabled split, read from accounts[]. "unknown" is a user whose accounts[]
        # was not read, so the three values add up to the users listed.
        if object_type != "user" or account_status not in {"enabled", "disabled", "unknown"}:
            raise ValueError("Filtro de estado de usuario Netskope no soportado")
        if account_status == "unknown":
            where.append("coalesce(attributes->>'account_status', '') NOT IN ('enabled', 'disabled')")
        else:
            where.append("attributes->>'account_status' = %s")
            params.append(account_status)
    if device_count or recent_device_age:
        if object_type != "user":
            raise ValueError("Los filtros por dispositivos del usuario sólo aplican a usuarios Netskope")
        user_ids = await list_user_ids_by_device_stats(pool, device_count=device_count, recent_device_age=recent_device_age)
        where.append("object_id = ANY(%s)")
        params.append(user_ids)
    activity_by_user: dict[int, dict] = {}
    if activity_days:
        if object_type != "user":
            raise ValueError("El filtro de actividad observada sólo aplica a usuarios Netskope")
        activity_rows = await list_user_device_activity(pool, activity_days)
        activity_by_user = {row["object_id"]: row for row in activity_rows}
        where.append("object_id = ANY(%s)")
        params.append(list(activity_by_user))
    if event_age:
        if object_type != "device":
            raise ValueError("El filtro de antigüedad sólo aplica a dispositivos Netskope")
        if event_age not in {key for key, _ in EVENT_AGE_BUCKETS}:
            raise ValueError("Filtro de antigüedad Netskope no soportado")
        where.append(f"({_event_age_case('now()')}) = %s")
        params.append(event_age)
    if change:
        if object_type != "device" or change not in LISTABLE_DEVICE_CHANGES:
            raise ValueError("Filtro de cambios Netskope no soportado")
        where.append(f"source_id IN (WITH {_DEVICE_CHANGES_CTE} SELECT device_id FROM changes WHERE kind = %s)")
        params.append(change)
    if client_compliance:
        if object_type != "device" or client_compliance not in {key for key, _ in CLIENT_COMPLIANCE_BUCKETS}:
            raise ValueError("Filtro de cumplimiento de cliente no soportado")
        baseline = await _baseline_value(pool, "client_golden_releases")
        if not baseline:
            raise ValueError("No hay releases golden configuradas para Netskope")
        where.append(f"({_client_compliance_case()}) = %s")
        params.extend([*_golden_params(baseline["value"]["releases"]), client_compliance])
    if os_compliance:
        if object_type != "device" or os_compliance not in {key for key, _ in OS_COMPLIANCE_BUCKETS}:
            raise ValueError("Filtro de cumplimiento de SO no soportado")
        baseline = await _baseline_value(pool, "os_minimum_versions")
        if not baseline:
            raise ValueError("No hay versiones mínimas de SO configuradas para Netskope")
        minimums = Jsonb(baseline["value"]["minimums"])
        where.append(f"({_os_compliance_case()}) = %s")
        params.extend([minimums, minimums, os_compliance])
    if duplicate:
        if object_type != "device" or duplicate not in DUPLICATE_KEYS:
            raise ValueError("Filtro de posibles duplicados no soportado")
        key = DUPLICATE_KEYS[duplicate]
        where.append(f"""{key} IN (
            SELECT {key} FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'{duplicate_freshness_condition} AND {key} IS NOT NULL
            GROUP BY 1 HAVING count(*) > 1)""")
        params.append(SOURCE_SYSTEM)
    # NSK-XMET-003 lists the most recently active users first.
    if activity_by_user:
        activity_order = list(activity_by_user)
        inner_order = "array_position(%s::int[], object_id)"
        outer_order = "array_position(%s::int[], paged_devices.object_id)"
        order_params: list[object] = [activity_order, activity_order]
    else:
        inner_order = "lower(display_name), object_id"
        outer_order = "lower(paged_devices.display_name), paged_devices.object_id"
        order_params = []
    rows = await fetch_all(pool, f"""
        WITH {SOURCE_EVIDENCE_CTES}, device_rows AS (
            SELECT object_id, display_name, source_id, attributes, first_seen_at, last_seen_at
            FROM public.cyberark_inventory_objects
            WHERE {' AND '.join(where)}
        ), device_total AS (
            SELECT count(*)::int AS total_count FROM device_rows
        ), paged_devices AS MATERIALIZED (
            SELECT *
            FROM device_rows
            ORDER BY {inner_order}
            LIMIT %s OFFSET %s
        )
        SELECT paged_devices.object_id, paged_devices.display_name, paged_devices.source_id,
               paged_devices.attributes, paged_devices.first_seen_at, paged_devices.last_seen_at,
               CASE
                   WHEN observed.candidate_count = 1 THEN 'matched'
                   WHEN observed.candidate_count > 1 THEN 'ambiguous'
                   ELSE 'unmatched'
               END AS observed_user_status,
               CASE WHEN observed.candidate_count = 1 THEN jsonb_build_object(
                   'object_id', observed.object_id,
                   'source_id', observed.source_id,
                   'display_name', observed.display_name,
                   'email', observed.email
               ) ELSE NULL END AS observed_user,
               ({suggestion_sql('paged_devices.object_id')}) AS review_suggestion,
               device_total.total_count,
               source_evidence.evidence_as_of, source_evidence.source_status,
               source_evidence.source_completed_at
        FROM source_evidence CROSS JOIN device_total
        LEFT JOIN paged_devices ON true
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT candidate.object_id)::int AS candidate_count,
                   max(candidate.object_id) AS object_id,
                   max(candidate.source_id) AS source_id,
                   max(candidate.display_name) AS display_name,
                   max(candidate.attributes->>'email') AS email
            FROM public.cyberark_inventory_objects candidate
            WHERE candidate.source_system = %s
              AND candidate.object_type = 'user'
              AND candidate.lifecycle_status = 'active'
              AND nullif(btrim(paged_devices.attributes->>'username'), '') IS NOT NULL
              AND (
                  lower(btrim(paged_devices.attributes->>'username')) = lower(btrim(candidate.source_id))
                  OR lower(btrim(paged_devices.attributes->>'username')) = lower(btrim(candidate.attributes->>'email'))
              )
        ) observed ON TRUE
        ORDER BY {outer_order}
    """, tuple(params + order_params[:1] + [limit, offset, SOURCE_SYSTEM] + order_params[1:]))
    total = rows[0]["total_count"] if rows else 0
    evidence = device_evidence(rows[0]) if rows else None
    source_evidence = {key: evidence[key] for key in ("source_fresh", "source_status", "source_completed_at", "as_of")} if evidence else None
    rows = [row for row in rows if row["object_id"] is not None]
    reviews = await reviews_for_objects(pool, [row["object_id"] for row in rows]) if object_type == "device" else {}
    for row in rows:
        row.pop("total_count", None)
        if object_type == "device":
            row["review"] = reviews.get(row["object_id"])
        if object_type == "device":
            row["device_evidence"] = device_evidence(row)
        for key in ("evidence_as_of", "source_status", "source_completed_at"):
            row.pop(key, None)
        if activity_by_user:
            activity = activity_by_user[row["object_id"]]
            row["device_activity"] = {
                "device_count": activity["device_count"], "latest_device": activity["latest_device"],
                "latest_event": activity["latest_event"], "match_basis": activity["match_basis"],
            }
    return {
        "rows": rows, "total": total, "limit": limit, "offset": offset, "search": search,
        "filters": active_filters, "event_age": event_age, "change": change,
        "freshness": freshness, "activity_days": activity_days,
        "client_compliance": client_compliance, "os_compliance": os_compliance, "duplicate": duplicate,
        "evidence_state": evidence_state, "source_evidence": source_evidence,
        "review_diagnosis": review_diagnosis, "review_status": review_status,
        "review_attention": review_attention, "review_suggestion": review_suggestion,
    }


async def get_netskope_device_facets(pool: AsyncConnectionPool):
    """Distinct values (with counts) per filterable device attribute."""
    facets: dict[str, list[dict[str, object]]] = {}
    for key in FACET_KEYS:
        expression = DEVICE_FILTER_EXPRESSIONS[key]
        facets[key] = await fetch_all(pool, f"""
            SELECT {_bucket(expression)} AS key, count(*)::int AS count
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
            GROUP BY 1
            ORDER BY count(*) DESC, key
            LIMIT %s
        """, (SOURCE_SYSTEM, FACET_LIMIT))
    return facets


async def get_netskope_device_history(pool: AsyncConnectionPool, device_id: str, limit: int = 20):
    rows = await fetch_all(pool, """
        SELECT snapshot_id, source_run_id, captured_at, attributes
        FROM public.netskope_device_snapshots
        WHERE device_id = %s
        ORDER BY captured_at DESC, snapshot_id DESC
        LIMIT %s
    """, (device_id, limit))
    return {"device_id": device_id, "snapshots": rows}


async def get_netskope_device_freshness(pool: AsyncConnectionPool, as_of=None):
    """Devices per last-event age bucket, crossed with classification. This is
    report freshness, not whether a device is on (heartbeat is not used, NSK-HB-001)."""
    rows = await fetch_all(pool, f"""
        WITH reference AS (SELECT coalesce(%s::timestamptz, now()) AS as_of),
        aged AS (
            SELECT {_event_age_case("reference.as_of")} AS age_bucket,
                   {_bucket(DEVICE_FILTER_EXPRESSIONS["classification_status"])} AS classification
            FROM public.cyberark_inventory_objects CROSS JOIN reference
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'
        )
        SELECT age_bucket, classification,
               count(*)::int AS count
        FROM aged
        GROUP BY age_bucket, classification
    """, (as_of, SOURCE_SYSTEM))
    buckets = {
        key: {"key": key, "label": label, "count": 0, "by_classification": []}
        for key, label in EVENT_AGE_BUCKETS
    }
    for row in rows:
        bucket = buckets[row["age_bucket"]]
        bucket["count"] += row["count"]
        bucket["by_classification"].append({"key": row["classification"], "count": row["count"]})
    for bucket in buckets.values():
        bucket["by_classification"].sort(key=lambda item: (-item["count"], item["key"]))
    ordered = list(buckets.values())
    source = await get_netskope_source_evidence(pool)
    return {
        "thresholds": EVENT_AGE_THRESHOLDS,
        "buckets": ordered,
        "total": sum(bucket["count"] for bucket in ordered),
        # The buckets are what the last inventory observed. "Review" is an evaluation and needs a complete,
        # recent sync (the same condition as the review state of the inventory), so without one it is unavailable
        # (None) instead of a historical count presented as current.
        "review_candidates": buckets["gt_30d"]["count"] if source["source_fresh"] else None,
        "source_evidence": source,
    }


async def get_netskope_client_events(pool: AsyncConnectionPool):
    """Distribution of the last event each client reported, flagging the
    exact literals that mean the client was uninstalled or disabled."""
    rows = await fetch_all(pool, f"""
        SELECT {_bucket(DEVICE_FILTER_EXPRESSIONS["last_seen_event"])} AS key, count(*)::int AS count
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active' AND {RECENT_DEVICE_CONDITION}
        GROUP BY 1
        ORDER BY count(*) DESC, key
        LIMIT %s
    """, (SOURCE_SYSTEM, FACET_LIMIT))
    events = [{**row, "coverage_risk": row["key"] in COVERAGE_RISK_EVENTS} for row in rows]
    return {
        "events": events,
        "total": sum(row["count"] for row in events),
        "coverage_risk_total": sum(row["count"] for row in events if row["coverage_risk"]),
        "coverage_risk_events": list(COVERAGE_RISK_EVENTS),
    }


DEVICE_CHANGE_TYPES = ("added", "removed", "upgraded", "downgraded", "version_changed", "os_changed", "classification_changed")
# Retired devices are no longer active, so the devices table cannot list them.
LISTABLE_DEVICE_CHANGES = frozenset(DEVICE_CHANGE_TYPES) - {"removed"}

# Only runs that completed (and therefore reconciled the whole inventory)
# are compared; a failed or partial run never produces "removed" devices.
_DEVICE_CHANGES_CTE = f"""
    device_runs AS (
        SELECT r.run_id, r.started_at
        FROM public.cyberark_ingestion_runs r
        WHERE r.status = 'completed' AND r.source_system = '{SOURCE_SYSTEM}'
          AND EXISTS (SELECT 1 FROM public.netskope_device_snapshots s
                      WHERE s.source_run_id = r.run_id)
        ORDER BY r.started_at DESC, r.run_id DESC
        LIMIT 2
    ),
    runs AS (
        SELECT r.run_id AS source_run_id, r.started_at,
               (SELECT min(s.captured_at) FROM public.netskope_device_snapshots s
                WHERE s.source_run_id = r.run_id) AS captured_at
        FROM device_runs r
    ),
    ranked AS (
        SELECT source_run_id, captured_at, row_number() OVER (ORDER BY started_at DESC, source_run_id DESC) AS position
        FROM runs
    ),
    latest AS (
        SELECT s.device_id, s.attributes FROM public.netskope_device_snapshots s
        JOIN ranked r ON r.source_run_id = s.source_run_id AND r.position = 1
    ),
    previous AS (
        SELECT s.device_id, s.attributes FROM public.netskope_device_snapshots s
        JOIN ranked r ON r.source_run_id = s.source_run_id AND r.position = 2
    ),
    paired AS (
        SELECT coalesce(l.device_id, p.device_id) AS device_id, p.attributes AS before, l.attributes AS after,
               {_version_key("p.attributes")} AS before_version, {_version_key("l.attributes")} AS after_version
        FROM latest l FULL OUTER JOIN previous p ON p.device_id = l.device_id
        WHERE EXISTS (SELECT 1 FROM ranked WHERE position = 2)
    ),
    changes AS (
        SELECT paired.device_id, change.kind,
               coalesce(paired.after->>'hostname', paired.before->>'hostname') AS hostname,
               change.before_value, change.after_value
        FROM paired
        CROSS JOIN LATERAL (VALUES
            ('added', paired.before IS NULL, NULL, paired.after->>'client_version'),
            ('removed', paired.after IS NULL, paired.before->>'client_version', NULL),
            ('upgraded', paired.before IS NOT NULL AND paired.after IS NOT NULL AND paired.after_version > paired.before_version,
                paired.before->>'client_version', paired.after->>'client_version'),
            ('downgraded', paired.before IS NOT NULL AND paired.after IS NOT NULL AND paired.after_version < paired.before_version,
                paired.before->>'client_version', paired.after->>'client_version'),
            ('version_changed', paired.before IS NOT NULL AND paired.after IS NOT NULL
                AND (paired.before_version IS NULL OR paired.after_version IS NULL)
                AND (paired.before->>'client_version') IS DISTINCT FROM (paired.after->>'client_version'),
                paired.before->>'client_version', paired.after->>'client_version'),
            ('os_changed', paired.before IS NOT NULL AND paired.after IS NOT NULL
                AND concat_ws(' ', paired.before->>'os', paired.before->>'os_version') IS DISTINCT FROM concat_ws(' ', paired.after->>'os', paired.after->>'os_version'),
                concat_ws(' ', paired.before->>'os', paired.before->>'os_version'), concat_ws(' ', paired.after->>'os', paired.after->>'os_version')),
            ('classification_changed', paired.before IS NOT NULL AND paired.after IS NOT NULL
                AND (paired.before->>'classification_status') IS DISTINCT FROM (paired.after->>'classification_status'),
                paired.before->>'classification_status', paired.after->>'classification_status')
        ) AS change(kind, applies, before_value, after_value)
        WHERE change.applies
    )
"""


async def get_netskope_device_changes(pool: AsyncConnectionPool, sample_limit: int = 20):
    """What changed between the two most recent completed Netskope runs."""
    kind_values = ", ".join(f"'{kind}'" for kind in DEVICE_CHANGE_TYPES)
    result = await fetch_one(pool, f"""
        WITH {_DEVICE_CHANGES_CTE},
        run_summary AS (
            SELECT coalesce(json_agg(json_build_object(
                       'source_run_id', ranked.source_run_id,
                       'captured_at', ranked.captured_at,
                       'position', ranked.position,
                       'devices', (SELECT count(*) FROM public.netskope_device_snapshots s
                                   WHERE s.source_run_id = ranked.source_run_id)
                   ) ORDER BY ranked.position), '[]'::json) AS runs
            FROM ranked
        ),
        numbered AS (
            SELECT *, count(*) OVER (PARTITION BY kind)::int AS kind_total,
                   row_number() OVER (PARTITION BY kind ORDER BY lower(coalesce(hostname, device_id)), device_id) AS position
            FROM changes
        ),
        change_summary AS (
            SELECT kind, max(kind_total)::int AS total,
                   json_agg(json_build_object(
                       'device_id', device_id,
                       'hostname', hostname,
                       'before_value', before_value,
                       'after_value', after_value
                   ) ORDER BY position) FILTER (WHERE position <= %s) AS samples
            FROM numbered
            GROUP BY kind
        ),
        change_kinds AS (
            SELECT unnest(ARRAY[{kind_values}]::text[]) AS kind
        ),
        change_json AS (
            SELECT json_object_agg(change_kinds.kind, coalesce(change_summary.total, 0)) AS counts,
                   json_object_agg(change_kinds.kind, coalesce(change_summary.samples, '[]'::json)) AS samples
            FROM change_kinds
            LEFT JOIN change_summary USING (kind)
        )
        SELECT run_summary.runs, change_json.counts, change_json.samples
        FROM run_summary
        CROSS JOIN change_json
    """, (sample_limit,))
    runs = result["runs"] if result else []
    if len(runs) < 2:
        return {
            "available": False,
            "completed_runs": len(runs),
            "latest_run": runs[0] if runs else None,
            "previous_run": None,
            "counts": {kind: 0 for kind in DEVICE_CHANGE_TYPES},
            "samples": {kind: [] for kind in DEVICE_CHANGE_TYPES},
        }
    counts = result["counts"]
    samples = result["samples"]
    return {
        "available": True,
        "completed_runs": len(runs),
        "latest_run": runs[0],
        "previous_run": runs[1],
        "counts": counts,
        "samples": samples,
    }


# --- NSK-DUP-001: possible duplicates inside the Netskope source ---

# Exact keys only (no fuzzy matching). Verified read-only on 2026-09-23 that
# repeated hostnames are notebooks (NB-/MB- names, never a VDI pool naming),
# always with the same OS and usually a different user: reassignment or
# reimage. They are labelled "posible duplicado — revisar"; nothing is ever
# merged or retired from here.
DUPLICATE_KEYS = {
    "hostname": "nullif(btrim(attributes->>'hostname'), '')",
    "username": "nullif(lower(btrim(attributes->>'username')), '')",
}


async def get_netskope_duplicates(pool: AsyncConnectionPool, group_limit: int = 12, freshness: str = "all"):
    if freshness not in DEVICE_FRESHNESS_VALUES:
        raise ValueError("Filtro de frescura Netskope no soportado")
    recent_clause = f" AND {RECENT_DEVICE_CONDITION}" if freshness == "recent" else ""
    result: dict[str, Any] = {}
    for name, key in DUPLICATE_KEYS.items():
        summary = await fetch_one(pool, f"""
            SELECT count(*)::int AS groups, coalesce(sum(devices), 0)::int AS devices, coalesce(max(devices), 0)::int AS largest
            FROM (
                SELECT {key} AS key, count(*) AS devices
                FROM public.cyberark_inventory_objects
                WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'{recent_clause} AND {key} IS NOT NULL
                GROUP BY 1 HAVING count(*) > 1
            ) groups
        """, (SOURCE_SYSTEM,))
        groups = await fetch_all(pool, f"""
            SELECT {key} AS key, count(*)::int AS devices,
                   count(DISTINCT {DUPLICATE_KEYS["username" if name == "hostname" else "hostname"]})::int AS distinct_other,
                   max(last_seen_at) AS last_seen_at
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'{recent_clause} AND {key} IS NOT NULL
            GROUP BY 1 HAVING count(*) > 1
            ORDER BY count(*) DESC, key
            LIMIT %s
        """, (SOURCE_SYSTEM, group_limit))
        result[name] = {**(summary or {"groups": 0, "devices": 0, "largest": 0}), "top": groups}
    return result
