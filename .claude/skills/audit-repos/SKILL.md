---
name: audit-repos
description: Read-only audit of svtechnmaa repos. Modes — `compliance` (orphan-team, workflow-required, .githooks completeness per INSTRUCTIONS.md §2.8), `workflow-active` (active-state + last-6-months runs), `check-job-results-ready` (repos ready for the check_job_results rollout). Emits a Markdown findings table; never mutates.
allowed-tools: [Bash, Read]
argument-hint: "compliance | workflow-active | check-job-results-ready [repo,repo,...]"
---

## When to Use

Invoke when you need a read-only picture of org-wide policy adherence, workflow health,
or pre-rollout scoping. This skill never writes, never opens PRs, never modifies any repo.
It is safe to run at any time, including pre-production.

## Steps

Follow `.agentic/phases/audit-repos.md` for the authoritative step sequence.

- **`compliance` mode** — runs Checks A (orphan repos), B (workflow requirement for DevOps/CI/SRE/OrgAdmin scope), and C (`.githooks/` completeness: all 5 required files).
- **`workflow-active` mode** — verifies `.github/workflows/*` files are present AND `gh api /repos/.../actions/workflows` returns `state == "active"` AND at least one run exists in the last 6 months. Apply skip criteria documented in the phase doc before flagging.
- **`check-job-results-ready` mode** — identifies repos that pass `workflow-active` checks but whose workflow YAML does not yet contain a `check_job_results` job. This is the pre-audit for `rollout-check-job-results`.

Emit one Markdown findings table per check. Prepend a summary line with mode, date, and counts.

## Common Mistakes

- **Checking file presence only** — verifying `.github/workflows/*.yml` exists is not enough; you must also confirm `state == "active"` via the Actions API. A file present with `state == "disabled_manually"` is not active.
- **Skipping the `state == active` verification** — always call `gh api /repos/.../actions/workflows` and filter on `.state`. Do not assume files equal active workflows.
- **Dumping raw JSON** — never output raw API JSON to the user. Always transform to a Markdown table before responding. Use `--jq` or pipe through `jq` to filter first.
- **Auto-fixing findings** — this skill is read-only. If a fix is needed, report it and stop. The `rollout-check-job-results` skill handles writes.
