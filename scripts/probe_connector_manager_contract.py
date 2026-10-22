#!/usr/bin/env python3
"""Inspect the approved CMGR-001 catalog without printing tenant values or payloads."""

import argparse
import asyncio
from dataclasses import replace
import json
import os
from pathlib import Path
import sys

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.cyberark.connector_manager.integrations.connector_manager import (  # noqa: E402
    ConnectorManagerClient,
    ConnectorManagerError,
    ConnectorManagerSettings,
)
from app.cyberark.connector_manager.services.catalogs import get_catalog  # noqa: E402


async def probe(page_size: int) -> None:
    settings = replace(ConnectorManagerSettings.from_environment(), page_size=page_size)
    async with ConnectorManagerClient(settings) as client:
        for catalog in ("pools", "networks"):
            result = await get_catalog(client, catalog)
            print(json.dumps({
                "source_system": result["source_system"], "catalog": catalog,
                "queried_at": result["queried_at"], "total": result["total"],
                "page_size": page_size,
                "public_fields": sorted(result["rows"][0]) if result["rows"] else [],
            }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page-size", type=int, default=100, help="Filas por página (1–100); usar 2 para comprobar continuación.")
    args = parser.parse_args()
    if not 1 <= args.page_size <= 100:
        parser.error("--page-size debe estar entre 1 y 100")
    load_dotenv(Path(os.getenv("ENV_FILE", ROOT / ".env.local")), override=False)
    try:
        asyncio.run(probe(args.page_size))
    except ConnectorManagerError:
        raise SystemExit("Connector Manager: consulta no disponible; revisar configuración, acceso o contrato.") from None
