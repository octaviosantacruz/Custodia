"""Safe/account classification use cases (ARCH-LAYERS-002).

Routes (Controller) call these functions instead of the repositories. The
service owns the domain-level translation of persistence failures: a foreign
key violation on the business-unit/responsible catalogs becomes
``CatalogReferenceError`` so the route only maps it to an HTTP status. SQL and
the audit row of each mutation stay in the repositories, in one transaction.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.cyberark.pam.repositories.account_mutations import update_account_inventory_classification
from app.cyberark.pam.repositories.catalogs import is_foreign_key_violation
from app.cyberark.pam.repositories.safe_mutations import bulk_update_safe_assignment
from app.cyberark.pam.repositories.safes import (
    count_retired_candidates,
    get_retired_candidates,
    list_safe_audit,
    update_safe_account_type,
    update_safe_assignment,
    update_safe_metadata,
    update_safe_quick,
    update_safe_scope,
)


class CatalogReferenceError(Exception):
    """The business unit or responsible referenced by a mutation does not exist."""


async def _with_catalog_check(operation: Callable[..., Awaitable[Any]], *args: Any) -> Any:
    try:
        return await operation(*args)
    except Exception as exc:
        if is_foreign_key_violation(exc):
            raise CatalogReferenceError from exc
        raise


async def classify_account(
    pool: AsyncConnectionPool, safe_number: int, account_id: str, inventory_account_type: Any, actor_id: str,
) -> dict | None:
    return await update_account_inventory_classification(
        pool, safe_number, account_id, inventory_account_type, actor_id,
    )


async def assign_safe(pool: AsyncConnectionPool, safe_number: int, payload: Any, actor_id: str) -> dict | None:
    return await _with_catalog_check(update_safe_assignment, pool, safe_number, payload, actor_id)


async def update_metadata(pool: AsyncConnectionPool, safe_number: int, payload: Any, actor_id: str) -> dict | None:
    return await _with_catalog_check(update_safe_metadata, pool, safe_number, payload, actor_id)


async def bulk_assign_safes(pool: AsyncConnectionPool, payload: Any, actor_id: str) -> dict:
    return await _with_catalog_check(bulk_update_safe_assignment, pool, payload, actor_id)


async def set_scope(pool: AsyncConnectionPool, safe_number: int, payload: Any, actor_id: str) -> dict | None:
    return await update_safe_scope(pool, safe_number, payload, actor_id)


async def set_account_type(pool: AsyncConnectionPool, safe_number: int, payload: Any, actor_id: str) -> dict | None:
    return await update_safe_account_type(pool, safe_number, payload, actor_id)


async def quick_update(pool: AsyncConnectionPool, safe_number: int, payload: Any, actor_id: str) -> dict | None:
    return await update_safe_quick(pool, safe_number, payload, actor_id)


async def safe_audit_rows(pool: AsyncConnectionPool, safe_number: int, limit: int) -> list[dict]:
    return await list_safe_audit(pool, safe_number, limit)


async def retired_candidates(pool: AsyncConnectionPool, limit: int) -> dict:
    return {
        "rows": await get_retired_candidates(pool, limit),
        "total": await count_retired_candidates(pool),
        # Physical deletion is never enabled from the inventory.
        "deletion_enabled": False,
    }
