from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.cross.repositories.audit import record_audit

DEFAULT_VISIBLE = ["safes"]
MAX_VISIBLE_PER_DOMAIN = 6
# PAM and Admin each keep their own quick-access quota. This aggregate cap
# protects the stored payload while allowing six entries in both active tools.
MAX_VISIBLE = MAX_VISIBLE_PER_DOMAIN * 2
MAX_RECENT = 8


async def get_workspace_preferences(pool: AsyncConnectionPool, actor_id: str) -> dict:
    row = await fetch_one(
        pool,
        """SELECT visible_workspaces, hidden_workspaces, recent_workspaces, updated_at
           FROM public.user_workspace_preferences WHERE actor_id = %s""",
        (actor_id,),
    )
    return row or {
        "visible_workspaces": DEFAULT_VISIBLE,
        "hidden_workspaces": [],
        "recent_workspaces": [],
        "updated_at": None,
    }


async def save_workspace_preferences(
    pool: AsyncConnectionPool,
    actor_id: str,
    *,
    visible_workspaces: list[str],
    hidden_workspaces: list[str],
    recent_workspaces: list[str],
) -> dict:
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    """SELECT visible_workspaces, hidden_workspaces, recent_workspaces
                       FROM public.user_workspace_preferences WHERE actor_id = %s FOR UPDATE""",
                    (actor_id,),
                )
                before = await cursor.fetchone()
                await cursor.execute(
                    """INSERT INTO public.user_workspace_preferences
                         (actor_id, visible_workspaces, hidden_workspaces, recent_workspaces)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (actor_id) DO UPDATE SET
                         visible_workspaces = EXCLUDED.visible_workspaces,
                         hidden_workspaces = EXCLUDED.hidden_workspaces,
                         recent_workspaces = EXCLUDED.recent_workspaces,
                         updated_at = now()
                       RETURNING visible_workspaces, hidden_workspaces, recent_workspaces, updated_at""",
                    (actor_id, Jsonb(visible_workspaces), Jsonb(hidden_workspaces), Jsonb(recent_workspaces)),
                )
                saved = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="update",
                    entity_type="workspace_preferences",
                    entity_id=actor_id,
                    before_data=before,
                    after_data={
                        "visible_workspaces": saved["visible_workspaces"],
                        "hidden_workspaces": saved["hidden_workspaces"],
                        "recent_workspaces": saved["recent_workspaces"],
                    },
                )
                return saved
