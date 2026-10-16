"""Persistence for the personal Netskope dashboard."""

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.cross.repositories.audit import record_audit


async def get_netskope_dashboard_preferences(pool: AsyncConnectionPool, actor_id: str):
    return await fetch_one(
        pool,
        """SELECT widgets, data_widgets, chart_widgets, updated_at
           FROM public.user_netskope_dashboard_preferences
           WHERE actor_id = %s""",
        (actor_id,),
    )


async def save_netskope_dashboard_preferences(
    pool: AsyncConnectionPool,
    actor_id: str,
    widgets: list[dict[str, object]],
    data_widgets: list[str],
    chart_widgets: list[str],
):
    """Persist the widget instances plus the legacy id arrays.

    The legacy arrays are written for rollback/older readers; `widgets` is
    the shape the current API returns and the one VIEW-002 adds size and
    order to.
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """SELECT widgets, data_widgets, chart_widgets
                       FROM public.user_netskope_dashboard_preferences
                       WHERE actor_id = %s FOR UPDATE""",
                    (actor_id,),
                )
                before = await cursor.fetchone()
                await cursor.execute(
                    """INSERT INTO public.user_netskope_dashboard_preferences
                           (actor_id, widgets, data_widgets, chart_widgets)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (actor_id) DO UPDATE
                       SET widgets = EXCLUDED.widgets,
                           data_widgets = EXCLUDED.data_widgets,
                           chart_widgets = EXCLUDED.chart_widgets,
                           updated_at = now()
                       RETURNING widgets, data_widgets, chart_widgets, updated_at""",
                    (actor_id, Jsonb(widgets), Jsonb(data_widgets), Jsonb(chart_widgets)),
                )
                saved = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="netskope_dashboard_preferences",
                    entity_id=actor_id,
                    before_data=dict(before) if before else None,
                    after_data={
                        "widgets": saved["widgets"],
                        "data_widgets": saved["data_widgets"],
                        "chart_widgets": saved["chart_widgets"],
                    },
                )
                return saved
