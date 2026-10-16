"""NSK-XMET-001: cross user-device metrics over the exact NSK-DEV-001 match.

A device's normalized ``username`` (lower(btrim)) matches exactly one active
user when it equals that user's normalized ``source_id`` or ``email``; two or
more distinct candidates are ``ambiguous`` and none is ``unmatched``. The
relation is computed once in SQL (hash join against the union of both user
keys, so a user matching through both keys counts once) and every KPI below
only aggregates it. No similarity, no hostname/name join, no persisted
relationship.

Scopes, stated so the panel and its drills agree:
- Device coverage (matched/ambiguous/unmatched) uses the same recent scope as
  the device inventory: an event in the last 7 days.
- ``users_by_device_count``, ``users_by_recent_device_age`` and the coverage
  risk grouping look at the whole active inventory, because their point is to
  surface users with no device and devices the client stopped reporting.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_metrics import _metric_filter_sql
from app.netskope.sse.repositories.netskope_shared import (
    COVERAGE_RISK_EVENTS, EVENT_AGE_BUCKETS, EVENT_AGE_THRESHOLDS,
    RECENT_DEVICE_CONDITION, SOURCE_SYSTEM, observed_user_match_ctes, valid_event_epoch,
)

DEVICE_COUNT_BUCKETS = ("0", "1", "2plus")
RECENT_DEVICE_AGE_KEYS = tuple(key for key, _ in EVENT_AGE_BUCKETS)
RISK_USERS_LIMIT = 10
ACTIVITY_WINDOWS = (7, 14, 30)


def _activity_condition(days: int) -> str:
    """NSK-XMET-001/003 cutoff: the card counts and the drill list filters with this one predicate."""
    return f"device_count > 0 AND newest_event >= now() - make_interval(days => {int(days)})"


def _recent_device_age_case(newest_event: str) -> str:
    """Age bucket of a user's newest device, reusing EVENT_AGE_THRESHOLDS.

    ``unknown`` means the user has devices but none carries a numeric
    ``last_event_timestamp``; users with zero devices are counted by
    ``users_by_device_count`` instead of any age bucket.
    """
    thresholds = EVENT_AGE_THRESHOLDS
    return f"""CASE
        WHEN {newest_event} IS NULL THEN 'unknown'
        WHEN {newest_event} >= now() - make_interval(hours => {int(thresholds['recent_hours'])}) THEN 'lt_24h'
        WHEN {newest_event} >= now() - make_interval(days => {int(thresholds['week_days'])}) THEN 'd1_7'
        WHEN {newest_event} >= now() - make_interval(days => {int(thresholds['stale_days'])}) THEN 'd7_30'
        ELSE 'gt_30d'
    END"""


async def get_netskope_cross_metrics(
    pool: AsyncConnectionPool, filters: dict[str, str] | None = None, *, fields: frozenset[str] | None = None,
) -> dict[str, Any]:
    """Count-only KPIs that cross Netskope users and devices by exact match."""
    device_clauses, user_clauses, device_params, user_params = _metric_filter_sql(filters)
    user_sql = "".join(user_clauses)
    device_sql = "".join(device_clauses)

    status_fields = {
        "devices_observed_user_matched", "devices_observed_user_ambiguous",
        "devices_observed_user_unmatched", "devices_by_observed_user_status",
    }
    user_fields = {
        "users_with_device_activity_7d", "users_with_device_activity_14d", "users_with_device_activity_30d",
        "users_without_observed_devices", "users_by_device_count", "users_by_recent_device_age",
    }
    needs_status = fields is None or bool(fields & status_fields)
    needs_users = fields is None or bool(fields & user_fields)
    needs_risk = fields is None or "coverage_risk_devices_by_user" in fields
    needs_active_total = fields is None or "devices_active_total" in fields
    if not (needs_status or needs_users or needs_risk or needs_active_total):
        return {}

    # All requested user/device metrics observe the same statement snapshot.
    # Keep narrow scopes for standalone widgets; combined requests match once
    # over active devices, then apply each metric's own population predicate.
    device_scope = ""
    scope_params: list[Any] = []
    if needs_status and not (needs_users or needs_risk or needs_active_total):
        device_scope = f" AND {RECENT_DEVICE_CONDITION}"
    elif needs_risk and not (needs_status or needs_users):
        device_scope = " AND attributes->>'last_seen_event' = ANY(%s)"
        scope_params.append(list(COVERAGE_RISK_EVENTS))
    matching_ctes, matching_params = observed_user_match_ctes(
        user_clauses=user_sql, user_params=tuple(user_params),
        device_scope=device_scope, device_clauses=device_sql,
        device_params=tuple([*scope_params, *device_params]),
    )
    ctes = [matching_ctes]
    selections = []
    params = list(matching_params)
    if needs_status:
        selections.append(f"""
            (SELECT row_to_json(counts) FROM (
                SELECT count(*) FILTER (WHERE keys.candidates = 1)::int AS matched,
                       count(*) FILTER (WHERE keys.candidates > 1)::int AS ambiguous,
                       count(*) FILTER (WHERE keys.key IS NULL)::int AS unmatched
                FROM scoped_devices devices
                LEFT JOIN user_keys keys ON keys.key = devices.match_key AND devices.match_key <> ''
                WHERE {RECENT_DEVICE_CONDITION}
            ) counts) AS status
        """)
    if needs_users:
        ctes.append(f"""
            per_user AS (
                SELECT active_users.object_id,
                       count(matched_devices.object_id)::int AS device_count,
                       max(matched_devices.event_time) AS newest_event
                FROM active_users
                LEFT JOIN matched_devices ON matched_devices.user_object_id = active_users.object_id
                GROUP BY active_users.object_id
            ), bucketed AS (
                SELECT device_count, newest_event, {_recent_device_age_case('newest_event')} AS age_bucket
                FROM per_user
            )
        """)
        selections.append(f"""
            (SELECT row_to_json(counts) FROM (
                SELECT
                    count(*) FILTER (
                        WHERE {_activity_condition(7)}
                    )::int AS users_with_device_activity_7d,
                    count(*) FILTER (
                        WHERE {_activity_condition(14)}
                    )::int AS users_with_device_activity_14d,
                    count(*) FILTER (
                        WHERE {_activity_condition(30)}
                    )::int AS users_with_device_activity_30d,
                    count(*) FILTER (WHERE device_count = 0)::int AS zero_devices,
                    count(*) FILTER (WHERE device_count = 1)::int AS one_device,
                    count(*) FILTER (WHERE device_count > 1)::int AS many_devices,
                    count(*) FILTER (WHERE device_count > 0 AND age_bucket = 'lt_24h')::int AS age_lt_24h,
                    count(*) FILTER (WHERE device_count > 0 AND age_bucket = 'd1_7')::int AS age_d1_7,
                    count(*) FILTER (WHERE device_count > 0 AND age_bucket = 'd7_30')::int AS age_d7_30,
                    count(*) FILTER (WHERE device_count > 0 AND age_bucket = 'gt_30d')::int AS age_gt_30d,
                    count(*) FILTER (WHERE device_count > 0 AND age_bucket = 'unknown')::int AS age_unknown
                FROM bucketed
            ) counts) AS per_user
        """)
    if needs_risk:
        selections.append(f"""
            (SELECT coalesce(json_agg(risk), '[]'::json) FROM (
                SELECT active_users.display_name AS key, active_users.source_id AS filter_value,
                       count(*)::int AS count
                FROM matched_devices
                JOIN active_users ON active_users.object_id = matched_devices.user_object_id
                WHERE matched_devices.attributes->>'last_seen_event' = ANY(%s)
                GROUP BY 1, 2
                ORDER BY count DESC, key
                LIMIT {RISK_USERS_LIMIT}
            ) risk) AS risk_rows
        """)
        params.append(list(COVERAGE_RISK_EVENTS))
    if needs_active_total and not (needs_status or needs_users):
        # A total-only widget needs no timestamp conversion or user matching.
        # Risk-only matching remains narrow while its denominator stays whole.
        selections.append(f"""
            (SELECT count(*)::int FROM public.cyberark_inventory_objects
             WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'
               {device_sql}) AS devices_active_total
        """)
        params.extend([SOURCE_SYSTEM, *device_params])
    elif needs_active_total or needs_users:
        selections.append("(SELECT count(*) FROM scoped_devices)::int AS devices_active_total")

    row = await fetch_one(pool, f"WITH {','.join(ctes)} SELECT {','.join(selections)}", tuple(params)) or {}
    status = row.get("status") or {"matched": 0, "ambiguous": 0, "unmatched": 0}
    per_user = {**(row.get("per_user") or {}), "devices_active_total": row.get("devices_active_total", 0)}
    risk_rows = row.get("risk_rows") or []

    result = {
        "devices_observed_user_matched": status["matched"],
        "devices_observed_user_ambiguous": status["ambiguous"],
        "devices_observed_user_unmatched": status["unmatched"],
        # Denominator of the whole-active-inventory groupings (coverage risk).
        "devices_active_total": per_user.get("devices_active_total", 0),
        "users_with_device_activity_7d": per_user.get("users_with_device_activity_7d", 0),
        "users_with_device_activity_14d": per_user.get("users_with_device_activity_14d", 0),
        "users_with_device_activity_30d": per_user.get("users_with_device_activity_30d", 0),
        "devices_by_observed_user_status": [
            {"key": "matched", "count": status["matched"]},
            {"key": "ambiguous", "count": status["ambiguous"]},
            {"key": "unmatched", "count": status["unmatched"]},
        ],
        "users_without_observed_devices": per_user.get("zero_devices", 0),
        "users_by_device_count": [
            {"key": "0", "count": per_user.get("zero_devices", 0)},
            {"key": "1", "count": per_user.get("one_device", 0)},
            {"key": "2plus", "count": per_user.get("many_devices", 0)},
        ],
        "users_by_recent_device_age": [
            {"key": key, "count": per_user.get(f"age_{key}", 0)} for key in RECENT_DEVICE_AGE_KEYS
        ],
        "coverage_risk_devices_by_user": risk_rows,
    }

    if fields is None:
        return result
    available = set()
    if needs_status:
        available.update(status_fields)
    if needs_users:
        available.update(user_fields)
        available.add("devices_active_total")
    if needs_active_total:
        available.add("devices_active_total")
    if needs_risk:
        available.add("coverage_risk_devices_by_user")
    return {key: value for key, value in result.items() if key in available}


async def list_user_ids_by_device_stats(
    pool: AsyncConnectionPool, *, device_count: str = "", recent_device_age: str = ""
) -> list[int]:
    """User object_ids whose matched-device statistics match the drill.

    Used by the inventory user filters so the list shows exactly the users
    the KPI counted; the whole active inventory is considered (no widget
    filters), mirroring the chart. At least one criterion is required.
    """
    if device_count and device_count not in DEVICE_COUNT_BUCKETS:
        raise ValueError(f"Filtro de cantidad de dispositivos no soportado: {device_count}")
    if recent_device_age and recent_device_age not in RECENT_DEVICE_AGE_KEYS:
        raise ValueError(f"Filtro de antigüedad del dispositivo no soportado: {recent_device_age}")
    if not device_count and not recent_device_age:
        raise ValueError("Se requiere un filtro de dispositivos por usuario")

    conditions: list[str] = []
    params: list[Any] = []
    if device_count == "0":
        conditions.append("device_count = 0")
    elif device_count == "1":
        conditions.append("device_count = 1")
    elif device_count == "2plus":
        conditions.append("device_count > 1")
    if recent_device_age:
        conditions.append("device_count > 0")
        conditions.append(f"{_recent_device_age_case('newest_event')} = %s")
        params.append(recent_device_age)

    ctes, cte_params = observed_user_match_ctes()
    rows = await fetch_all(pool, f"""
        WITH {ctes},
        per_user AS (
            SELECT active_users.object_id,
                   count(matched_devices.object_id)::int AS device_count,
                   max(matched_devices.event_time) AS newest_event
            FROM active_users
            LEFT JOIN matched_devices ON matched_devices.user_object_id = active_users.object_id
            GROUP BY active_users.object_id
        )
        SELECT object_id FROM per_user
        WHERE {' AND '.join(conditions)}
        ORDER BY object_id
    """, tuple([*cte_params, *params]))
    return [row["object_id"] for row in rows]


async def list_user_device_activity(pool: AsyncConnectionPool, days: int) -> list[dict[str, Any]]:
    """NSK-XMET-003: users whose exact-matched devices reported within ``days``.

    Same CTEs, whole-active-inventory scope and cutoff as the
    ``users_with_device_activity_*`` cards, so the list length equals the card.
    Ordered by newest observed device event; "activity" is the last event a
    device reported, never a login or a live connection. ``match_basis`` lists
    the exact keys (``source_id``/``email``) that linked the devices.
    """
    if days not in ACTIVITY_WINDOWS:
        raise ValueError(f"Ventana de actividad no soportada: {days}")
    ctes, params = observed_user_match_ctes()
    return await fetch_all(pool, f"""
        WITH {ctes},
        per_user AS (
            SELECT active_users.object_id,
                   count(matched_devices.object_id)::int AS device_count,
                   max(matched_devices.event_time) AS newest_event,
                   (array_agg(
                       coalesce(nullif(btrim(matched_devices.attributes->>'hostname'), ''), matched_devices.attributes->>'username')
                       ORDER BY matched_devices.event_time DESC NULLS LAST, matched_devices.object_id
                   ) FILTER (WHERE matched_devices.object_id IS NOT NULL))[1] AS latest_device,
                   array_remove(ARRAY[
                       CASE WHEN bool_or(matched_devices.match_key = lower(btrim(coalesce(active_users.source_id, '')))) THEN 'source_id' END,
                       CASE WHEN bool_or(matched_devices.match_key = lower(btrim(coalesce(active_users.email, '')))) THEN 'email' END
                   ], NULL) AS match_basis
            FROM active_users
            LEFT JOIN matched_devices ON matched_devices.user_object_id = active_users.object_id
            GROUP BY active_users.object_id
        )
        SELECT object_id, device_count, newest_event AS latest_event, latest_device, match_basis
        FROM per_user
        WHERE {_activity_condition(days)}
        ORDER BY newest_event DESC, object_id
    """, tuple(params))


async def list_retired_users_with_device_activity(pool: AsyncConnectionPool, days: int) -> list[dict[str, Any]]:
    """Retired Netskope users whose exact-matched devices still reported within ``days``.

    These are the identities the console counts as active users but the inventory does
    not (every account is deleted in Netskope). Same exact ``source_id``/``email`` key
    rule as the active match, and a device whose key also belongs to an active user is
    never listed here, so the list and ``users_with_device_activity_*`` are disjoint.
    """
    if days not in ACTIVITY_WINDOWS:
        raise ValueError(f"Ventana de actividad no soportada: {days}")
    return await fetch_all(pool, f"""
        WITH active_keys AS (
            SELECT lower(btrim(k)) AS key
            FROM public.cyberark_inventory_objects,
                 LATERAL unnest(ARRAY[source_id, attributes->>'email']) AS k
            WHERE source_system = %s AND object_type = 'user' AND lifecycle_status = 'active' AND btrim(coalesce(k, '')) <> ''
        ),
        retired_keys AS (
            SELECT key, count(DISTINCT object_id)::int AS candidates, min(object_id) AS user_object_id
            FROM (
                SELECT object_id, lower(btrim(k)) AS key
                FROM public.cyberark_inventory_objects,
                     LATERAL unnest(ARRAY[source_id, attributes->>'email']) AS k
                WHERE source_system = %s AND object_type = 'user' AND lifecycle_status = 'retired' AND btrim(coalesce(k, '')) <> ''
            ) AS keys
            GROUP BY key
        ),
        recent_devices AS (
            SELECT object_id, attributes, lower(btrim(coalesce(attributes->>'username', ''))) AS match_key,
                   to_timestamp(({valid_event_epoch()})::double precision) AS event_time
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'
              AND {valid_event_epoch()} >= extract(epoch FROM now() - make_interval(days => {int(days)}))
        ),
        matched AS (
            SELECT retired_keys.user_object_id, devices.object_id, devices.attributes, devices.event_time
            FROM recent_devices devices
            JOIN retired_keys ON retired_keys.key = devices.match_key AND retired_keys.candidates = 1
            WHERE devices.match_key <> '' AND devices.match_key NOT IN (SELECT key FROM active_keys)
        )
        SELECT users.object_id, users.source_id, users.display_name, users.attributes->>'email' AS email,
               count(DISTINCT matched.object_id)::int AS device_count,
               max(matched.event_time) AS latest_event,
               (array_agg(coalesce(nullif(btrim(matched.attributes->>'hostname'), ''), matched.attributes->>'username')
                          ORDER BY matched.event_time DESC, matched.object_id))[1] AS latest_device
        FROM matched
        JOIN public.cyberark_inventory_objects users ON users.object_id = matched.user_object_id
        GROUP BY users.object_id
        ORDER BY latest_event DESC, users.object_id
    """, (SOURCE_SYSTEM, SOURCE_SYSTEM, SOURCE_SYSTEM))
