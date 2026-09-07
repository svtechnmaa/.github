# CI/CD Pipeline chart settings

The `ci.yml` starter workflow can update your Helm chart repositories after a
semantic release. When you choose the workflow from **Actions → New workflow**,
review the four chart settings in the `Publish chart and stacked-chart updates`
step before committing the generated workflow.

```yaml
chart_values_file: kubernetes/my-app/values.yaml
chart_image_repository: my-org/my-app
charts_repository_name: charts
stack_charts_string: my-app
```

## What to change

| Setting | What it means | Example |
| --- | --- | --- |
| `chart_values_file` | Path to the image values file inside the `charts_repository`. The file must contain an image `repository:` line followed by its `tag:` line. | `kubernetes/my-app/values.yaml` |
| `chart_image_repository` | Exact value of the chart’s `repository:` field. The action finds this value and changes the following `tag:` to the new release tag. | `my-org/my-app` |
| `charts_repository_name` | Repository name passed to the stacked-chart update utility. Use the repository name only, not the full `owner/name`. | `charts` |
| `stack_charts_string` | Chart or application identifier understood by your stacked-chart update utility. | `my-app` |

## Related repository settings

The generated workflow assumes these repositories and branches by default:

- `OWNER/charts` on `main`
- `OWNER/stacked_charts` on `master`
- `OWNER/SVTECH_CICD_Utilities` on `dev-jenkins`

Change the `*_repository` and `*_ref` values in the generated workflow if your
organization uses different names or branches.

## Required secrets

Chart CD runs only after a semantic release and requires:

- `PUSH_TOKEN`: permission to clone and push the chart repositories
- `GPG_PRIVATE_KEY`: private key used to sign commits
- `GPG_KEY_ID`: key fingerprint or signing key ID
- `GPG_PASSPHRASE`: passphrase, when the key is protected

The chart update action fails early if the values file or image repository entry
cannot be found, so verify the path and repository string before enabling a
release.

## Optional Docker Compose testing

The CI template normally starts the built application image with the reusable
container action. For repositories that need multiple services, manually run
the workflow with `run_compose` enabled and set `compose_file` if the file is
not `docker-compose.yml`. Compose replaces the single-container launcher to
avoid port conflicts. The workflow validates the file, waits for services to
start, and removes Compose containers and networks afterward without removing
volumes. It assigns a run-specific Compose project name; avoid fixed
`container_name` values in Compose files if multiple repositories share a
self-hosted runner.

If the Compose file should test the exact image built by CI, reference the
provided `COMPOSE_IMAGE` environment variable in its service definition, for
example: `image: ${COMPOSE_IMAGE}`.

## GHCR cleanup settings

The `cleanup.yml` starter workflow is safe by default: scheduled runs and manual
runs start in preview-only mode. It only deletes package versions when a manual
run explicitly sets `dry_run` to `false` and types `DELETE` into
`confirm_delete`.
Each run also has a configurable deletion cap (`max_deletions`, default `20`,
maximum `100`). Release-like semantic-version tags (`vX.Y.Z`, including
prerelease/build suffixes) and the `latest` tag are always excluded; only
expired tags beginning with `test-v` are eligible.
Runs are serialized per repository so overlapping cleanup runs cannot race each
other.
