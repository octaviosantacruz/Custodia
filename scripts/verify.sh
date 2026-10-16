#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/backend/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

echo "[1/9] Compilación Python"
PYTHONPATH=backend "$PYTHON_BIN" -m py_compile $(find backend -name '*.py' -not -path '*/.venv/*' -not -path '*/__pycache__/*')

echo "[2/9] Linter backend (ruff F,B)"
if ! "$PYTHON_BIN" -c 'import ruff' >/dev/null 2>&1; then
  echo "Falta ruff. Instalá las dependencias de desarrollo: backend/.venv/bin/pip install -r backend/requirements-dev.txt" >&2
  exit 1
fi
"$PYTHON_BIN" -m ruff check backend scripts

echo "[3/9] Tests backend (discovery recursivo por plataforma/herramienta)"
scripts/verify_postgres_integration.sh "$PYTHON_BIN"

echo "[4/9] Scripts de inspección"
"$PYTHON_BIN" scripts/build_postman_collection.py --check
bash -n scripts/probe_cyberark_endpoint.sh scripts/probe_sia_endpoint.sh scripts/probe_netskope_api.sh scripts/probe_netskope_dlp_contract.sh scripts/probe_netskope_dlp_incidents_contract.sh scripts/probe_netskope_dlp_crosswalk.sh
scripts/probe_cyberark_endpoint.sh --help >/dev/null
scripts/probe_sia_endpoint.sh --help >/dev/null
scripts/probe_netskope_api.sh --help >/dev/null
scripts/probe_netskope_dlp_contract.sh --help >/dev/null
scripts/probe_netskope_dlp_incidents_contract.sh --help >/dev/null
scripts/probe_netskope_dlp_crosswalk.sh --help >/dev/null
if CA_PVWA_URL=https://tenant.example/api scripts/probe_cyberark_endpoint.sh https://evil.example/steal >/dev/null 2>&1; then
  echo "El probe CyberArk aceptó una URL fuera de su base" >&2
  exit 1
fi
if SIA_PROBE_BASE_URL=https://tenant.example/api SIA_PROBE_HEADER_NAME=X-Test SIA_PROBE_TOKEN=test \
    scripts/probe_sia_endpoint.sh https://evil.example/steal >/dev/null 2>&1; then
  echo "El probe SIA aceptó una URL fuera de su base" >&2
  exit 1
fi
if NETSKOPE_URL=https://tenant.example NETSKOPE_API_TOKEN=test \
    scripts/probe_netskope_api.sh /api/v2/not-approved >/dev/null 2>&1; then
  echo "El probe Netskope aceptó una ruta fuera de su allowlist" >&2
  exit 1
fi

echo "[5/9] Propiedad de estilos"
npm --prefix frontend run verify:styles

echo "[6/9] Tipos generados (Cadenas)"
npm --prefix frontend run verify:chains-types

echo "[7/9] Lint y tests frontend"
npm --prefix frontend run lint
npm --prefix frontend run test:unit

echo "[8/9] Build frontend"
npm --prefix frontend run build

echo "[9/9] Git diff check"
npm run harness:check
npm run harness:test
npm run docs:check
npm run docs:test
git diff --check

echo "Verificación completa."
