#!/usr/bin/env bash
set -euo pipefail

# Default to no exemption, including validation and infrastructure errors.
echo 'scan_bypassed=false' >> "$GITHUB_OUTPUT"

if [[ "$JOB_STATUS" != 'success' ]]; then
  echo '::error::The job failed or was cancelled before the final Trivy status check. No bypass is permitted.'
  exit 1
fi

# A deliberately skipped scan (for example no-ci/no-scan) needs no bypass.
if [[ "$REPORT_OUTCOME" == 'skipped' ]]; then
  echo 'Trivy report was skipped; no scan bypass is applied.'
  exit 0
fi

if [[ "$REPORT_OUTCOME" != 'success' ]]; then
  echo '::error::Trivy report did not succeed. No bypass is permitted.'
  exit 1
fi

if [[ ! "$FINDING_COUNT" =~ ^(0|[1-9][0-9]*)$ ]] || [[ "$GATE_FAILED" != 'true' && "$GATE_FAILED" != 'false' ]]; then
  echo '::error::Missing or invalid Trivy report outputs. No bypass is permitted.'
  exit 1
fi

if [[ "$GATE_FAILED" == 'true' ]]; then
  echo '::error::Trivy gate is blocking. No bypass is permitted.'
  exit 1
fi

if [[ "$FINDING_COUNT" != '0' ]]; then
  # The updated report gate permits findings only for allowed vulnerabilities.
  # This is the last build step: all actual build work must finish before here.
  echo 'scan_bypassed=true' >> "$GITHUB_OUTPUT"
  echo '::error title=Allowed Trivy vulnerabilities::Vulnerabilities were explicitly allowed. This job is intentionally red for visibility; check_job_results may accept this failure.'
  exit 1
fi

echo 'Trivy scan is clean; no bypass is needed.'
