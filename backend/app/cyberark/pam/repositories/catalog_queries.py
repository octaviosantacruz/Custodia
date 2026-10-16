import asyncio

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all

async def get_catalogs(pool: AsyncConnectionPool):
    units, responsibles, account_types = await asyncio.gather(
        fetch_all(pool, """
            SELECT business_unit_id, unit_code, unit_name, is_active
            FROM public.cyberark_business_units
            ORDER BY is_active DESC, unit_name
        """),
        fetch_all(pool, """
            SELECT responsible_id, display_name, email, is_active
            FROM public.cyberark_responsibles
            ORDER BY is_active DESC, display_name
        """),
        fetch_all(pool, """
            SELECT CASE lower(trim(coalesce(m.account_type_classification, '')))
                       WHEN 'nominal' THEN 'Nominal'
                       WHEN 'no_nominal' THEN 'No nominal'
                       WHEN 'internal' THEN 'Interno CyberArk'
                       ELSE 'Sin clasificar'
                   END AS key,
                   count(DISTINCT s.safe_number)::int AS count,
                   count(DISTINCT s.safe_number)::int AS safes
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            WHERE s.lifecycle_status = 'active'
            GROUP BY 1
            ORDER BY key
        """),
    )
    return {"business_units": units, "responsibles": responsibles, "account_types": account_types}
