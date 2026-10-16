#!/bin/sh
# Actualiza DATABASE_PASSWORD_FILE con la contraseña vigente de AWS Secrets Manager,
# para herramientas que leen el archivo directamente. La app y migrate.sh no lo necesitan.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON_BIN=${PYTHON_BIN:-"$ROOT/backend/.venv/bin/python"}
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN=${PYTHON_FALLBACK:-python3}
fi
exec "$PYTHON_BIN" "$ROOT/scripts/refresh_database_password.py"
