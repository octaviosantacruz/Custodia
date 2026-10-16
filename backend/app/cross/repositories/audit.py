from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.repositories.activity_events import record_activity_event


CLASSIFICATION_ENTITY_TYPES = {
    "account_inventory_classification",
    "safe_account_type",
    "safe_assignment",
    "safe_metadata",
    "safe_scope",
}


def activity_event_kind(action: str, entity_type: str) -> str | None:
    # Activity keeps every lifecycle transition durably. The lightweight
    # cross-session stream is intentionally quieter: a run is useful to an
    # observer only once its result is known, and notifying earlier can
    # interrupt an active workspace multiple times for one synchronization.
    if action == "sync_complete" and entity_type == "ingestion_run":
        return "sync"
    if action == "import" and entity_type == "connection_inventory":
        return "import"
    if action in {"update", "bulk_update"} and entity_type in CLASSIFICATION_ENTITY_TYPES:
        return "classification"
    return None


_ACTIVITY_FROM = """
        FROM public.access_audit_log a
        LEFT JOIN public.access_users u ON u.actor_id = a.actor_id
        LEFT JOIN public.cyberark_business_units bu
          ON a.entity_type = 'business_unit' AND bu.business_unit_id::text = a.entity_id
        LEFT JOIN public.cyberark_responsibles r
          ON a.entity_type = 'responsible' AND r.responsible_id::text = a.entity_id
"""

_ACTIVITY_COLUMNS = """
        SELECT a.audit_id, a.actor_id,
               coalesce(u.display_name, a.actor_id) AS actor_name,
               a.action, a.entity_type, a.entity_id,
               CASE a.entity_type
                   WHEN 'business_unit' THEN coalesce(bu.unit_name, bu.unit_code)
                   WHEN 'responsible' THEN coalesce(r.display_name, r.email)
                   WHEN 'ingestion_run' THEN a.after_data->>'source_system'
                   ELSE NULL
               END AS entity_name,
               a.before_data - 'password_hash' AS before_data,
               a.after_data - 'password_hash' AS after_data,
               a.created_at
"""


def _activity_filters(action: str, entity_type: str, q: str) -> tuple[str, list[object]]:
    filters = ["1 = 1"]
    params: list[object] = []
    if action:
        filters.append("a.action = %s")
        params.append(action)
    if entity_type:
        filters.append("a.entity_type = %s")
        params.append(entity_type)
    if q:
        filters.append(
            "(a.actor_id ILIKE '%%' || %s || '%%' OR coalesce(u.display_name, '') ILIKE '%%' || %s || '%%' "
            "OR a.entity_id ILIKE '%%' || %s || '%%' OR coalesce(bu.unit_code, '') ILIKE '%%' || %s || '%%' "
            "OR coalesce(bu.unit_name, '') ILIKE '%%' || %s || '%%' OR coalesce(r.display_name, '') ILIKE '%%' || %s || '%%')"
        )
        params.extend([q, q, q, q, q, q])
    return " AND ".join(filters), params


async def list_activity(
    pool: AsyncConnectionPool,
    *,
    limit: int = 50,
    offset: int = 0,
    action: str = "",
    entity_type: str = "",
    q: str = "",
):
    where, params = _activity_filters(action, entity_type, q)
    rows = await fetch_all(
        pool,
        f"""
        {_ACTIVITY_COLUMNS},
               count(*) OVER ()::int AS total_count
        {_ACTIVITY_FROM}
        WHERE {where}
        ORDER BY a.created_at DESC, a.audit_id DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


async def export_activity(
    pool: AsyncConnectionPool,
    *,
    limit: int,
    action: str = "",
    entity_type: str = "",
    q: str = "",
):
    """Same filters as the listing, newest first, capped; also returns the unfiltered-by-cap total."""
    where, params = _activity_filters(action, entity_type, q)
    rows = await fetch_all(
        pool,
        f"""
        {_ACTIVITY_COLUMNS},
               count(*) OVER ()::int AS total_count
        {_ACTIVITY_FROM}
        WHERE {where}
        ORDER BY a.created_at DESC, a.audit_id DESC
        LIMIT %s
        """,
        tuple(params + [limit]),
    )
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total}


async def record_audit(
    pool: AsyncConnectionPool,
    *,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    before_data: dict | None = None,
    after_data: dict | None = None,
    connection=None,
    dumps=None,
) -> None:
    from psycopg.types.json import Jsonb

    query = "INSERT INTO public.access_audit_log (actor_id, action, entity_type, entity_id, before_data, after_data) VALUES (%s, %s, %s, %s, %s, %s)"
    to_jsonb = lambda value: Jsonb(value, dumps=dumps) if dumps is not None else Jsonb(value)
    params = (actor_id, action, entity_type, entity_id, to_jsonb(before_data) if before_data is not None else None, to_jsonb(after_data) if after_data is not None else None)
    if connection is not None:
        await connection.execute(query, params)
        event_kind = activity_event_kind(action, entity_type)
        if event_kind is not None:
            await record_activity_event(
                pool,
                connection=connection,
                kind=event_kind,
                actor_id=actor_id,
                run_id=entity_id if event_kind == "sync" else None,
                source_system=(after_data or {}).get("source_system") if event_kind == "sync" else None,
            )
        return
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(query, params)
            event_kind = activity_event_kind(action, entity_type)
            if event_kind is not None:
                await record_activity_event(
                    pool,
                    connection=conn,
                    kind=event_kind,
                    actor_id=actor_id,
                    run_id=entity_id if event_kind == "sync" else None,
                    source_system=(after_data or {}).get("source_system") if event_kind == "sync" else None,
                )
