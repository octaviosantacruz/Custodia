#!/usr/bin/env bash
# Worktrees por tarea: cada ID (humano o agente) trabaja en su propio árbol y
# su propia rama, así que dos actores nunca editan los mismos archivos.
#
#   scripts/wt.sh new <ID>        crea (o reutiliza) ../Custodia-wt/<ID> en la rama task/<ID>;
#                                 lo invocan el orchestrator y el autopilot, no hace falta a mano
#   scripts/wt.sh status          lista los árboles y su estado
#   scripts/wt.sh merge <ID>      rebase sobre la rama base y fast-forward en el árbol principal
#   scripts/wt.sh clean <ID>      borra el árbol y la rama (sólo si ya está integrada)
#
# Nunca hace push. Documentado en docs/operations/comandos-clave.md (sección 12).
set -euo pipefail

MAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(dirname "$MAIN")/Custodia-wt"

die() { echo "wt: $*" >&2; exit 1; }

valid_id() { [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "ID inválido: '${1:-}'"; }

base_branch() { git -C "$MAIN" symbolic-ref --short HEAD; }

cmd_new() {
  valid_id "${1:-}"; local id="$1" dir="$ROOT/$1" branch="task/$1"
  # Idempotente: si el árbol ya existe en su rama, se reutiliza (reanudar un ID).
  if [[ -e "$dir" ]]; then
    [[ "$(git -C "$dir" branch --show-current 2>/dev/null)" == "$branch" ]] \
      || die "$dir existe pero no está en la rama $branch"
    echo "Árbol existente: $dir (rama $branch)"; echo "WORKTREE=$dir"; return 0
  fi
  # El ID debe figurar en el tracker de pendientes (WT_ANY_ID=1 lo omite).
  [[ -n "${WT_ANY_ID:-}" ]] || grep -qF "| \`$id\` |" "$MAIN/docs/tracking/TO_IMPLEMENT.md" \
    || die "$id no figura en docs/tracking/TO_IMPLEMENT.md"
  mkdir -p "$ROOT"
  # Parte de la punta de la rama base: lo que está sin commitear en el árbol
  # principal no viaja, y por eso mismo no puede chocar.
  git -C "$MAIN" worktree add -b "$branch" "$dir" "$(base_branch)" >/dev/null
  # Dependencias y secretos se comparten por enlace simbólico (no se copian).
  ln -s "$MAIN/node_modules" "$dir/node_modules"
  ln -s "$MAIN/frontend/node_modules" "$dir/frontend/node_modules"
  ln -s "$MAIN/backend/.venv" "$dir/backend/.venv"
  for f in .env.local .ca_secret .secrets; do
    [[ -e "$MAIN/$f" ]] && ln -s "$MAIN/$f" "$dir/$f"
  done
  # Los enlaces no los cubre el .gitignore (patrones con "/" final): se excluyen
  # en el info/exclude común para que git status siga limpio y nadie los agregue.
  local ex; ex="$(git -C "$MAIN" rev-parse --git-common-dir)/info/exclude"
  mkdir -p "$(dirname "$ex")"
  local p; for p in /.secrets /.ca_secret /.env.local /node_modules /frontend/node_modules /backend/.venv; do
    grep -qxF "$p" "$ex" 2>/dev/null || echo "$p" >> "$ex"
  done
  echo "Árbol listo: $dir (rama $branch)"
  echo "WORKTREE=$dir"
}

cmd_status() {
  git -C "$MAIN" worktree list
  local d
  for d in "$ROOT"/*/; do
    [[ -d "$d" ]] || continue
    echo "--- $(basename "$d"): $(git -C "$d" rev-list --count "$(base_branch)..HEAD") commit(s) por integrar, $(git -C "$d" status --short | wc -l) archivo(s) sin commitear"
  done
}

cmd_merge() {
  valid_id "${1:-}"; local dir="$ROOT/$1" branch="task/$1" base
  [[ -d "$dir" ]] || die "no existe $dir"
  base="$(base_branch)"
  [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] \
    || die "el árbol $dir tiene cambios sin commitear: commitealos o descartalos antes"
  git -C "$dir" rebase "$base" \
    || die "conflicto al rebasar sobre $base: resolvelo en $dir (git rebase --continue) y repetí"
  # fast-forward en el árbol principal; falla si toca archivos con cambios locales solapados
  git -C "$MAIN" merge --ff-only "$branch"
  echo "Integrado $branch en $base. Limpieza: scripts/wt.sh clean $1"
}

cmd_clean() {
  valid_id "${1:-}"; local dir="$ROOT/$1" branch="task/$1"
  git -C "$MAIN" merge-base --is-ancestor "$branch" "$(base_branch)" \
    || die "$branch tiene commits sin integrar (scripts/wt.sh merge $1)"
  [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] \
    || die "el árbol $dir tiene cambios sin commitear"
  # Quita primero los enlaces para que 'worktree remove' no los siga.
  find "$dir" -maxdepth 2 -type l -delete
  git -C "$MAIN" worktree remove --force "$dir"
  git -C "$MAIN" branch -d "$branch"
}

case "${1:-}" in
  new) shift; cmd_new "$@" ;;
  status) cmd_status ;;
  merge) shift; cmd_merge "$@" ;;
  clean) shift; cmd_clean "$@" ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
