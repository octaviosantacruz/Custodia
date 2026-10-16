#!/usr/bin/env python3
"""Run a command with a validated DATABASE_URL and guarded AWS recovery."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.cross.integrations.aws_secrets_manager import SecretRetrievalError  # noqa: E402
from app.cross.services.database_credentials import (  # noqa: E402
    DatabaseCredentialError,
    database_url_from_password_file,
    resolve_database_url,
)


def child_environment(database_url: str) -> dict[str, str]:
    """Build the child environment after resolving all credential sources.

    The password file is an input to this preflight, not to the child. Leaving
    it set lets downstream startup code apply a stale file over a freshly
    recovered Secrets Manager password.
    """
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    # Keep the key present but empty. Some children reload .env.local with
    # setdefault(); removing it would let that reload reintroduce the stale
    # file path and overwrite the validated URL again.
    environment["DATABASE_PASSWORD_FILE"] = ""
    return environment


def recovered_notice(password_file: str) -> str:
    """Say what happened, since the notice reads like a warning but is a success."""
    notice = (
        "Preflight de base de datos: la contraseña local no era válida (probablemente rotó); "
        "se usó la vigente de AWS Secrets Manager, sólo en memoria."
    )
    if password_file:
        notice += (
            f" {password_file} sigue desactualizado: para otras herramientas que lo lean, "
            "ejecutá scripts/refresh_database_password.sh."
        )
    return notice


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Valida DATABASE_URL y, sólo si falta o PostgreSQL rechaza la contraseña, "
            "recupera AWSCURRENT desde AWS Secrets Manager."
        )
    )
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("falta el comando a ejecutar después de --")
    return args


def main() -> None:
    args = parse_args()
    env_file = Path(os.getenv("ENV_FILE", ROOT / ".env.local"))
    load_dotenv(env_file, override=False)

    try:
        local_database_url = database_url_from_password_file(
            os.getenv("DATABASE_URL"),
            os.getenv("DATABASE_PASSWORD_FILE", "").strip(),
        )
    except DatabaseCredentialError as exc:
        raise SystemExit(f"Preflight de base de datos: {exc}") from exc

    secret_id = os.getenv("DATABASE_SECRET_ID", "").strip()
    if not secret_id:
        # Preserve the current behavior for installations that have not opted
        # into AWS recovery; the child remains responsible for DATABASE_URL.
        environment = child_environment(local_database_url)
        os.execvpe(args.command[0], args.command, environment)

    try:
        resolution = resolve_database_url(
            local_database_url,
            secret_id,
            region=os.getenv("DATABASE_SECRET_REGION") or None,
        )
    except (DatabaseCredentialError, SecretRetrievalError) as exc:
        raise SystemExit(f"Preflight de base de datos: {exc}") from exc

    environment = child_environment(resolution.database_url)
    if resolution.recovered_from_aws:
        print(recovered_notice(os.getenv("DATABASE_PASSWORD_FILE", "").strip()), flush=True)
    os.execvpe(args.command[0], args.command, environment)


if __name__ == "__main__":
    main()
