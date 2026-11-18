# Trivy Mail

Call this action in a job that runs after `trivy-report`. It downloads the email artifact, selects recipients, and sends one HTML email with a plain-text fallback.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `notification_artifact_name` | Yes | — | Artifact name from `trivy-report.outputs.notification_artifact_name`. |
| `smtp_username` | Yes | — | SMTP authentication username. |
| `smtp_password` | Yes | — | SMTP authentication password. |
| `recipients` | No | Empty | Comma-separated recipients. GitHub `noreply` addresses are removed. |
| `from_address` | No | SMTP username | Sender address. |
| `it_team_email` | No | Empty | Added to recipients when the report contains secrets. |
| `smtp_server` | No | `smtp.gmail.com` | SMTP server. |
| `smtp_port` | No | `465` | SMTP port. |

## Output

No declared outputs. The action downloads `trivy-mail.html`, `trivy-mail.txt`, and `trivy-mail-details.json`, then sends the email. If no recipients remain after filtering, it falls back to the sender address; if that is empty, the action fails. Legacy input names remain available during migration.
