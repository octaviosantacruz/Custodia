"""Versioned role templates for personal dashboards (VIEW-006)."""

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all
from app.cross.repositories.audit import record_audit


async def list_actor_dashboard_templates(pool: AsyncConnectionPool, actor_id: str, dashboard_kind: str):
    return await fetch_all(
        pool,
        """
        WITH latest AS (
          SELECT DISTINCT ON (template.role_code)
                 template.role_code, template.version, template.widgets,
                 template.published_at
          FROM public.role_dashboard_templates template
          WHERE template.dashboard_kind = %s
          ORDER BY template.role_code, template.version DESC
        )
        SELECT latest.role_code, role.display_name AS role_name,
               latest.version, latest.widgets, latest.published_at
        FROM latest
        JOIN public.access_user_roles assignment
          ON assignment.role_code = latest.role_code AND assignment.actor_id = %s
        JOIN public.access_roles role ON role.role_code = latest.role_code
        WHERE role.lifecycle_status = 'active'
        ORDER BY role.display_name, latest.role_code
        """,
        (dashboard_kind, actor_id),
    )


async def publish_dashboard_template(
    pool: AsyncConnectionPool,
    actor_id: str,
    role_code: str,
    dashboard_kind: str,
    widgets: list[dict],
):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute(
                    "SELECT display_name FROM public.access_roles WHERE role_code = %s AND lifecycle_status = 'active' FOR UPDATE",
                    (role_code,),
                )
                role = await cursor.fetchone()
                if not role:
                    raise ValueError("El rol no existe o no está activo")
                await cursor.execute(
                    """SELECT COALESCE(MAX(version), 0) + 1 AS version
                       FROM public.role_dashboard_templates
                       WHERE role_code = %s AND dashboard_kind = %s""",
                    (role_code, dashboard_kind),
                )
                version = (await cursor.fetchone())["version"]
                await cursor.execute(
                    """INSERT INTO public.role_dashboard_templates
                           (role_code, dashboard_kind, version, widgets, published_by)
                       VALUES (%s, %s, %s, %s, %s)
                       RETURNING role_code, version, widgets, published_at""",
                    (role_code, dashboard_kind, version, Jsonb(widgets), actor_id),
                )
                saved = await cursor.fetchone()
                await record_audit(
                    pool,
                    connection=conn,
                    actor_id=actor_id,
                    action="publish",
                    entity_type="dashboard_role_template",
                    entity_id=f"{dashboard_kind}:{role_code}:{version}",
                    after_data={"role_code": role_code, "dashboard_kind": dashboard_kind, "version": version, "widgets": widgets},
                )
                return {**saved, "role_name": role["display_name"]}
