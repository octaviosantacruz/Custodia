#!/usr/bin/env bash
set -euo pipefail

# NSK-DLP-INCIDENTS-CONTRACT-001/v1. Read-only probe for the collection used
# by Netskope's DLP Incidents view. It reports only response shape, field
# names, types and counts; it never prints event values or payloads.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: scripts/probe_netskope_dlp_incidents_contract.sh

Probes the Netskope DLP incident-event iterator for the last 24 hours and
requests one next page. It prints only HTTP status, JSON shape, field names,
types and counts. It never prints event values, users, IPs or payloads.

Required: NETSKOPE_URL and NETSKOPE_API_TOKEN (or NETSKOPE_API_TOKEN_FILE)
Optional: NETSKOPE_DLP_INCIDENTS_PATH and NETSKOPE_PROBE_TIMEOUT (default: 60)
EOF
}
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage; exit 0; fi
command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

base_url="${NETSKOPE_URL:-}"
token="${NETSKOPE_API_TOKEN:-}"
token_file="${NETSKOPE_API_TOKEN_FILE:-}"
timeout="${NETSKOPE_PROBE_TIMEOUT:-60}"
path="${NETSKOPE_DLP_INCIDENTS_PATH:-/api/v2/events/dataexport/events/incident}"
[[ "$base_url" =~ ^https://[^[:space:]]+$ ]] || { echo "NETSKOPE_URL debe usar HTTPS" >&2; exit 1; }
[[ "$path" == "/api/v2/events/dataexport/events/incident" ]] || { echo "Ruta de incidentes DLP no aprobada para este probe" >&2; exit 2; }
base_url="${base_url%/}"
if [[ -z "$token" && -n "$token_file" ]]; then
  [[ -f "$token_file" ]] || [[ -f "$ROOT_DIR/$token_file" ]] || { echo "No existe NETSKOPE_API_TOKEN_FILE" >&2; exit 1; }
  [[ -f "$token_file" ]] || token_file="$ROOT_DIR/$token_file"
  token="$(<"$token_file")"
fi
[[ -n "$token" && "$token" != *$'\n'* && "$token" != *$'\r'* ]] || { echo "Falta un token válido" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
body="$workdir/body.json"
request() {
  local output="$1"; shift
  curl --silent --show-error --max-time "$timeout" --output "$output" --write-out '%{http_code}' \
    --header "Netskope-API-Token: $token" --header 'Accept: application/json' \
    --get "$base_url$path" "$@"
}

index="dshub-dlp-incidents-contract-$(date -u +%Y%m%dT%H%M%SZ)-$$"
status="$(request "$body" \
  --data-urlencode "operation=$(date -u -d '24 hours ago' +%s)" \
  --data-urlencode "index=$index")"

echo "probe=NSK-DLP-INCIDENTS-CONTRACT-001/v1 http_status=$status"

jq -c '
  def rows: if (.result | type) == "array" then .result else [] end;
  (rows) as $rows
  | {
      top_level_type: type,
      top_level_keys: (if type == "object" then (keys | sort) else [] end),
      event_count: ($rows | length),
      field_presence: (
        ($rows | map(select(type == "object") | keys) | add // [] | unique | sort) as $all_keys
        | [$all_keys[] as $k | {
            name: $k,
            present_count: ([$rows[] | select(type == "object" and has($k))] | length),
            types: ([$rows[] | select(type == "object" and has($k)) | .[$k] | type] | unique | sort)
          }]
      ),
      identity_field_agreement: (
        def agreement(a; b): [$rows[] | select(type == "object" and has(a) and has(b))] as $both
          | {events_with_both_fields: ($both | length), events_where_equal: ([$both[] | select(.[a] == .[b])] | length)};
        {
          user_vs_acting_user: agreement("user"; "acting_user"),
          user_vs_violating_user: agreement("user"; "violating_user"),
          violating_user_vs_acting_user: agreement("violating_user"; "acting_user"),
          user_id_vs_acting_user: agreement("user_id"; "acting_user")
        }
      ),
      incident_granularity: {
        raw_event_count: ($rows | length),
        unique_dlp_incident_id_count: (
          [$rows[] | select(type == "object" and has("dlp_incident_id")) | .dlp_incident_id] | unique | length
        ),
        unique_incident_id_count: (
          [$rows[] | select(type == "object" and has("incident_id")) | .incident_id] | unique | length
        )
      },
      rule_shape: {
        dlp_match_info_keys: ([ $rows[] | .dlp_match_info? // [] | .[] | select(type == "object") | keys[] ] | unique | sort),
        endpoint_policy_match_keys: ([ $rows[] | .endpoint_policy_match? // [] | .[] | select(type == "object") | keys[] ] | unique | sort),
        desired_action_keys: ([ $rows[] | ."endpoint_policy_match.desired_action"? // [] | .[] | select(type == "object") | keys[] ] | unique | sort),
        inline_dlp_match_info_keys: ([ $rows[] | .inline_dlp_match_info? // [] | .[] | select(type == "object") | keys[] ] | unique | sort),
        dlp_policy_types: ([ $rows[] | .dlp_match_info? // [] | .[] | .dlp_policy? | type ] | unique | sort),
        dlp_profile_name_types: ([ $rows[] | .dlp_match_info? // [] | .[] | .dlp_profile_name? | type ] | unique | sort),
        dlp_rules_types: ([ $rows[] | .dlp_match_info? // [] | .[] | .dlp_rules? | type ] | unique | sort),
        dlp_rule_object_keys: ([ $rows[] | .dlp_match_info? // [] | .[] | .dlp_rules? // [] | .[] | select(type == "object") | keys[] ] | unique | sort),
        top_level_rule_candidates: ([ $rows[] | keys[] | select(test("rule|policy|incident"; "i")) ] | unique | sort)
      },
      iterator: {timestamp_hwm: .timestamp_hwm, wait_time: .wait_time}
    }
' "$body" 2>/dev/null || echo 'response_shape=non_json_or_missing_result'

next_body="$workdir/next.json"
next_status="$(request "$next_body" --data-urlencode 'operation=next' --data-urlencode "index=$index")"
next_count="$(jq -r 'if (.result | type) == "array" then (.result | length) else 0 end' "$next_body" 2>/dev/null || echo 0)"
echo "iterator_next_status=$next_status iterator_next_result_count=$next_count"

for field in _id dlp_incident_id incident_id title app site dlp_unique_count last_action severity dlp_rule_severity acting_user violating_user user user_id hostname target_device; do
  jq -r --arg f "$field" '
    def rows: if (.result | type) == "array" then .result else [] end;
    (rows | length) as $total
    | (rows | map(select(type == "object" and has($f))) | length) as $present
    | "has_field=\($f) count=\($present)/\($total)"
  ' "$body" 2>/dev/null || echo "has_field=$field count=0/0"
done
