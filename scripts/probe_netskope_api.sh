#!/usr/bin/env bash
set -euo pipefail

# Versioned, read-only Netskope contract probe. It deliberately reports only
# response shape and rate-limit metadata; it never prints response values.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

PROBE_VERSION="NSK-API-001/v3"
readonly -a APPROVED_PATHS=(
  "/api/v2/reporting/aa/reports"
  "/api/v2/reporting/aa/widgets"
  "/api/v2/events/datasearch/alert"
  "/api/v2/events/datasearch/application"
  "/api/v2/events/datasearch/page"
  "/api/v2/events/datasearch/incident"
  "/api/v2/events/data/audit"
  "/api/v2/infrastructure/publishers"
  "/api/v2/infrastructure/publisherupgradeprofiles"
  "/api/v2/infrastructure/lbrokers"
  "/api/v2/steering/apps/private"
  "/api/v2/policy/npa/rules"
  "/api/v2/policy/npa/policygroups"
  "/api/v2/policy/urllist"
  "/api/v2/users/getgroups"
  "/api/v2/services/cci/app"
  "/api/v2/steering/globalconfig/clientconfiguration"
  "/api/v2/steering/devices"
  "/api/v2/devices/supportedos"
  "/api/v2/spm/saas_posture_score"
  "/api/v2/ubadatasvc/user/uci"
  "/api/v2/dem/query/definitions"
  "/api/v2/dem/config/applications"
  "/api/v2/dem/config/gateways"
  "/api/v2/dem/config/sites"
  "/api/v2/dem/apps"
  "/api/v2/dem/appprobes"
  "/api/v2/dem/networkprobes"
  "/api/v2/dem/operatingsystems"
  "/api/v2/dem/monitoredapps"
  "/api/v2/dem/globalsettings"
  "/api/v2/dem/globalsettings/monitoredapps"
  "/api/v2/dem/alert/receiver/templates"
  "/api/v2/dem/alert/receivers"
  "/api/v2/dem/alert/rules"
  "/api/v2/dem/alert/rules/entities"
  "/api/v2/rbac/roles"
  "/api/v2/rbac/labels"
  "/api/v2/rbac/apigroups/pagemapping"
  "/api/v2/scim/Groups"
  "/api/v2/scim/Users"
  "/api/v2/platform/administration/scim/Users"
  "/api/v2/deviceclassification/rules"
  "/api/v2/deviceclassification/tags"
  "/api/v2/deviceclassification/onpremdetection/steering"
  "/api/v2/policy/internetaccess/rules"
  "/api/v2/policy/internetaccess/rules/applied"
  "/api/v2/policy/internetaccess/groups"
  "/api/v2/profiles/destinations"
  "/api/v2/profiles/networks"
  "/api/v2/profiles/serviceobjects"
  "/api/v2/steering/ipsec/pops"
  "/api/v2/steering/ipsec/tunnels"
  "/api/v2/services/cci/tags"
  "/api/v2/services/cci/tags/all"
  "/api/v2/auth/tokens"
  "/api/v2/enrollment/tokenset"
  "/api/v2/events/data/infrastructure"
  "/api/v2/events/metrics/transactionevents"
  "/api/v2/spm/apps"
  "/api/v2/spm/apps/recentchanges/getstats"
  "/api/v2/spm/policy/rules"
  "/api/v2/ips/status"
  "/api/v2/ips/allowlist"
  "/api/v2/devices/tags"
  "/api/v2/infrastructure/publishers/releases"
  "/api/v2/infrastructure/publishers/alertsconfiguration"
  "/api/v2/steering/apps/private/tags"
  "/api/v2/users/counts"
  "/api/v2/incidents/users/scenarios"
  "/api/v2/incidents/watchlists"
  "/api/v2/events/logstreaming/list"
  "/api/v2/nsbrowser/licenses"
  "/api/v2/nsbrowser/licensesettings"
  "/api/v2/aisecurity/usage"
  "/api/v2/casb/appinstances"
  "/api/v2/casbapi/accessreviews"
  "/api/v2/aig/aiproviders"
  "/api/v2/aig/mcpservers"
  "/api/v2/aig/appliances"
  "/api/v2/airt/summary"
  "/api/v2/airt/quota"
  "/api/v2/adem/userlist"
  "/api/v2/adem/poplist"
  "/api/v2/adem/deviceoslist"
  "/api/v2/analysis/npa/jobs"
  "/api/v2/reporting/er/reports"
  "/api/v2/spm/stats/disconnectedinstances"
  "/api/v2/platform/contracts"
  "/api/v2/rbac/roles/me"
  "/api/v2/ips/alertonlymode"
  "/api/v2/ips/threathuntingconfig"
  "/api/v2/services/dlp/profiles"
  "/api/v2/steering/gre/pops"
  "/api/v2/steering/gre/tunnels"
  "/api/v2/steering/expressconnect/sites"
  "/api/v2/enrollment/secure-enrollment"
  "/api/v2/enrollment/tenantnotifications"
  "/api/v2/forwardproxy/auth/globalsettings"
  "/api/v2/platform/ssoconfig/idpaccounts"
  "/api/v2/nsbrowser/policies"
  "/api/v2/epdlp/constraints"
)

