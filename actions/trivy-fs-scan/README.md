# Trivy filesystem and image scan

Scans files changed in the pull request and, optionally, one or more container images. This action only scans and collects results; it does not create the workflow Summary or send email. Use `trivy-report` once after all scan actions, then use `trivy-mail` in a downstream job when its output says an email is needed.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `trivy-server` | No | Empty | Trivy server URL. Local scanning is used if the server is unavailable. |
| `severity` | No | `CRITICAL,HIGH` | Comma-separated severity levels to scan. |
| `scanners` | No | `secret,misconfig,vuln` | Comma-separated Trivy scanners. |
| `enable-image-scan` | No | `false` | Also scan container images when set to `true`. |
| `image-ref` | No | Empty | Space-separated image references; required when image scanning is enabled. |
| `ignore_finding` | No | `false` | Passes the finding policy to `trivy-report`. Findings remain visible when set to `true`, but do not fail the job. |

## Results

The action has no declared outputs. It writes each scan's `report.json` and `meta.json` under:

```text
$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/scan.<random>/
```

Call `trivy-report` in the same job to collect these results. When scans run in separate jobs, upload this directory as an artifact and download it into a shared directory before calling `trivy-report` with `report_dir` set to that directory.

Filesystem scanning uses the pull request's `base...head` diff, so the checkout must include both commits (`fetch-depth: 0`). Vulnerability scans use `--ignore-unfixed`, so findings without a known fix are excluded.
