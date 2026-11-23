# Dockerfile Trivy Scan

Scans a Dockerfile's build context for HIGH and CRITICAL vulnerabilities, secrets, and Dockerfile misconfigurations. The action only scans and collects results; call `trivy-report` once after all scans to create the Summary and apply the finding policy.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `dockerfile_path` | No | `./Dockerfile` | Dockerfile to scan; its directory is the build context. |
| `trivy_server` | No | Empty | Trivy server URL. Falls back to local scanning if unavailable. |
| `allow_vulnerabilities` | No | `false` | Existing per-scan setting, used only when `ignore_findings_json` is empty. |
| `ignore_findings_json` | No | Empty | Pass `${{ vars.IGNORE_FINDINGS }}` from the calling workflow. JSON maps repository names to booleans and takes precedence over `allow_vulnerabilities`. A missing repository defaults to `false`. |
| `commit_author_name` | Yes | — | Author name recorded with this scan. |
| `commit_id` | Yes | — | Commit ID recorded with this scan. |

## Output

The action has no declared outputs. It saves `report.json` and `meta.json` under `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/scan.<random>/`. `trivy-report` reads these files. The workflow must upload and download this directory when scans run in separate jobs.

Only vulnerability findings may be allowed. Misconfigurations, secrets, scan errors, and invalid policy JSON fail the scan gate.
