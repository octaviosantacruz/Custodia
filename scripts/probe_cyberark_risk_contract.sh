#!/usr/bin/env bash
set -euo pipefail

# RISK-001/v1: inspect the approved CyberArk Risk Management GET contract.
# Output is deliberately limited to HTTP status, JSON shape, keys and counts.
# No token, tenant value, entity value or response payload is printed.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

command -v curl >/dev/null || { echo "curl es obligatorio" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq es obligatorio" >&2; exit 1; }

pvwa_url="${CA_PVWA_URL:-}"
identity_url="${CA_IDENTITY_URL:-}"
client_id="${CA_CLIENT_ID:-}"
secret="${CA_CLIENT_SECRET:-}"
secret_file="${CA_SECRET_FILE:-$ROOT_DIR/.ca_secret}"
if [[ -z "$secret" && -f "$secret_file" ]]; then
  secret="$(<"$secret_file")"
fi

[[ "$pvwa_url" =~ ^https://([A-Za-z0-9-]+)\.privilegecloud\.cyberark\.cloud(/|$) ]] || {
  echo "CA_PVWA_URL no tiene el host HTTPS esperado de Privilege Cloud" >&2
  exit 1
}
tenant_subdomain="${BASH_REMATCH[1]}"
base_url="${CA_RISK_URL:-https://${tenant_subdomain}.compass.cyberark.cloud}"
[[ "$base_url" == "https://${tenant_subdomain}.compass.cyberark.cloud" ]] || {
  echo "CA_RISK_URL debe ser el host Compass derivado del tenant" >&2
  exit 1
}
[[ "$identity_url" =~ ^https://[^[:space:]]+$ ]] || { echo "Falta CA_IDENTITY_URL HTTPS" >&2; exit 1; }
[[ -n "$client_id" ]] || { echo "Falta CA_CLIENT_ID" >&2; exit 1; }
[[ -n "$secret" ]] || { echo "Falta CA_CLIENT_SECRET o CA_SECRET_FILE" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
curl_args=(--silent --show-error --connect-timeout 15 --max-time 60 --proto '=https')
token_response="$(curl "${curl_args[@]}" --fail -X POST "${identity_url%/}/oauth2/platformtoken" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$client_id" \
  --data-urlencode "client_secret=$secret")"
token="$(jq -er '.access_token // empty' <<<"$token_response")" || {
  echo "La respuesta OAuth no contiene access_token" >&2
  exit 1
}

paths=(
  "/risks/summary"
  "/risks/risk-types?limit=25&offset=0"
  "/risks/findings?limit=25&offset=0"
  "/recommendations?limit=25&offset=0"
  "/remediations?limit=25&offset=0"
  "/risk-posture/secure-standing-privilege/discovery"
  "/risk-posture/secure-standing-privilege/progress"
)

for index in "${!paths[@]}"; do
  response_file="$workdir/response-${index}.json"
  status="$(curl "${curl_args[@]}" -o "$response_file" -w '%{http_code}' \
    -H "Authorization: Bearer $token" "${base_url}${paths[$index]}")"
  jq -cn --arg endpoint "${paths[$index]%%\?*}" --arg status "$status" \
    --slurpfile response "$response_file" '
      def object_arrays($object):
        [$object | to_entries[] | select(.value | type == "array") |
          {key: .key, count: (.value | length),
           item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object"
             then (.value[0] | keys | sort) else [] end),
           item_types: (if (.value | length) > 0 and (.value[0] | type) == "object"
             then (.value[0] | with_entries(.value = (.value | type))) else {} end),
           nested_array_item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object"
             then [(.value[0] | to_entries[]) | select(.value | type == "array") |
               {key: .key, item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object"
                 then (.value[0] | keys | sort) else [] end)}]
             else [] end)}];
      ($response[0]) as $body |
      {endpoint: $endpoint, status: ($status | tonumber), body_type: ($body | type)} +
      (if ($body | type) == "object" then
        {top_level_keys: ($body | keys | sort), arrays: object_arrays($body)}
       elif ($body | type) == "array" then
        {item_count: ($body | length),
         item_keys: (if ($body | length) > 0 and ($body[0] | type) == "object"
           then ($body[0] | keys | sort) else [] end)}
       else {} end)
    '
done

# The recommendations contract is typed. Reuse one opaque remediationType
# observed above without ever printing it or embedding it in the probe output.
recommendation_type="$(jq -er '.remediations[0].remediationType // empty' "$workdir/response-4.json" 2>/dev/null || true)"
if [[ -n "$recommendation_type" ]]; then
  encoded_type="$(jq -rn --arg value "$recommendation_type" '$value|@uri')"
  recommendation_paths=(
    "/recommendations?recommendationType=${encoded_type}&limit=25&offset=0"
    "/recommendations/${encoded_type}/by-tags?limit=25&offset=0"
  )
  labels=("/recommendations?recommendationType=<opaque>" "/recommendations/<opaque>/by-tags")
  for index in "${!recommendation_paths[@]}"; do
    response_file="$workdir/recommendation-${index}.json"
    status="$(curl "${curl_args[@]}" -o "$response_file" -w '%{http_code}' \
      -H "Authorization: Bearer $token" "${base_url}${recommendation_paths[$index]}")"
    jq -cn --arg endpoint "${labels[$index]}" --arg status "$status" \
      --slurpfile response "$response_file" '
        ($response[0]) as $body |
        {endpoint: $endpoint, status: ($status | tonumber), body_type: ($body | type)} +
        (if ($body | type) == "object" then
          {top_level_keys: ($body | keys | sort), arrays: [($body | to_entries[]) |
            select(.value | type == "array") |
            {key: .key, count: (.value | length),
             item_keys: (if (.value | length) > 0 and (.value[0] | type) == "object"
               then (.value[0] | keys | sort) else [] end)}]}
         elif ($body | type) == "array" then
          {item_count: ($body | length),
           item_keys: (if ($body | length) > 0 and ($body[0] | type) == "object"
             then ($body[0] | keys | sort) else [] end)}
         else {} end)
      '
  done
fi
