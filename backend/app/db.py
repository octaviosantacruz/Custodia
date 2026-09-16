from collections.abc import Sequence
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


def create_pool(conninfo: str) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        conninfo=conninfo,
        kwargs={"row_factory": dict_row},
        min_size=1,
        max_size=8,
        open=False,
    )


async def fetch_all(pool: AsyncConnectionPool, query: str, params: Sequence[Any] = ()):
    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            return await cursor.fetchall()


async def fetch_one(pool: AsyncConnectionPool, query: str, params: Sequence[Any] = ()):
    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            return await cursor.fetchone()
