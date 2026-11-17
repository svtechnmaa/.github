const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateReport } = require('./generate-report');

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
  generateReport({
      ...process.env,
      REPORT_DIR: reportDir,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_REPOSITORY: 'svtechnmaa/svtech_report',
      GITHUB_SERVER_URL: 'https://github.com',
    }, root);
  const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const data = {
    values,
    summary: fs.readFileSync(summary, 'utf8'),
    mail: fs.readFileSync(path.join(root, 'trivy-mail.txt'), 'utf8'),
    htmlMail: fs.readFileSync(path.join(root, 'trivy-mail.html'), 'utf8'),
    mailMetadata: JSON.parse(fs.readFileSync(path.join(root, 'trivy-mail-details.json'), 'utf8')),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return data;
}

const vulnerability = { VulnerabilityID: 'CVE-2026-1', PrimaryURL: 'https://example.com/CVE-2026-1', Severity: 'HIGH', PkgName: 'pkg', FixedVersion: '2.0' };
const secret = { RuleID: 'secret-rule', Severity: 'HIGH', Title: 'Credential', StartLine: 4 };

test('combines repeated scans and records secret count for downstream mail', () => {
  const data = run([
    { meta: { kind: 'dockerfile', target: './Dockerfile', commit_id: '123456789abcdef', commit_author: 'Author', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Target: 'Dockerfile', Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:first', commit_id: '123456789abcdef', commit_author: 'Author', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Target: 'app:first', Secrets: [secret] }] } },
    { meta: { kind: 'image', target: 'app:second', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [] } },
  ]);
  assert.equal(data.values.scan_count, '3');
  assert.equal(data.values.finding_count, '2');
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.deepEqual(data.mailMetadata, {
    subject: '[TRIVY][ACTION REQUIRED] 1 vulns, 1 secrets — svtechnmaa/svtech_report',
    secret_count: 1,
  });
  assert.match(data.summary, /## 1\. Summary/);
  assert.match(data.summary, /Commit:\*\* \[`1234567`\]\(https:\/\/github\.com\/svtechnmaa\/svtech_report\/commit\/123456789abcdef\)/);
  assert.match(data.summary, /## 2\. Scanned targets/);
  assert.match(data.summary, /## 3\. Findings/);
  assert.match(data.summary, /\[CVE-2026-1\]\(https:\/\/example\.com\/CVE-2026-1\)/);
  assert.match(data.summary, /Fixed in/);
  assert.match(data.summary, /ignore_finding: true/);
  assert.match(data.summary, /app:second/);
  assert.doesNotMatch(data.mail, /secret-rule/);
  assert.match(data.htmlMail, /<strong>3 scans/);
  assert.match(data.mailMetadata.subject, /\[TRIVY\]\[ACTION REQUIRED\]/);
  assert.match(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
  assert.match(data.htmlMail, /<strong>NOT BLOCKING<\/strong> applies only to allowed vulnerabilities/);
  assert.match(data.summary, /Blocking secrets/);
  assert.match(data.mail, /BLOCKING SECRETS/);
  assert.match(data.htmlMail, /BLOCKING SECRETS/);
  assert.doesNotMatch(data.htmlMail, /IGNORE_FINDING/);
  assert.match(data.htmlMail, /OPEN FULL GITHUB SUMMARY/);
  assert.doesNotMatch(data.htmlMail, /secret-rule/);
});

test('vulnerabilities block scans without ignore_finding', () => {
  const data = run([
    { meta: { kind: 'dockerfile', target: './Dockerfile', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:latest', ignore_finding: false, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
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
  assert.match(data.htmlMail, /SCAN FAILED/);
  assert.match(data.mail, /SCAN ERRORS means a scan did not finish or produced no readable report/);
  assert.match(data.htmlMail, /<strong>SCAN ERRORS<\/strong> means a scan did not finish/);
});

test('allowed vulnerabilities do not block merging', () => {
  const data = run([
    { meta: { kind: 'filesystem', target: 'changed files', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'false');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.mailMetadata.subject, /\[FINDINGS FOUND\]/);
  assert.match(data.summary, /Findings allowed/);
  assert.match(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
});

for (const kind of ['filesystem', 'dockerfile', 'image']) {
  for (const ignoreFinding of [false, true]) {
    for (let combination = 0; combination < 8; combination++) {
      const hasVulnerability = Boolean(combination & 1);
      const hasMisconfiguration = Boolean(combination & 2);
      const hasSecret = Boolean(combination & 4);
      test(`${kind}: ignore=${ignoreFinding}, vuln=${hasVulnerability}, misconfig=${hasMisconfiguration}, secret=${hasSecret}`, () => {
        const data = run([{
          meta: { kind, target: 'target', ignore_finding: ignoreFinding, scan_ok: true },
          report: { SchemaVersion: 2, Results: [{
            Vulnerabilities: hasVulnerability ? [vulnerability] : [],
            Misconfigurations: hasMisconfiguration ? [{ ID: 'AVD-TEST', Severity: 'HIGH' }] : [],
            Secrets: hasSecret ? [secret] : [],
          }] },
        }]);
        const blocking = hasSecret || hasMisconfiguration || (hasVulnerability && !ignoreFinding);
        const hasFindings = hasVulnerability || hasMisconfiguration || hasSecret;
        assert.equal(data.values.gate_failed, String(blocking));
        assert.equal(data.values.send_mail, String(hasFindings));
        assert.equal(data.values.finding_count, String(Number(hasVulnerability) + Number(hasMisconfiguration) + Number(hasSecret)));
        if (blocking) {
          assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
          assert.doesNotMatch(data.summary, /Findings allowed/);
          assert.doesNotMatch(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
          assert.doesNotMatch(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
        } else if (hasFindings) {
          assert.match(data.mailMetadata.subject, /\[FINDINGS FOUND\]/);
          assert.match(data.summary, /Findings allowed/);
        } else {
          assert.match(data.summary, /Clean/);
        }
      });
    }
  }
}

test('secrets always block even in an allowed scan, with or without other findings', () => {
  for (const extra of [{}, { Vulnerabilities: [vulnerability], Misconfigurations: [{ ID: 'AVD-TEST', Severity: 'HIGH' }] }]) {
    const data = run([
      { meta: { kind: 'filesystem', target: 'changed files', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Secrets: [{ ...secret, Match: 'PRIVATE_SECRET_VALUE' }], ...extra }] } },
    ]);
    assert.equal(data.values.gate_failed, 'true');
    assert.equal(data.values.send_mail, 'true');
    assert.equal(data.mailMetadata.secret_count, 1);
    assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
    assert.match(data.summary, /Blocking secrets/);
    assert.match(data.mail, /BLOCKING SECRETS/);
    assert.match(data.htmlMail, /BLOCKING SECRETS/);
    assert.doesNotMatch(data.summary, /Findings allowed/);
    assert.doesNotMatch(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
    assert.doesNotMatch(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
    for (const output of [data.summary, data.mail, data.htmlMail]) assert.doesNotMatch(output, /PRIVATE_SECRET_VALUE/);
  }
});

test('allowed vulnerabilities in one scan cannot bypass misconfigurations in another', () => {
  const data = run([
    { meta: { kind: 'image', target: 'app:sha', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'dockerfile', target: 'Dockerfile', ignore_finding: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Misconfigurations: [{ ID: 'AVD-TEST', Severity: 'HIGH' }] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
  assert.match(data.summary, /Blocking misconfigurations/);
  assert.match(data.mail, /BLOCKING MISCONFIGURATIONS/);
  assert.match(data.htmlMail, /BLOCKING MISCONFIGURATIONS/);
});

test('invalid reports remain blocking even when scan metadata permits vulnerabilities', () => {
  for (const report of [{}, { SchemaVersion: 2, Results: 'invalid' }]) {
    const data = run([{ meta: { kind: 'image', target: 'app:sha', ignore_finding: true, scan_ok: true }, report }]);
    assert.equal(data.values.gate_failed, 'true');
    assert.equal(data.values.send_mail, 'true');
    assert.match(data.mailMetadata.subject, /\[SCAN FAILED\]/);
  }
});

test('missing results do not produce a clean report', () => {
  const data = run([]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
});
