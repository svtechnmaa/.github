const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateReport } = require('./generate-report');

function run(scans, runAttempt = '1') {
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
      GITHUB_RUN_ATTEMPT: runAttempt,
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
    { meta: { kind: 'dockerfile', target: './Dockerfile', commit_id: '123456789abcdef', commit_author: 'Author', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Target: 'Dockerfile', Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:first', commit_id: '123456789abcdef', commit_author: 'Author', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Target: 'app:first', Secrets: [secret] }] } },
    { meta: { kind: 'image', target: 'app:second', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [] } },
  ], '2');
  assert.equal(data.values.scan_count, '3');
  assert.equal(data.values.finding_count, '2');
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.deepEqual(data.mailMetadata, {
    subject: '[TRIVY][ACTION REQUIRED] 1 vulns, 0 misconfigs, 1 secrets — svtechnmaa/svtech_report',
    secret_count: 1,
  });
  assert.match(data.summary, /## 1\. Summary/);
  assert.match(data.summary, /Commit:\*\* \[`1234567`\]\(https:\/\/github\.com\/svtechnmaa\/svtech_report\/commit\/123456789abcdef\)/);
  assert.match(data.summary, /## 2\. Scanned targets/);
  assert.match(data.summary, /## 3\. Findings/);
  assert.match(data.summary, /\[CVE-2026-1\]\(https:\/\/example\.com\/CVE-2026-1\)/);
  assert.match(data.summary, /Fixed in/);
  assert.match(data.summary, /Secrets always block the Trivy scan gate/);
  assert.doesNotMatch(data.summary, /allow_vulnerabilities/);
  assert.match(data.summary, /actions\/runs\/123\/attempts\/2/);
  assert.match(data.mail, /FULL REPORT \(ATTEMPT 2\): https:\/\/github\.com\/svtechnmaa\/svtech_report\/actions\/runs\/123\/attempts\/2/);
  assert.match(data.htmlMail, /href="https:\/\/github\.com\/svtechnmaa\/svtech_report\/actions\/runs\/123\/attempts\/2"/);
  assert.match(data.htmlMail, /<strong>Run attempt:<\/strong> 2/);
  assert.match(data.summary, /app:second/);
  assert.doesNotMatch(data.mail, /secret-rule/);
  assert.match(data.htmlMail, /<strong>3 scans/);
  assert.match(data.mailMetadata.subject, /\[TRIVY\]\[ACTION REQUIRED\]/);
  assert.match(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
  assert.match(data.htmlMail, /<strong>NOT BLOCKING<\/strong> applies only to allowed vulnerabilities or misconfigurations/);
  assert.match(data.summary, /Blocking secrets/);
  assert.match(data.mail, /BLOCKING SECRETS/);
  assert.match(data.htmlMail, /BLOCKING SECRETS/);
  assert.doesNotMatch(data.htmlMail, /IGNORE_FINDING/);
  assert.match(data.htmlMail, /OPEN FULL GITHUB SUMMARY/);
  assert.doesNotMatch(data.htmlMail, /secret-rule/);
});

test('vulnerabilities block scans without allow_vulnerabilities', () => {
  const data = run([
    { meta: { kind: 'dockerfile', target: './Dockerfile', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'image', target: 'app:latest', allow_vulnerabilities: false, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.finding_count, '2');
});

test('scan errors remain blocking even when allow_vulnerabilities is true', () => {
  const data = run([
    { meta: { kind: 'image', target: 'app:latest', allow_vulnerabilities: true, scan_ok: false } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.summary, /Scan failed/);
  assert.match(data.htmlMail, /SCAN FAILED/);
  assert.match(data.mail, /SCAN ERRORS means a scan did not finish or produced no readable report/);
  assert.match(data.htmlMail, /<strong>SCAN ERRORS<\/strong> means a scan did not finish/);
});

test('allowed vulnerabilities do not block the scan gate', () => {
  const data = run([
    { meta: { kind: 'filesystem', target: 'changed files', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'false');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.mailMetadata.subject, /\[FINDINGS FOUND\]/);
  assert.match(data.summary, /⚠️ Findings allowed/);
  assert.match(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
});

test('allowed misconfigurations remain visible without blocking the scan gate', () => {
  const misconfiguration = { ID: 'AVD-DS-0002', Severity: 'HIGH', Title: 'Running as root' };
  const data = run([{
    meta: { kind: 'dockerfile', target: 'Dockerfile', allow_misconfigurations: true, scan_ok: true },
    report: { SchemaVersion: 2, Results: [{ Misconfigurations: [misconfiguration] }] },
  }]);
  assert.equal(data.values.gate_failed, 'false');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.mailMetadata.subject, /\[FINDINGS FOUND\]/);
  assert.match(data.summary, /Misconfigurations \(HIGH, CRITICAL\) \| 1 \| 1 \| 0/);
  assert.match(data.summary, /AVD-DS-0002/);
  assert.match(data.summary, /ALLOWED BY SCAN POLICY/);
  assert.match(data.mail, /ALLOWED MISCONFIGURATIONS: 1/);
  assert.match(data.htmlMail, /1 allowed · 0 blocking/);
});

test('allowed misconfigurations never bypass secrets, disallowed vulnerabilities, or scan errors', () => {
  const misconfiguration = { ID: 'AVD-DS-0002', Severity: 'HIGH' };
  for (const item of [
    { findings: { Misconfigurations: [misconfiguration], Secrets: [secret] } },
    { findings: { Misconfigurations: [misconfiguration], Vulnerabilities: [vulnerability] } },
    { findings: { Misconfigurations: [misconfiguration] }, scan_ok: false },
  ]) {
    const data = run([{
      meta: { kind: 'dockerfile', allow_misconfigurations: true, scan_ok: item.scan_ok !== false },
      report: { SchemaVersion: 2, Results: [item.findings] },
    }]);
    assert.equal(data.values.gate_failed, 'true');
    assert.match(data.mailMetadata.subject, /\[(ACTION REQUIRED|SCAN FAILED)\]/);
  }
});

test('misconfiguration permission applies only to the scan with that policy', () => {
  const misconfiguration = { ID: 'AVD-DS-0002', Severity: 'HIGH' };
  const data = run([
    { meta: { kind: 'dockerfile', target: 'backend/Dockerfile', allow_misconfigurations: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Misconfigurations: [misconfiguration] }] } },
    { meta: { kind: 'dockerfile', target: 'frontend/Dockerfile', scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Misconfigurations: [misconfiguration] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.match(data.summary, /Misconfigurations \(HIGH, CRITICAL\) \| 2 \| 1 \| 1/);
  assert.match(data.mail, /ALLOWED MISCONFIGURATIONS: 1/);
  assert.match(data.mail, /BLOCKING MISCONFIGURATIONS: 1/);
});

for (const kind of ['filesystem', 'dockerfile', 'image']) {
  for (const allowVulnerabilities of [false, true]) {
    for (let combination = 0; combination < 8; combination++) {
      const hasVulnerability = Boolean(combination & 1);
      const hasMisconfiguration = Boolean(combination & 2);
      const hasSecret = Boolean(combination & 4);
      test(`${kind}: ignore=${allowVulnerabilities}, vuln=${hasVulnerability}, misconfig=${hasMisconfiguration}, secret=${hasSecret}`, () => {
        const data = run([{
          meta: { kind, target: 'target', allow_vulnerabilities: allowVulnerabilities, scan_ok: true },
          report: { SchemaVersion: 2, Results: [{
            Vulnerabilities: hasVulnerability ? [vulnerability] : [],
            Misconfigurations: hasMisconfiguration ? [{ ID: 'AVD-TEST', Severity: 'HIGH' }] : [],
            Secrets: hasSecret ? [secret] : [],
          }] },
        }]);
        const blocking = hasSecret || hasMisconfiguration || (hasVulnerability && !allowVulnerabilities);
        const hasFindings = hasVulnerability || hasMisconfiguration || hasSecret;
        assert.equal(data.values.gate_failed, String(blocking));
        assert.equal(data.values.send_mail, String(hasFindings));
        assert.equal(data.values.finding_count, String(Number(hasVulnerability) + Number(hasMisconfiguration) + Number(hasSecret)));
        if (blocking) {
          assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
          assert.doesNotMatch(data.summary, /⚠️ Findings allowed/);
          assert.doesNotMatch(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
          assert.doesNotMatch(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
        } else if (hasFindings) {
          assert.match(data.mailMetadata.subject, /\[FINDINGS FOUND\]/);
          assert.match(data.summary, /⚠️ Findings allowed/);
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
      { meta: { kind: 'filesystem', target: 'changed files', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Secrets: [{ ...secret, Match: 'PRIVATE_SECRET_VALUE' }], ...extra }] } },
    ]);
    assert.equal(data.values.gate_failed, 'true');
    assert.equal(data.values.send_mail, 'true');
    assert.equal(data.mailMetadata.secret_count, 1);
    assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
    assert.match(data.summary, /Blocking secrets/);
    assert.match(data.mail, /BLOCKING SECRETS/);
    assert.match(data.htmlMail, /BLOCKING SECRETS/);
    assert.doesNotMatch(data.summary, /⚠️ Findings allowed/);
    assert.doesNotMatch(data.mail, /REVIEW REQUIRED — NOT BLOCKING/);
    assert.doesNotMatch(data.htmlMail, /REVIEW REQUIRED — NOT BLOCKING/);
    for (const output of [data.summary, data.mail, data.htmlMail]) assert.doesNotMatch(output, /PRIVATE_SECRET_VALUE/);
  }
});

test('allowed vulnerabilities in one scan cannot bypass misconfigurations in another', () => {
  const data = run([
    { meta: { kind: 'image', target: 'app:sha', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
    { meta: { kind: 'dockerfile', target: 'Dockerfile', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Misconfigurations: [{ ID: 'AVD-TEST', Severity: 'HIGH' }] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
  assert.match(data.mailMetadata.subject, /\[ACTION REQUIRED\]/);
  assert.match(data.summary, /1 misconfigurations, 0 secrets/);
  assert.match(data.mail, /BLOCKING FINDINGS/);
  assert.match(data.htmlMail, /ACTION REQUIRED/);
});

test('invalid reports remain blocking even when scan metadata permits vulnerabilities', () => {
  for (const report of [{}, { SchemaVersion: 2, Results: 'invalid' }, { SchemaVersion: 2, Results: [null] }, { SchemaVersion: 2, Results: [{ Secrets: {} }] }]) {
    const data = run([{ meta: { kind: 'image', target: 'app:sha', allow_vulnerabilities: true, scan_ok: true }, report }]);
    assert.equal(data.values.gate_failed, 'true');
    assert.equal(data.values.send_mail, 'true');
    assert.match(data.mailMetadata.subject, /\[SCAN FAILED\]/);
  }
});

test('mixed scan reports distinguish allowed vulnerabilities from blocking misconfigurations', () => {
  const data = run([
    { meta: { kind: 'filesystem', target: 'backend', allow_vulnerabilities: true, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability], Misconfigurations: [{ ID: 'AVD-TEST', Severity: 'HIGH' }] }] } },
    { meta: { kind: 'image', target: 'frontend', allow_vulnerabilities: false, scan_ok: true }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.equal(data.values.gate_failed, 'true');
  assert.match(data.summary, /Scan gate: ❌ BLOCKED/);
  assert.match(data.summary, /\| 🛡️ Vulnerabilities \(HIGH, CRITICAL\) \| 2 \| 1 \| 1 \|/);
  assert.match(data.summary, /\| ⚙️ Misconfigurations \(HIGH, CRITICAL\) \| 1 \| 0 \| 1 \|/);
  assert.match(data.summary, /\| backend \| Yes \| No \| 1 \(1 allowed, 0 blocking\)/);
  assert.match(data.summary, /\| frontend \| No \| No \| 1 \(0 allowed, 1 blocking\)/);
  assert.match(data.summary, /ALLOWED BY SCAN POLICY/);
  assert.match(data.summary, /❌ BLOCKING/);
  assert.match(data.summary, /❌ BLOCKING/);
  assert.match(data.mail, /ALLOWED VULNERABILITIES: 1/);
  assert.match(data.mail, /BLOCKING VULNERABILITIES: 1/);
  assert.match(data.htmlMail, /1 allowed · 1 blocking/);
  assert.match(data.htmlMail, /SCAN GATE: BLOCKED/);
  assert.match(data.mailMetadata.subject, /1 misconfigs/);
});

test('scan failures cannot present their vulnerability results as allowed', () => {
  const data = run([
    { meta: { kind: 'image', target: 'backend', allow_vulnerabilities: true, scan_ok: false }, report: { SchemaVersion: 2, Results: [{ Vulnerabilities: [vulnerability] }] } },
  ]);
  assert.match(data.mail, /ALLOWED VULNERABILITIES: 0/);
  assert.match(data.mail, /BLOCKING VULNERABILITIES: 1/);
  assert.doesNotMatch(data.summary, /ALLOWED BY SCAN POLICY/);
});

test('missing results do not produce a clean report', () => {
  const data = run([]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.send_mail, 'true');
});

test('successful Trivy reports may omit Results or contain null', () => {
  for (const report of [{ SchemaVersion: 2 }, { SchemaVersion: 2, Results: null }, { SchemaVersion: 2, Results: [] }]) {
    const data = run([{ meta: { kind: 'filesystem', allow_vulnerabilities: true, scan_succeeded: true }, report }]);
    assert.equal(data.values.gate_failed, 'false');
    assert.equal(data.values.finding_count, '0');
    assert.equal(data.values.notification_required, 'false');
  }
});

test('failed scans never become clean when Results is omitted', () => {
  const data = run([{ meta: { kind: 'filesystem', allow_vulnerabilities: true, scan_succeeded: false }, report: { SchemaVersion: 2 } }]);
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.notification_required, 'true');
});

test('a failed filesystem preparation remains blocking alongside a successful image scan', () => {
  const data = run([
    { meta: { kind: 'filesystem', target: 'changed files', scan_succeeded: false, allow_vulnerabilities: true }, report: { SchemaVersion: 2, Results: [] } },
    { meta: { kind: 'image', target: 'app:sha', scan_succeeded: true, allow_vulnerabilities: true }, report: { SchemaVersion: 2, Results: [] } },
  ]);
  assert.equal(data.values.scan_count, '2');
  assert.equal(data.values.gate_failed, 'true');
  assert.equal(data.values.notification_required, 'true');
  assert.match(data.summary, /Scan failed/);
});
