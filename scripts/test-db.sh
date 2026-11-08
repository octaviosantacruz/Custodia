#!/usr/bin/env bash
# Starts a disposable PostgreSQL in Docker for Custodia's integration tests
# and prints the URL to export. It never touches a database on this host.
#   eval "$(scripts/test-db.sh)"     # start and export CUSTODIA_TEST_DATABASE_URL
#   scripts/test-db.sh stop          # remove it
set -euo pipefail
name=custodia-test-db
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo docker); fi
if [[ "${1:-}" == "stop" ]]; then
  "${docker_cmd[@]}" rm -f "$name" >/dev/null 2>&1 || true
  exit 0
fi
if ! "${docker_cmd[@]}" inspect "$name" >/dev/null 2>&1; then
  "${docker_cmd[@]}" run -d --rm --name "$name" -e POSTGRES_PASSWORD=custodia-test -e POSTGRES_DB=custodia_test \
    -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
fi
port="$("${docker_cmd[@]}" port "$name" 5432/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do
  if "${docker_cmd[@]}" exec "$name" pg_isready -U postgres -d custodia_test >/dev/null 2>&1; then break; fi
  sleep 0.5
done
echo "export CUSTODIA_TEST_DATABASE_URL='postgres://postgres:custodia-test@127.0.0.1:${port}/custodia_test?sslmode=disable'"
