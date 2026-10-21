# GitHub artifacts with SeaweedFS fallback

This shared Linux composite action provides artifact upload/download with S3 fallback.
It lives in `actions/artifact_with_s3_fallback/` in the `svtechnmaa/.github` repository.
Fallback runs in the producing/consuming job so that it has access to local files.

- Upload: try `actions/upload-artifact@v4`, with `continue-on-error: true`.
  Only on failure, upload a tar.gz archive to SeaweedFS.
- Download: try `actions/download-artifact@v4`, with `continue-on-error: true`.
  Only on failure, download and extract the tar.gz from SeaweedFS.
- A successful fallback makes the artifact step succeed. If fallback fails, the
  step fails. Earlier deployment/test failures are still failures.
- An absent/empty upload source is an error, rather than a successful empty upload.
- Uploads invoked with `if: always()` still attempt transfer after earlier failures.

## Secrets and runner setup

Create organization secrets `S3_ARTIFACT_ACCESS_KEY` and
`S3_ARTIFACT_SECRET_KEY`, and grant this repository access to them. The workflow
passes them explicitly because composite actions cannot read secrets directly.
Secrets must be available for fallback (fork PRs normally do not receive them).

Runners need Bash, curl 7.75.0+ (with `--aws-sigv4`), GNU tar, find, awk,
sha256sum and standard coreutils. No Python, AWS CLI or package installation is
needed. Fallback calls `https://s3.svtechdev.org` directly with curl. S3 requests
use Signature V4, path-style bucket addressing, region `us-east-1`, and the
`github-artifacts` bucket by default. Transfers retry transient errors up to three
times; each attempt has a 10-minute timeout. Upload uses a single S3 PUT, so keep
compressed artifacts within the endpoint's single-request size limit.

Call the action directly; no checkout of the action repository is needed.
For a private action repository, enable access for caller repositories under
**Settings → Actions → General → Access**. Publish this action to `main` in
`svtechnmaa/.github` before running workflows that reference it.

```yaml
- uses: svtechnmaa/.github/actions/artifact_with_s3_fallback@main
  if: always()
  with:
    operation: upload
    name: vm_vars
    path: ${{ github.workspace }}/build_vars.yml
    s3-access-key: ${{ secrets.S3_ARTIFACT_ACCESS_KEY }}
    s3-secret-key: ${{ secrets.S3_ARTIFACT_SECRET_KEY }}

- uses: svtechnmaa/.github/actions/artifact_with_s3_fallback@main
  with:
    operation: download
    name: vm_vars
    path: ${{ github.workspace }}
    s3-access-key: ${{ secrets.S3_ARTIFACT_ACCESS_KEY }}
    s3-secret-key: ${{ secrets.S3_ARTIFACT_SECRET_KEY }}
```

## Storage and retention

S3 keys group artifacts by organization/owner, repository, workflow, run and attempt:

```text
github-artifacts/
└── svtechnmaa/
    └── charts/
        └── workflows/
            └── main.yml/
                └── runs/
                    └── 123-987654321/
                        └── attempts/
                        │   ├── 1/artifacts/
                        │   │   ├── vm_vars.tar.gz
                        │   │   └── robot-nmaa-result-#123.tar.gz
                        │   └── 2/artifacts/
                        │       └── nmaa_build_vars.tar.gz
```

Key format:
`<owner>/<repo>/workflows/<workflow-file>/runs/<run-number>-<run-id>/attempts/<attempt>/artifacts/<artifact-name>.tar.gz`.

- Owner and repository come from the caller's `GITHUB_REPOSITORY`, so artifacts
  stay under `svtechnmaa/charts`, rather than the shared action repository.
- Workflow filename comes from `GITHUB_WORKFLOW_REF` (for example `main.yml`).
  Different workflow files can have the same display name without colliding.
- The run folder combines the human-facing run number with the unique run ID.
- Each attempt has its own artifacts, so reruns do not overwrite earlier S3 copies.
  Artifact names are scoped to a run/attempt, just as GitHub artifacts are scoped
  to a run. The producing job is object metadata rather than another path level,
  allowing other jobs to download an artifact by name.
- Names are URL-encoded for HTTP requests; object keys retain readable names such
  as `robot-nmaa-result-#123.tar.gz` in an S3 browser.
- Upload metadata includes the GitHub run/attempt URL, workflow display name,
  producer job and commit SHA. Workflow/job metadata values are URL-encoded.

Download tries the current attempt first, then earlier attempts in descending
order within the **same run and workflow**. This supports rerunning a failed
consumer without rerunning successful producers. Only HTTP 404 advances to the
next candidate; permission errors, connection failures and server errors fail the
step after curl's retries. A corrupt downloaded archive also fails the step.
As a final migration fallback, it checks the old
`<owner>/<repo>/<run-id>/<artifact-name>.tar.gz` key. New uploads only use the new
layout; existing S3 objects are not moved or deleted.

A file is restored by basename (`build_vars.yml`); a directory
is restored by its contents, without adding a `test_result/` wrapper. Directory
uploads exclude hidden files/directories, matching GitHub's default. This action
accepts one literal file/directory path, without globs or multiline patterns.

GitHub retention is 60 days. SeaweedFS expiration must be configured on the server
or bucket; the action assumes the stated 60-day TTL already exists. It does not
change lifecycle policy on every upload. See [SeaweedFS lifecycle documentation](https://github.com/seaweedfs/seaweedfs/wiki/S3-Lifecycle).

This is fallback storage, so a successful GitHub upload does **not** create an S3
copy. If a subsequent GitHub download fails, S3 can only recover an artifact that
was previously uploaded there. For guaranteed availability from both backends,
uploads must also mirror to S3. When rerunning producers, the two backends may
contain different versions if their selected upload backend changes.

An actual SeaweedFS transfer needs a workflow run with the organization secrets.
