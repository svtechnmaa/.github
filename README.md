# svtechnmaa/.github

This is the organisation-level `.github` repository for `svtechnmaa`. It serves three purposes at once: it holds the org-wide GitHub community defaults (organisation profile, funding links, etc.); it owns the shared composite GitHub Actions used across all repos; and it contains the agentic knowledge base — playbooks, guardrails, and skills — that allow both Claude Code and Codex CLI to run organisation-admin tasks autonomously. Everything a maintainer or an AI agent needs to operate on `svtechnmaa` starts here.

---

## Repository layout

```text
.github/                        # GitHub metadata (workflows, etc.)
  workflows/
    agentic-parity.yml          # CI: blocks PRs if agent-side parity check fails
.agentic/                       # Tool-agnostic org-admin knowledge base
  INSTRUCTIONS.md               # Single source of truth — read this first
  phases/
    audit-repos.md              # Step-by-step phase doc: audit skill
    rollout-check-job-results.md  # Step-by-step phase doc: rollout skill
  tests/
    parity.sh                   # Enforces parity between Claude and Codex sides
.claude/                        # Claude Code agent config
  skills/
    audit-repos/                # Skill: read-only repo compliance audit
    rollout-check-job-results/  # Skill: roll out check_job_results action
.codex/                         # Codex CLI agent config (mirrors .claude/)
  skills/
    audit-repos/
    rollout-check-job-results/
.githooks/                      # Shared git hooks — installed via core.hooksPath
actions/                        # Reusable composite GitHub Actions
  check_job_results/            # Composite action: aggregate job status checks
CLAUDE.md                       # Claude Code agent stub (delegates to .agentic/)
AGENTS.md                       # Codex CLI agent stub (delegates to .agentic/)
```

---

## For humans

**Start here:** Read [`.agentic/INSTRUCTIONS.md`](.agentic/INSTRUCTIONS.md). It is the single source of truth for org-admin policy, playbooks, canonical facts, and the per-OS setup matrix.

**Install shared git hooks** in any repo that should run the org hooks:

```bash
git config core.hooksPath .githooks
```

**Run the parity check** to verify that the Claude and Codex agent sides are in sync:

```bash
bash .agentic/tests/parity.sh
```

---

## For AI agents

Claude Code reads `CLAUDE.md`; Codex CLI reads `AGENTS.md`. Both are thin stubs that immediately delegate to `.agentic/INSTRUCTIONS.md`, which is the tool-agnostic source of truth for all org-admin knowledge. Two skills are available to both agents: `audit-repos` (read-only — audits repos for compliance, workflow state, or rollout readiness) and `rollout-check-job-results` (writes — opens PRs to deploy the `check_job_results` composite action across repos). Parity between the two agent sides is enforced by `bash .agentic/tests/parity.sh`, which is run by the `.githooks/pre-commit` hook and by the `agentic-parity` CI workflow, so any drift is blocked at merge time.

---

## Prerequisites

See [`.agentic/INSTRUCTIONS.md §0`](.agentic/INSTRUCTIONS.md) for the per-OS setup matrix (macOS / Ubuntu / Windows) and MCP server configuration.

---

## Contributing

- Only `.claude/**` and `.codex/**` skill directories must be kept in parity. `.agentic/**` is the shared source of truth (not mirrored per agent). `CLAUDE.md` and `AGENTS.md` are agent-specific stubs and may contain per-agent sections.
- Run `bash .agentic/tests/parity.sh` locally before pushing — the `agentic-parity` CI check will block the PR if it fails.
- Composite actions under `actions/` follow standard GitHub Actions authoring conventions; keep `action.yml` as the entry point for each action.
- Workflows under `.github/workflows/` that enforce org-wide policy should be documented in `.agentic/INSTRUCTIONS.md`.

---

## License / contact

This is an internal `svtechnmaa` organisation repository. Direct questions or access requests to the org owners.
