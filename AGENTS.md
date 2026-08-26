# AGENTS.md — svtechnmaa/.github

Read `.agentic/INSTRUCTIONS.md` first — that is the single source of truth for all org-admin policy, playbooks, guardrails, and canonical facts. This file only adds Codex CLI-specific ergonomics that are not relevant to other agents.

**Prerequisites:** For setup (Codex CLI install, MCP config, per-OS steps) see `.agentic/INSTRUCTIONS.md §0`.

---

## Skill index

| Skill | Type | Description | Path |
|---|---|---|---|
| `audit-repos` | Read-only | Audits svtechnmaa repos in one of three modes: `compliance` (orphan-team, workflow-required, .githooks completeness per §2.8), `workflow-active` (active-state + last-6-months runs), `check-job-results-ready` (repos ready for rollout). Emits a Markdown findings table; never mutates. | `.codex/skills/audit-repos/SKILL.md` |
| `rollout-check-job-results` | Writes | Rolls out the `check_job_results` composite action to one or more repos. Delegates the audit step, confirms with user, opens a PR from branch `fix/check-job-results` with reviewers `phamtranlinhchi` + `duchieu2k`, and creates ClickUp tracking sub-subtasks under parent `86d40y9gr`. | `.codex/skills/rollout-check-job-results/SKILL.md` |

---

## Codex invocation notes

To invoke a skill from Codex CLI, reference the skill file directly in your prompt or config:

```bash
# From the repo root, invoke the audit skill:
codex "Follow .codex/skills/audit-repos/SKILL.md in check-job-results-ready mode for all repos"

# Invoke the rollout skill for a specific repo:
codex "Follow .codex/skills/rollout-check-job-results/SKILL.md for svtechnmaa/my-repo"
```

Codex uses Bash + `gh` CLI for all operations. MCP tools (GitHub, ClickUp) are used when available per the config in `~/.config/codex/config.toml`. If MCP is unavailable, Codex falls back to `gh` CLI for GitHub operations and leaves a TODO in a `rollout-log` file for ClickUp tracking steps.

MCP config location for Codex:

```toml
# ~/.config/codex/config.toml
[mcp_servers.github]
url = "https://api.githubcopilot.com/mcp/"
headers = { Authorization = "Bearer <FINE-GRAINED-PAT>" }
```

See `.agentic/INSTRUCTIONS.md §0` for the full MCP setup instructions.

---

## Change log

See `.agentic/INSTRUCTIONS.md §12` for all changes.
