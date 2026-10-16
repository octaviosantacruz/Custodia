"""Construye el pool PostgreSQL y ofrece helpers de consulta compartidos.

Los repositorios propietarios definen el SQL y las transacciones. El pool
acepta conninfo dinámico para recuperar credenciales rotadas sin reiniciar.
Nunca registrar la cadena de conexión ni sus credenciales.
"""

from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

# Default matches psycopg_pool's own retry cadence but caps the time a
# rotated-but-unrecovered credential keeps failing silently before
# `reconnect_failed` gets a chance to fetch the new one (see
# DatabaseCredentialProvider). psycopg_pool's own default is 300s.
DEFAULT_RECONNECT_TIMEOUT_SECONDS = 60.0

ReconnectFailedHook = Callable[[AsyncConnectionPool], Awaitable[None]]


def create_pool(
    conninfo: str | Callable[[], str],
    *,
    reconnect_failed: ReconnectFailedHook | None = None,
    reconnect_timeout: float = DEFAULT_RECONNECT_TIMEOUT_SECONDS,
) -> AsyncConnectionPool:
    """Build the app's connection pool.

    ``conninfo`` accepts a plain string or a zero-argument callable;
    psycopg_pool calls a callable fresh on every new connection attempt,
    which is what lets ``DatabaseCredentialProvider`` swap in a rotated
    password without recreating the pool.
    """
    return AsyncConnectionPool(
        conninfo=conninfo,
        kwargs={"row_factory": dict_row},
        min_size=1,
        max_size=8,
        open=False,
        reconnect_timeout=reconnect_timeout,
        reconnect_failed=reconnect_failed,
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
