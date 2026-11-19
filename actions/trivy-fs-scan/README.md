# Trivy filesystem scan

Scans files changed in the pull request and collects results for `trivy-report`. Use `trivy-image-scan` separately for container images.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `trivy_server` | No | Empty | Trivy server URL. Local scanning is used if the server is unavailable. |
| `severity` | No | `CRITICAL,HIGH` | Comma-separated severity levels to scan. |
| `scanners` | No | `secret,misconfig,vuln` | Comma-separated Trivy scanners. |
| `allow_vulnerabilities` | No | `false` | Allows vulnerability findings. Misconfigurations, secrets, and scan errors still block. |

## Results

The action has no declared outputs. It writes each scan's `report.json` and `meta.json` under:

```text
$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/scan.<random>/
```

Call `trivy-report` in the same job to collect these results. When scans run in separate jobs, upload this directory as an artifact and download it into a shared directory before calling `trivy-report` with `report_dir` set to that directory.

Filesystem scanning uses the pull request's `base...head` diff, so the checkout must include both commits (`fetch-depth: 0`). Vulnerability scans use `--ignore-unfixed`, so findings without a known fix are excluded.
The action records `scan_succeeded: false` if scope preparation or scanning fails.
