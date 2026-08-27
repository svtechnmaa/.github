---
name: rollout-check-job-results
description: Roll out the `check_job_results` composite action to one or more svtechnmaa repos. Delegates the audit step to `audit-repos` skill (mode `check-job-results-ready`), then confirms with user, opens a PR from branch `fix/check-job-results` with commit `no-ci: add check_jobs_results job` and reviewers `phamtranlinhchi`+`duchieu2k`, and creates ClickUp tracking sub-subtasks under ClickUp parent 86d40y9gr.
allowed-tools: [Bash, Read, AskUserQuestion, Agent]
argument-hint: "[repo-name] or comma-separated list"
---

# rollout-check-job-results

## When to Use

Invoke when either of the following is true:

1. ClickUp parent task `86d40y9gr` has one or more subtasks with "Need check_job_results: Yes".
2. The user explicitly names a repo and asks to add the `check_job_results` job.

Do not invoke without a confirmed target repo. Do not skip the audit step to save time.

## Steps

Follow `.agentic/phases/rollout-check-job-results.md` for the authoritative step sequence.

**Main-loop delegation rule:** the clone / edit / commit / push / PR steps (Step C) must run
in a spawned Sonnet subagent via the `Agent` tool. The main loop handles orchestration only:
it invokes the audit, presents the confirmation to the user, and hands Step C off to the subagent.
Never call `Edit` or `Write` directly in the main loop.

Summary of steps:

- **Step A** — Delegate to `audit-repos` skill in `check-job-results-ready` mode. If the audit
  finds no eligible repos, stop and report.
- **Step B** — Print the workflows directory link and ask the user which file is main and whether
  to rename to `main.yml`. Wait for explicit confirmation.
- **Step C** — Spawn a Sonnet subagent to: clone to scratchpad, branch `fix/check-job-results`
  from default branch, optionally `git mv`, append job template, commit
  `no-ci: add check_jobs_results job`, push, and open PR with reviewers
  `phamtranlinhchi` and `duchieu2k`.
- **Step D** — Create ClickUp sub-subtasks (`created PR: <URL>` + `Review`) under the repo's
  subtask under `86d40y9gr`, then update the parent subtask to `in progress`.

## Common Mistakes

- **Forgot reviewers** — every PR must have both `phamtranlinhchi` and `duchieu2k` as reviewers.
  If `--reviewer` fails at PR create time, fall back to `gh pr edit <URL> --add-reviewer ...`.
- **Forgot parent → in progress** — after creating the sub-subtasks, always update the repo's
  parent subtask status to `in progress` in ClickUp.
- **Wrong branch name** — branch must be exactly `fix/check-job-results`. No variations.
- **Commit message typo** — commit must be exactly `no-ci: add check_jobs_results job`
  (note: `check_jobs_results` has an `s` before `_job`). Match exactly.
- **Force push / no-verify / amend** — these are prohibited. Never use `--force`, `--no-verify`,
  or `git commit --amend` at any point. If the push is rejected, investigate root cause.
- **Skipped audit delegation** — never go directly to Step C. The audit (Step A) is mandatory
  to confirm the repo is eligible and to avoid duplicate work on repos that already have the job.

> ClickUp writes follow the hierarchy contract in `.agentic/INSTRUCTIONS.md § ClickUp task hierarchy`.
