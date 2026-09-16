#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/backend/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

echo "[1/6] Compilación Python"
PYTHONPATH=backend "$PYTHON_BIN" -m py_compile $(find backend -name '*.py' -not -path '*/.venv/*' -not -path '*/__pycache__/*')

echo "[2/6] Tests backend"
PYTHONPATH=backend "$PYTHON_BIN" -m unittest discover -s backend/tests

echo "[3/6] Scripts de inspección"
bash -n scripts/probe_cyberark_endpoint.sh scripts/probe_sia_endpoint.sh
scripts/probe_cyberark_endpoint.sh --help >/dev/null
scripts/probe_sia_endpoint.sh --help >/dev/null
if CA_PVWA_URL=https://tenant.example/api scripts/probe_cyberark_endpoint.sh https://evil.example/steal >/dev/null 2>&1; then
  echo "El probe CyberArk aceptó una URL fuera de su base" >&2
  exit 1
fi
if SIA_PROBE_BASE_URL=https://tenant.example/api SIA_PROBE_HEADER_NAME=X-Test SIA_PROBE_TOKEN=test \
    scripts/probe_sia_endpoint.sh https://evil.example/steal >/dev/null 2>&1; then
  echo "El probe SIA aceptó una URL fuera de su base" >&2
  exit 1
fi

echo "[4/6] Tests frontend"
npm --prefix frontend run test:unit

echo "[5/6] Build frontend"
npm --prefix frontend run build

echo "[6/6] Git diff check"
git diff --check

echo "Verificación completa."
