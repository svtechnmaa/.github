#!/usr/bin/env bash
set -euo pipefail

policy="${IGNORE_FINDINGS_JSON:-}"
if [ -z "${policy//[[:space:]]/}" ]; then
  allow_vulnerabilities="${LEGACY_ALLOW_VULNERABILITIES:-false}"
  if [ "$allow_vulnerabilities" != true ]; then allow_vulnerabilities=false; fi
else
  if ! printf '%s' "$policy" | jq -e -s 'length == 1 and (.[0] | type == "object" and all(.[]; type == "boolean"))' >/dev/null; then
    echo '::error::IGNORE_FINDINGS must be a JSON object mapping repository names to boolean values.' >&2
    exit 1
  fi
  repository_name="${GITHUB_REPOSITORY#*/}"
  allow_vulnerabilities="$(printf '%s' "$policy" | jq -r --arg repo "$repository_name" '.[$repo] // false')"
fi

echo "allow_vulnerabilities=$allow_vulnerabilities" >> "$GITHUB_OUTPUT"
echo "Repository ${GITHUB_REPOSITORY}: allow_vulnerabilities=$allow_vulnerabilities"
