#!/usr/bin/env bash
set -euo pipefail

# Probe one approved CyberArk endpoint without printing credentials or full payloads.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: scripts/probe_cyberark_endpoint.sh PATH

Examples:
  scripts/probe_cyberark_endpoint.sh /API/Safes
  scripts/probe_cyberark_endpoint.sh /API/Safes/Example/Members
  scripts/probe_cyberark_endpoint.sh /api/users

Required environment:
  API base, client ID, client secret, and either CA_IDENTITY_URL or CA_IDENTITY_ADMIN_TOKEN_URL.
  CA_PVWA_URL and CA_CLIENT_ID are used by default for Privilege Cloud probes.

Optional environment:
  PROBE_SOURCE                pam (default) or identity_admin
  CA_IDENTITY_ADMIN_URL       API base for Identity Administration probes
  CA_IDENTITY_ADMIN_TOKEN_URL OAuth token URL for Identity Administration
  CA_IDENTITY_ADMIN_CLIENT_ID Client ID for Identity Administration
  CA_IDENTITY_ADMIN_SECRET_FILE
  CA_IDENTITY_ADMIN_CLIENT_SECRET
  CA_SECRET_FILE              fallback secret file (default: .ca_secret)
  PROBE_PAGE_SIZE             default: 100
  PROBE_PLATFORM_DETAIL=1     with /API/Platforms, inspect one detail shape without values
  PROBE_RAW=1                 print the full response (use only locally)
EOF
}

if [[ $# -ne 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  [[ $# -eq 1 ]] && exit 0
  exit 2
fi

command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

identity_url="${CA_IDENTITY_URL:-}"
probe_source="${PROBE_SOURCE:-pam}"
if [[ "$probe_source" == "pam" ]]; then
  client_id="${CA_CLIENT_ID:-}"
  base_url="${CA_PVWA_URL:-}"
  token_url="${identity_url%/}/oauth2/platformtoken"
elif [[ "$probe_source" == "identity_admin" ]]; then
  client_id="${CA_IDENTITY_ADMIN_CLIENT_ID:-${CA_CLIENT_ID:-}}"
  base_url="${CA_IDENTITY_ADMIN_URL:-}"
  token_url="${CA_IDENTITY_ADMIN_TOKEN_URL:-${identity_url%/}/oauth2/platformtoken}"
else
  echo "PROBE_SOURCE debe ser pam o identity_admin" >&2
  exit 2
fi
page_size="${PROBE_PAGE_SIZE:-100}"

if [[ "$probe_source" == "pam" ]]; then
  secret="${CA_CLIENT_SECRET:-}"
  secret_file="${CA_SECRET_FILE:-$ROOT_DIR/.ca_secret}"
else
  secret="${CA_IDENTITY_ADMIN_CLIENT_SECRET:-${CA_CLIENT_SECRET:-}}"
  secret_file="${CA_IDENTITY_ADMIN_SECRET_FILE:-${CA_SECRET_FILE:-$ROOT_DIR/.ca_secret}}"
fi
if [[ -z "$secret" && -f "$secret_file" ]]; then
  secret="$(<"$secret_file")"
fi

[[ -n "$client_id" ]] || { echo "Falta el client ID para $probe_source" >&2; exit 1; }
[[ -n "$secret" ]] || { echo "Falta el secreto de cliente" >&2; exit 1; }
[[ -n "$base_url" ]] || { echo "Falta la URL base para $probe_source" >&2; exit 1; }
if [[ -z "$token_url" ]]; then
  echo "Falta CA_IDENTITY_URL o CA_IDENTITY_ADMIN_TOKEN_URL" >&2
  exit 1
fi

path="$1"
base_url="${base_url%/}"
if [[ "$path" == https://* ]]; then
  url="$path"
  [[ "$url" == "$base_url"/* ]] || { echo "La URL debe permanecer bajo la base configurada" >&2; exit 1; }
elif [[ "$path" == http://* ]]; then
  echo "Las URLs del probe deben usar HTTPS" >&2
  exit 1
else
  separator='?'
  [[ "$path" == *\?* ]] && separator='&'
  url="${base_url}/${path#/}${separator}limit=${page_size}"
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

curl_args=(--fail --silent --show-error --retry 2 --connect-timeout 15 --max-time 60)
token_response="$(curl "${curl_args[@]}" -X POST "$token_url" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$client_id" \
  --data-urlencode "client_secret=$secret")"
token="$(jq -er '.access_token // empty' <<<"$token_response")" || {
  echo "La respuesta OAuth no contiene access_token" >&2
  exit 1
}

curl "${curl_args[@]}" -H "Authorization: Bearer $token" "$url" > "$workdir/response.json"

if [[ "${PROBE_RAW:-0}" == "1" ]]; then
  cat "$workdir/response.json"
  exit 0
fi

summary="$(jq -c '
  {
    top_level_keys: (keys | sort),
    item_count: (if (.value | type) == "array" then (.value | length) elif (.Platforms | type) == "array" then (.Platforms | length) else null end),
    reported_count: (.count // .Total // null),
    has_next_link: ((.nextLink // null) != null),
    first_item_keys: (if (.value | type) == "array" and (.value | length) > 0 and (.value[0] | type) == "object" then (.value[0] | keys | sort) elif (.Platforms | type) == "array" and (.Platforms | length) > 0 and (.Platforms[0] | type) == "object" then (.Platforms[0] | keys | sort) else [] end)
  }
' "$workdir/response.json")"

if [[ "${PROBE_PLATFORM_DETAIL:-0}" != "1" || "$path" != "/API/Platforms" ]]; then
  printf '%s\n' "$summary"
  exit 0
fi

platform_id="$(jq -er '.Platforms[0].general.id // empty' "$workdir/response.json")" || {
  echo "La lista de plataformas no contiene Platforms[0].general.id para inspeccionar detalle" >&2
  exit 1
}
encoded_platform_id="$(jq -rn --arg value "$platform_id" '$value|@uri')"
curl "${curl_args[@]}" -H "Authorization: Bearer $token" \
  "${base_url}/API/Platforms/${encoded_platform_id}" > "$workdir/platform-detail.json"

jq -cn --argjson list "$summary" --slurpfile platforms "$workdir/response.json" --slurpfile detail "$workdir/platform-detail.json" '
  {
    list: $list + {
      first_platform_keys: (if ($platforms[0].Platforms[0] | type) == "object" then ($platforms[0].Platforms[0] | keys | sort) else [] end),
      first_platform_general_keys: (if ($platforms[0].Platforms[0].general | type) == "object" then ($platforms[0].Platforms[0].general | keys | sort) else [] end),
      first_platform_session_management_keys: (if ($platforms[0].Platforms[0].sessionManagement | type) == "object" then ($platforms[0].Platforms[0].sessionManagement | keys | sort) else [] end)
    },
    platform_detail: {
      top_level_keys: ($detail[0] | keys | sort),
      general_keys: (if ($detail[0].general | type) == "object" then ($detail[0].general | keys | sort) else [] end),
      session_management_keys: (if ($detail[0].sessionManagement | type) == "object" then ($detail[0].sessionManagement | keys | sort) else [] end),
      credentials_management_keys: (if ($detail[0].credentialsManagement | type) == "object" then ($detail[0].credentialsManagement | keys | sort) else [] end),
      details_keys: (if ($detail[0].Details | type) == "object" then ($detail[0].Details | keys | sort) else [] end),
      allowed_safes_type: ($detail[0].Details.AllowedSafes | type)
    }
  }
'
