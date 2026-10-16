"""COV-002: plan a destination-inventory import by IP + port.

A destination is identified by its IP and port (an empty port is its own key). Importing updates the rows the file
mentions and adds the new ones. In ``update`` mode a row missing from the file is kept as ``retired`` (never deleted),
and a retired row that reappears becomes active again; in ``replace`` mode the snapshot holds only the file. The same
plan feeds the preview and the write, so what an operator confirms is what gets stored.
"""

from __future__ import annotations

import csv
import io
import ipaddress
import logging
from typing import Any

from app.cross.repositories.audit import record_audit
from app.cross.repositories.connection_inventory import (
    DestinationConflict,
    create_destination,
    export_connection_inventory,
    get_coverage_progress,
    import_connection_inventory,
    list_coverage_series,
    save_coverage_snapshot,
    preview_connection_import,
    update_destinations,
)

IMPORT_MODES = ("update", "replace")
WORK_STATUSES = ("pending", "in_progress", "onboarded", "blocked", "not_applicable")
# Set by people in the inventory; a file only overrides them when it carries the column (value not None).
WORK_FIELDS = ("work_status", "responsible", "note")
WORK_DEFAULTS = {"work_status": "pending", "responsible": "", "note": ""}
COMPARED_FIELDS = ("instance_name", "environment", "ca_sia", "ca_dba", "zsp_implemented", "access_available", "description")
LOGGER = logging.getLogger(__name__)
SAMPLE_LIMIT = 25

Key = tuple[str, int | None]


def destination_key(private_ip: str, port: int | None) -> Key:
    return str(ipaddress.ip_address(private_ip.strip())).lower(), port


def _sample(row: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"private_ip": row["private_ip"], "port": row.get("port"), "instance_name": row["instance_name"], **extra}


