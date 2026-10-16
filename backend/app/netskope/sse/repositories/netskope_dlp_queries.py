"""Read-only queries for the minimal DLP alerts (NSK-DLP-001).

User resolution is exact equality between the persisted opaque ``user_id``
and the already-persisted Netskope user inventory (``source_system='netskope'``,
``object_type='user'``). Never by email, display name, prefix or similarity,
and never using attributes copied from the DLP event itself.
"""

from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all, fetch_one
from app.netskope.sse.repositories.netskope_shared import SOURCE_SYSTEM

DLP_WINDOW_DAYS = 30
DLP_BUCKET_LIMIT = 10
DLP_USER_LIMIT = 20
DLP_POLICY_LIMIT = 100
DLP_POLICY_MIX_LIMIT = 4
DLP_RESOLUTION_VALUES = ("", "resolved", "unresolved")

# Shared projection: the LEFT JOIN only ever reads identity fields already
# stored in the Netskope user inventory, never fields from the DLP event.
_USER_JOIN = """
    LEFT JOIN public.cyberark_inventory_objects u
      ON u.source_system = %s
     AND u.object_type = 'user'
     AND u.source_id = a.user_id
"""


async def get_netskope_dlp_capture_state(pool: AsyncConnectionPool) -> dict[str, Any] | None:
    return await fetch_one(
        pool,
        """
        SELECT cache_key, iterator_index, coverage_start, coverage_end, partial,
               scanned_events, captured_alerts, captured_at, last_run_id
        FROM public.netskope_dlp_capture_state
        WHERE cache_key = 'default'
        """,
    )


async def list_netskope_dlp_alerts(
    pool: AsyncConnectionPool,
    *,
    severity: str = "",
    status: str = "",
    action: str = "",
    policy: str = "",
    resolution: str = "",
    user_id: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    if resolution not in DLP_RESOLUTION_VALUES:
        raise ValueError("Filtro de resolución DLP no soportado")
    where = ["a.event_timestamp >= now() - make_interval(days => %s)"]
    params: list[object] = [SOURCE_SYSTEM, DLP_WINDOW_DAYS]
    for expression, value in (
        ("a.severity", severity), ("a.status", status), ("a.action", action), ("a.policy", policy),
    ):
        if value:
            where.append(f"{expression} = %s")
            params.append(value)
    if user_id:
        where.append("a.user_id = %s")
        params.append(user_id)
    if resolution == "resolved":
        where.append("u.object_id IS NOT NULL")
    elif resolution == "unresolved":
        where.append("u.object_id IS NULL")
    rows = await fetch_all(
        pool,
        f"""
        SELECT a.incident_id, a.event_timestamp, a.status, a.severity, a.policy, a.action,
               a.user_id,
               u.object_id AS user_object_id, u.display_name AS user_display_name,
               u.attributes->>'email' AS user_email,
               count(*) OVER ()::int AS total_count
        FROM public.netskope_dlp_alerts a
        {_USER_JOIN}
        WHERE {' AND '.join(where)}
        ORDER BY a.event_timestamp DESC, a.incident_id DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
        # The API contract nests the resolved user (exact match only); an unresolved alert has none.
        object_id = row.pop("user_object_id")
        display_name = row.pop("user_display_name")
        email = row.pop("user_email")
        row["user"] = None if object_id is None else {
            "object_id": object_id, "display_name": display_name or email or "", "email": email,
        }
    return {
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "severity": severity,
        "status": status,
        "action": action,
        "policy": policy,
        "resolution": resolution,
        "user_id": user_id,
    }


async def get_netskope_dlp_policies(
    pool: AsyncConnectionPool, window_days: int = DLP_WINDOW_DAYS, limit: int = DLP_POLICY_LIMIT,
) -> dict[str, Any]:
    """One row per policy name seen in the window: volume, 7-day trend, severity/action mix.

    The policy is the name Netskope stamps on the incident; it is never matched to a policy
    group or rule here (the rules are not readable yet). Alerts without a policy name are
    only counted, so the table never invents a row for them.
    """
    window = "a.event_timestamp >= now() - make_interval(days => %s)"
    named = "nullif(btrim(a.policy), '') IS NOT NULL"
    rows = await fetch_all(
        pool,
        f"""
        SELECT btrim(a.policy) AS policy,
               count(*)::int AS alert_count,
               count(*) FILTER (WHERE a.event_timestamp >= now() - interval '7 days')::int AS last_7d,
               count(*) FILTER (WHERE a.event_timestamp < now() - interval '7 days'
                                  AND a.event_timestamp >= now() - interval '14 days')::int AS previous_7d,
               max(a.event_timestamp) AS latest_event_at,
               count(*) OVER ()::int AS policy_count
        FROM public.netskope_dlp_alerts a
        WHERE {window} AND {named}
        GROUP BY btrim(a.policy)
        ORDER BY count(*) DESC, btrim(a.policy)
        LIMIT %s
        """,
        (window_days, limit),
    )
    names = [row["policy"] for row in rows]
    mixes: dict[str, dict[str, list[dict[str, Any]]]] = {name: {"severity": [], "action": []} for name in names}
    for field in ("severity", "action"):
        for item in await fetch_all(
            pool,
            f"""
            SELECT btrim(a.policy) AS policy, coalesce(nullif(btrim(a.{field}), ''), 'Sin dato') AS key,
                   count(*)::int AS count
            FROM public.netskope_dlp_alerts a
            WHERE {window} AND {named} AND btrim(a.policy) = ANY(%s)
            GROUP BY 1, 2
            ORDER BY count(*) DESC, key
            """,
            (window_days, names),
        ):
            bucket = mixes[item["policy"]][field]
            if len(bucket) < DLP_POLICY_MIX_LIMIT:
                bucket.append({"key": item["key"], "count": item["count"]})
    unnamed = await fetch_one(
        pool,
        f"SELECT count(*)::int AS count FROM public.netskope_dlp_alerts a WHERE {window} AND NOT ({named})",
        (window_days,),
    ) or {}
    return {
        "window_days": window_days,
        "total_policies": rows[0]["policy_count"] if rows else 0,
        "unnamed_alerts": unnamed.get("count", 0),
        "policies": [
            {
                "policy": row["policy"], "alert_count": row["alert_count"], "last_7d": row["last_7d"],
                "previous_7d": row["previous_7d"], "latest_event_at": row["latest_event_at"],
                "by_severity": mixes[row["policy"]]["severity"], "by_action": mixes[row["policy"]]["action"],
            }
            for row in rows
        ],
    }
