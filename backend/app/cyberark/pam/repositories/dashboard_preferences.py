from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.cross.repositories.audit import record_audit


async def get_dashboard_preferences(pool: AsyncConnectionPool, actor_id: str):
    return await fetch_one(
        pool,
        "SELECT widgets, updated_at FROM public.user_dashboard_preferences WHERE actor_id = %s",
        (actor_id,),
    )


async def save_dashboard_preferences(pool: AsyncConnectionPool, actor_id: str, widgets: list[dict]):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT widgets FROM public.user_dashboard_preferences WHERE actor_id = %s FOR UPDATE",
                    (actor_id,),
                )
                before = await cursor.fetchone()
                await cursor.execute(
                    """INSERT INTO public.user_dashboard_preferences (actor_id, widgets)
                       VALUES (%s, %s)
                       ON CONFLICT (actor_id) DO UPDATE
                       SET widgets = EXCLUDED.widgets, updated_at = now()
                       RETURNING widgets, updated_at""",
                    (actor_id, Jsonb(widgets)),
                )
                saved = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="dashboard_preferences",
                    entity_id=actor_id,
                    before_data={"widgets": before["widgets"]} if before else None,
                    after_data={"widgets": saved["widgets"]},
                )
                return saved
