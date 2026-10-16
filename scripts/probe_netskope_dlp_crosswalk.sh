#!/usr/bin/env bash
set -euo pipefail

# NSK-DLP-CROSSWALK-001/v1. Read-only comparison of the two DLP dataexport
# contracts. It reports only statuses, counts and identifier intersection
# counts. It never prints identifiers, users, files, IPs or raw payloads.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

usage() {
  cat <<'EOF'
Usage: scripts/probe_netskope_dlp_crosswalk.sh

Compares one 24-hour sample from the DLP Alerts and DLP Incidents iterator
contracts. It reports only HTTP status, result counts and overlap counts for
candidate identifiers; it never prints values or payloads.

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
[[ "$base_url" =~ ^https://[^[:space:]]+$ ]] || { echo "NETSKOPE_URL debe usar HTTPS" >&2; exit 1; }
base_url="${base_url%/}"
if [[ -z "$token" && -n "$token_file" ]]; then
  [[ -f "$token_file" ]] || [[ -f "$ROOT_DIR/$token_file" ]] || { echo "No existe NETSKOPE_API_TOKEN_FILE" >&2; exit 1; }
  [[ -f "$token_file" ]] || token_file="$ROOT_DIR/$token_file"
  token="$(<"$token_file")"
fi
[[ -n "$token" && "$token" != *$'\n'* && "$token" != *$'\r'* ]] || { echo "Falta un token válido" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
request() {
  local path="$1" output="$2" index="$3"
  curl --silent --show-error --max-time "$timeout" --output "$output" --write-out '%{http_code}' \
    --header "Netskope-API-Token: $token" --header 'Accept: application/json' \
    --get "$base_url$path" \
    --data-urlencode "operation=$(date -u -d '24 hours ago' +%s)" \
    --data-urlencode "index=$index"
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
alerts_body="$workdir/alerts.json"
incidents_body="$workdir/incidents.json"
alerts_status="$(request '/api/v2/events/dataexport/alerts/dlp' "$alerts_body" "dshub-dlp-crosswalk-alerts-$timestamp-$$")"
incidents_status="$(request '/api/v2/events/dataexport/events/incident' "$incidents_body" "dshub-dlp-crosswalk-incidents-$timestamp-$$")"

echo "probe=NSK-DLP-CROSSWALK-001/v1 alerts_status=$alerts_status incidents_status=$incidents_status"

jq -n --slurpfile alerts "$alerts_body" --slurpfile incidents "$incidents_body" '
  def rows: if (.result | type) == "array" then .result else [] end;
  def ids($rows; $field):
    [$rows[] | select(type == "object" and has($field)) | .[$field] | tostring] | unique;
  ($alerts[0] | rows) as $a
  | ($incidents[0] | rows) as $i
  | {
      alerts_sample_events: ($a | length),
      incidents_sample_events: ($i | length),
      candidate_identifier_overlap: [
        "_id", "id", "dlp_incident_id", "incident_id"
        | . as $field
        | (ids($a; $field)) as $alert_ids
        | (ids($i; $field)) as $incident_ids
        | {
            field: $field,
            alerts_with_field: ($alert_ids | length),
            incidents_with_field: ($incident_ids | length),
            shared_identifier_count: ([$alert_ids[] | select(. as $id | $incident_ids | index($id))] | length)
          }
      ],
      alerts_top_level_keys: ($alerts[0] | if type == "object" then (keys | sort) else [] end),
      incidents_top_level_keys: ($incidents[0] | if type == "object" then (keys | sort) else [] end)
    }
' 2>/dev/null || echo 'response_shape=non_json_or_missing_result'
