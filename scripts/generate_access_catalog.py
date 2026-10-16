#!/usr/bin/env python3
"""Generate docs/architecture/access-catalog.md from the migrated access catalog.

DOCS-GEN-002: roles, domains and permissions are seeded by ``migrations/`` and
live in PostgreSQL, so the only faithful source is a database with the
migrations applied. Without a URL this script starts the same kind of ephemeral
cluster as ``scripts/verify_postgres_integration.sh``, applies the migrations
and reads the catalog from there. Only ``system_managed`` rows are documented:
custom roles created at runtime are data, not catalog.

Usage:
    backend/.venv/bin/python scripts/generate_access_catalog.py            # rewrite the file
    backend/.venv/bin/python scripts/generate_access_catalog.py --check    # fail if it is stale
    DSHUB_TEST_DATABASE_URL=... backend/.venv/bin/python scripts/generate_access_catalog.py  # reuse a migrated database
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO_ROOT / "docs" / "architecture" / "access-catalog.md"
REGENERATE = "backend/.venv/bin/python scripts/generate_access_catalog.py"
OPT_IN_ENV_VAR = "DSHUB_TEST_DATABASE_URL"

FRONTMATTER = """---
estado: vigente
dueño: Octavio Santacruz
revisado: {revisado}
generado: sí
---
"""

NOTICE = """# Catálogo de roles y permisos (generado)

> **Archivo generado. No editar a mano.** Se regenera con `{command}` aplicando las migraciones
> en un PostgreSQL efímero y leyendo el catálogo. El test `backend/tests/cross/test_access_catalog.py`
> falla si este archivo está desactualizado respecto de `migrations/`.

