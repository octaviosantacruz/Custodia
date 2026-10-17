#!/usr/bin/env python3
"""Apply repository migrations with a tracked, idempotent runner."""
from __future__ import annotations

import os
from pathlib import Path
import re
import sys

import psycopg

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.cross.services.database_credentials import DatabaseCredentialError, database_url_from_password_file

MIGRATIONS = Path(os.getenv("MIGRATIONS_DIR", ROOT / "migrations"))
BASELINE = MIGRATIONS / "baseline.sql"


def baseline_versions(sql: str) -> list[str]:
    """Versions embedded in the generated baseline artifact."""
    return re.findall(r"^-- BEGIN (\d{3})_", sql, flags=re.MULTILINE)

def load_env_file() -> None:
    env_file = Path(os.getenv("ENV_FILE", ROOT / ".env.local"))
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

def main() -> None:
    load_env_file()
    try:
        database_url = database_url_from_password_file(
            os.getenv("DATABASE_URL"), os.getenv("DATABASE_PASSWORD_FILE", "").strip()
        )
    except DatabaseCredentialError as exc:
        raise SystemExit(str(exc)) from exc
    if not database_url:
        raise SystemExit("DATABASE_URL es obligatorio")
    files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
    if not files:
        raise SystemExit(f"No hay migraciones en {MIGRATIONS}")

    with psycopg.connect(database_url) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS public.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        conn.execute("SELECT pg_advisory_lock(hashtext('custodia-schema-migrations'))")
        try:
            has_schema = conn.execute("""SELECT (to_regclass('public.safes') IS NOT NULL AND to_regclass('public.safe_members') IS NOT NULL AND to_regclass('public.cyberark_ingestion_runs') IS NOT NULL AND to_regclass('public.access_user_roles') IS NOT NULL)""").fetchone()[0]
            tracked_count = conn.execute("SELECT count(*) FROM public.schema_migrations").fetchone()[0]
            if not has_schema and tracked_count == 0 and os.getenv("USE_SCHEMA_BASELINE", "true").lower() in {"1", "true", "yes"} and BASELINE.exists():
                print(f"Aplicando baseline consolidado: {BASELINE.name}")
                baseline_sql = BASELINE.read_text(encoding="utf-8")
                versions = baseline_versions(baseline_sql)
                if not versions:
                    raise RuntimeError("El baseline no declara ninguna migración numerada")
                conn.execute(baseline_sql)
                conn.execute(
                    "INSERT INTO public.schema_migrations (version) SELECT unnest(%s::text[]) ON CONFLICT DO NOTHING",
                    (versions,),
                )
            elif has_schema and tracked_count == 0:
                conn.execute("INSERT INTO public.schema_migrations (version) SELECT lpad(value::text, 3, '0') FROM generate_series(1, 13) AS value ON CONFLICT DO NOTHING")
                print("Baseline aplicado: migraciones 001-013")

            for path in files:
                version = path.name.split("_", 1)[0]
                applied = conn.execute("SELECT 1 FROM public.schema_migrations WHERE version = %s", (version,)).fetchone()
                if applied:
                    continue
                print(f"Aplicando migracion {version}: {path.name}")
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO public.schema_migrations (version) VALUES (%s) ON CONFLICT DO NOTHING", (version,))
            conn.commit()
        finally:
            # Roll back a failed migration before releasing the lock; otherwise
            # PostgreSQL rejects the unlock query inside the aborted transaction.
            conn.rollback()
            conn.execute("SELECT pg_advisory_unlock(hashtext('custodia-schema-migrations'))")
            conn.commit()

if __name__ == "__main__":
    main()
