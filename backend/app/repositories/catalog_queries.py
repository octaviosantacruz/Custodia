import asyncio

from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all

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
            SELECT type.key,
                   count(DISTINCT s.safe_number)::int AS count,
                   count(DISTINCT s.safe_number)::int AS safes
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            LEFT JOIN LATERAL jsonb_each_text(coalesce(m.inventory_account_types, '{}'::jsonb)) AS type(key, value) ON true
            WHERE s.lifecycle_status = 'active'
            GROUP BY type.key
            UNION ALL
            SELECT 'Sin clasificar' AS key, count(*)::int AS count, count(*)::int AS safes
            FROM public.safes s
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            WHERE s.lifecycle_status = 'active'
              AND coalesce(m.inventory_account_types, '{}'::jsonb) = '{}'::jsonb
            HAVING count(*) > 0
            ORDER BY key
        """),
    )
    return {"business_units": units, "responsibles": responsibles, "account_types": account_types}
