#!/usr/bin/env python3
"""Read-only reconciliation of the supplied CyberArk inventory workbook.

The workbook is evidence for review, not an automatic classification command.
Only rows explicitly marked ``INTERNO CYBERARK`` are proposed as internal.
The report intentionally emits aggregate counts and never account identifiers.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import psycopg

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def _column_index(reference: str) -> int:
    letters = re.sub(r"[^A-Za-z]", "", reference)
    value = 0
    for letter in letters.upper():
        value = value * 26 + ord(letter) - 64
    return value - 1


def _workbook_rows(path: Path) -> list[dict[str, str]]:
    with ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(text.text or "" for text in item.iter(f"{{{NS['m']}}}t"))
                for item in root.findall("m:si", NS)
            ]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
        for sheet in workbook.find("m:sheets", NS):
            if sheet.attrib.get("name") != "Account Inventory":
                continue
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]]
            target = target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
            rows = ET.fromstring(archive.read(target)).findall(".//m:sheetData/m:row", NS)
            parsed: list[list[str]] = []
            for row in rows:
                cells: dict[int, str] = {}
                for cell in row.findall("m:c", NS):
                    value = cell.find("m:v", NS)
                    text = "" if value is None else value.text or ""
                    if cell.attrib.get("t") == "s" and text.isdigit():
                        text = shared_strings[int(text)]
                    cells[_column_index(cell.attrib.get("r", ""))] = text.strip()
                parsed.append([cells.get(index, "") for index in range(max(cells, default=-1) + 1)])
            if not parsed:
                return []
            headers = parsed[0]
            return [dict(zip(headers, row, strict=False)) for row in parsed[1:]]
    raise ValueError("No se encontró la hoja 'Account Inventory'")


def _key(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def _load_workbook(path: Path) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    rows = _workbook_rows(path)
    all_pairs = {
        (_key(row.get("Safe")), _key(row.get("Account")))
        for row in rows
        if _key(row.get("Safe")) and _key(row.get("Account"))
    }
    internal_pairs = {
        (_key(row.get("Safe")), _key(row.get("Account")))
        for row in rows
        if _key(row.get("Tipo de Cuenta")) == "interno cyberark"
        and _key(row.get("Safe"))
        and _key(row.get("Account"))
    }
    return all_pairs, internal_pairs


def _report(path: Path, database_url: str | None) -> dict[str, object]:
    all_pairs, internal_pairs = _load_workbook(path)
    result: dict[str, object] = {
        "workbook": str(path),
        "workbook_pairs": len(all_pairs),
        "workbook_internal_pairs": len(internal_pairs),
        "database_checked": bool(database_url),
    }
    if not database_url:
        result["note"] = "DATABASE_URL no está definido; se omitió el cruce con la base."
        return result

    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            SELECT s.safe_name, a.account_name, m.inventory_scope
            FROM public.cyberark_accounts a
            JOIN public.safes s ON s.safe_number = a.safe_number
            LEFT JOIN public.cyberark_safe_metadata m ON m.safe_number = s.safe_number
            WHERE a.lifecycle_status = 'active'
            """
        ).fetchall()
    database_pairs = {(_key(row[0]), _key(row[1])) for row in rows}
    existing_internal = {
        (_key(row[0]), _key(row[1]))
        for row in rows
        if _key(row[2]) == "internal"
    }
    matched_internal_pairs = internal_pairs & database_pairs
    internal_safes = {safe for safe, _account in matched_internal_pairs}
    accounts_by_safe: dict[str, set[tuple[str, str]]] = {}
    for safe, account, _scope in rows:
        accounts_by_safe.setdefault(_key(safe), set()).add((_key(safe), _key(account)))
    workbook_internal_by_safe: dict[str, set[tuple[str, str]]] = {}
    for pair in matched_internal_pairs:
        workbook_internal_by_safe.setdefault(pair[0], set()).add(pair)
    internal_only_safes = {
        safe for safe in internal_safes
        if accounts_by_safe.get(safe, set()) and accounts_by_safe[safe] <= workbook_internal_by_safe.get(safe, set())
    }
    result.update(
        database_pairs=len(database_pairs),
        matched_pairs=len(all_pairs & database_pairs),
        workbook_only_pairs=len(all_pairs - database_pairs),
        database_only_pairs=len(database_pairs - all_pairs),
        internal_pairs_matched=len(matched_internal_pairs),
        internal_pairs_pending_review=len(internal_pairs - database_pairs),
        existing_internal_pairs=len(existing_internal),
        explicit_conflicts=len(matched_internal_pairs - existing_internal),
        matched_internal_safes=len(internal_safes),
        internal_only_safe_candidates=len(internal_only_safes),
        mixed_safe_candidates=len(internal_safes - internal_only_safes),
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Cruza el inventario Excel con la base sin modificar datos")
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()
    if not args.workbook.is_file():
        parser.error(f"No existe el workbook: {args.workbook}")
    print(json.dumps(_report(args.workbook, os.environ.get("DATABASE_URL")), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
