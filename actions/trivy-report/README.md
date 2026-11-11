# One Trivy report for all scans

`run_trivy_scan_dockerfile` and `run_trivy_scan_image` report each scan on its
own by default. Set `merge_report: 'true'` on every scan to save results for
one report instead.
Each scan saves a uniquely named result under
`$RUNNER_TEMP/trivy-collect/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` and does not
send mail, write a job summary, or fail on findings in this mode.

Call `trivy-report` once after the last scan. It writes one job summary and prepares
one email when findings or scan errors exist. It preserves each scan's
`ignore_finding` setting: ignored findings appear in the report but do not fail
the job. Scan errors always fail the job. Put this step before publishing an image.

GitHub displays the Summary only after the scan job finishes. Set
`mail_after_job: 'true'` on `trivy-report` and add a downstream `trivy-mail`
job so the link is ready when the email arrives. By default, `trivy-report`
sends mail in the same job.

```yaml
- name: Scan Dockerfile
  uses: svtechnmaa/.github/actions/run_trivy_scan_dockerfile@main
  with:
    dockerfile_path: ./Dockerfile
    merge_report: 'true'
    ignore_finding: 'true'
    # Other existing inputs...

- name: Scan image
  uses: svtechnmaa/.github/actions/run_trivy_scan_image@main
  with:
    image_name: my-app
    image_tag: latest
    merge_report: 'true'
    ignore_finding: 'true'
    # Other existing inputs...

- name: Report all Trivy scans
  id: trivy_report
  if: always()
  uses: svtechnmaa/.github/actions/trivy-report@main
  with:
    mail_username: ${{ vars.MAIL_USERNAME }}
    mail_password: ${{ secrets.MAIL_PASSWORD }}
    mail_receivers: ${{ vars.DEFAULT_MAIL_RECIPIENTS }}
    it_team_email: ${{ vars.IT_TEAM_EMAIL }}
    mail_after_job: 'true'
```

Expose only `steps.trivy_report.outputs.send_mail` and `artifact_name` as
scan job outputs. The notify job reads the subject and recipients from the
mail artifact after download. Then add a downstream notify job:

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
```

The artifact contains `trivy-mail.html` (formatted email), `trivy-mail.txt`
(plain-text email), and `trivy-mail-details.json` (subject and recipients).
The GitHub Summary is written separately to `GITHUB_STEP_SUMMARY`.

For scans in separate jobs, upload the collection directory once at the end
of each scan job with a distinct artifact name (for example,
`trivy-results-${{ github.job }}`). In a final job with `needs` on every scan job
and `if: always()`, download the artifacts with `merge-multiple: true` into a
single directory, then pass that directory as `report_dir` to `trivy-report`
with `mail_after_job: 'true'`. A downstream notify job sends the single email
after the report job finishes and its Summary is available.
