"""Durable, sanitized operational events; never a raw application log."""

from psycopg.types.json import Jsonb

from app.db import fetch_all


async def record_operational_log(
    pool,
    *,
    level: str,
    source_system: str,
    event: str,
    message: str,
    run_id=None,
    metadata: dict | None = None,
    connection=None,
) -> None:
    """Best-effort write of a fixed, structured operational event."""
    query = """INSERT INTO public.operational_log_events
        (level, source_system, event, message, run_id, metadata)
        VALUES (%s, %s, %s, %s, %s, %s)"""
    try:
        params = (level, source_system, event, message, run_id, Jsonb(metadata or {}))
        if connection is not None:
            await connection.execute(query, params)
            return
        async with pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(query, params)
    except Exception:
        # Diagnostics must never make the actual synchronization fail.
        return


async def list_operational_logs(
    pool, *, limit: int = 100, offset: int = 0, q: str = "", level: str = "", source_system: str = "",
) -> dict:
    filters = ["1 = 1"]
    params: list[object] = []
    if q:
        filters.append("(log.source_system ILIKE '%%' || %s || '%%' OR log.event ILIKE '%%' || %s || '%%' OR log.message ILIKE '%%' || %s || '%%' OR coalesce(log.run_id::text, '') ILIKE '%%' || %s || '%%')")
        params.extend([q, q, q, q])
    if level:
        filters.append("log.level = %s")
        params.append(level)
    if source_system:
        filters.append("log.source_system = %s")
        params.append(source_system)
    rows = await fetch_all(pool, f"""
        SELECT log.log_id, log.occurred_at, log.level, log.source_system,
               log.event, log.message, log.run_id, log.metadata,
               count(*) OVER ()::int AS total_count
        FROM public.operational_log_events log
        WHERE {' AND '.join(filters)}
        ORDER BY log.occurred_at DESC, log.log_id DESC
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}
