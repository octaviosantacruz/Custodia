from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all


async def record_activity_event(
    pool: AsyncConnectionPool,
    *,
    kind: str,
    actor_id: str,
    run_id: str | None = None,
    source_system: str | None = None,
    connection=None,
) -> None:
    query = """INSERT INTO public.activity_events (kind, actor_id, run_id, source_system)
               VALUES (%s, %s, %s, %s)"""
    params = (kind, actor_id, run_id, source_system)
    if connection is not None:
        await connection.execute(query, params)
        return
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(query, params)


async def list_activity_events(
    pool: AsyncConnectionPool,
    *,
    since: int = 0,
    limit: int = 100,
) -> dict:
    rows = await fetch_all(
        pool,
        """
        SELECT event.event_id, event.kind, event.actor_id,
               coalesce(user_account.display_name, event.actor_id) AS actor_name,
               event.run_id::text AS run_id, event.source_system,
               event.created_at
        FROM public.activity_events event
        LEFT JOIN public.access_users user_account
          ON user_account.actor_id = event.actor_id
        WHERE event.event_id > %s
        ORDER BY event.event_id ASC
        LIMIT %s
        """,
        (since, limit),
    )
    return {"rows": rows}
