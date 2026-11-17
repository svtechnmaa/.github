# Check job results

Call this action from a final job with `if: always()` and `needs` containing all
jobs that must be checked. Pass `jobs: ${{ toJSON(needs) }}`.

| Job result | Aggregate result |
| --- | --- |
| `success` or `skipped` | Accepted, preserving existing skip behavior |
| `failure` with output `scan_bypassed` exactly equal to string `true` | Accepted intentional Trivy vulnerability failure |
| Any other `failure` | Fail |
| `cancelled`, unknown result, or malformed job JSON | Fail |

Only expose `scan_bypassed` from the final `trivy-check-scan-status` action. Never
derive it directly from `ignore_finding`: that flag cannot prove the rest of a
build succeeded. The scan-status action must be the last job step, after all
required work. Existing callers without this output still fail for every failed
job. Other jobs' failures still block even when one build is bypassed.

The action needs Bash and jq, and does not use the GitHub API or require a token.
It evaluates the supplied job outputs, not job logs. It does not change the red
job or the overall workflow conclusion; only the aggregate check can pass.
