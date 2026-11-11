# One Trivy report for all scans

## Flow at a glance

```text
Dockerfile/image scans
  -> collect results without sending mail
  -> trivy-report (once after all scans)
       -> write one GitHub Summary and decide whether findings fail the job
       -> no findings and no scan errors: no mail
       -> any findings or scan errors:
            save mail artifact -> scan job finishes
            -> trivy-mail sends one mail
```

`run_trivy_scan_dockerfile` and `run_trivy_scan_image` only scan and collect
results. Each scan saves a uniquely named result under
`$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` and does not
send mail, write a job summary, or fail on findings. A workflow must call
`trivy-report` after its scans to publish the Summary and enforce the result.

Call `trivy-report` once after the last scan. It writes one job summary and prepares
one email when findings or scan errors exist. It preserves each scan's
`ignore_finding` setting: ignored findings appear in the report but do not fail
the job. Scan errors always fail the job. Put this step before publishing an image.

GitHub displays the Summary only after the scan job finishes. `trivy-report`
always saves the mail files as an artifact when findings or scan errors exist.
A downstream `trivy-mail` job sends the mail after the Summary is available.
Only `trivy-mail` receives SMTP credentials and recipient addresses.

```yaml
- name: Scan Dockerfile
  uses: svtechnmaa/.github/actions/run_trivy_scan_dockerfile@main
  with:
    dockerfile_path: ./Dockerfile
    ignore_finding: 'true'
    # Other existing inputs...

- name: Scan image
  uses: svtechnmaa/.github/actions/run_trivy_scan_image@main
  with:
    image_name: my-app
    image_tag: latest
    ignore_finding: 'true'
    # Other existing inputs...

- name: Report all Trivy scans
  id: trivy_report
  if: always()
  uses: svtechnmaa/.github/actions/trivy-report@main
```

Expose `steps.trivy_report.outputs.send_mail` and `artifact_name` as scan job
outputs. If the commit author should receive mail, expose their email as a
separate job output. Then add a downstream notify job:

```yaml
jobs:
  scan:
    outputs:
      trivy_send_mail: ${{ steps.trivy_report.outputs.send_mail }}
      trivy_mail_artifact: ${{ steps.trivy_report.outputs.artifact_name }}
    # Runner and scan steps from above...

  notify_trivy:
    needs: scan
    if: always() && needs.scan.outputs.trivy_send_mail == 'true'
    runs-on: ubuntu-latest
    permissions:
      actions: read
    steps:
      - name: Mail completed report
        uses: svtechnmaa/.github/actions/trivy-mail@main
        with:
          artifact_name: ${{ needs.scan.outputs.trivy_mail_artifact }}
          mail_username: ${{ vars.MAIL_USERNAME }}
          mail_password: ${{ secrets.MAIL_PASSWORD }}
          mail_receivers: ${{ vars.DEFAULT_MAIL_RECIPIENTS }}
          it_team_email: ${{ vars.IT_TEAM_EMAIL }}
```

The artifact contains `trivy-mail.html` (formatted email), `trivy-mail.txt`
(plain-text email), and `trivy-mail-details.json` (subject and secret count).
The GitHub Summary is written separately to `GITHUB_STEP_SUMMARY`.

For scans in separate jobs, upload the collection directory once at the end
of each scan job with a distinct artifact name (for example,
`trivy-results-${{ github.job }}`). In a final job with `needs` on every scan job
and `if: always()`, download the artifacts with `merge-multiple: true` into a
single directory, then pass that directory as `report_dir` to `trivy-report`.
A downstream notify job sends the single email
after the report job finishes and its Summary is available.
