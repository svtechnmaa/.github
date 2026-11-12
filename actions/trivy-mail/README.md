# Trivy Mail

Call this action in a job that runs after `trivy-report`. It downloads the email artifact, selects recipients, and sends one HTML email with a plain-text fallback.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `artifact_name` | Yes | — | Artifact name from `trivy-report.outputs.artifact_name`. |
| `mail_username` | Yes | — | SMTP sender address; also used as the recipient fallback. |
| `mail_password` | Yes | — | SMTP password. |
| `mail_receivers` | No | Empty | Comma-separated recipients. GitHub `noreply` addresses are removed. |
| `it_team_email` | No | Empty | Added to recipients when the report contains secrets. |
| `smtp_server` | No | `smtp.gmail.com` | SMTP server. |
| `smtp_port` | No | `465` | SMTP port. |

## Output

No declared outputs. The action downloads `trivy-mail.html`, `trivy-mail.txt`, and `trivy-mail-details.json`, then sends the email. If no recipients remain after filtering, it falls back to `mail_username`; if that is empty, the action fails.
