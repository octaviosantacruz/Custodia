"""Orquesta la ingesta de un Safe: guarda el snapshot crudo, valida y persiste.

El SQL vive en ``repositories/safe_ingestion.py``; aquí sólo se decide el orden
(el crudo se confirma antes de validar) y qué se persiste.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from app.cyberark.pam.repositories.safe_ingestion import persist_safe_entry, retire_stale_inventory, store_raw_entry
from app.cyberark.pam.services.ingestion_compare import _normalize_location, validate_entry


async def ingest_entry(pool: AsyncConnectionPool, run_id: UUID, entry: dict[str, Any], index: int, reconcile_complete: bool = False) -> dict[str, Any]:
    safe_name = entry.get("safeName")
    async with pool.connection() as conn:
        await store_raw_entry(conn, run_id, safe_name, entry)
        validate_entry(entry, index)
        location = _normalize_location(entry["safeData"].get("location"))
        return await persist_safe_entry(conn, run_id, entry, location, reconcile_complete)


async def reconcile_inventory(pool: AsyncConnectionPool, run_id: UUID) -> tuple[int, int]:
    return await retire_stale_inventory(pool, run_id)
