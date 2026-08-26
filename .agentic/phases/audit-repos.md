# Phase: audit-repos

Tool-agnostic read-only audit of `svtechnmaa` GitHub repositories.
Output is always a Markdown findings table. Never auto-fix.

> **Prerequisites:** `yq` (mikefarah v4+) is required for Mode C job-key detection.
> Install: macOS `brew install yq` · Ubuntu `sudo snap install yq` · Windows `winget install MikeFarah.yq`

---

## When to invoke

- **Monthly compliance sweep** — verify org-wide policy adherence.
- **Ad-hoc admin check** — before granting permissions, deprecating a repo, or investigating a drift report.
- **Pre-rollout scoping** — called by `rollout-check-job-results` in `check-job-results-ready` mode before any PR is opened.

---

## Modes

Pass exactly one mode as the skill argument. Optionally append a comma-separated repo list to restrict scope.

```
compliance [repo,repo,...]
workflow-active [repo,repo,...]
check-job-results-ready [repo,repo,...]
```

---

## Mode A — `compliance`

Runs three checks (A, B, C) derived from `INSTRUCTIONS.md §2.8`.

### Check A — Orphan repos (no team assignment)

```bash
# List repos with zero team assignments
gh api /orgs/svtechnmaa/repos --paginate -q '.[].name' | while read repo; do
  teams=$(gh api "/repos/svtechnmaa/${repo}/teams" -q '.[].name' 2>/dev/null) \
    || { echo "ERROR|${repo}|teams_api_failed"; continue; }
  if [ -z "$teams" ]; then
    echo "ORPHAN|${repo}|no team"
  fi
done
```

Emit table:

| Repo | Status | Note |
|------|--------|------|
| `<name>` | ORPHAN | No team assignment |

### Check B — Workflow requirement (DevOps / CI / SRE / OrgAdmin scope)

Applies to repos under teams: DevOps, CI, SRE, OrgAdmin. Archived repos are skipped. For each in-scope repo: verify `.github/workflows/` is non-empty.

```bash
for repo in $(gh api /orgs/svtechnmaa/repos --paginate -q '.[].name'); do
  workflows=$(gh api "/repos/svtechnmaa/${repo}/contents/.github/workflows" \
    --jq '.[].name' 2>/dev/null)
  if [ -z "$workflows" ]; then
    echo "NO_WORKFLOW|${repo}"
  fi
done
```

Emit table:

| Repo | Status | Note |
|------|--------|------|
| `<name>` | NO_WORKFLOW | `.github/workflows/` empty or absent |

### Check C — `.githooks/` completeness

All five required files must be present:

- `commit-msg`
- `pre-commit`
- `install-betterleaks.sh`
- `setup_security_scan.bash`
- `pre-merge`

```bash
REQUIRED="commit-msg pre-commit install-betterleaks.sh setup_security_scan.bash pre-merge"
for repo in $(gh api /orgs/svtechnmaa/repos --paginate -q '.[].name'); do
  for f in $REQUIRED; do
    result=$(gh api "/repos/svtechnmaa/${repo}/contents/.githooks/${f}" \
      -q '.name' 2>/dev/null)
    if [ -z "$result" ]; then
      echo "MISSING_HOOK|${repo}|${f}"
    fi
  done
done
```

Emit table:

| Repo | Missing file | Status |
|------|-------------|--------|
| `<name>` | `pre-merge` | MISSING |

---

## Mode B — `workflow-active`

A repo's workflow is considered **active** only if all three sub-checks pass:

1. `.github/workflows/` directory contains at least one `.yml` / `.yaml` file.
2. `gh api /repos/svtechnmaa/<repo>/actions/workflows` reports at least one entry with `state == "active"`.
3. At least one workflow run exists with `created_at` in the last 6 months.

