#!/usr/bin/env bash
set -euo pipefail

policy="${ALLOW_MISSCONFIGURATIONS_JSON:-}"
if [ -z "${policy//[[:space:]]/}" ]; then
  policy='{}'
fi
if ! printf '%s' "$policy" | jq -e -s 'length == 1 and (.[0] | type == "object" and all(.[]; type == "boolean"))' >/dev/null; then
  echo '::error::ALLOW_MISSCONFIGURATIONS must be a JSON object mapping repository names to boolean values.' >&2
  exit 1
fi
repository_name="${GITHUB_REPOSITORY#*/}"
allow_misconfigurations="$(printf '%s' "$policy" | jq -r --arg repo "$repository_name" '.[$repo] // false')"

echo "allow_misconfigurations=$allow_misconfigurations" >> "$GITHUB_OUTPUT"
echo "Repository ${GITHUB_REPOSITORY}: allow_misconfigurations=$allow_misconfigurations"
