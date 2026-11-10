const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { aggregate } = require('./aggregate');

function run(scans) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-report-test-'));
  const reportDir = path.join(root, 'reports');
  fs.mkdirSync(reportDir);
  for (const [index, scan] of scans.entries()) {
    const dir = path.join(reportDir, `scan-${index}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(scan.meta));
    if (scan.report) fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(scan.report));
  }
  const output = path.join(root, 'output');
  const summary = path.join(root, 'summary');
  aggregate({
      ...process.env,
      REPORT_DIR: reportDir,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_REPOSITORY: 'svtechnmaa/svtech_report',
      GITHUB_SERVER_URL: 'https://github.com',
      MAIL_RECEIVERS: 'author@example.com,author@example.com',
      MAIL_USERNAME: 'sender@example.com',
      IT_TEAM_EMAIL: 'it@example.com',
    }, path.join(root, 'trivy-aggregate-mail.txt'));
  const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const data = {
    values,
    summary: fs.readFileSync(summary, 'utf8'),
    mail: fs.readFileSync(path.join(root, 'trivy-aggregate-mail.txt'), 'utf8'),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return data;
}

const vulnerability = { VulnerabilityID: 'CVE-2026-1', Severity: 'HIGH', PkgName: 'pkg', FixedVersion: '2.0' };
const secret = { RuleID: 'secret-rule', Severity: 'HIGH', Title: 'Credential', StartLine: 4 };

test('combines repeated scans, reports ignored findings, and sends one email to IT for secrets', () => {
  const data = run([
    { meta: { kind: 'dockerfile', target: './Dockerfile', ignore_finding: true, scan_ok: true }, report: { Results: [{ Target: 'Dockerfile', Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:first', ignore_finding: true, scan_ok: true }, report: { Results: [{ Target: 'app:first', Secrets: [secret] }] } },
    { meta: { kind: 'image', target: 'app:second', ignore_finding: true, scan_ok: true }, report: { Results: [] } },
  ]);
  assert.equal(data.values.scan_count, '3');
  assert.equal(data.values.finding_count, '2');
  assert.equal(data.values.gate_failed, 'false');
  assert.equal(data.values.send_mail, 'true');
  assert.equal(data.values.mail_receivers, 'author@example.com,it@example.com');
  assert.match(data.summary, /CVE-2026-1/);
  assert.match(data.summary, /app:second/);
  assert.doesNotMatch(data.mail, /secret-rule/);
});

test('findings block only scans without ignore_finding', () => {
  const data = run([
    { meta: { kind: 'dockerfile', target: './Dockerfile', ignore_finding: true, scan_ok: true }, report: { Results: [{ Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:latest', ignore_finding: false, scan_ok: true }, report: { Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.finding_count, '2');
});

test('scan errors remain blocking even when ignore_finding is true', () => {
  const data = run([
    { meta: { kind: 'image', target: 'app:latest', ignore_finding: true, scan_ok: false } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.summary, /Scan failed/);
});

test('missing results do not produce a clean report', () => {
  const data = run([]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
});
