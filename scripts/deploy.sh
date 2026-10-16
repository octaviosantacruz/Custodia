#!/usr/bin/env bash
set -euo pipefail

# Keep the long-lived service streams separate. systemd creates this directory
# through LogsDirectory= in deploy/dshub.service; the /tmp fallback keeps the
# script usable when run manually without root-owned /var/log access.
LOG_DIR="${DSHUB_LOG_DIR:-/tmp/dshub}"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
DEPLOY_LOG="$LOG_DIR/deploy.log"

# Redirect only after the script has created the directory. systemd keeps its
# own journal copy as a fallback, while this gives operators three separate
# files without making systemd open deploy.log before service startup.
exec >>"$DEPLOY_LOG" 2>&1

echo "[deploy] Aplicando migraciones pendientes"
bash scripts/migrate.sh

echo "[deploy] Construyendo frontend"
npm run web:build

echo "[deploy] Iniciando backend y frontend"
# Append (O_APPEND), never truncate: systemd restarts this script on every
# crash, and logrotate's copytruncate leaves NUL-filled files behind a writer
# that keeps its own offset.
exec concurrently -k \
  "npm run web:prod >>'$BACKEND_LOG' 2>&1" \
  "npm run web:frontend:prod >>'$FRONTEND_LOG' 2>&1"
