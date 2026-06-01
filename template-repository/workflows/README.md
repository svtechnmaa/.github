# Security Workflow

`scan-secret.yaml` protects pull requests with two checks:

1. BetterLeaks trailer validation.
2. Trivy scanning through the shared SVTECH action.

## BetterLeaks Trailer Check

The local hook appends this trailer to every scanned commit:

```text
betterleaks-Scan: passed
```

The workflow checks every commit in the pull request range. If a commit is missing the trailer, or the trailer is not `passed`, the PR fails.

This prevents commits made without the local hook from being merged.

## Trivy Scan

The workflow searches for Dockerfiles in the repository.

If Dockerfiles exist:

1. Each Dockerfile is built into a temporary image.
2. The image references are passed to `svtechnmaa/.github/actions/trivy-scan@v1`.
3. Image scanning is enabled.

If no Dockerfile exists:

1. No image is built.
2. Image scanning is disabled.
3. The shared action still receives the common security configuration.

## Required Repository Settings

Configure these GitHub Actions variables and secrets in each repository or organization:

```text
secrets.TRIVY_SERVER
vars.MAIL_USERNAME
secrets.MAIL_PASSWORD
vars.IT_TEAM_EMAIL
vars.DEFAULT_MAIL_RECIPIENTS
```

## Local Setup

Run this once after creating a repo from the template:

```bash
git config core.hooksPath hooks
```

Or use the setup helper:

```bash
./setup_security_scan.bash
```
