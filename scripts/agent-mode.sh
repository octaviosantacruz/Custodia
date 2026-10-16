#!/usr/bin/env bash
# Interruptor de modelos de los agentes OpenCode (.opencode/agents/*.md).
#
#   scripts/agent-mode.sh eco       orchestrator/autopilot/reviewers en gpt-6-luna; workers en deepseek-v4.1-flash
#   scripts/agent-mode.sh normal    orchestrator/autopilot/reviewers en Claude Sonnet 5.5; workers en deepseek-v4.1-flash
#   scripts/agent-mode.sh status    muestra el modelo de cada perfil
#
# ECO_MODEL y WORKER_MODEL (p. ej. opencode-go/deepseek-v4.1-flash) cambian de proveedor/suscripción.
# Reabrir OpenCode (o `opencode reload`) después: las sesiones abiertas conservan el modelo.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.opencode/agents"
LUNA="commandcode-openai/gpt-6-luna"
FRONTIER="commandcode/claude-sonnet-5-5"
ECO="${ECO_MODEL:-$LUNA}"
WORKER="${WORKER_MODEL:-commandcode-openai/deepseek/deepseek-v4.1-flash}"

set_model() { sed -i "s#^model: .*#model: $2#" "$DIR/$1.md"; }

case "${1:-}" in
  eco)    for a in orchestrator autopilot reviewer reviewer-auto; do set_model "$a" "$ECO"; done
          for a in worker worker-auto; do set_model "$a" "$WORKER"; done ;;
  normal) for a in orchestrator autopilot reviewer reviewer-auto; do set_model "$a" "$FRONTIER"; done
          for a in worker worker-auto; do set_model "$a" "$WORKER"; done ;;
  status) ;;
  *) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
grep -H '^model:' "$DIR"/*.md | sed "s#$DIR/##; s#\.md:model:# →#"
