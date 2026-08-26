---
name: audit-repos
description: Read-only audit of svtechnmaa repos. Modes — compliance, workflow-active, check-job-results-ready. Emits a Markdown findings table; never mutates.
---

# audit-repos

Follow `.agentic/phases/audit-repos.md` for the full step sequence.
Use `bash` and `gh` CLI only — no MCP tools required.
Output must be a Markdown table; never dump raw JSON.
This skill is read-only: report findings and stop. Do not auto-fix.