def plan_connection_import(existing: list[dict[str, Any]], incoming: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    """Return the counts, samples, row errors and the ``rows`` of the resulting snapshot.

    ``existing`` is every row of the current snapshot (active and retired). Each resulting row carries
    ``lifecycle_status`` and ``retired_at`` (``None`` for active, the previous value or ``"now"`` for retired).
    """
    if mode not in IMPORT_MODES:
        raise ValueError("Modo de importación no válido")
    errors: list[dict[str, Any]] = []
    by_key: dict[Key, list[dict[str, Any]]] = {}
    for row in existing:
        by_key.setdefault(destination_key(row["private_ip"], row["port"]), []).append(row)

    seen: dict[Key, int] = {}
    resulting: list[dict[str, Any]] = []
    added: list[dict[str, Any]] = []
    changed: list[dict[str, Any]] = []
    unchanged = 0
    matched_ids: set[int] = set()
    for row in incoming:
        key = destination_key(row["private_ip"], row.get("port"))
        if key in seen:
            errors.append({"row": row["source_row_number"], "message": f"IP y puerto repetidos (ya aparecen en la fila {seen[key]})"})
            continue
        seen[key] = row["source_row_number"]
        previous = (by_key.get(key) or [None])[0]
        new_row = {**row, "lifecycle_status": "active", "retired_at": None}
        for name in WORK_FIELDS:
            if new_row.get(name) is None:
                new_row[name] = previous.get(name, WORK_DEFAULTS[name]) if previous else WORK_DEFAULTS[name]
        resulting.append(new_row)
        if previous is None:
            added.append(_sample(row))
            continue
        matched_ids.add(previous["inventory_id"])
        fields = [name for name in COMPARED_FIELDS if previous.get(name) != row.get(name)]
        fields += [name for name in WORK_FIELDS if row.get(name) is not None and previous.get(name) != row.get(name)]
        reactivated = previous["lifecycle_status"] == "retired"
        if fields or reactivated:
            changed.append(_sample(row, fields=fields, reactivated=reactivated))
        else:
            unchanged += 1

    missing: list[dict[str, Any]] = []
    carried: list[dict[str, Any]] = []
    already_retired = 0
    for row in existing:
        if row["inventory_id"] in matched_ids:
            continue
        if row["lifecycle_status"] == "retired":
            already_retired += 1
            if mode == "update":
                carried.append({**row})
            continue
        missing.append(_sample(row))
        if mode == "update":
            carried.append({**row, "lifecycle_status": "retired", "retired_at": "now"})
    next_number = max((row["source_row_number"] for row in incoming), default=1) + 1
    for row in carried:
        row["source_row_number"] = next_number
        next_number += 1
    resulting.extend(carried)
    return {
        "mode": mode,
        "counts": {
            "incoming": len(incoming), "new": len(added), "changed": len(changed), "unchanged": unchanged,
            "missing": len(missing), "already_retired": already_retired,
        },
        "samples": {"new": added[:SAMPLE_LIMIT], "changed": changed[:SAMPLE_LIMIT], "missing": missing[:SAMPLE_LIMIT]},
        "errors": errors, "rows": resulting,
    }


async def preview_import(pool, rows: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    return await preview_connection_import(pool, rows, mode, plan_connection_import)


COVERAGE_SOURCES = frozenset({"cyberark", "sia"})  # the syncs whose data the coverage reads


async def record_coverage_snapshot(pool, trigger: str) -> None:
    """Best effort: a failed snapshot must never fail the sync or the import that asked for it."""
    try:
        await save_coverage_snapshot(pool, trigger)
    except Exception:  # noqa: BLE001
        LOGGER.warning("No se pudo guardar la foto de cobertura (%s)", trigger, exc_info=True)


async def apply_import(pool, rows: list[dict[str, Any]], file_name: str, mode: str, actor_id: str):
    result = await import_connection_inventory(pool, rows, file_name, mode, actor_id, plan_connection_import)
    await record_coverage_snapshot(pool, "import")
    return result


async def coverage_progress(pool) -> dict[str, Any]:
    """Live counts plus the weekly series of recorded snapshots."""
    return {"current": await get_coverage_progress(pool), "series": await list_coverage_series(pool)}


async def take_coverage_snapshot(pool) -> dict[str, Any]:
    return await save_coverage_snapshot(pool, "manual")


# OWASP: a leading tab or carriage return also makes a spreadsheet read the cell as a formula.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

WORK_STATUS_LABELS = {
    "pending": "Pendiente", "in_progress": "En curso", "onboarded": "Incorporado", "blocked": "Bloqueado", "not_applicable": "No aplica",
}

EXPORT_HEADERS = (
    "Instance Name", "Ambiente", "Private IP", "Puerto", "Platform", "DBA", "Implementado ZSP", "Tengo acceso",
    "Descripción", "Estado de trabajo", "Responsable", "Nota", "Estado", "Cuentas en Safes", "Políticas SIA", "Cobertura observada",
)


def _csv_cell(value: Any) -> Any:
    """Keep exported text from being interpreted as a spreadsheet formula (the importer undoes the prefix)."""
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _flag(value: bool | None) -> str:
    return "" if value is None else "Sí" if value else "No"


def connection_inventory_csv(rows: list[dict[str, Any]]) -> str:
    """CSV with the imported columns first (so it re-imports unchanged) and the observed ones after."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(EXPORT_HEADERS)
    for row in rows:
        safes, policies = row["safe_match_count"], row["sia_match_count"]
        coverage = "Safe + SIA" if safes and policies else "Solo Safe" if safes else "Solo SIA" if policies else "Sin coincidencia"
        writer.writerow([_csv_cell(value) for value in (
            row["instance_name"], row["environment"], row["private_ip"], row["port"],
            _flag(row["ca_sia"]), _flag(row["ca_dba"]), _flag(row["zsp_implemented"]), _flag(row["access_available"]),
            row["description"], WORK_STATUS_LABELS.get(row.get("work_status"), "Pendiente"), row.get("responsible", ""), row.get("note", ""),
            "Activo", safes, policies, coverage,
        )])
    return output.getvalue()


async def export_destinations_csv(pool, actor_id: str) -> str:
    """The audited export: active destinations with the observed PAM/SIA matches."""
    rows = await export_connection_inventory(pool)
    await record_audit(
        pool, actor_id=actor_id, action="export", entity_type="connection_inventory",
        entity_id="current", after_data={"row_count": len(rows)},
    )
    return connection_inventory_csv(rows)


__all__ = ["DestinationConflict"]

EDIT_FIELDS_BULK = ("environment", "ca_sia", "ca_dba", "zsp_implemented", "access_available", "lifecycle_status", "work_status", "responsible", "note")


async def add_destination(pool, values: dict[str, Any], actor_id: str) -> int:
    values = {**WORK_DEFAULTS, **{key: value for key, value in values.items() if value is not None or key not in WORK_FIELDS}, "private_ip": str(ipaddress.ip_address(values["private_ip"].strip()))}
    return await create_destination(pool, values, actor_id, destination_key)


async def edit_destinations(pool, ids: list[int], changes: dict[str, Any], actor_id: str) -> int:
    """Edit one or many destinations. IP, port and instance name are per-destination, never bulk."""
    if not changes:
        raise ValueError("No hay cambios para aplicar")
    if len(set(ids)) > 1 and set(changes) - set(EDIT_FIELDS_BULK):
        raise ValueError("En lote sólo se cambian ambiente, banderas, estado, responsable y nota")
    if "private_ip" in changes:
        changes = {**changes, "private_ip": str(ipaddress.ip_address(changes["private_ip"].strip()))}
    return await update_destinations(pool, ids, changes, actor_id, destination_key)
