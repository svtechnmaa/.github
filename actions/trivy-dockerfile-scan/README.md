# Dockerfile Trivy Scan

Scans a Dockerfile's build context for HIGH and CRITICAL vulnerabilities, secrets, and Dockerfile misconfigurations. The action only scans and collects results; call `trivy-report` once after all scans to create the Summary and apply the finding policy.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `dockerfile_path` | No | `./Dockerfile` | Dockerfile to scan; its directory is the build context. |
| `trivy_server` | No | Empty | Trivy server URL. Falls back to local scanning if unavailable. |
| `allow_vulnerabilities` | No | `false` | Allows vulnerabilities when `true`. Misconfigurations, secrets, and scan errors always fail. |
| `ignore_finding` | No | `false` | Legacy alias for `allow_vulnerabilities`. |
| `commit_author_name` | Yes | — | Author name recorded with this scan. |
| `commit_id` | Yes | — | Commit ID recorded with this scan. |

## Output

The action has no declared outputs. It saves `report.json` and `meta.json` under `$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/scan.<random>/`. `trivy-report` reads these files. The workflow must upload and download this directory when scans run in separate jobs.