# POST endpoints that behave as read-only queries. Bodies are fixed and minimal;
# user/device identifiers come from NETSKOPE_PROBE_USER / NETSKOPE_PROBE_DEVICE_ID
# and are never printed. A probe whose identifier is missing is reported as
# skipped. Only the response shape is reported.
readonly -a APPROVED_POST_PATHS=(
  "/api/v2/ubadatasvc/user/uci"
  "/api/v2/incidents/users/getanomalies"
  "/api/v2/incidents/uba/getuci"
  "/api/v2/adem/users/getsummary"
  "/api/v2/adem/tenant/getusage"
  "/api/v2/adem/users/getentities"
  "/api/v2/adem/users/getinfo"
  "/api/v2/adem/users/getapplications"
  "/api/v2/adem/users/getlocations"
  "/api/v2/adem/users/metrics/getexpscore"
  "/api/v2/adem/users/metrics/getexpscores"
  "/api/v2/adem/users/device/getaggregatedscores"
  "/api/v2/adem/users/device/getrca"
  "/api/v2/dem/alerts/getalerts"
  "/api/v2/spm/inventory"
)

usage() {
  cat <<'EOF'
Usage: scripts/probe_netskope_api.sh [APPROVED_PATH ...]

Without paths, probes every GET path and every read-only POST query in the
NSK-API-001/v3 allowlists. Passing
paths restricts the run to those exact allowlisted paths. The allowlist includes
the read-only DEM, RBAC and graph-candidate collections documented in
TO_IMPLEMENT.md. No
response payload values are printed. POST endpoints that behave as queries are
intentionally excluded until their request schemas are captured and versioned.

Required environment:
  NETSKOPE_URL             HTTPS tenant base URL
  NETSKOPE_API_TOKEN       Token, or NETSKOPE_API_TOKEN_FILE

Optional environment:
  NETSKOPE_API_TOKEN_FILE  File containing only the API token
  NETSKOPE_PROBE_TIMEOUT   curl max time in seconds (default: 60)
  NETSKOPE_PROBE_USER      User identifier for the POST user queries (never printed)
  NETSKOPE_PROBE_DEVICE_ID Device id for device-scoped POST queries (never printed)
  NETSKOPE_PROBE_RAW=1     Refused by design; this probe never prints payloads
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

base_url="${NETSKOPE_URL:-}"
token="${NETSKOPE_API_TOKEN:-}"
token_file="${NETSKOPE_API_TOKEN_FILE:-}"
timeout="${NETSKOPE_PROBE_TIMEOUT:-60}"

[[ -n "$base_url" ]] || { echo "Falta NETSKOPE_URL" >&2; exit 1; }
[[ "$base_url" =~ ^https://[^[:space:]]+$ ]] || { echo "NETSKOPE_URL debe usar HTTPS" >&2; exit 1; }
base_url="${base_url%/}"

if [[ -z "$token" && -n "$token_file" ]]; then
  [[ -f "$token_file" ]] || [[ -f "$ROOT_DIR/$token_file" ]] || {
    echo "No existe NETSKOPE_API_TOKEN_FILE" >&2
    exit 1
  }
  [[ -f "$token_file" ]] || token_file="$ROOT_DIR/$token_file"
  token="$(<"$token_file")"
fi
[[ -n "$token" ]] || { echo "Falta NETSKOPE_API_TOKEN o NETSKOPE_API_TOKEN_FILE" >&2; exit 1; }
[[ "$token" != *$'\n'* && "$token" != *$'\r'* ]] || { echo "El token no puede contener saltos de línea" >&2; exit 1; }

is_approved_path() {
  local candidate="$1" approved
  for approved in "${APPROVED_PATHS[@]}" "${APPROVED_POST_PATHS[@]}"; do
    [[ "$candidate" == "$approved" ]] && return 0
  done
  return 1
}

is_post_path() {
  local candidate="$1" approved
  for approved in "${APPROVED_POST_PATHS[@]}"; do
    [[ "$candidate" == "$approved" ]] && return 0
  done
  return 1
}

paths=()
if [[ "$#" -eq 0 ]]; then
  paths=("${APPROVED_PATHS[@]}" "${APPROVED_POST_PATHS[@]}")
else
  for path in "$@"; do
    if ! is_approved_path "$path"; then
      echo "Ruta Netskope no aprobada para este probe: $path" >&2
      exit 2
    fi
    paths+=("$path")
  done
fi

probe_user="${NETSKOPE_PROBE_USER:-}"
probe_device="${NETSKOPE_PROBE_DEVICE_ID:-}"
now_epoch="$(date +%s)"
window_start=$((now_epoch - 7200))

# Prints the JSON body for a POST path, or nothing when the identifier it
# needs is not configured.
post_body() {
  case "$1" in
    /api/v2/ubadatasvc/user/uci)
      [[ -n "$probe_user" ]] || return 0
      jq -cn --arg u "$probe_user" --argjson f "$((now_epoch - 2592000))" --argjson t "$now_epoch" '{user: $u, fromTime: $f, toTime: $t}' ;;
    /api/v2/incidents/uba/getuci)
      [[ -n "$probe_user" ]] || return 0
      jq -cn --arg u "$probe_user" --argjson f "$((now_epoch - 2592000))" --argjson t "$now_epoch" '{users: [$u], fromTime: $f, toTime: $t}' ;;
    /api/v2/adem/users/getsummary|/api/v2/adem/tenant/getusage|/api/v2/adem/users/getentities)
      jq -cn --argjson s "$window_start" --argjson e "$now_epoch" '{starttime: $s, endtime: $e, limit: 5}' ;;
    /api/v2/incidents/users/getanomalies)
      [[ -n "$probe_user" ]] || return 0
      jq -cn --arg u "$probe_user" '{users: [$u], timeframe: 30, limit: 5}' ;;
    /api/v2/adem/users/getinfo|/api/v2/adem/users/getapplications|/api/v2/adem/users/getlocations)
      [[ -n "$probe_user" ]] || return 0
      jq -cn --arg u "$probe_user" --argjson s "$window_start" --argjson e "$now_epoch" '{starttime: $s, endtime: $e, user: $u}' ;;
    /api/v2/adem/users/metrics/getexpscore|/api/v2/adem/users/metrics/getexpscores|/api/v2/adem/users/device/getaggregatedscores|/api/v2/adem/users/device/getrca)
      [[ -n "$probe_user" && -n "$probe_device" ]] || return 0
      jq -cn --arg u "$probe_user" --arg d "$probe_device" --argjson s "$window_start" --argjson e "$now_epoch" '{starttime: $s, endtime: $e, user: $u, deviceId: $d}' ;;
    /api/v2/dem/alerts/getalerts)
      jq -cn '{limit: 5, offset: 0}' ;;
    /api/v2/spm/inventory)
      jq -cn '{limit: 5, offset: 0}' ;;
  esac
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

