import psycopg
from psycopg_pool import AsyncConnectionPool
from app.cyberark.pam.schemas import BusinessUnitUpdate, ResponsibleUpdate
from app.cross.repositories.audit import record_audit

async def create_business_unit(pool: AsyncConnectionPool, unit_code: str, unit_name: str, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    INSERT INTO public.cyberark_business_units (unit_code, unit_name)
                    VALUES (%s, %s)
                    RETURNING business_unit_id, unit_code, unit_name, is_active
                """, (unit_code, unit_name))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="create", entity_type="business_unit", entity_id=str(after["business_unit_id"]), after_data=after)
                return after


async def create_responsible(pool: AsyncConnectionPool, display_name: str, email: str, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    INSERT INTO public.cyberark_responsibles (display_name, email)
                    VALUES (%s, %s)
                    RETURNING responsible_id, display_name, email, is_active
                """, (display_name, email.lower()))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="create", entity_type="responsible", entity_id=str(after["responsible_id"]), after_data=after)
                return after


async def update_business_unit(pool: AsyncConnectionPool, business_unit_id: int, payload: BusinessUnitUpdate, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT to_jsonb(b) AS data FROM public.cyberark_business_units b WHERE business_unit_id = %s", (business_unit_id,))
                before = await cursor.fetchone()
                if before is None:
                    return None
                await cursor.execute("""
                    UPDATE public.cyberark_business_units
                    SET unit_code = %s, unit_name = %s, is_active = %s, updated_at = now()
                    WHERE business_unit_id = %s
                    RETURNING business_unit_id, unit_code, unit_name, is_active
                """, (payload.unit_code, payload.unit_name, payload.is_active, business_unit_id))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="business_unit", entity_id=str(business_unit_id), before_data=before["data"], after_data=after)
                return after


async def update_responsible(pool: AsyncConnectionPool, responsible_id: int, payload: ResponsibleUpdate, actor_id: str):
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT to_jsonb(r) AS data FROM public.cyberark_responsibles r WHERE responsible_id = %s", (responsible_id,))
                before = await cursor.fetchone()
                if before is None:
                    return None
                await cursor.execute("""
                    UPDATE public.cyberark_responsibles
                    SET display_name = %s, email = lower(%s), is_active = %s, updated_at = now()
                    WHERE responsible_id = %s
                    RETURNING responsible_id, display_name, email, is_active
                """, (payload.display_name, payload.email, payload.is_active, responsible_id))
                after = await cursor.fetchone()
                await record_audit(pool, connection=conn, actor_id=actor_id, action="update", entity_type="responsible", entity_id=str(responsible_id), before_data=before["data"], after_data=after)
                return after


def is_unique_violation(exc: Exception) -> bool:
    return isinstance(exc, psycopg.errors.UniqueViolation)


def is_foreign_key_violation(exc: Exception) -> bool:
    return isinstance(exc, psycopg.errors.ForeignKeyViolation)