```bash
SIX_MONTHS_AGO=$(date -u -v-6m +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
  date -u --date="6 months ago" +%Y-%m-%dT%H:%M:%SZ)

skip_repo() {
  local repo="$1"
  local pushed
  pushed=$(gh api "/repos/svtechnmaa/${repo}" -q '.pushed_at' 2>/dev/null) || return 0
  # Skip stale repos (no push in 6 months)
  [[ "$pushed" < "$SIX_MONTHS_AGO" ]] && return 0
  # Skip sync-bot-only repos
  [[ "$repo" =~ (-sync|-mirror|-fork)$ ]] && return 0
  return 1
}

for repo in $(gh api /orgs/svtechnmaa/repos --paginate -q '.[].name'); do
  skip_repo "$repo" && continue

  # Sub-check 1: workflow files present
  wf_files=$(gh api "/repos/svtechnmaa/${repo}/contents/.github/workflows" \
    --jq '[.[] | select(.name | test("\\.ya?ml$"))] | length' 2>/dev/null) \
    || { echo "ERROR|${repo}|wf_files_api_failed"; continue; }

  # Sub-check 2: at least one workflow with state == "active"
  active_count=$(gh api "/repos/svtechnmaa/${repo}/actions/workflows" \
    --jq '.workflows | map(select(.state == "active")) | length' 2>/dev/null) \
    || { echo "ERROR|${repo}|active_count_api_failed"; continue; }

  # Sub-check 3: run in last 6 months
  recent_run=$(gh api "/repos/svtechnmaa/${repo}/actions/runs" \
    --jq ".workflow_runs | map(select(.created_at >= \"${SIX_MONTHS_AGO}\")) | length" \
    2>/dev/null) || { echo "ERROR|${repo}|recent_run_api_failed"; continue; }

  if [ "$wf_files" -eq 0 ] || [ "$active_count" -eq 0 ] || [ "$recent_run" -eq 0 ]; then
    echo "INACTIVE|${repo}|files:${wf_files} active:${active_count} recent_runs:${recent_run}"
  fi
done
```

Emit table:

| Repo | WF files | Active state | Runs (6 mo) | Verdict |
|------|----------|-------------|-------------|---------|
| `<name>` | 2 | 0 | 0 | INACTIVE |

### Skip criteria for `workflow-active`

Do not flag a repo as failing `workflow-active` if it matches any of:

- Upstream fork used only for lint, PR-template, or release housekeeping.
- Sync-bot-only repos (name matches `*-sync`, `*-mirror`, `*-fork`).
- All workflows explicitly set to `disabled_manually` in the API response.
- Repo has no commits in the last 6 months (`pushed_at < SIX_MONTHS_AGO`).

The `skip_repo()` helper defined in the bash block above enforces the stale and sync-bot criteria automatically.

---

## Mode C — `check-job-results-ready`

Lists repos that have at least one **active** workflow (pass `workflow-active` checks) but whose workflow YAML does not yet contain a `check_job_results` job.

```bash
SIX_MONTHS_AGO=$(date -u -v-6m +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
  date -u --date="6 months ago" +%Y-%m-%dT%H:%M:%SZ)

# skip_repo() is defined in Mode B above — reuse the same function here.

for repo in $(gh api /orgs/svtechnmaa/repos --paginate -q '.[].name'); do
  skip_repo "$repo" && continue

  # Must have active workflow (same sub-checks as workflow-active)
  active_count=$(gh api "/repos/svtechnmaa/${repo}/actions/workflows" \
    --jq '.workflows | map(select(.state == "active")) | length' 2>/dev/null) \
    || { echo "ERROR|${repo}|active_count_api_failed"; continue; }
  [ "$active_count" -eq 0 ] && continue

  recent_run=$(gh api "/repos/svtechnmaa/${repo}/actions/runs" \
    --jq ".workflow_runs | map(select(.created_at >= \"${SIX_MONTHS_AGO}\")) | length" \
    2>/dev/null) || { echo "ERROR|${repo}|recent_run_api_failed"; continue; }
  [ "$recent_run" -eq 0 ] && continue

  # Check each workflow file for a check_job_results job key (yq v4 required)
  has_job=false
  wf_files_list=$(gh api "/repos/svtechnmaa/${repo}/contents/.github/workflows" \
    --jq '[.[] | select(.name | test("\\.ya?ml$")) | .download_url] | .[]' 2>/dev/null)
  for url in $wf_files_list; do
    tmp_wf=$(mktemp /tmp/wf_XXXXXX.yml)
    curl -fsSL "$url" -o "$tmp_wf" 2>/dev/null
    if yq '.jobs | keys[]' "$tmp_wf" 2>/dev/null | grep -Fxq 'check_job_results'; then
      has_job=true
      rm -f "$tmp_wf"
      break
    fi
    rm -f "$tmp_wf"
  done

  if [ "$has_job" = "false" ]; then
    echo "NEEDS_JOB|${repo}"
  fi
done
```

Emit table:

| Repo | Active workflows | check_job_results present | Action needed |
|------|-----------------|--------------------------|---------------|
| `<name>` | Yes | No | Add job |

---

## Output format

Always emit one Markdown table per check. Prepend a summary line:

```
## audit-repos findings — mode: <MODE> — <DATE>

Checked N repos. Found M issues.
```

Never emit raw JSON. Never auto-fix. Flag only.
