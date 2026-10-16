"""Count-only metrics and alert aggregates for the Netskope inventory."""

from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import (
    DEVICE_COMPANY, DEVICE_FILTER_EXPRESSIONS, RECENT_DEVICE_CONDITION,
    SOURCE_SYSTEM, STALE_DEVICE_CONDITION, USER_COMPANY, _bucket, get_netskope_source_evidence,
)
from app.netskope.sse.metric_contracts import inventory_metric_fields

# VIEW-007: allowlisted per-widget filters. Device filters apply to device
# rows only; company also applies to user rows (USER_COMPANY), never os or
# classification, which a user object does not have.
NETSKOPE_METRIC_FILTERS = {
    "os": DEVICE_FILTER_EXPRESSIONS["os"],
    "company": DEVICE_COMPANY,
    "classification_status": DEVICE_FILTER_EXPRESSIONS["classification_status"],
}

# Match the Netskope inventory freshness window (24 hours); an older aggregate
# remains useful as historical context but must not look current.
ALERT_AGGREGATE_STALE_AFTER = timedelta(hours=24)


def _metric_filter_sql(filters: dict[str, str] | None) -> tuple[list[str], list[str], list[str], list[str]]:
    """Return (device clauses, user clauses, device params, user params)."""
    device_clauses: list[str] = []
    user_clauses: list[str] = []
    device_params: list[str] = []
    user_params: list[str] = []
    for key, raw in (filters or {}).items():
        if key not in NETSKOPE_METRIC_FILTERS:
            raise ValueError(f"Filtro de métricas Netskope no soportado: {key}")
        value = (raw or "").strip()
        if not value:
            continue
        device_clauses.append(f" AND {_bucket(NETSKOPE_METRIC_FILTERS[key])} = %s")
        device_params.append(value)
        if key == "company":
            user_clauses.append(f" AND {_bucket(USER_COMPANY)} = %s")
            user_params.append(value)
    return device_clauses, user_clauses, device_params, user_params


async def get_netskope_alert_aggregates(pool: AsyncConnectionPool) -> dict[str, Any]:
    """Return one completed cohort per window; partial runs are not eligible."""
    rows = await fetch_all(pool, """
        WITH completed_window_runs AS (
            SELECT DISTINCT snapshot.window_days, ingestion_run.run_id, ingestion_run.completed_at
            FROM public.netskope_alert_aggregates AS snapshot
            JOIN public.cyberark_ingestion_runs AS ingestion_run
              ON ingestion_run.run_id = snapshot.source_run_id
            WHERE snapshot.dimension = ANY(%s)
              AND ingestion_run.source_system = %s
              AND ingestion_run.status = 'completed'
              AND ingestion_run.completed_at IS NOT NULL
        ), cohorts AS (
            SELECT DISTINCT ON (window_days) window_days, run_id
            FROM completed_window_runs
            ORDER BY window_days, completed_at DESC, run_id DESC
        )
        SELECT snapshot.window_days, snapshot.window_start, snapshot.window_end,
               snapshot.dimension, snapshot.dimension_value,
               snapshot.alert_count, snapshot.captured_at
        FROM cohorts
        JOIN public.netskope_alert_aggregates AS snapshot
          ON snapshot.source_run_id = cohorts.run_id
         AND snapshot.window_days = cohorts.window_days
        WHERE snapshot.dimension = ANY(%s)
        ORDER BY snapshot.window_days,
                 CASE WHEN snapshot.dimension = 'total' THEN 0 ELSE 1 END,
                 snapshot.dimension, snapshot.dimension_value
    """, (["total", "alert_type", "action"], SOURCE_SYSTEM, ["total", "alert_type", "action"]))
    by_window: dict[int, dict[str, Any]] = {}
    for row in rows:
        window = by_window.setdefault(row["window_days"], {
            "days": row["window_days"],
            "window_start": row["window_start"],
            "window_end": row["window_end"],
            "captured_at": row["captured_at"],
            "total": None,
            "_has_total": False,
            "by_alert_type": [],
            "by_severity": [],
            "by_action": [],
        })
        if row["dimension"] == "total":
            window["total"] = row["alert_count"]
            window["_has_total"] = True
            # The total bucket is the anchor for the capture's date metadata.
            window["window_start"] = row["window_start"]
            window["window_end"] = row["window_end"]
            window["captured_at"] = row["captured_at"]
        else:
            key = f"by_{row['dimension']}"
            window[key].append({"key": row["dimension_value"], "count": row["alert_count"]})
    stale_before = datetime.now(timezone.utc) - ALERT_AGGREGATE_STALE_AFTER
    for window in by_window.values():
        for key in ("by_alert_type", "by_severity", "by_action"):
            window[key].sort(key=lambda item: (-item["count"], item["key"]))
            window[key] = window[key][:10]
        has_total = window.pop("_has_total")
        # A missing denominator is the primary availability signal; stale is
        # reported when a total exists but its capture has aged past the limit.
        if not has_total:
            window["availability"] = "incomplete"
        elif window["captured_at"] < stale_before:
            window["availability"] = "stale"
        else:
            window["availability"] = "complete"
    return {"windows": [by_window[days] for days in (7, 30, 90) if days in by_window]}


