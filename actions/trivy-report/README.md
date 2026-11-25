# Trivy Report

Call this action once after the Trivy scan actions. It reads their collected results, writes one GitHub Summary, applies the finding gate, and uploads email content when findings or scan errors exist. It does not send email or need SMTP credentials.

## Input

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `report_dir` | No | `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` | Directory containing collected scan folders. Set this when results were downloaded from other jobs or stored elsewhere. |

## Outputs

| Output | Meaning |
| --- | --- |
| `total_scans` | Number of collected scans. |
| `total_findings` | Total vulnerabilities, secrets, and misconfigurations. |
| `gate_failed` | `true` if a scan failed or a non-ignored finding was found. |
| `notification_required` | `true` if findings or scan errors require an email. |
| `notification_artifact_name` | Artifact containing `trivy-mail.html`, `trivy-mail.txt`, and `trivy-mail-details.json`. |

Vulnerabilities and misconfigurations can be allowed independently by repository policy. Allowed findings remain visible in the Summary and email but do not block the scan gate. Secrets and scan errors always block. Clean scans produce a Summary but no email artifact. Legacy output names remain available during migration.

## Finding policy

The calling workflow passes one organization variable as `finding_policy: ${{ vars.TRIVY_FINDING_POLICY }}` to each scan action. Only configured exceptions are allowed:

```json
{
  "svtech_report": {
    "vulnerabilities": {
      "expires_at": "2027-03-31",
      "description": "Legacy dependencies pending upgrade"
    },
    "misconfigurations": {
      "expires_at": "2027-02-28",
      "description": "Legacy Dockerfile pending hardening"
    }
  }
}
```

The exception applies through the named date in `Asia/Ho_Chi_Minh`; it blocks again from 00:00 on the following day. An absent repository or category blocks by default. The selected repository's entry must contain only the two category names above; each present category requires a real `YYYY-MM-DD` date and a nonempty description. Invalid entries fail policy evaluation. Expired exceptions remain visible in the Summary and email when findings exist. Updating the variable does not rerun existing PR checks.

The Summary and email distinguish allowed and blocking findings, show each
target's policy, and label every finding's gate decision in the detailed Summary.
The scan gate can remain blocked by other findings even when
some findings are allowed. The email subject includes misconfiguration
counts as well as vulnerability and secret counts.

These are scan decisions, not confirmation that the build was bypassed. When a
workflow uses `trivy-check-scan-status`, its final step appends the actual build
bypass decision to the GitHub Summary after all required build work finishes.

## Same-job scans

When scans and this action run in the same job, no `report_dir` input is needed:

```yaml
- uses: svtechnmaa/.github/actions/trivy-dockerfile-scan@main
  with:
    dockerfile_path: ./Dockerfile
    commit_author_name: ${{ steps.commit_author.outputs.name }}
    commit_id: ${{ github.sha }}

- uses: svtechnmaa/.github/actions/trivy-report@main
  id: trivy_report
  if: always()
```

## Scans in separate jobs

Each scan job must upload `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`. A report job downloads the results into one directory and passes that directory as `report_dir`. See the workflow template for the downstream `trivy-mail` job pattern.
