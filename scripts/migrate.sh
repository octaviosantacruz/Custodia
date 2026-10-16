#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON_BIN=${PYTHON_BIN:-"$ROOT/backend/.venv/bin/python"}
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN=${PYTHON_FALLBACK:-python3}
fi
exec "$PYTHON_BIN" "$ROOT/scripts/run_with_database_secret.py" -- \
  "$PYTHON_BIN" "$ROOT/scripts/migrate.py"
