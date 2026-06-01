# SVTECH Repository Security Template

Reusable template for enabling BetterLeaks local scanning and GitHub Actions security checks across SVTECH repositories.

## Setup

### Case 1 — Repo not cloned from this template

Run from inside the target repository:

```bash
curl -fsSL \
  -H "Authorization: token ghp_xxx" \
  -H "Accept: application/vnd.github.v3.raw" \
  "https://api.github.com/repos/svtechnmaa/template-repository/contents/setup_security_scan.bash?ref=main" \
  | GITHUB_TOKEN=ghp_xxx bash -s -- -y
```

The script detects repo state and acts accordingly:

```text
files missing  ->  download hooks + workflow  ->  activate hooks
files present  ->  activate hooks
```

Commit the installed files:

```bash
git add hooks .github/workflows/scan-secret.yaml
git commit -m "chore: install security scan hooks"
```

### Case 2 — Repo cloned from this template

Files are already present. Only activate hooks:

```bash
./setup_security_scan.bash --template -y
```

## What Gets Installed

```text
hooks/pre-commit
hooks/prepare-commit-msg
hooks/install-betterleaks.sh
.github/workflows/scan-secret.yaml
```

Hooks are activated via:

```bash
git config core.hooksPath hooks
```

## Check Setup

```bash
./setup_security_scan.bash --check
# or
git config --get core.hooksPath
# expected: hooks
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | _(empty)_ | GitHub PAT. Requires `repo` scope (classic) or `contents: read` (fine-grained). |
| `TEMPLATE_REPO` | `svtechnmaa/template-repository` | Source template repo. |
| `BRANCH` | `main` | Source branch. |

## How It Works

**Local commits:**
```text
git commit
  -> pre-commit hook runs install-betterleaks.sh
  -> betterleaks scans staged changes
  -> prepare-commit-msg appends "betterleaks-Scan: passed"
```

**Pull requests:**
```text
scan-secret.yaml
  -> requires "betterleaks-Scan: passed" on every commit
  -> runs Trivy scan when Dockerfiles are present
```