async def get_netskope_metrics(
    pool: AsyncConnectionPool, filters: dict[str, str] | None = None, *, widgets: list[str] | None = None,
):
    # No selection preserves the complete public API for existing clients.
    fields = inventory_metric_fields(widgets) if widgets is not None else None
    device_clauses, user_clauses, device_params, user_params = _metric_filter_sql(filters)
    row = await fetch_one(pool, f"""
        WITH reported AS (
            -- NSK-REF-001: Netskope's own user total from the newest completed run that read it; reference only.
            SELECT c.total_users, c.reported_at, c.active_accounts, c.inactive_accounts, c.total_groups, c.total_ous, c.repeated_user_rows
            FROM public.netskope_reported_counts c
            JOIN public.cyberark_ingestion_runs r ON r.run_id = c.source_run_id
            WHERE r.source_system = '{SOURCE_SYSTEM}' AND r.status = 'completed'
            ORDER BY r.completed_at DESC, r.run_id DESC LIMIT 1
        )
        SELECT
            count(*) FILTER (WHERE object_type = 'user')::int AS users_total,
            (SELECT total_users FROM reported) AS users_reported_total,
            (SELECT reported_at FROM reported) AS users_reported_at,
            (SELECT active_accounts FROM reported) AS accounts_reported_active,
            (SELECT inactive_accounts FROM reported) AS accounts_reported_inactive,
            (SELECT total_groups FROM reported) AS groups_reported_total,
            (SELECT total_ous FROM reported) AS ous_reported_total,
            (SELECT repeated_user_rows FROM reported) AS users_repeated_rows,
            -- NSK-USR-001: the console's enabled/disabled split, from accounts[]; users without it stay unknown.
            count(*) FILTER (WHERE object_type = 'user' AND attributes->>'account_status' = 'enabled')::int AS users_enabled,
            count(*) FILTER (WHERE object_type = 'user' AND attributes->>'account_status' = 'disabled')::int AS users_disabled,
            count(*) FILTER (WHERE object_type = 'device')::int AS devices_total,
            -- How many of those report a DEM latido as their last event (vs. a tunnel/system event).
            count(*) FILTER (WHERE object_type = 'device' AND attributes->>'last_seen_event' = 'Dem Heartbeat')::int AS devices_last_event_dem,
            count(*) FILTER (
                WHERE object_type = 'device'
                  AND nullif(btrim(coalesce(attributes->>'username', '')), '') IS NOT NULL
            )::int AS devices_with_observed_user,
            max(last_seen_at) AS last_observed_at
        FROM public.cyberark_inventory_objects
        WHERE source_system = %s AND lifecycle_status = 'active'
          AND (
            (object_type = 'user'{"".join(user_clauses)})
            OR (object_type = 'device' AND {RECENT_DEVICE_CONDITION}{"".join(device_clauses)})
          )
    """, (SOURCE_SYSTEM, *user_params, *device_params))
    metrics = row or {
        "users_total": 0,
        "devices_total": 0,
        "devices_last_event_dem": 0,
        "devices_with_observed_user": 0,
        "last_observed_at": None,
    }
    distribution_specs = {
        "devices_by_os": ("device", DEVICE_FILTER_EXPRESSIONS["os"], 8),
        "devices_by_client": ("device", DEVICE_FILTER_EXPRESSIONS["client_version"], 8),
        "devices_by_make": ("device", "attributes->>'device_make'", 8),
        "devices_by_classification": ("device", DEVICE_FILTER_EXPRESSIONS["classification_status"], 8),
        "devices_by_user_status": ("device", DEVICE_FILTER_EXPRESSIONS["user_status"], 8),
        "devices_by_company": ("device", DEVICE_COMPANY, 40),
        "users_by_company": ("user", USER_COMPANY, 40),
    }
    if fields is not None:
        distribution_specs = {key: spec for key, spec in distribution_specs.items() if key in fields}

    # All selected distributions share one statement/snapshot. GROUPING SETS
    # reads each filtered population once instead of repeating the event-date
    # conversion and inventory scan for every device attribute.
    distribution_queries: list[str] = []
    distribution_params: list[Any] = []
    for object_type in ("device", "user"):
        specs = [(name, expression) for name, (kind, expression, _) in distribution_specs.items() if kind == object_type]
        if not specs:
            continue
        columns = [f"bucket_{index}" for index in range(len(specs))]
        projections = ", ".join(f"{_bucket(expression)} AS {column}" for column, (_, expression) in zip(columns, specs, strict=True))
        labels = " ".join(f"WHEN GROUPING({column}) = 0 THEN '{name}'" for column, (name, _) in zip(columns, specs, strict=True))
        grouping_sets = ", ".join(f"({column})" for column in columns)
        recent_clause = f" AND {RECENT_DEVICE_CONDITION}" if object_type == "device" else ""
        filter_clause = "".join(device_clauses if object_type == "device" else user_clauses)
        filter_values = device_params if object_type == "device" else user_params
        distribution_queries.append(f"""
            SELECT CASE {labels} END AS metric,
                   coalesce({", ".join(columns)}) AS key, count(*)::int AS count
            FROM (
                SELECT {projections}
                FROM public.cyberark_inventory_objects
                WHERE source_system = %s AND object_type = %s AND lifecycle_status = 'active'
                  {recent_clause}{filter_clause}
            ) AS population
            GROUP BY GROUPING SETS ({grouping_sets})
        """)
        distribution_params.extend((SOURCE_SYSTEM, object_type, *filter_values))
    distributions: dict[str, list[dict[str, Any]]] = {name: [] for name in distribution_specs}
    if distribution_queries:
        limits = " ".join(f"WHEN '{name}' THEN %s" for name in distribution_specs)
        distribution_params.extend(spec[2] for spec in distribution_specs.values())
        distribution_rows = await fetch_all(pool, f"""
            WITH buckets AS ({" UNION ALL ".join(distribution_queries)}), ranked AS (
                SELECT metric, key, count,
                       row_number() OVER (PARTITION BY metric ORDER BY count DESC, key) AS position
                FROM buckets
            )
            SELECT metric, key, count FROM ranked
            WHERE position <= CASE metric {limits} END
            ORDER BY metric, count DESC, key
        """, distribution_params)
        for bucket in distribution_rows:
            distributions[bucket["metric"]].append({"key": bucket["key"], "count": bucket["count"]})
    stale = {}
    evidence = await get_netskope_source_evidence(pool) if fields is None or "devices_stale_30d" in fields else None
    if fields is None or "devices_stale_30d" in fields:
        # Outside the recent-device scope of the other counts: these are exactly the
        # devices whose last event is older than 30 days, never inferred from heartbeat.
        stale_row = await fetch_one(pool, f"""
            SELECT count(*)::int AS devices_stale_30d
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'
              AND {STALE_DEVICE_CONDITION}{"".join(device_clauses)}
        """, (SOURCE_SYSTEM, *device_params))
        stale = {"devices_stale_30d": stale_row["devices_stale_30d"] if stale_row else 0}
    if evidence is not None:
        stale["source_evidence"] = evidence
    # NSK-XMET-001: cross user-device KPIs share the same filtered request.
    # Deferred import: the cross module reuses this module's filter builder.
    from app.netskope.sse.repositories.netskope_cross_metrics import get_netskope_cross_metrics

    cross = await get_netskope_cross_metrics(pool, filters) if fields is None else await get_netskope_cross_metrics(pool, filters, fields=fields)
    return {
        **metrics,
        **distributions,
        **stale,
        **cross,
    }
