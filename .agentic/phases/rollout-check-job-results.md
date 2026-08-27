# Phase: rollout-check-job-results

Rolls out the `check_job_results` composite action to one or more `svtechnmaa` repos.
Tool-agnostic step sequence — shell + `gh` CLI only.

---

## When to invoke

- ClickUp parent task `86d40y9gr` has subtasks marked **"Need check_job_results: Yes"**.
- User explicitly names a specific repo and requests the `check_job_results` job be added.

---

## Preconditions

- `gh auth status` shows your GitHub identity with **write access to each target repo** (fork + PR if you don't have direct write).
- Target repo(s) identified (either from ClickUp subtasks or user input).
- `git`, `gh`, and `jq` available in PATH.

---

## Step A — Audit

Delegate to the `audit-repos` skill in `check-job-results-ready` mode against the target list.

```bash
# Example: audit two repos
# Invoke skill: audit-repos check-job-results-ready svtechnmaa/repo-a,svtechnmaa/repo-b
```

Consume the findings table output as the scope for Step C.
If the audit finds no repos needing the job, stop and report "all target repos already have check_job_results".

---

## Step B — Confirm with user

For each repo in scope, print the raw GitHub link to its workflows directory:

```
https://github.com/svtechnmaa/<repo>/tree/<default-branch>/.github/workflows/
```

Retrieve the default branch:

```bash
default_branch=$(gh repo view svtechnmaa/<repo> --json defaultBranchRef -q '.defaultBranchRef.name')
```

List workflow files:

```bash
gh api "/repos/svtechnmaa/<repo>/contents/.github/workflows" --jq '.[].name'
```

Ask the user:
1. Which workflow file is the **main** workflow? (the one all others are gated on)
2. Should this file be renamed to `main.yml`? (skip if it is already named `main.yml`)

Wait for explicit user confirmation before proceeding to Step C.

---

## Step C — Apply

All file-write operations run in a spawned subagent. The main loop must not call Edit/Write directly.

```bash
REPO="svtechnmaa/<repo>"
DEFAULT_BRANCH=$(gh repo view "$REPO" --json defaultBranchRef -q '.defaultBranchRef.name')
SCRATCHPAD="/tmp/rollout-check-job-results"
mkdir -p "$SCRATCHPAD"

# Clone
git clone "https://github.com/${REPO}.git" "${SCRATCHPAD}/<repo>"
cd "${SCRATCHPAD}/<repo>"

# Branch from default
git checkout "$DEFAULT_BRANCH"
git checkout -b fix/check-job-results

# Rename if needed (skip if already main.yml)
if [ "<current-name>" != "main.yml" ]; then
  git mv ".github/workflows/<current-name>" ".github/workflows/main.yml"
fi
```

Append the `check_job_results` job template to the end of `jobs:` in `.github/workflows/main.yml`.
Collect all existing job IDs first:

```bash
# Extract existing job IDs (keys under `jobs:`)
job_ids=$(grep -E '^  [a-z_][a-z0-9_-]+:' .github/workflows/main.yml \
  | sed 's/://; s/^ *//')
# Format as YAML list items: "      - job_id"
needs_list=$(echo "$job_ids" | sed 's/^/      - /')
```

Then append:

```yaml
  check_job_results:
    name: Check job results
    if: always()
    needs:
      - <all other job ids>
    runs-on: ubuntu-latest
    steps:
      - name: Check job results
        uses: svtechnmaa/.github/actions/check_job_results@main
        with:
          jobs: ${{ toJSON(needs) }}
```

Commit and push:

```bash
git add .github/workflows/main.yml
git commit -m "no-ci: add check_jobs_results job"
git push -u origin fix/check-job-results
```

Create PR:

```bash
PR_URL=$(gh pr create \
  --repo "$REPO" \
  --base "$DEFAULT_BRANCH" \
  --head fix/check-job-results \
  --title "no-ci: add check_jobs_results job" \
  --body "Adds the check_job_results composite action job as part of the org-wide rollout (ClickUp parent 86d40y9gr)." \
  --reviewer phamtranlinhchi,duchieu2k)

# If --reviewer flag is not accepted at create time, fall back:
# gh pr edit "$PR_URL" --add-reviewer phamtranlinhchi,duchieu2k
```

### Hard rules for Step C

- **Never** use `--force`, `--no-verify`, or `git commit --amend`.
- **Never** push directly to the default branch.
- Branch name must be exactly `fix/check-job-results`.
- Commit message must be exactly `no-ci: add check_jobs_results job`.

---

## Step D — ClickUp tracking

ClickUp reference IDs:

| Entity | ID |
|--------|----|
| Parent task | `86d40y9gr` |
| Bucket (parent lives under) | `86d45c45g` (Workflows) |
| List | `170724951` |
| Assignee: Tú Hoàng | `37650575` |
| Assignee: Chi Phạm | `270897282` |

> The parent task `86d40y9gr` is a child of the **Workflows** bucket (`86d45c45g`). All new rollout tracking tasks must follow the hierarchy contract in `.agentic/INSTRUCTIONS.md § ClickUp task hierarchy`.

Under the repo's subtask under parent `86d40y9gr`, create two sub-subtasks:

**Sub-subtask 1 — created PR**
- Name: `created PR: <PR_URL>`
- Status: `review`
- Assignee: `37650575` (Tú Hoàng)
- List: `170724951`

**Sub-subtask 2 — review**
- Name: `Review`
- Assignee: `270897282` (Chi Phạm)
- List: `170724951`

Then update the repo's parent subtask status to `in progress`.

Use ClickUp MCP tools if available. If not, leave a TODO comment in a file named `rollout-log.txt` in the scratchpad and continue.

---

## Skip criteria

Do not process a repo if it matches any of the following:

- Upstream fork used only for lint, PR-template, or release housekeeping workflows.
- Sync-bot-only repo (name matches `*-sync`, `*-mirror`, `*-fork`).
- All workflows are `disabled_manually` in `gh api /repos/.../actions/workflows`.
- No workflow runs in the last 6 months (`pushed_at < 6 months ago`).

Repos matching skip criteria are listed in the findings table with status `SKIP` and reason.

---

## Job template (canonical)

```yaml
  check_job_results:
    name: Check job results
    if: always()
    needs:
      - <all other job ids>
    runs-on: ubuntu-latest
    steps:
      - name: Check job results
        uses: svtechnmaa/.github/actions/check_job_results@main
        with:
          jobs: ${{ toJSON(needs) }}
```

Replace `<all other job ids>` with the actual job IDs extracted in Step C.
The `if: always()` is mandatory — do not omit it.
