from __future__ import annotations

import argparse
import asyncio
import json
import os
from uuid import uuid4

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.ingestion import IngestionOptions, run_ingestion


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingesta CyberArk Safes + Members hacia PostgreSQL")
    parser.add_argument("--max-safes", type=int, default=0, help="Limita la corrida para una prueba; 0 = todos")
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--member-delay", type=float, default=0.3)
    parser.add_argument("--reconcile", action="store_true", help="Reconciliar staging; usar solo en corrida completa")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if args.max_safes < 0 or args.page_size < 1 or args.member_delay < 0:
        raise SystemExit("Los parámetros numéricos deben ser no negativos y page-size debe ser positivo")
    if args.reconcile and args.max_safes:
        raise SystemExit("--reconcile requiere una corrida completa, sin --max-safes")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL es obligatorio")

    run_id = uuid4()
    options = IngestionOptions(
        max_safes=args.max_safes,
        page_size=args.page_size,
        member_delay_seconds=args.member_delay,
        reconcile_complete=args.reconcile,
    )
    pool = AsyncConnectionPool(database_url, kwargs={"row_factory": dict_row}, min_size=1, max_size=8, open=False)
    await pool.open()
    await pool.wait()
    try:
        await run_ingestion(pool, options, run_id)
        async with pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""
                    SELECT run_id, status, expected_safe_count, received_safe_count,
                           received_member_count, error_count, error_details
                    FROM public.cyberark_ingestion_runs
                    WHERE run_id = %s
                """, (run_id,))
                row = await cursor.fetchone()
        print(json.dumps(row, default=str, ensure_ascii=False))
    finally:
        await pool.close()


if __name__ == "__main__":
    load_dotenv(".env.local")
    asyncio.run(main())
