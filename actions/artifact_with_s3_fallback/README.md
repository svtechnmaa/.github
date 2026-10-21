# GitHub artifacts with SeaweedFS fallback

Shared Linux composite action in `svtechnmaa/.github/actions/artifact_with_s3_fallback`.
It tries `actions/upload-artifact@v7` or `actions/download-artifact@v8` first,
with `continue-on-error: true`, then uses Bash/curl to transfer through S3 on
failure. A failed fallback fails the caller step, unless that step also sets
`continue-on-error: true`. Earlier deployment/test failures remain failures.

## Inputs

Upload inputs follow [upload-artifact@v7](https://github.com/actions/upload-artifact/tree/v7).

| Input | Default | GitHub | SeaweedFS fallback |
| --- | --- | --- | --- |
| `operation` | `upload` | `upload` or `download` | Same |
| `name` | `artifact` | Artifact name | Same; with `archive: false`, upload uses the file basename |
| `path` | Required | File, directory, wildcard, multiline paths and `!exclude`; download destination | Same matching/root layout using `@actions/glob` |
| `if-no-files-found` | `warn` | `warn`, `error`, `ignore` | Same; warn/ignore skip S3 upload successfully if no matches |
| `retention-days` | `0` | Repository default at 0; otherwise requested retention | Bucket/server TTL remains 60 days; requested value is metadata, not expiration enforcement |
| `compression-level` | `6` | ZIP level 0–9 | tar without compression at 0; gzip level 1–9 otherwise; ignored for raw uploads |
| `overwrite` | `false` | Replace an existing artifact if true | Replace the same S3 artifact in the current attempt; false sends `If-None-Match: *` and an existing object fails with HTTP 412 |
| `include-hidden-files` | `false` | Include dotfiles and hidden directories if true | Same matching policy |
| `archive` | `true` | ZIP if true; exactly one file uploaded unchanged if false, named after its basename | tar/tar.gz if true; exactly one file uploaded unchanged if false, named after its basename |
| `s3-access-key` | Empty | Unused | Access key; required on transfer |
| `s3-secret-key` | Empty | Unused | Secret key; required on transfer |
| `s3-endpoint` | `https://s3.svtechdev.org` | Unused | HTTPS endpoint |
| `s3-bucket` | `github-artifacts` | Unused | Artifact bucket |
| `s3-region` | `us-east-1` | Unused | Signature V4 region |
| `s3-retry-count` | `3` | Unused | Retries per S3 request after the initial attempt; nonnegative integer; `0` disables retries |

Upload-specific options describe upload behavior; S3 options apply to both upload
and download. Download restores a
single named artifact and auto-detects its S3 format from object metadata. For a
raw upload, download by its **file basename**, because the upload `name` was
ignored. Download does not support fetching all artifacts, patterns of artifact
names, artifact IDs, or another repository/run. GitHub-specific upload outputs
are not exposed by this wrapper.

`overwrite` applies independently in each backend: a duplicate GitHub upload can
fail and trigger S3 fallback. S3 prevents replacement only within the same attempt;
earlier attempts remain separate. SeaweedFS must support conditional S3 PUTs for
the no-overwrite guarantee. This is not a global cross-backend artifact registry.

## Usage

```yaml
- uses: svtechnmaa/.github/actions/artifact_with_s3_fallback@main
  if: always()
  continue-on-error: true # Optional for informational Robot reports
  with:
    operation: upload
    name: robot-nmaa-result-#${{ github.run_number }}
    path: |
      ${{ github.workspace }}/test_result/**
      !${{ github.workspace }}/test_result/**/*.tmp
    s3-retry-count: 3 # Optional; retries after the initial request
    s3-access-key: ${{ secrets.S3_ARTIFACT_ACCESS_KEY }}
    s3-secret-key: ${{ secrets.S3_ARTIFACT_SECRET_KEY }}

- uses: svtechnmaa/.github/actions/artifact_with_s3_fallback@main
  with:
    operation: download
    name: robot-nmaa-result-#${{ github.run_number }}
    path: ${{ github.workspace }}/restored-results
    s3-access-key: ${{ secrets.S3_ARTIFACT_ACCESS_KEY }}
    s3-secret-key: ${{ secrets.S3_ARTIFACT_SECRET_KEY }}
```

Raw upload example:

```yaml
- uses: svtechnmaa/.github/actions/artifact_with_s3_fallback@main
  with:
    path: dist/release.tar.gz
    archive: false # Effective artifact name: release.tar.gz
    s3-access-key: ${{ secrets.S3_ARTIFACT_ACCESS_KEY }}
    s3-secret-key: ${{ secrets.S3_ARTIFACT_SECRET_KEY }}
```

The existing charts `main.yml` explicitly sets `if-no-files-found: error`,
`retention-days: 60` and `overwrite: true` on its uploads to retain its earlier
behavior. Robot report uploads keep caller-level `continue-on-error: true`.

## Runner and repository setup

Use Actions Runner **2.327.1+** for the Node 24 actions. Linux runners also need
Bash, curl 7.75.0+ with `--aws-sigv4`, GNU tar, gzip, awk, sha256sum and coreutils.
Only failed GitHub uploads invoke `actions/github-script@v8` to resolve files with
its built-in `@actions/glob`. This handles wildcard patterns, exclusions, tilde
expansion, hidden-file filtering and the least common ancestor of search paths.
There is no Python, AWS CLI, npm or pip installation in the workflow. S3 file
transfers still run in Bash with curl.

Create organization secrets `S3_ARTIFACT_ACCESS_KEY` and
`S3_ARTIFACT_SECRET_KEY`, granting caller repositories access. Fork PRs normally
do not receive these secrets. Transfers use Signature V4 and path-style bucket
addressing and retry transient errors using curl's retry policy, including
connection-refused errors. `s3-retry-count` applies to every S3 PUT and GET,
including lookups in earlier attempts and legacy paths. Its default of `3` means
one initial request plus up to three retries (four attempts total); `0` disables
retries. Retry delay is 2 seconds, and each attempt is limited to 10 minutes.
HTTP 403, 404 and 412 are not retried; 404 proceeds to the next lookup candidate.
Upload uses a single S3 PUT, subject to the endpoint's request-size
limit. Access to the GitHub actions and the S3 endpoint is required.

Call the shared action directly, without checking out its repository. For a
private action repository, enable caller access under **Settings → Actions →
General → Access**. Publish changes to `svtechnmaa/.github@main` before running
updated caller workflows.

## S3 layout and reruns

```text
github-artifacts/
└── svtechnmaa/charts/
    └── workflows/main.yml/
        └── runs/123-987654321/
            └── attempts/
                ├── 1/artifacts/
                │   ├── vm_vars/content
                │   └── robot-nmaa-result-#123/content
                └── 2/artifacts/
                    └── release.tar.gz/content
```

Key format:
`<owner>/<repo>/workflows/<workflow-file>/runs/<run-number>-<run-id>/attempts/<attempt>/artifacts/<artifact-name>/content`.

Owner/repository refer to the caller, not the shared action repository. The
workflow filename comes from `GITHUB_WORKFLOW_REF`, so duplicate display names
do not collide. Run folders combine the visible run number and unique run ID.
Each attempt remains separate. Artifact names are URL-encoded in HTTP requests
and remain readable in S3 browsers.

The stable `content` key prevents collisions between raw files and archives,
including artifacts whose names already end in `.tar.gz`. Object metadata records
format (`tar`, `tar+gzip` or `raw`), requested retention, GitHub run/attempt URL,
workflow display name, producing job and commit SHA. Workflow/job values are
URL-encoded. S3 archives use tar rather than GitHub ZIP; download restores their
contents automatically, while raw downloads preserve the file bytes.

Download checks the current attempt, then previous attempts in the same workflow
run. Within each attempt it also checks the old `<artifact-name>.tar.gz` key.
As a final migration fallback it checks the original
`<owner>/<repo>/<run-id>/<artifact-name>.tar.gz` key. Only HTTP 404 advances to the
next candidate; access/network/server errors or corrupt archives fail the step.
Existing objects are not moved or deleted. This supports rerunning failed
consumers without rerunning successful producers.

## Retention and fallback limits

`retention-days` is forwarded to GitHub. It does not change S3 expiration or bucket
policy. SeaweedFS still uses the configured **60-day TTL**; an explicit different
retention value produces a fallback warning. An S3 `Expires` header would only
control HTTP caching, not automatic object deletion. See [SeaweedFS lifecycle
documentation](https://github.com/seaweedfs/seaweedfs/wiki/S3-Lifecycle).

A successful GitHub upload does **not** create an S3 copy. A later failed GitHub
download can recover only data already uploaded to S3. Mirroring every upload is
required for guaranteed copies in both backends. If rerun producers change upload
backend, the backends can contain different versions of an artifact.

Real SeaweedFS verification needs a workflow run with the organization secrets.
