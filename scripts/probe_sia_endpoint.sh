#!/usr/bin/env bash
set -euo pipefail

# Inspect one authorized SIA endpoint without printing credentials or full payloads.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: scripts/probe_sia_endpoint.sh PATH

Examples:
  scripts/probe_sia_endpoint.sh /resources
  scripts/probe_sia_endpoint.sh /access-policies?limit=25

Required environment:
  SIA_PROBE_BASE_URL       Exact SIA API base URL, for example https://tenant.example/api
  SIA_PROBE_HEADER_NAME    Authentication header name supplied by CyberArk
  SIA_PROBE_TOKEN_FILE     File containing only the corresponding header value

Optional environment:
  SIA_PROBE_TOKEN          Header value; prefer SIA_PROBE_TOKEN_FILE instead
  SIA_PROBE_PAGE_SIZE      Appends limit when PATH has no limit (default: 100)
  SIA_PROBE_RAW=1          Print the full response only in a controlled local environment

The script never reuses CA_CLIENT_SECRET or the PVWA OAuth token. Absolute URLs
must remain under SIA_PROBE_BASE_URL so an authentication header cannot be sent
to a different host.
EOF
}

if [[ $# -ne 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  [[ $# -eq 1 ]] && exit 0
  exit 2
fi

command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

base_url="${SIA_PROBE_BASE_URL:-${CA_SIA_URL:-}}"
header_name="${SIA_PROBE_HEADER_NAME:-}"
token="${SIA_PROBE_TOKEN:-}"
token_file="${SIA_PROBE_TOKEN_FILE:-}"
page_size="${SIA_PROBE_PAGE_SIZE:-100}"

[[ -n "$base_url" ]] || { echo "Falta SIA_PROBE_BASE_URL" >&2; exit 1; }
[[ "$base_url" =~ ^https://[^[:space:]]+$ ]] || { echo "SIA_PROBE_BASE_URL debe usar HTTPS" >&2; exit 1; }
[[ "$header_name" =~ ^[A-Za-z0-9-]+$ ]] || { echo "SIA_PROBE_HEADER_NAME inválido" >&2; exit 1; }
if [[ -z "$token" && -n "$token_file" && -f "$token_file" ]]; then
  token="$(<"$token_file")"
fi
[[ -n "$token" ]] || { echo "Falta SIA_PROBE_TOKEN_FILE o SIA_PROBE_TOKEN" >&2; exit 1; }
[[ "$token" != *$'\n'* && "$token" != *$'\r'* ]] || { echo "El token no puede contener saltos de línea" >&2; exit 1; }

path="$1"
base_url="${base_url%/}"
if [[ "$path" == https://* ]]; then
  url="$path"
  [[ "$url" == "$base_url"/* ]] || { echo "La URL debe permanecer bajo SIA_PROBE_BASE_URL" >&2; exit 1; }
else
  separator='?'
  [[ "$path" == *\?* ]] && separator='&'
  url="${base_url}/${path#/}"
  if [[ "$path" != *'limit='* ]]; then
    url="${url}${separator}limit=${page_size}"
  fi
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
curl_args=(--fail --silent --show-error --retry 2 --connect-timeout 15 --max-time 60 --proto '=https')
curl "${curl_args[@]}" -H "${header_name}: ${token}" "$url" > "$workdir/response.json"

if [[ "${SIA_PROBE_RAW:-0}" == "1" ]]; then
  cat "$workdir/response.json"
  exit 0
fi

jq -c '
  def arrays:
    [to_entries[] | select(.value | type == "array") | {key: .key, count: (.value | length), first_item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object" then (.value[0] | keys | sort) else [] end)}];
  if type == "object" then
    {top_level_keys: (keys | sort), arrays: arrays}
  elif type == "array" then
    {top_level_type: "array", item_count: length, first_item_keys: (if length > 0 and (.[0] | type) == "object" then (.[0] | keys | sort) else [] end)}
  else
    {top_level_type: type}
  end
' "$workdir/response.json"
