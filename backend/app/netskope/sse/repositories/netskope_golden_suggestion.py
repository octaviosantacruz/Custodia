"""Golden release pair suggested from the public Netskope documentation (NSK-GOLDEN-001).

Separate from ``netskope_baselines``: reading the page never changes compliance; an admin confirms through the audited
baseline PUT."""

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one


async def save_golden_suggestion(pool: AsyncConnectionPool, releases: list[str], source_url: str, run_id: UUID | None) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            """INSERT INTO public.netskope_golden_suggestion (singleton, releases, source_url, fetched_at, source_run_id)
               VALUES (TRUE, %s, %s, now(), %s)
               ON CONFLICT (singleton) DO UPDATE
                   SET releases = EXCLUDED.releases, source_url = EXCLUDED.source_url,
                       fetched_at = EXCLUDED.fetched_at, source_run_id = EXCLUDED.source_run_id""",
            (Jsonb(releases), source_url, run_id),
        )


async def get_golden_suggestion(pool: AsyncConnectionPool) -> dict[str, Any] | None:
    return await fetch_one(pool, "SELECT releases, source_url, fetched_at FROM public.netskope_golden_suggestion")
