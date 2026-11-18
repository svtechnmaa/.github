const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateReport } = require('../trivy-report/generate-report');

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const finalizeScript = path.join(__dirname, 'check-status.sh');
const resultsScript = path.join(__dirname, '../check_job_results/check-results.sh');

function execute(script, env) {
  const result = spawnSync(bash, [script.replace(/\\/g, '/')], { env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.notEqual(result.status, null, result.stderr);
  return { code: result.status, text: result.stdout + result.stderr };
}

function finalize(env) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-finalize-'));
  try {
    const output = path.join(root, 'output');
    const result = execute(finalizeScript, {
      JOB_STATUS: 'success', REPORT_OUTCOME: 'success', FINDING_COUNT: '1', GATE_FAILED: 'false',
      ...env, GITHUB_OUTPUT: output.replace(/\\/g, '/'), GITHUB_STEP_SUMMARY: path.join(root, 'summary').replace(/\\/g, '/'),
    });
    const lines = fs.readFileSync(output, 'utf8').trim().split('\n');
    const outputs = Object.fromEntries(lines.map((line) => line.split('=')));
    return { ...result, bypassed: outputs.scan_bypassed, summary: fs.readFileSync(path.join(root, 'summary'), 'utf8') };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function check(jobs) {
  return execute(resultsScript, { JOBS: typeof jobs === 'string' ? jobs : JSON.stringify(jobs) });
}

test('only an otherwise successful job with allowed findings is intentionally failed and accepted', () => {
  const result = finalize({});
  assert.equal(result.code, 1);
  assert.equal(result.bypassed, 'true');
  assert.match(result.summary, /BUILD BYPASS APPLIED — ALLOWED VULNERABILITIES ONLY/);
  assert.equal(check({ build: { result: 'failure', outputs: { scan_bypassed: result.bypassed } } }).code, 0);
});

test('clean and deliberately skipped reports do not need a bypass', () => {
  for (const env of [{ FINDING_COUNT: '0' }, { REPORT_OUTCOME: 'skipped', FINDING_COUNT: '', GATE_FAILED: '' }]) {
    const result = finalize(env);
    assert.equal(result.code, 0);
    assert.equal(result.bypassed, 'false');
    assert.match(result.summary, /NO BUILD BYPASS/);
  }
});

for (const status of ['failure', 'cancelled', '', 'unknown']) {
  test(`preceding job status ${JSON.stringify(status)} is never bypassed`, () => {
    const result = finalize({ JOB_STATUS: status });
    assert.equal(result.code, 1);
    assert.equal(result.bypassed, 'false');
    assert.equal(check({ build: { result: 'failure', outputs: { scan_bypassed: result.bypassed } } }).code, 1);
  });
}

for (const outcome of ['failure', 'cancelled', '', 'unknown']) {
  test(`report outcome ${JSON.stringify(outcome)} is never bypassed`, () => {
    const result = finalize({ REPORT_OUTCOME: outcome });
    assert.equal(result.code, 1);
    assert.equal(result.bypassed, 'false');
  });
}

for (const env of [
  { GATE_FAILED: 'true' }, { GATE_FAILED: '' }, { GATE_FAILED: 'False' },
  { FINDING_COUNT: '' }, { FINDING_COUNT: '-1' }, { FINDING_COUNT: '1.5' },
  { FINDING_COUNT: 'abc' }, { FINDING_COUNT: '01' },
]) {
  test(`blocking or invalid report outputs ${JSON.stringify(env)} are never bypassed`, () => {
    const result = finalize(env);
    assert.equal(result.code, 1);
    assert.equal(result.bypassed, 'false');
  });
}

test('other failed and cancelled jobs still block even when build has an allowed bypass', () => {
  const build = { result: 'failure', outputs: { scan_bypassed: 'true' } };
  for (const result of ['failure', 'cancelled', 'unknown']) {
    assert.equal(check({ build, test: { result } }).code, 1);
  }
  assert.equal(check({ build, test: { result: 'success' }, release: { result: 'skipped' } }).code, 0);
  assert.equal(check({ build: { result: 'cancelled', outputs: { scan_bypassed: 'true' } } }).code, 1);
});

test('existing callers need no output changes and failures are not implicitly exempted', () => {
  assert.equal(check({ build: { result: 'success' }, test: { result: 'skipped' } }).code, 0);
  for (const outputs of [undefined, {}, { scan_bypassed: 'false' }, { scan_bypassed: true }]) {
    assert.equal(check({ build: { result: 'failure', outputs } }).code, 1);
  }
});

test('invalid needs JSON cannot silently pass', () => {
  for (const jobs of ['', '{}', '[]', 'null', '{', '{} {}', '{"build":{}}', '{"build":{"result":"failure","outputs":[]}}']) {
    assert.equal(check(jobs).code, 1, jobs);
  }
});

test('real report outputs bypass only allowed vulnerabilities, never secrets, misconfigurations or scan errors', () => {
  const vulnerability = { VulnerabilityID: 'CVE-TEST', Severity: 'HIGH' };
  const secret = { RuleID: 'TEST', Severity: 'HIGH' };
  const misconfiguration = { ID: 'AVD-TEST', Severity: 'HIGH' };
  const cases = [
    { ignore: true, findings: { Vulnerabilities: [vulnerability] }, allowed: true },
    { ignore: false, findings: { Vulnerabilities: [vulnerability] } },
    { ignore: true, findings: { Secrets: [secret] } },
    { ignore: true, findings: { Misconfigurations: [misconfiguration] } },
    { ignore: true, findings: { Vulnerabilities: [vulnerability], Misconfigurations: [misconfiguration] } },
    { ignore: true, findings: { Vulnerabilities: [vulnerability], Secrets: [secret] } },
    { ignore: true, findings: {}, scanOk: false },
    { ignore: true, findings: {}, clean: true },
  ];
  for (const item of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-policy-integration-'));
    try {
      const dir = path.join(root, 'reports', 'scan');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ kind: 'image', scan_ok: item.scanOk !== false, ignore_finding: item.ignore }));
      fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ SchemaVersion: 2, Results: [item.findings] }));
      const outputs = generateReport({ REPORT_DIR: path.dirname(dir), GITHUB_OUTPUT: path.join(root, 'output'), GITHUB_STEP_SUMMARY: path.join(root, 'summary') }, root);
      const result = finalize({ FINDING_COUNT: String(outputs.finding_count), GATE_FAILED: String(outputs.gate_failed), REPORT_OUTCOME: outputs.gate_failed ? 'failure' : 'success' });
      assert.equal(result.bypassed, item.allowed ? 'true' : 'false', JSON.stringify(item));
      assert.equal(result.code, item.clean ? 0 : 1);
      if (item.allowed) {
        const unrelatedFailure = finalize({ FINDING_COUNT: String(outputs.finding_count), GATE_FAILED: 'false', REPORT_OUTCOME: 'success', JOB_STATUS: 'failure' });
        assert.equal(unrelatedFailure.bypassed, 'false');
        assert.equal(check({ build: { result: 'failure', outputs: { scan_bypassed: unrelatedFailure.bypassed } } }).code, 1);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
