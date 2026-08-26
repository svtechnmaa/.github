---
name: rollout-check-job-results
description: Roll out the check_job_results composite action to svtechnmaa repos. Audits first, confirms with user, opens PR from fix/check-job-results with reviewers phamtranlinhchi+duchieu2k, and tracks in ClickUp under parent 86d40y9gr.
---

# rollout-check-job-results

Follow `.agentic/phases/rollout-check-job-results.md` for the full step sequence.
Use `bash` and `gh` CLI for all git and GitHub operations.
For ClickUp tracking (Step D), use ClickUp MCP tools if available; otherwise write a TODO
entry to `rollout-log.txt` in the scratchpad directory and continue.
Never force-push, skip the audit step, or open a PR without both reviewers assigned.
