#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${1:-$ROOT_DIR/backend/.venv/bin/python}"

if [[ "${CUSTODIA_SKIP_PG:-}" == "1" ]]; then
  echo "Tests PostgreSQL omitidos explícitamente (CUSTODIA_SKIP_PG=1)."
  exit 0
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "No se encontró el intérprete Python para los tests: $PYTHON_BIN" >&2
  exit 1
fi

POSTGRES_BIN_DIR="${POSTGRES_BIN_DIR:-}"
if [[ -z "$POSTGRES_BIN_DIR" ]] && command -v pg_config >/dev/null 2>&1; then
  POSTGRES_BIN_DIR="$(pg_config --bindir)"
fi

INITDB="$POSTGRES_BIN_DIR/initdb"
PG_CTL="$POSTGRES_BIN_DIR/pg_ctl"
if [[ ! -x "$INITDB" || ! -x "$PG_CTL" ]]; then
  echo "No se encontraron initdb y pg_ctl. Instalá los binarios de PostgreSQL o usá CUSTODIA_SKIP_PG=1 de forma explícita." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/custodia-postgres.XXXXXXXX")"
DATA_DIR="$TEMP_DIR/data"
SOCKET_DIR="$TEMP_DIR/socket"
mkdir "$SOCKET_DIR"

cleanup() {
  "$PG_CTL" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

PORT="$($PYTHON_BIN -c 'import socket; sock = socket.socket(); sock.bind(("127.0.0.1", 0)); print(sock.getsockname()[1]); sock.close()')"
"$INITDB" --auth=trust --encoding=UTF8 --no-locale --username=custodia_test --pgdata="$DATA_DIR" >/dev/null
"$PG_CTL" -D "$DATA_DIR" -o "-k $SOCKET_DIR -p $PORT -c listen_addresses=''" -w start >/dev/null

DATABASE_URL="postgresql://custodia_test@/postgres?host=$SOCKET_DIR&port=$PORT"
echo "Ejecutando tests de integración contra PostgreSQL efímero."
cd "$ROOT_DIR"
ENV_FILE=/dev/null DATABASE_URL="$DATABASE_URL" "$PYTHON_BIN" scripts/migrate.py
CUSTODIA_TEST_DATABASE_URL="$DATABASE_URL" PYTHONPATH=backend "$PYTHON_BIN" -m unittest discover -s backend/tests -t backend
