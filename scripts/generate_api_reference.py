#!/usr/bin/env python3
"""Generate docs/architecture/api-reference.md from the mounted FastAPI app.

DOCS-GEN-001: the endpoint list and the access each route requires change with
the code, so they are generated instead of hand-written. It runs against the
app object only (no server, no database; same inert environment as
``dump_openapi.py``). The access column comes from the real route
dependencies, so dropping a ``Depends(require_permission(...))`` changes the
reference and fails ``--check``.

Usage:
    backend/.venv/bin/python scripts/generate_api_reference.py            # rewrite the file
    backend/.venv/bin/python scripts/generate_api_reference.py --check    # fail if it is stale
"""

from __future__ import annotations

import argparse
import difflib
import inspect
import os
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
OUTPUT = REPO_ROOT / "docs" / "architecture" / "api-reference.md"
REGENERATE = "backend/.venv/bin/python scripts/generate_api_reference.py"

INERT_ENVIRONMENT = {
    "DATABASE_URL": "postgresql://openapi-dump:openapi-dump@127.0.0.1:5432/openapi_dump",
    "SESSION_SECRET": "openapi-dump-session-secret-at-least-32-bytes",
    "INGESTION_INTERVAL_MINUTES": "1440",
    "AUTH_MODE": "local",
    "SESSION_HTTPS_ONLY": "false",
}

# Dependencies from app/auth.py that do not carry a permission code of their own.
FIXED_ACCESS = {
    "require_session_actor": "sesión del navegador (sin token)",
    "require_authenticated_read_access": "sesión o token Bearer de lectura, sin permiso específico",
    "require_read_access": "`inventory:read`",
    "require_write_access": "sesión o token de escritura, sin permiso específico",
}
# Closures built by the factories: the factory name is the dependency's qualname prefix.
FACTORIES = {
    "require_permission": "escritura",
    "require_any_permission": "escritura",
    "require_permission_read": "lectura",
    "require_any_permission_read": "lectura",
}

FRONTMATTER = """---
estado: vigente
dueño: Octavio Santacruz
revisado: {revisado}
generado: sí
---
"""

NOTICE = """# Referencia de la API (generada)

> **Archivo generado. No editar a mano.** Se regenera con `{command}` a partir de las rutas
> montadas en la app y de las dependencias de autorización de cada una. El test
> `backend/tests/cross/test_api_reference.py` falla si este archivo está desactualizado.

La columna «Acceso» sale de las dependencias reales de cada ruta: el permiso que exige y si
acepta sesión, token de escritura (`X-Access-Token`) o token Bearer de lectura. Qué permisos reúne
cada rol: [Catálogo de roles y permisos](access-catalog.md) (generado desde las migraciones).
Contratos, límites y ejemplos de cada integración: [Contratos de integración](integration-contracts.md).
"""


def _force_inert_environment() -> None:
    for name, value in INERT_ENVIRONMENT.items():
        os.environ[name] = value
    for name in ("DATABASE_PASSWORD_FILE", "SESSION_SECRET_FILE"):
        os.environ.pop(name, None)


def _closure_codes(call) -> tuple[str, tuple[str, ...]] | None:
    """(factory name, permission codes) for a dependency built by a require_* factory."""
    qualname = getattr(call, "__qualname__", "")
    factory = qualname.split(".<locals>.")[0] if ".<locals>." in qualname else ""
    if factory not in FACTORIES:
        return None
    nonlocals = inspect.getclosurevars(call).nonlocals
    if "permission_code" in nonlocals:
        return factory, (nonlocals["permission_code"],)
    if "permission_codes" in nonlocals:
        return factory, tuple(nonlocals["permission_codes"])
    raise RuntimeError(f"No se pudo leer el permiso de {qualname}; actualizá _closure_codes.")


def _dependency_calls(dependant):
    for sub in dependant.dependencies:
        if sub.call is not None:
            yield sub.call
        yield from _dependency_calls(sub)


def access_of(route) -> str:
    parts: list[str] = []
    for call in _dependency_calls(route.dependant):
        closure = _closure_codes(call)
        if closure:
            factory, codes = closure
            joined = " o ".join(f"`{code}`" for code in codes)
            parts.append(f"{joined} ({FACTORIES[factory]})")
        elif getattr(call, "__name__", "") in FIXED_ACCESS:
            parts.append(FIXED_ACCESS[call.__name__])
        elif getattr(call, "__name__", "").startswith("require_"):
            # Route-specific guard (it wraps its own permission check); the code is the source of truth.
            parts.append(f"dependencia propia `{call.__name__}`")
    unique = list(dict.fromkeys(parts))
    return "; ".join(unique) if unique else "pública (sin dependencia de autorización)"


def _escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def effective_routes(app):
    """Every mounted operation. FastAPI wraps included routers lazily; their effective routes are
    exposed by ``effective_route_contexts`` (checked against the version pinned in requirements.lock)."""
    for route in app.routes:
        flatten = getattr(route, "effective_route_contexts", None)
        if flatten is not None:
            yield from flatten()
        elif hasattr(route, "dependant") and hasattr(route, "methods"):
            yield route


def build_body(app) -> str:
    rows = []
    for route in effective_routes(app):
        if not route.include_in_schema or not route.methods:
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            rows.append((route.path, method, access_of(route), ", ".join(route.tags or [])))
    rows.sort()

    lines = [NOTICE.format(command=REGENERATE), f"{len(rows)} operaciones.", "", "| Método | Ruta | Acceso | Etiqueta |", "|---|---|---|---|"]
    for path, method, access, tag in rows:
        lines.append(f"| {method} | `{path}` | {_escape(access)} | {_escape(tag)} |")

    permissions: dict[str, int] = {}
    for _path, _method, access, _tag in rows:
        for code in re.findall(r"`([a-z_]+:[a-z_]+)`", access):
            permissions[code] = permissions.get(code, 0) + 1
    lines += ["", "## Permisos usados por las rutas", "", "| Permiso | Operaciones |", "|---|---|"]
    for code, count in sorted(permissions.items()):
        lines.append(f"| `{code}` | {count} |")
    return "\n".join(lines) + "\n"


def load_app():
    _force_inert_environment()
    sys.path.insert(0, str(BACKEND_DIR))
    from app.main import app

    return app


def split_frontmatter(text: str) -> tuple[str, str]:
    match = re.match(r"^(---\n.*?\n---\n)\n?", text, re.S)
    return (match.group(1), text[match.end():]) if match else ("", text)


def render(app, existing: str = "") -> str:
    front, _ = split_frontmatter(existing)
    return (front or FRONTMATTER.format(revisado=date.today().isoformat())) + "\n" + build_body(app)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generar docs/architecture/api-reference.md.")
    parser.add_argument("--check", action="store_true", help="Fallar si el archivo no coincide con el código.")
    args = parser.parse_args()

    app = load_app()
    existing = OUTPUT.read_text() if OUTPUT.exists() else ""
    expected = render(app, existing)
    if args.check:
        if existing != expected:
            diff = "".join(list(difflib.unified_diff(existing.splitlines(True), expected.splitlines(True), "actual", "esperado"))[:40])
            print(f"{OUTPUT.relative_to(REPO_ROOT)} está desactualizado. Regeneralo con: {REGENERATE}\n{diff}", file=sys.stderr)
            return 1
        print("Referencia de la API al día.")
        return 0
    OUTPUT.write_text(expected)
    print(f"Escribí {OUTPUT.relative_to(REPO_ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
