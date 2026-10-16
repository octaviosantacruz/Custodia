#!/usr/bin/env python3
"""Open or close the local DS Hub account used by browser automation (AUTH-AGENT-001).

People sign in through Okta; the local account stays disabled until a
browser-automation session needs it.

``open`` activates it with a fresh random credential (no first-login change)
and hands that credential to an agent-browser auth profile through stdin: it
is never printed, logged or written to a file of this repository.
``close`` deactivates it behind another random credential nobody keeps and
deletes the profile. Both end every open session of the account and are
audited in the same transaction. A failed profile step only needs another run.

    npm run agent-access -- open --email admin@itti.digital
    agent-browser auth login dshub      # local form at /login/local
    npm run agent-access -- close --email admin@itti.digital
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.cross.services.user_management import close_automation_access, open_automation_access  # noqa: E402
from app.db import create_pool  # noqa: E402

DEFAULT_PROFILE = "dshub"
DEFAULT_LOGIN_URL = "http://localhost:5173/login/local"


class AgentAccessError(Exception):
    """A failure the operator can act on; the message never carries the credential."""


def _agent_browser(arguments: list[str], run=None, **kwargs) -> subprocess.CompletedProcess:
    return (run or subprocess.run)(["agent-browser", "auth", *arguments], text=True, capture_output=True, check=False, **kwargs)


def save_profile(profile: str, login_url: str, email: str, password: str, run=None) -> None:
    result = _agent_browser(
        ["save", profile, "--url", login_url, "--username", email, "--password-stdin"], run, input=password,
    )
    if result.returncode != 0:
        raise AgentAccessError(
            f"La cuenta quedó activa pero agent-browser no guardó el perfil {profile!r} "
            f"(código {result.returncode}). Volvé a ejecutar open."
        )


def delete_profile(profile: str, run=None) -> bool:
    return _agent_browser(["delete", profile], run).returncode == 0


async def change_access(pool, action: str, email: str, actor_id: str) -> str | None:
    if action == "open":
        password = await open_automation_access(pool, email, actor_id)
        if password is None:
            raise AgentAccessError(f"No existe la cuenta local {email!r}; creala antes desde Administración.")
        return password
    try:
        closed = await close_automation_access(pool, email, actor_id)
    except ValueError as exc:
        raise AgentAccessError(f"No se desactivó {email!r}: {exc}.") from None
    if not closed:
        raise AgentAccessError(f"No existe la cuenta local {email!r}.")
    return None


async def main_async(args: argparse.Namespace) -> str:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise AgentAccessError("Falta DATABASE_URL; ejecutá el script con npm run agent-access.")
    email = args.email.strip().lower()
    pool = create_pool(database_url)
    await pool.open()
    try:
        password = await change_access(pool, args.action, email, f"system:agent-access:{getpass.getuser()}")
    finally:
        await pool.close()
    if args.action == "open":
        save_profile(args.profile, args.login_url, email, password)
        return f"Cuenta {email} activa; credencial nueva en el perfil {args.profile!r} de agent-browser."
    profile_note = "perfil eliminado" if delete_profile(args.profile) else f"no había perfil {args.profile!r} para eliminar"
    return f"Cuenta {email} desactivada y sesiones cerradas; {profile_note}."


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Activa o desactiva la cuenta local usada por agent-browser.")
    parser.add_argument("action", choices=("open", "close"))
    parser.add_argument("--email", required=True, help="Cuenta local de automatización.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE, help=f"Perfil de agent-browser (por defecto {DEFAULT_PROFILE}).")
    parser.add_argument("--login-url", default=DEFAULT_LOGIN_URL, help=f"URL del login local (por defecto {DEFAULT_LOGIN_URL}).")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    try:
        message = asyncio.run(main_async(args))
    except AgentAccessError as exc:
        raise SystemExit(str(exc)) from None
    print(message)


if __name__ == "__main__":
    main()
