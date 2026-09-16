from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from .cyberark import CyberArkClient, CyberArkError, CyberArkSettings
from .pam_inventory import sync_pam_inventory
from .services.ingestion_compare import compare_inventory, validate_entry
from .services.ingestion_persistence import ingest_entry, reconcile_inventory
from .services.ingestion_source import fetch_safe_members, fetch_safes
from .repositories.ingestion import current_inventory, create_ingestion_run, finish_ingestion_run, update_ingestion_expected
from .repositories.findings import refresh_findings


LOGGER = logging.getLogger(__name__)
@dataclass(frozen=True)
class IngestionOptions:
    max_safes: int = 0
    page_size: int = 100
    member_delay_seconds: float = 0.3
    reconcile_complete: bool = False
    psm_only: bool = False


def should_sync_pam(options: IngestionOptions, errors: list[dict[str, str]]) -> bool:
    """PAM can only be refreshed from a complete, error-free Safe snapshot."""
    return not options.max_safes and not errors


async def preview_ingestion(pool: AsyncConnectionPool, options: IngestionOptions) -> dict[str, Any]:
    current_safes, current_members = await current_inventory(pool)
    settings = CyberArkSettings.from_environment()
    async with CyberArkClient(settings) as client:
        incoming_safes, reported_count = await fetch_safes(
            client, page_size=options.page_size, max_safes=options.max_safes, reject_duplicates=True
        )
        incoming_members: list[dict[str, Any]] = []
        for index, safe_data in enumerate(incoming_safes):
            safe_name, members = await fetch_safe_members(
                client, safe_data, page_size=options.page_size,
                delay_seconds=options.member_delay_seconds, index=index
            )
            entry = {"safeName": safe_name, "safeData": safe_data, "members": members}
            validate_entry(entry, index)
            member_keys = [(item.get("safeNumber"), item.get("memberId")) for item in members]
            if len(member_keys) != len(set(member_keys)):
                raise CyberArkError(f"{safe_name}: CyberArk devolvió memberId duplicado; se cancela el preview")
            incoming_members.extend(members)

    comparison = compare_inventory(current_safes, current_members, incoming_safes, incoming_members)
    comparison.update({
        "reported_safe_count": reported_count,
        "complete_snapshot": not bool(options.max_safes),
        "can_reconcile": not bool(options.max_safes),
        "warning": "La corrida limitada no puede marcar ausencias como retiradas." if options.max_safes else None,
    })
    return comparison


async def run_ingestion(
    pool: AsyncConnectionPool,
    options: IngestionOptions,
    run_id: UUID,
    triggered_by: str | None = None,
    *,
    run_already_claimed: bool = False,
) -> None:
    triggered_by = triggered_by or "system:ingestion"
    errors: list[dict[str, str]] = []
    safe_count = 0
    member_count = 0
    breakdown: dict[str, int | bool] = {
        "safes_created": 0, "safes_updated": 0, "safes_retired": 0,
        "members_created": 0, "members_updated": 0, "members_retired": 0,
        "pam_synced": False,
    }
    if not run_already_claimed:
        await create_ingestion_run(pool, run_id, triggered_by=triggered_by)

    try:
        settings = CyberArkSettings.from_environment()
        async with CyberArkClient(settings) as client:
            safes, reported_count = await fetch_safes(
                client, page_size=options.page_size, max_safes=options.max_safes
            )
            expected_count = len(safes) if options.max_safes else reported_count or len(safes)
            await update_ingestion_expected(pool, run_id, expected_count)

            for index, safe_data in enumerate(safes):
                safe_name = safe_data.get("safeName", f"entry-{index}")
                try:
                    fetched_name, members = await fetch_safe_members(
                        client, safe_data, page_size=options.page_size,
                        delay_seconds=options.member_delay_seconds, index=index
                    )
                    result = await ingest_entry(pool, run_id, {"safeName": fetched_name, "safeData": safe_data, "members": members}, index, options.reconcile_complete)
                    safe_count += 1
                    member_count += result["member_count"]
                    breakdown["safes_created"] += 1 if result["safe_inserted"] else 0
                    breakdown["safes_updated"] += 0 if result["safe_inserted"] else 1
                    breakdown["members_created"] += result["members_inserted"]
                    breakdown["members_updated"] += result["members_updated"]
                except Exception as exc:
                    errors.append({"safeName": str(safe_name), "error": str(exc)})

            if options.reconcile_complete:
                if options.max_safes:
                    raise ValueError("reconcile_complete requiere una corrida completa, no max_safes")
                if errors:
                    raise ValueError("No se reconcilia una corrida con errores")
                retired_members, retired_safes = await reconcile_inventory(pool, run_id)
                breakdown["members_retired"] += retired_members
                breakdown["safes_retired"] += retired_safes

            # PAM requires the complete, current Safe snapshot. A limited or
            # error-bearing Safe ingestion must not refresh this graph.
            if should_sync_pam(options, errors):
                try:
                    pam_result = await sync_pam_inventory(pool, run_id, page_size=options.page_size)
                    LOGGER.info("Ingesta PAM %s completada: %s", run_id, pam_result)
                    breakdown["pam_synced"] = True
                except Exception as exc:
                    errors.append({"safeName": "<pam>", "error": str(exc)})
    except Exception as exc:
        errors.append({"safeName": "<run>", "error": str(exc)})

    status = "completed" if not errors else ("failed" if safe_count == 0 else "partial")
    await finish_ingestion_run(pool, run_id, status, safe_count, member_count, errors, breakdown)
    try:
        await refresh_findings(pool, run_id)
    except Exception:
        LOGGER.exception("No se pudieron actualizar los hallazgos de la corrida %s", run_id)
