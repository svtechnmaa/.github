# Docker Image Trivy Scan

Scans a Docker image for HIGH and CRITICAL vulnerabilities and secrets. The action only scans and collects results; call `trivy-report` once after all scans to create the Summary and apply the finding policy.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `image_name` | Yes | — | Image name to scan. |
| `image_tag` | No | `latest` | Image tag to scan. |
| `trivy_server` | No | Empty | Trivy server URL. Falls back to local scanning if unavailable. |
| `finding_policy` | No | Empty | Pass `${{ vars.TRIVY_FINDING_POLICY }}` from the calling workflow. The JSON selects this repository and independently evaluates expiring vulnerability and misconfiguration exceptions. |
| `commit_author_name` | Yes | — | Author name recorded with this scan. |
| `commit_id` | Yes | — | Commit ID recorded with this scan. |

## Output

The action has no declared outputs. It saves `report.json` and `meta.json` under `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/scan.<random>/`. `trivy-report` reads these files. The workflow must upload and download this directory when scans run in separate jobs.

Vulnerabilities and misconfigurations can be allowed independently until the end of each exception's `expires_at` date in `Asia/Ho_Chi_Minh`. Secrets, scan errors, and invalid policy entries always fail the scan gate. Allowed findings remain in the report. See `trivy-report` for the JSON schema.
