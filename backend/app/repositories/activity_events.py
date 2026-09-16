from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all


async def record_activity_event(
    pool: AsyncConnectionPool,
    *,
    kind: str,
    actor_id: str,
    connection=None,
) -> None:
    query = """INSERT INTO public.activity_events (kind, actor_id)
               VALUES (%s, %s)"""
    if connection is not None:
        await connection.execute(query, (kind, actor_id))
        return
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(query, (kind, actor_id))


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
