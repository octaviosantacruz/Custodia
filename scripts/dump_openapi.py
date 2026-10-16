#!/usr/bin/env python3
"""Dump the in-memory FastAPI OpenAPI schema as deterministic JSON.

FE-API-001: this artifact is the source openapi-typescript consumes for the
Cadenas pilot. It runs standalone against the app object (no server, no
database): importing ``app.main`` only registers routes and builds the schema,
the lifespan/startup never runs.

The environment below is forced to inert local values so the dump never
depends on (or leaks) the host's real configuration; a real DATABASE_URL or
SESSION_SECRET is not needed to build the schema and must not end up in the
artifact. ``--path-prefix`` prunes the schema to the routes under that prefix
plus the component schemas they reference transitively, so a domain pilot can
commit a small, reviewable generated file instead of the whole API surface.

Usage:
    backend/.venv/bin/python scripts/dump_openapi.py --output /tmp/openapi.json
    backend/.venv/bin/python scripts/dump_openapi.py \
        --path-prefix /api/chains --output /tmp/openapi-chains.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
SCHEMA_REF_PREFIX = "#/components/schemas/"

INERT_ENVIRONMENT = {
    "DATABASE_URL": "postgresql://openapi-dump:openapi-dump@127.0.0.1:5432/openapi_dump",
    "SESSION_SECRET": "openapi-dump-session-secret-at-least-32-bytes",
    "INGESTION_INTERVAL_MINUTES": "1440",
    "AUTH_MODE": "local",
    "SESSION_HTTPS_ONLY": "false",
}


def _force_inert_environment() -> None:
    for name, value in INERT_ENVIRONMENT.items():
        os.environ[name] = value
    # A real *_FILE pointer would make the settings loader read a secret from
    # disk even though the literal values above were just forced.
    for name in ("DATABASE_PASSWORD_FILE", "SESSION_SECRET_FILE"):
        os.environ.pop(name, None)


def _collect_schema_refs(node: object, refs: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith(SCHEMA_REF_PREFIX):
            refs.add(ref[len(SCHEMA_REF_PREFIX):])
        for value in node.values():
            _collect_schema_refs(value, refs)
    elif isinstance(node, list):
        for item in node:
            _collect_schema_refs(item, refs)


def _prune(schema: dict, path_prefix: str) -> dict:
    paths = {path: item for path, item in schema.get("paths", {}).items() if path.startswith(path_prefix)}
    if not paths:
        raise SystemExit(f"No hay rutas bajo {path_prefix!r} en el schema OpenAPI.")

    all_schemas = schema.get("components", {}).get("schemas", {})
    referenced: set[str] = set()
    _collect_schema_refs(paths, referenced)
    pending: list[str] = sorted(referenced)

    kept: dict = {}
    while pending:
        name = pending.pop()
        if name in kept:
            continue
        component = all_schemas.get(name)
        if component is None:
            raise SystemExit(f"El schema podado referencia {name!r}, que no existe en components.schemas.")
        kept[name] = component
        found: set[str] = set()
        _collect_schema_refs(component, found)
        pending.extend(sorted(found - kept.keys()))

    pruned = {
        "openapi": schema.get("openapi", "3.1.0"),
        "info": schema.get("info", {}),
        "paths": paths,
        "components": {"schemas": kept},
    }
    # Every reference left in the pruned document must resolve inside it;
    # otherwise openapi-typescript would emit a dangling type name.
    remaining: set[str] = set()
    _collect_schema_refs(pruned, remaining)
    missing = remaining - kept.keys()
    if missing:
        raise SystemExit(f"El schema podado dejó referencias sin resolver: {', '.join(sorted(missing))}.")
    return pruned


def main() -> int:
    parser = argparse.ArgumentParser(description="Volcar el OpenAPI de la app como JSON determinista.")
    parser.add_argument("--output", default="-", help="Archivo de salida; '-' escribe a stdout (por defecto).")
    parser.add_argument("--path-prefix", default="", help="Conservar sólo las rutas que empiezan con este prefijo (y sus schemas).")
    args = parser.parse_args()

    _force_inert_environment()
    sys.path.insert(0, str(BACKEND_DIR))
    from app.main import app  # noqa: E402 -- la app se importa después de fijar el entorno.

    schema = app.openapi()
    if args.path_prefix:
        schema = _prune(schema, args.path_prefix)
    payload = json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if args.output == "-":
        sys.stdout.write(payload)
    else:
        Path(args.output).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
