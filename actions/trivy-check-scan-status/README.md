# Trivy final scan status

Use this action as the **last step** of an ordinary build job, after health checks,
image pushes, and any other required work. It intentionally fails an otherwise
successful job when `trivy-report` found only explicitly allowed findings.
The job stays red for visibility; `check_job_results` can accept its bypass output.
The report gate must allow vulnerabilities and misconfigurations independently;
secrets and scan failures always block.

| Input | Source |
| --- | --- |
| `job_status` | `${{ job.status }}` immediately before this final step |
| `report_outcome` | `${{ steps.trivy_report.outcome }}` |
| `finding_count` | `${{ steps.trivy_report.outputs.finding_count }}` |
| `gate_failed` | `${{ steps.trivy_report.outputs.gate_failed }}` |

`scan_bypassed` is `true` only when the preceding job status and report outcome
are both `success`, the finding count is positive, and the gate explicitly passed.
Other errors and invalid outputs never receive an exemption. A deliberately
skipped report needs no bypass. Clean scans keep the job green.

```yaml
jobs:
  build:
    outputs:
      scan_bypassed: ${{ steps.trivy_status.outputs.scan_bypassed }}
    steps:
      # Build, scan, report, health checks, and image pushes go above this step.
      - name: Finalize Trivy scan status
        id: trivy_status
        if: always()
        uses: svtechnmaa/.github/actions/trivy-check-scan-status@main
        with:
          job_status: ${{ job.status }}
          report_outcome: ${{ steps.trivy_report.outcome }}
          finding_count: ${{ steps.trivy_report.outputs.finding_count }}
          gate_failed: ${{ steps.trivy_report.outputs.gate_failed }}
```

Do not put work after this step or use job-level `continue-on-error`. Required
work must not suppress failures with step-level `continue-on-error`; otherwise
inspect those step outcomes before using this action. Pass the report step's
`outcome`, not its `conclusion`.

Jobs depending on build need an explicit condition to run after a bypassed
failure. `check_job_results` must use the updated action and depend on every job
whose failures should block merging. The red build job must not itself be a
required successful check; use the final aggregate check for that policy.

This action appends a final build status to the GitHub Summary: bypass applied,
no bypass because of blocking results or another failure, skipped scan, or clean
scan. It does not send email; the earlier report/email describes scan policy,
while this final section confirms whether the build actually received a bypass.
Required security workflows do not need to call it and keep their existing gate behavior.
