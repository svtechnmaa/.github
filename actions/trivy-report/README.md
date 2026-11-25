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

When the scan policy allows vulnerabilities, they remain visible in the Summary and email but do not block the scan gate. Misconfigurations, secrets, and scan errors always block. Clean scans produce a Summary but no email artifact. Legacy output names remain available during migration.

The Summary and email distinguish allowed and blocking vulnerabilities, show each
target's policy, and label every finding's gate decision in the detailed Summary.
The scan gate can remain blocked by misconfigurations or other findings even when
some vulnerabilities are allowed. The email subject includes misconfiguration
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