summarize() {
  local body="$1"
  if jq -e . "$body" >/dev/null 2>&1; then
    jq -c '
      if type == "object" then
        {
          top_level_type: "object",
          top_level_keys: (keys | sort),
          arrays: [to_entries[] | select(.value | type == "array") | {
            key: .key,
            count: (.value | length),
            first_item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object" then (.value[0] | keys | sort) else [] end)
          }],
          reported_counts: (to_entries | map(select(.key | test("^(count|total|totalCount|totalResults|size)$"; "i")) | {key: .key, type: (.value | type)}))
        }
      elif type == "array" then
        {
          top_level_type: "array",
          item_count: length,
          first_item_keys: (if length > 0 and (.[0] | type) == "object" then (.[0] | keys | sort) else [] end)
        }
      else {top_level_type: type}
      end
    ' "$body"
  else
    jq -cn '{parse_error: true}'
  fi
}

results=()
for path in "${paths[@]}"; do
  response_file="$workdir/response-${#results[@]}.body"
  headers_file="$workdir/response-${#results[@]}.headers"
  method_args=()
  method="GET"
  if is_post_path "$path"; then
    method="POST"
    body="$(post_body "$path")"
    if [[ -z "$body" ]]; then
      results+=("$(jq -cn --arg path "$path" '{path: $path, method: "POST", skipped: "falta NETSKOPE_PROBE_USER o NETSKOPE_PROBE_DEVICE_ID"}')")
      continue
    fi
    method_args=(-X POST -H 'Content-Type: application/json' --data "$body")
  fi
  status="$(curl --silent --show-error --location --retry 2 --connect-timeout 15 --max-time "$timeout" \
    --proto '=https' --output "$response_file" --dump-header "$headers_file" --write-out '%{http_code}' \
    --compressed "${method_args[@]}" \
    -H "Netskope-API-Token: $token" -H 'Accept: application/json' \
    "$base_url$path" 2>"$workdir/curl-error")" || status="000"
  shape="$(summarize "$response_file")"
  rate_headers="$(jq -Rn '
    [inputs | select(test("^(retry-after|x-ratelimit-|ratelimit-)"; "i"))
      | capture("^(?<name>[^:]+):\\s*(?<value>.*)$"; "i")
      | {name: (.name | ascii_downcase), value: (.value | rtrimstr("\r"))}]
  ' < "$headers_file")"
  error=""
  if [[ "$status" == "000" ]]; then
    error="$(<"$workdir/curl-error")"
  fi
  results+=("$(jq -cn --arg path "$path" --arg method "$method" --arg status "$status" --argjson shape "$shape" --argjson rate_headers "$rate_headers" --arg error "$error" '{path: $path, method: $method, http_status: ($status | tonumber), shape: $shape, rate_limit_headers: $rate_headers} + (if $error == "" then {} else {network_error: $error} end)')")
done

jq -cn --arg probe_version "$PROBE_VERSION" --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --args '{probe_version: $probe_version, generated_at: $generated_at, read_only: true, results: [ $ARGS.positional[] | fromjson ]}' --args "${results[@]}"
