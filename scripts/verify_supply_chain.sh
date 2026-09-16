#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/backend/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

echo "[1/3] pip-audit (backend/requirements.lock.txt)"
"$PYTHON_BIN" -m pip_audit -r backend/requirements.lock.txt

echo "[2/3] npm audit (raíz)"
npm audit --omit=dev

echo "[3/3] npm audit (frontend)"
npm --prefix frontend audit --omit=dev

echo "Auditoría de dependencias completa."
