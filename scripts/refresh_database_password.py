#!/usr/bin/env python3
"""Write the current AWS Secrets Manager database password into DATABASE_PASSWORD_FILE.

Explicit, opt-in command for tools that read the file directly (a SQL client,
psql, ad-hoc scripts). The running app and scripts/migrate.sh never need it:
their preflight recovers the password in memory and never writes it anywhere.
The password is validated against PostgreSQL before it replaces the file, is
written atomically with mode 0600, and is never printed.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import psycopg  # noqa: E402
from psycopg.conninfo import conninfo_to_dict  # noqa: E402

from app.cross.integrations.aws_secrets_manager import SecretRetrievalError, get_secret_string  # noqa: E402
from app.cross.services.database_credentials import (  # noqa: E402
    DatabaseCredentialError,
    database_url_from_password_file,
    database_url_from_secret,
    probe_database,
)

DEFAULT_PASSWORD_FILE = ROOT / ".secrets" / "database_password"


def write_private_file(path: Path, content: str) -> None:
    """Replace ``path`` atomically with a 0600 file; no partial or world-readable state."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def refresh(
    password_file: Path,
    base_url: str,
    secret_id: str,
    region: str | None,
    *,
    probe=probe_database,
    fetch_secret=get_secret_string,
) -> str:
    """Return "current" when the file already works, or "updated" after replacing it."""
    if password_file.is_file():
        try:
            probe(database_url_from_password_file(base_url, str(password_file)))
            return "current"
        except (psycopg.Error, DatabaseCredentialError):
            pass
    resolved = database_url_from_secret(fetch_secret(secret_id, region), base_url)
    password = conninfo_to_dict(resolved).get("password") or ""
    if not password:
        raise DatabaseCredentialError("El secreto no contiene una contraseña")
    try:
        probe(resolved)
    except psycopg.Error as exc:
        raise DatabaseCredentialError("La contraseña de AWS no pudo validarse contra PostgreSQL; el archivo no se modificó") from exc
    write_private_file(password_file, password)
    return "updated"


def main() -> None:
    load_dotenv(Path(os.getenv("ENV_FILE", ROOT / ".env.local")), override=False)
    secret_id = os.getenv("DATABASE_SECRET_ID", "").strip()
    base_url = os.getenv("DATABASE_URL", "").strip()
    if not secret_id:
        raise SystemExit("refresh_database_password: falta DATABASE_SECRET_ID")
    if not base_url:
        raise SystemExit("refresh_database_password: falta DATABASE_URL con los datos de conexión")
    configured = os.getenv("DATABASE_PASSWORD_FILE", "").strip()
    password_file = Path(configured) if configured else DEFAULT_PASSWORD_FILE
    if not password_file.is_absolute():
        password_file = ROOT / password_file
    try:
        outcome = refresh(password_file, base_url, secret_id, os.getenv("DATABASE_SECRET_REGION") or None)
    except (DatabaseCredentialError, SecretRetrievalError) as exc:
        raise SystemExit(f"refresh_database_password: {exc}") from exc
    if outcome == "current":
        print(f"{password_file.name} ya tiene la contraseña vigente; no se modificó nada.")
    else:
        print(f"{password_file.name} actualizado con la contraseña vigente de AWS (permisos 0600, validada contra PostgreSQL).")


if __name__ == "__main__":
    main()
