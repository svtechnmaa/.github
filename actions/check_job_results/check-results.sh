#!/usr/bin/env bash
set -euo pipefail

if ! printf '%s' "$JOBS" | jq -e -s 'length == 1 and (.[0] | type == "object" and length > 0 and all(.[]; type == "object" and (.result | type == "string") and ((.outputs // {}) | type == "object")))' >/dev/null; then
  echo '::error::Expected a nonempty JSON object containing job results.'
  exit 1
fi

# Parse before the loop so a jq failure cannot silently pass the check.
jobs_tsv="$(printf '%s' "$JOBS" | jq -r 'to_entries[] | [.key, .value.result, (if .value.outputs.scan_bypassed == "true" then "true" else "false" end)] | @tsv')"
jobs_tsv="${jobs_tsv//$'\r'/}"
failed=false
while IFS=$'\t' read -r job result bypassed; do
  echo "$job: $result"
  case "$result" in
    success|skipped)
      ;;
    failure)
      if [[ "$bypassed" == 'true' ]]; then
        echo "$job: accepted intentional Trivy failure for allowed vulnerabilities. Review its Summary."
      else
        failed=true
      fi
      ;;
    cancelled)
      failed=true
      ;;
    *)
      echo "Unknown result for $job: $result"
      failed=true
      ;;
  esac
done <<< "$jobs_tsv"

if [[ "$failed" == 'true' ]]; then
  echo '::error::One or more jobs failed or were cancelled without an allowed Trivy bypass.'
  exit 1
fi
