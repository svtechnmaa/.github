#!/usr/bin/env bash
set -euo pipefail

# Default to no exemption, including validation and infrastructure errors.
echo 'scan_bypassed=false' >> "$GITHUB_OUTPUT"

record_status() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '\n## Final build scan status\n\n**%s**\n\n%s\n' "$1" "$2" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [[ "$JOB_STATUS" != 'success' ]]; then
  if [[ "$REPORT_OUTCOME" == 'failure' && "$GATE_FAILED" == 'true' ]]; then
    record_status 'NO BUILD BYPASS — SCAN GATE BLOCKED' 'The scan report contains blocking results. See its Blocking column and per-finding gate decisions. No build failure is exempted.'
  else
    record_status 'NO BUILD BYPASS — JOB FAILED OR CANCELLED' 'Earlier build work did not succeed. Allowed vulnerabilities cannot exempt other failures.'
  fi
  echo '::error::The job failed or was cancelled before the final Trivy status check. No bypass is permitted.'
  exit 1
fi

# A deliberately skipped scan (for example no-ci/no-scan) needs no bypass.
if [[ "$REPORT_OUTCOME" == 'skipped' ]]; then
  record_status 'NO BUILD BYPASS — SCAN SKIPPED' 'The report was deliberately skipped; no exemption is applied.'
  echo 'Trivy report was skipped; no scan bypass is applied.'
  exit 0
fi

if [[ "$REPORT_OUTCOME" != 'success' ]]; then
  record_status 'NO BUILD BYPASS — REPORT DID NOT SUCCEED' 'The report failed, was cancelled, or is missing. No exemption is applied.'
  echo '::error::Trivy report did not succeed. No bypass is permitted.'
  exit 1
fi

if [[ ! "$FINDING_COUNT" =~ ^(0|[1-9][0-9]*)$ ]] || [[ "$GATE_FAILED" != 'true' && "$GATE_FAILED" != 'false' ]]; then
  record_status 'NO BUILD BYPASS — INVALID REPORT OUTPUTS' 'Report outputs could not be validated. No exemption is applied.'
  echo '::error::Missing or invalid Trivy report outputs. No bypass is permitted.'
  exit 1
fi

if [[ "$GATE_FAILED" == 'true' ]]; then
  record_status 'NO BUILD BYPASS — SCAN GATE BLOCKED' 'Blocking findings or scan failures require remediation.'
  echo '::error::Trivy gate is blocking. No bypass is permitted.'
  exit 1
fi

if [[ "$FINDING_COUNT" != '0' ]]; then
  # The updated report gate permits findings only for allowed vulnerabilities.
  # This is the last build step: all actual build work must finish before here.
  record_status 'BUILD BYPASS APPLIED — ALLOWED VULNERABILITIES ONLY' 'All preceding build work succeeded. The build is intentionally red for visibility; check_job_results may accept this failure. Other job failures still block.'
  echo 'scan_bypassed=true' >> "$GITHUB_OUTPUT"
  echo '::error title=Allowed Trivy vulnerabilities::Vulnerabilities were explicitly allowed. This job is intentionally red for visibility; check_job_results may accept this failure.'
  exit 1
fi

record_status 'NO BUILD BYPASS NEEDED — CLEAN SCAN' 'The scan has no findings and all preceding work succeeded.'
echo 'Trivy scan is clean; no bypass is needed.'
