"""Business-unit / responsible catalog use cases (ARCH-LAYERS-002).

The route maps ``DuplicateCatalogEntryError`` to HTTP 409; the unique-violation
detection lives here, next to the mutation, instead of in the Controller.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.cyberark.pam.repositories.catalogs import (
    create_business_unit,
    create_responsible,
    get_catalogs,
    is_unique_violation,
    update_business_unit,
    update_responsible,
)


class DuplicateCatalogEntryError(Exception):
    """The unit or responsible already exists."""


async def _unique(operation: Callable[..., Awaitable[Any]], *args: Any) -> Any:
    try:
        return await operation(*args)
    except Exception as exc:
        if is_unique_violation(exc):
            raise DuplicateCatalogEntryError from exc
        raise


async def load_catalogs(pool: AsyncConnectionPool) -> dict:
    return await get_catalogs(pool)


async def add_business_unit(pool: AsyncConnectionPool, unit_code: str, unit_name: str, actor_id: str) -> dict:
    return await _unique(create_business_unit, pool, unit_code, unit_name, actor_id)


async def add_responsible(pool: AsyncConnectionPool, display_name: str, email: str | None, actor_id: str) -> dict:
    return await _unique(create_responsible, pool, display_name, email, actor_id)


async def change_business_unit(pool: AsyncConnectionPool, unit_id: int, payload: Any, actor_id: str) -> dict | None:
    return await _unique(update_business_unit, pool, unit_id, payload, actor_id)


async def change_responsible(pool: AsyncConnectionPool, responsible_id: int, payload: Any, actor_id: str) -> dict | None:
    return await _unique(update_responsible, pool, responsible_id, payload, actor_id)
