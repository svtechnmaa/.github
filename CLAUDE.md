# CLAUDE.md — svtechnmaa/.github

Read `.agentic/INSTRUCTIONS.md` first — that is the single source of truth for all org-admin policy, playbooks, guardrails, and canonical facts. This file only adds Claude Code-specific ergonomics that are not relevant to other agents.

**Prerequisites:** For setup (Claude Code install, MCP config, per-OS steps) see `.agentic/INSTRUCTIONS.md §0`.

---

## Skill index

| Skill | Type | Description | Path |
|---|---|---|---|
| `audit-repos` | Read-only | Audits svtechnmaa repos in one of three modes: `compliance` (orphan-team, workflow-required, .githooks completeness per §2.8), `workflow-active` (active-state + last-6-months runs), `check-job-results-ready` (repos ready for rollout). Emits a Markdown findings table; never mutates. | `.claude/skills/audit-repos/SKILL.md` |
| `rollout-check-job-results` | Writes | Rolls out the `check_job_results` composite action to one or more repos. Delegates the audit step, confirms with user, opens a PR from branch `fix/check-job-results` with reviewers `phamtranlinhchi` + `duchieu2k`, and creates ClickUp tracking sub-subtasks under parent `86d40y9gr`. | `.claude/skills/rollout-check-job-results/SKILL.md` |

---

## Subagent delegation rule

Never call Edit / Write / MultiEdit / apply_patch in the main conversation loop. Any file-writing work — code, config, workflow YAML, dotfiles — must be handled by a subagent (`general-purpose`, `model: sonnet`). The main loop stays for orchestration, read-only ops (Read, Grep, Bash status/verify commands, git log/status/diff), and user communication.

Override: if the user explicitly says "just do it yourself" or "don't spawn a subagent for this one", honor for that turn only.

---

## PR-review workflow

After completing `/review`, always ask whether to submit the review to GitHub with per-file inline comments. Offer these options based on findings:

- **Request Changes** — if there are critical issues (security, correctness, data loss)
- **Comment** — if there are only suggestions or minor issues
- **Approve** — if there are no critical or warning-level issues

---

## Change log

See `.agentic/INSTRUCTIONS.md §12` for all changes.
