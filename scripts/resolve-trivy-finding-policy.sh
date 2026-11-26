#!/usr/bin/env bash
set -euo pipefail

policy="${TRIVY_FINDING_POLICY_JSON:-}"
if [[ -z "${policy//[[:space:]]/}" ]]; then policy='{}'; fi
if ! printf '%s' "$policy" | jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null; then
  echo '::error::TRIVY_FINDING_POLICY must contain one JSON object keyed by repository name.' >&2
  exit 1
fi

repository_name="${GITHUB_REPOSITORY#*/}"
repository_policy="$(printf '%s' "$policy" | jq -c --arg repo "$repository_name" 'if has($repo) then .[$repo] else empty end')"
if [[ -n "$repository_policy" ]] && ! jq -e '
  type == "object" and
  all(keys[]; . == "vulnerabilities" or . == "misconfigurations") and
  all(.[];
    type == "object" and
    all(keys[]; . == "expires_at" or . == "description") and
    (.expires_at | type == "string") and
    (.description | type == "string" and (gsub("[[:space:]]"; "") | length > 0))
  )
' <<< "$repository_policy" >/dev/null; then
  echo "::error::TRIVY_FINDING_POLICY entry for $repository_name must contain only vulnerabilities/misconfigurations, each with expires_at and a nonempty description." >&2
  exit 1
fi

today="$(TZ=Asia/Ho_Chi_Minh date +%F)"
allow_vulnerabilities=false
allow_misconfigurations=false
exception_details='{}'
for category in vulnerabilities misconfigurations; do
  exception=''
  if [[ -n "$repository_policy" ]]; then
    exception="$(jq -c --arg category "$category" 'if has($category) then .[$category] else empty end' <<< "$repository_policy")"
  fi
  if [[ -z "$exception" ]]; then
    echo "Repository $repository_name: $category blocked by default"
    continue
  fi

  expires_at="$(jq -r '.expires_at' <<< "$exception")"
  description="$(jq -r '.description' <<< "$exception")"
  if [[ ! "$expires_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] ||
     [[ "$(date -u -d "$expires_at" +%F 2>/dev/null || true)" != "$expires_at" ]]; then
    echo "::error::TRIVY_FINDING_POLICY $repository_name.$category has invalid expires_at: $expires_at (expected a real YYYY-MM-DD date)." >&2
    exit 1
  fi

  status=expired
  if [[ "$today" < "$expires_at" || "$today" == "$expires_at" ]]; then
    status=active
    if [[ "$category" == vulnerabilities ]]; then
      allow_vulnerabilities=true
    else
      allow_misconfigurations=true
    fi
  fi
  exception_details="$(jq -cn --argjson details "$exception_details" --arg category "$category" --arg status "$status" --arg expires_at "$expires_at" --arg description "$description" '$details + {($category): {status:$status, expires_at:$expires_at, description:$description}}')"
  echo "Repository $repository_name: $category exception $status (through $expires_at, Asia/Ho_Chi_Minh)"
done

{
  echo "allow_vulnerabilities=$allow_vulnerabilities"
  echo "allow_misconfigurations=$allow_misconfigurations"
  echo "exception_details=$exception_details"
} >> "$GITHUB_OUTPUT"
