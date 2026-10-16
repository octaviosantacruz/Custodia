#!/usr/bin/env python3
"""Porcentaje puntual de cuentas compliant según el overview de CyberArk.

Uso: backend/.venv/bin/python scripts/cyberark_compliance.py
Sólo consulta APIs; no persiste cuentas, respuestas ni credenciales.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

from dotenv import load_dotenv
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.cyberark.pam.client import CyberArkClient  # noqa: E402
from app.cyberark.pam.cyberark_errors import CyberArkError  # noqa: E402
from app.cyberark.pam.services.cyberark_settings import CyberArkSettings  # noqa: E402


class ComplianceError(Exception):
    pass


def _safe_cyberark_error(exc: CyberArkError) -> str:
    # La excepción original puede incluir el cuerpo HTTP. Sólo conservamos
    # el status para diagnosticar permisos/endpoints sin exponer la respuesta.
    match = re.search(r"CyberArk respondió HTTP (\d{3})", str(exc))
    if match:
        return f"HTTP {match.group(1)}"
    message = str(exc)
    if message.startswith("No se pudo obtener el token de CyberArk"):
        return "falló OAuth"
    if message.startswith("Error de red llamando a CyberArk"):
        return "error de red"
    if "throttling 429" in message:
        return "HTTP 429"
    if "Paginación incompleta" in message:
        return "paginación incompleta"
    return "error de API"


def _account_ids(accounts: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for account in accounts:
        if not isinstance(account, dict):
            raise ComplianceError("El listado de cuentas tiene un registro inválido")
        account_id = account.get("id")
        if not isinstance(account_id, (str, int)) or isinstance(account_id, bool) or not str(account_id).strip():
            raise ComplianceError("El listado de cuentas tiene un registro sin ID")
        ids.append(str(account_id))
    if len(ids) != len(set(ids)):
        raise ComplianceError("El listado de cuentas contiene IDs duplicados")
    if not ids:
        raise ComplianceError("CyberArk no devolvió cuentas; no se puede calcular un porcentaje")
    return ids


def _is_compliant(overview: dict[str, Any]) -> bool:
    compliance = overview.get("compliance", overview.get("Compliance"))
    if not isinstance(compliance, dict):
        raise ComplianceError("El overview no contiene compliance")
    for key in ("isCompliant", "IsCompliant", "is_compliant"):
        if key in compliance:
            value = compliance[key]
            if isinstance(value, bool):
                return value
            break
    raise ComplianceError("El overview no contiene un isCompliant booleano")


async def calculate(client: CyberArkClient, concurrency: int = 5) -> dict[str, int | float]:
    try:
        accounts, _ = await client.get_accounts()
    except CyberArkError as exc:
        raise ComplianceError(f"No se pudo listar cuentas ({_safe_cyberark_error(exc)})") from None
    ids = _account_ids(accounts)
    semaphore = asyncio.Semaphore(concurrency)

    async def fetch(account_id: str) -> bool:
        async with semaphore:
            overview = await client.get_json(f"/API/ExtendedAccounts/{quote(account_id, safe='')}/overview")
            return _is_compliant(overview)

    # La primera consulta confirma que el tenant admite el endpoint antes de
    # lanzar una consulta por cada cuenta.
    try:
        first = await fetch(ids[0])
    except CyberArkError as exc:
        raise ComplianceError(f"No se pudo consultar el primer overview ({_safe_cyberark_error(exc)})") from None
    results = await asyncio.gather(*(fetch(account_id) for account_id in ids[1:]), return_exceptions=True)
    failures = sum(isinstance(result, BaseException) for result in results)
    if failures:
        raise ComplianceError(f"No se pudo determinar compliance para {failures} cuentas; porcentaje omitido")
    compliant = int(first) + sum(result is True for result in results)
    total = len(ids)
    return {
        "total_accounts": total,
        "compliant_accounts": compliant,
        "non_compliant_accounts": total - compliant,
        "compliance_percent": round(100 * compliant / total, 2),
    }


async def _run(concurrency: int) -> dict[str, int | float]:
    # Cargar credenciales sólo dentro del proceso, sin imprimir el contenido.
    load_dotenv(ROOT / ".env.local", override=False)
    settings = CyberArkSettings.from_environment()
    async with CyberArkClient(settings) as client:
        return await calculate(client, concurrency=concurrency)


def publish(result: dict[str, int | float]) -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ComplianceError("DATABASE_URL es obligatorio para publicar KR6")
    try:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("""INSERT INTO public.cyberark_compliance_snapshot
                    (singleton, total_accounts, compliant_accounts, measured_at)
                    VALUES (TRUE, %s, %s, now())
                    ON CONFLICT (singleton) DO UPDATE SET
                      total_accounts = EXCLUDED.total_accounts,
                      compliant_accounts = EXCLUDED.compliant_accounts,
                      measured_at = EXCLUDED.measured_at""",
                    (result["total_accounts"], result["compliant_accounts"]))
    except psycopg.Error:
        # Driver errors can contain connection strings or server details.
        raise ComplianceError("No se pudo publicar KR6; verificá la migración 051 y la conexión a la base") from None


def main() -> int:
    parser = argparse.ArgumentParser(description="Porcentaje de cuentas compliant informado por CyberArk")
    parser.add_argument("--concurrency", type=int, default=5, help="consultas simultáneas (1 a 10; default: 5)")
    parser.add_argument("--publish", action="store_true", help="guardar sólo el resumen agregado para KR6 en DS Hub")
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 10:
        parser.error("--concurrency debe estar entre 1 y 10")
    try:
        result = asyncio.run(_run(args.concurrency))
        if args.publish:
            publish(result)
    except ComplianceError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except CyberArkError:
        # CyberArkTransport puede incluir parte de una respuesta HTTP en la
        # excepción. No mostrarla: el overview puede traer datos de cuenta.
        print("Error: no se pudo consultar CyberArk. Revisá el acceso del cliente y el endpoint de overview.", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
