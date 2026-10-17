#!/usr/bin/env python3
"""Generate a credential-free Postman v2.1 collection from Custodia OpenAPI."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def example_value(node: dict, schemas: dict, seen: frozenset = frozenset()):
    """Produce an editable template, never read configuration or live data."""
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        if name in seen:
            return None
        return example_value(schemas.get(name, {}), schemas, seen | {name})
    if "default" in node:
        return node["default"]
    if "enum" in node:
        return node["enum"][0]
    for union in ("anyOf", "oneOf"):
        if union in node:
            return example_value(next((v for v in node[union] if v.get("type") != "null"), {}), schemas, seen)
    kind = node.get("type")
    if kind == "object" or "properties" in node:
        return {key: example_value(value, schemas, seen) for key, value in node.get("properties", {}).items()}
    if kind == "array":
        return []
    if kind in {"integer", "number"}:
        return node.get("minimum", 1)
    if kind == "boolean":
        return False
    if kind == "null":
        return None
    if node.get("format") == "date":
        return "{{date}}"
    if node.get("format") == "date-time":
        return "{{datetime}}"
    if node.get("format") == "uuid":
        return "{{uuid}}"
    return "REEMPLAZAR"


def request_auth(security: list) -> dict:
    schemes = {name for alternative in security for name in alternative}
    if "apiBearer" in schemes:
        return {"type": "bearer", "bearer": [{"key": "token", "value": "{{read_token}}", "type": "string"}]}
    for scheme, header, variable in (
        ("accessToken", "X-Access-Token", "write_token"),
        ("bootstrapToken", "X-Bootstrap-Token", "bootstrap_token"),
    ):
        if scheme in schemes:
            return {"type": "apikey", "apikey": [
                {"key": "key", "value": header, "type": "string"},
                {"key": "value", "value": "{{" + variable + "}}", "type": "string"},
                {"key": "in", "value": "header", "type": "string"},
            ]}
    # Postman's cookie jar supplies the session for session-only operations.
    return {"type": "noauth"}


def build_collection(schema: dict) -> dict:
    groups: dict[str, dict[str, list]] = {"Lectura": {}, "Escritura": {}}
    schemas = schema.get("components", {}).get("schemas", {})
    for path, path_item in sorted(schema["paths"].items()):
        for method, operation in sorted(path_item.items()):
            if method not in METHODS:
                continue
            params = { (p["in"], p["name"]): p for p in path_item.get("parameters", []) }
            params.update({(p["in"], p["name"]): p for p in operation.get("parameters", [])})
            url_path = re.sub(r"\{([^}]+)\}", r":\1", path)
            query, variables, headers = [], [], []
            for (location, name), param in params.items():
                value = example_value(param.get("schema", {}), schemas)
                entry = {"key": name, "value": str(value) if value is not None else "", "description": param.get("description", "")}
                if location == "query":
                    entry["disabled"] = not param.get("required", False)
                    query.append(entry)
                elif location == "path":
                    entry["value"] = "{{" + name + "}}"
                    variables.append(entry)
                elif location == "header" and name.lower() not in {"x-access-token", "x-bootstrap-token", "authorization", "cookie"}:
                    entry["disabled"] = not param.get("required", False)
                    headers.append(entry)
            url = {"raw": "{{base_url}}" + url_path, "host": ["{{base_url}}"], "path": url_path.lstrip("/").split("/"), "query": query, "variable": variables}
            security = operation.get("security", schema.get("security", []))
            description = operation.get("description", "")
            description += "\n\nAutenticación OpenAPI: " + (", ".join(" / ".join(v) or "pública" for v in security) if security else "pública")
            request = {"method": method.upper(), "url": url, "header": headers, "auth": request_auth(security), "description": description}
            content = operation.get("requestBody", {}).get("content", {})
            if "application/json" in content:
                body = example_value(content["application/json"].get("schema", {}), schemas)
                if path == "/api/auth/login" and method == "post":
                    body = {"email": "{{email}}", "password": "{{password}}"}
                request["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2, ensure_ascii=False), "options": {"raw": {"language": "json"}}}
                headers.append({"key": "Content-Type", "value": "application/json"})
            else:
                for media, details in content.items():
                    if media in {"multipart/form-data", "application/x-www-form-urlencoded"}:
                        fields = example_value(details.get("schema", {}), schemas) or {}
                        mode = "formdata" if media == "multipart/form-data" else "urlencoded"
                        request["body"] = {"mode": mode, mode: [{"key": k, "value": str(v), "type": "text"} for k, v in fields.items()]}
                        break
            lane = "Lectura" if method in {"get", "head", "options"} else "Escritura"
            tag = operation.get("tags", ["General"])[0]
            groups[lane].setdefault(tag, []).append({"name": f"{method.upper()} {path}", "request": request, "response": []})
    return {
        "info": {"name": "Custodia API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json", "description": "Generada desde OpenAPI. Ver docs/operations/postman.md. Los cuerpos son plantillas editables; no ejecutar la carpeta Escritura como lote. Bearer personal sólo para lectura; escrituras con sesión o token técnico autorizado."},
        "variable": [{"key": "base_url", "value": "http://localhost:8000", "type": "string"}],
        "item": [{"name": lane, "item": [{"name": tag, "item": items} for tag, items in sorted(tags.items())]} for lane, tags in groups.items()],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "api/postman/Custodia.postman_collection.json"))
    parser.add_argument("--check", action="store_true", help="Fail if the committed collection is out of date.")
    args = parser.parse_args()
    schema = json.loads(subprocess.check_output([sys.executable, str(ROOT / "scripts/dump_openapi.py")], text=True))
    payload = json.dumps(build_collection(schema), indent=2, ensure_ascii=False) + "\n"
    target = Path(args.output)
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != payload:
            raise SystemExit("Colección desactualizada: ejecutá scripts/build_postman_collection.py.")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload, encoding="utf-8")


if __name__ == "__main__":
    main()
