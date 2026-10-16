#!/usr/bin/env bash
set -euo pipefail

# NSK-DLP-CONTRACT-001/v1. Read-only iterator contract probe. It reports only
# response shape, field names and counts; values, payloads and sensitive data
# are never printed.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: scripts/probe_netskope_dlp_contract.sh

Probes the approved Netskope DLP dataexport iterator for the last 24 hours,
including one `next` operation and exploratory server-side filter parameters.
It prints only HTTP status, JSON shape and counts. It never prints values.

Required: NETSKOPE_URL and NETSKOPE_API_TOKEN (or NETSKOPE_API_TOKEN_FILE)
Optional: NETSKOPE_PROBE_TIMEOUT (default: 60)
EOF
}
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage; exit 0; fi
command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

base_url="${NETSKOPE_URL:-}"
token="${NETSKOPE_API_TOKEN:-}"
token_file="${NETSKOPE_API_TOKEN_FILE:-}"
timeout="${NETSKOPE_PROBE_TIMEOUT:-60}"
path="${NETSKOPE_DLP_ALERTS_PATH:-/api/v2/events/dataexport/alerts/dlp}"
[[ "$base_url" =~ ^https://[^[:space:]]+$ ]] || { echo "NETSKOPE_URL debe usar HTTPS" >&2; exit 1; }
[[ "$path" == "/api/v2/events/dataexport/alerts/dlp" ]] || { echo "Ruta DLP no aprobada para este probe" >&2; exit 2; }
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
    --header "Authorization: Bearer $token" --header 'Accept: application/json' \
    --get "$base_url$path" "$@"
}

index="dshub-dlp-contract-$(date -u +%Y%m%dT%H%M%SZ)-$$"
status="$(request "$body" \
  --data-urlencode "operation=$(date -u -d '24 hours ago' +%s)" \
  --data-urlencode "index=$index")"

echo "probe=NSK-DLP-CONTRACT-001/v1 http_status=$status"

# NSK-DLP-CONTRACT-001/v2: field presence is computed over EVERY event in the
# page, not just the first one. Netskope DLP events do not share one fixed
# schema across action subtypes (e.g. a file-upload event vs. others), so
# inspecting only .result[0] can make the same probe report different fields
# on different runs even though the contract has not changed. Still never
# prints a field's value, only whether it is present, its observed JSON
# type(s), and (for the two identity-shaped fields) whether they agree.
jq -c '
  def rows: if (.result | type) == "array" then .result else [] end;
  (rows) as $rows
  | {
      top_level_type: type,
      top_level_keys: (if type == "object" then (keys | sort) else [] end),
      event_count: ($rows | length),
      field_presence: (
        ($rows | map(keys) | add // [] | unique | sort) as $all_keys
        | [$all_keys[] as $k | {
            name: $k,
            present_count: ([$rows[] | select(has($k))] | length),
            types: ([$rows[] | select(has($k)) | .[$k] | type] | unique | sort)
          }]
      ),
      identity_field_agreement: (
        # user/violating_user is the correlation key for "who violated the
        # policy"; act_user is Netskope'"'"'s "acting user" and may be a
        # different person (e.g. an admin). Report only whether pairs match,
        # never the values, so a wrong assumption here never gets encoded in
        # business logic downstream.
        def agreement(a; b): [$rows[] | select(has(a) and has(b))] as $both
          | {events_with_both_fields: ($both | length), events_where_equal: ([$both[] | select(.[a] == .[b])] | length)};
        {
          user_vs_act_user: agreement("user"; "act_user"),
          user_vs_violating_user: agreement("user"; "violating_user"),
          violating_user_vs_act_user: agreement("violating_user"; "act_user")
        }
      ),
      incident_granularity: {
        raw_event_count: ($rows | length),
        unique_dlp_incident_id_count: (
          if ($rows | length) > 0 and ($rows[0] | has("dlp_incident_id"))
          then ([$rows[] | .dlp_incident_id] | unique | length)
          else null
          end
        ),
        unique_incident_id_count: (
          if ($rows | length) > 0 and ($rows[0] | has("incident_id"))
          then ([$rows[] | .incident_id] | unique | length)
          else null
          end
        )
      }
    }
' "$body"

echo "--- has_field summary (name, present/total) ---"
for field in _id alert_name alert_type app action severity hostname user userkey act_user violating_user dlp_incident_id title site dlp_unique_count instance file_size; do
  jq -r --arg f "$field" '
    def rows: if (.result | type) == "array" then .result else [] end;
    (rows | length) as $total
    | (rows | map(select(has($f))) | length) as $present
    | "has_field=\($f) count=\($present)/\($total)"
  ' "$body"
done

next_body="$workdir/next.json"
next_status="$(request "$next_body" --data-urlencode 'operation=next' --data-urlencode "index=$index")"
next_count="$(jq -r 'if (.result | type) == "array" then (.result | length) else 0 end' "$next_body" 2>/dev/null || echo 0)"
echo "iterator_next_status=$next_status iterator_next_result_count=$next_count"

# The public iterator documentation does not define server-side hostname/user
# filters for this route. Probe the candidate names with an impossible marker
# and report only status/count, so an ignored parameter is visible without
# exposing any tenant value.
for filter in hostname user userkey; do
  filter_body="$workdir/filter-$filter.json"
  filter_status="$(request "$filter_body" \
    --data-urlencode "operation=$(date -u -d '24 hours ago' +%s)" \
    --data-urlencode "index=${index}-${filter}" \
    --data-urlencode "${filter}=__dshub_contract_probe__")"
  filter_count="$(jq -r 'if (.result | type) == "array" then (.result | length) else 0 end' "$filter_body" 2>/dev/null || echo 0)"
  echo "filter=$filter status=$filter_status result_count=$filter_count"
done
