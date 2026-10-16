"""Sanitized operational failures; deliberately not a raw application log."""

import logging
import re

from psycopg.types.json import Jsonb

from app.db import fetch_all

LOGGER = logging.getLogger(__name__)
_SAFE_ERROR_KIND = re.compile(r"[^A-Za-z0-9_.-]")


def safe_error_kind(error: BaseException) -> str:
    """A stable diagnostic class name without serializing exception text."""
    return _SAFE_ERROR_KIND.sub("", type(error).__name__)[:120] or "UnhandledError"


async def record_operational_error(
    pool,
    *,
    request_id: str,
    method: str,
    path: str,
    error: BaseException,
) -> None:
    """Best effort: a logging failure must never replace the original 500."""
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO public.operational_error_events
                           (request_id, method, path, error_kind, metadata)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (
                        request_id[:128],
                        method.upper()[:10],
                        path[:500],
                        safe_error_kind(error),
                        Jsonb({"source": "api"}),
                    ),
                )
    except Exception:
        LOGGER.warning("No se pudo persistir el error operativo %s", request_id)


async def list_operational_errors(pool, *, limit: int = 50, offset: int = 0, q: str = "") -> dict:
    filters = ["1 = 1"]
    params: list[object] = []
    if q:
        filters.append("(event.request_id ILIKE '%%' || %s || '%%' OR event.path ILIKE '%%' || %s || '%%' OR event.error_kind ILIKE '%%' || %s || '%%')")
        params.extend([q, q, q])
    rows = await fetch_all(pool, f"""
        SELECT event.event_id, event.occurred_at, event.request_id, event.method,
               event.path, event.error_kind, event.status_code, event.metadata,
               count(*) OVER ()::int AS total_count
        FROM public.operational_error_events event
        WHERE {' AND '.join(filters)}
        ORDER BY event.occurred_at DESC, event.event_id DESC
        LIMIT %s OFFSET %s
    """, tuple(params + [limit, offset]))
    total = rows[0]["total_count"] if rows else 0
    for row in rows:
        row.pop("total_count", None)
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}