Solo figuran las filas sembradas por las migraciones (`system_managed`); los roles compuestos que
crea un administrador en tiempo de ejecución son datos, no catálogo. Un rol compuesto no copia
permisos: elige un nivel por dominio y hereda los del rol base de ese nivel. «Planificado» indica
un dominio o rol sin integración; no concede acceso útil todavía. «—» en «Roles que lo conceden» significa que
ningún rol sembrado lo incluye: un administrador lo asigna mediante un rol personalizado. Los permisos
estrictos (`netskope:dlp_read`, `netskope:uba_read`) no los otorgan `access:manage` ni `netskope:read`:
sólo el rol que los lista. Qué permiso exige cada endpoint:
[Referencia de la API](api-reference.md).
"""


def _escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def _codes(items) -> str:
    items = sorted(items)
    return ", ".join(f"`{item}`" for item in items) if items else "—"


def build_body(connection) -> str:
    def fetch(sql: str):
        with connection.cursor() as cursor:
            cursor.execute(sql)
            return cursor.fetchall()

    domains = fetch("SELECT domain_code, display_name, lifecycle_status FROM public.access_domains ORDER BY sort_order, domain_code")
    levels = fetch(
        "SELECT domain_code, level_code, display_name, base_role_code FROM public.access_domain_levels ORDER BY domain_code, sort_order, level_code"
    )
    permissions = fetch(
        "SELECT permission_code, domain_code, description, lifecycle_status FROM public.access_permissions "
        "WHERE system_managed ORDER BY domain_code, permission_code"
    )
    roles = fetch(
        "SELECT role_code, display_name, role_kind, domain_code, lifecycle_status FROM public.access_roles "
        "WHERE system_managed ORDER BY role_kind DESC, domain_code NULLS LAST, role_code"
    )
    grants = fetch("SELECT role_code, permission_code FROM public.access_role_permissions")

    by_role: dict[str, set[str]] = {}
    by_permission: dict[str, set[str]] = {}
    for role_code, permission_code in grants:
        by_role.setdefault(role_code, set()).add(permission_code)
        by_permission.setdefault(permission_code, set()).add(role_code)
    domain_names = {code: name for code, name, _ in domains}

    lines = [NOTICE.format(command=REGENERATE), "## Dominios y niveles", "", "| Dominio | Nombre | Estado | Niveles (rol base) |", "|---|---|---|---|"]
    for code, name, status in domains:
        domain_levels = ", ".join(f"{_escape(label)} → `{base}`" for domain, _, label, base in levels if domain == code)
        lines.append(f"| `{code}` | {_escape(name)} | {status} | {domain_levels or '—'} |")

    lines += ["", "## Roles", "", "| Rol | Nombre | Tipo | Dominio | Estado | Permisos propios |", "|---|---|---|---|---|---|"]
    for code, name, kind, domain, status in roles:
        scope = f"`{domain}`" if domain else "varios (por nivel)"
        lines.append(f"| `{code}` | {_escape(name)} | {'compuesto' if kind == 'composite' else 'directo'} | {scope} | {status} | {_codes(by_role.get(code, ()))} |")

    lines += ["", "## Permisos", "", "| Permiso | Dominio | Estado | Descripción | Roles que lo conceden |", "|---|---|---|---|---|"]
    for code, domain, description, status in permissions:
        lines.append(f"| `{code}` | {_escape(domain_names.get(domain, domain))} | {status} | {_escape(description)} | {_codes(by_permission.get(code, ()))} |")
    return "\n".join(lines) + "\n"


def split_frontmatter(text: str) -> tuple[str, str]:
    match = re.match(r"^(---\n.*?\n---\n)\n?", text, re.S)
    return (match.group(1), text[match.end():]) if match else ("", text)


def render(connection, existing: str = "") -> str:
    front, _ = split_frontmatter(existing)
    return (front or FRONTMATTER.format(revisado=date.today().isoformat())) + "\n" + build_body(connection)


def _postgres_bin() -> Path:
    configured = os.environ.get("POSTGRES_BIN_DIR")
    if configured:
        return Path(configured)
    pg_config = shutil.which("pg_config")
    if not pg_config:
        raise SystemExit("No se encontró pg_config; definí POSTGRES_BIN_DIR o DSHUB_TEST_DATABASE_URL.")
    return Path(subprocess.check_output([pg_config, "--bindir"], text=True).strip())


@contextmanager
def migrated_database():
    """Yield a connection URL to a migrated database: the opt-in one, or a throwaway cluster."""
    configured = os.environ.get(OPT_IN_ENV_VAR, "").strip()
    if configured:
        yield configured
        return
    import socket

    bin_dir = _postgres_bin()
    with tempfile.TemporaryDirectory(prefix="dshub-catalog.") as temp:
        data_dir, socket_dir = Path(temp) / "data", Path(temp) / "socket"
        socket_dir.mkdir()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        subprocess.run([bin_dir / "initdb", "--auth=trust", "--encoding=UTF8", "--no-locale", "--username=dshub_test", f"--pgdata={data_dir}"], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([bin_dir / "pg_ctl", "-D", data_dir, "-o", f"-k {socket_dir} -p {port} -c listen_addresses=''", "-w", "start"], check=True, stdout=subprocess.DEVNULL)
        try:
            url = f"postgresql://dshub_test@/postgres?host={socket_dir}&port={port}"
            subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "migrate.py")], check=True, cwd=REPO_ROOT, env={**os.environ, "ENV_FILE": "/dev/null", "DATABASE_URL": url}, stdout=subprocess.DEVNULL)
            yield url
        finally:
            subprocess.run([bin_dir / "pg_ctl", "-D", data_dir, "-m", "immediate", "-w", "stop"], check=False, stdout=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generar docs/architecture/access-catalog.md.")
    parser.add_argument("--check", action="store_true", help="Fallar si el archivo no coincide con las migraciones.")
    args = parser.parse_args()

    import psycopg

    with migrated_database() as url, psycopg.connect(url) as connection:
        existing = OUTPUT.read_text() if OUTPUT.exists() else ""
        expected = render(connection, existing)
    if args.check:
        if existing != expected:
            diff = "".join(list(difflib.unified_diff(existing.splitlines(True), expected.splitlines(True), "actual", "esperado"))[:40])
            print(f"{OUTPUT.relative_to(REPO_ROOT)} está desactualizado. Regeneralo con: {REGENERATE}\n{diff}", file=sys.stderr)
            return 1
        print("Catálogo de roles y permisos al día.")
        return 0
    OUTPUT.write_text(expected)
    print(f"Escribí {OUTPUT.relative_to(REPO_ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
