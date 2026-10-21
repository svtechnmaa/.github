# .github

A magic repo for workflow template.
These templates appear in the **Actions → New workflow** picker for repositories
in the organization.

For chart/CD configuration instructions, see
[`workflow-templates/README.md`](workflow-templates/README.md).

The shared `actions/trivy-scan` action skips report artifact uploads for
`svtechnmaa/x-portal`. Its scans, job summary, notifications and finding-based
failure checks still run. This keeps the project's security check independent
of artifact storage quota; other repositories retain report uploads.
