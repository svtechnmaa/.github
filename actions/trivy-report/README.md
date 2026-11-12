# Trivy Report

Call this action once after the Trivy scan actions. It reads their collected results, writes one GitHub Summary, applies the finding gate, and uploads email content when findings or scan errors exist. It does not send email or need SMTP credentials.

## Input

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `report_dir` | No | `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` | Directory containing collected scan folders. Set this when results were downloaded from other jobs or stored elsewhere. |

## Outputs

| Output | Meaning |
| --- | --- |
| `scan_count` | Number of collected scans. |
| `finding_count` | Total vulnerabilities, secrets, and misconfigurations. |
| `gate_failed` | `true` if a scan failed or a non-ignored finding was found. |
| `send_mail` | `true` if findings or scan errors require an email. |
| `artifact_name` | Artifact containing the email files when `send_mail` is true. |

Findings from scans marked `ignore_finding: true` still appear in the Summary and email but do not fail the job. Scan errors always fail the job. Clean scans produce a Summary but no email artifact.

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
