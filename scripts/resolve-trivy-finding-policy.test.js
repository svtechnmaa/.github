const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const script = path.join(__dirname, 'resolve-trivy-finding-policy.sh').replace(/\\/g, '/');

function resolve(policy, repo = 'svtechnmaa/netops-data-chains') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-policy-'));
  try {
    const output = path.join(dir, 'output');
    const result = spawnSync(bash, [script], {
      env: { ...process.env, GITHUB_OUTPUT: output.replace(/\\/g, '/'), GITHUB_REPOSITORY: repo, TRIVY_FINDING_POLICY_JSON: policy },
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    const values = fs.existsSync(output)
      ? Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
        const delimiter = line.indexOf('=');
        return [line.slice(0, delimiter), line.slice(delimiter + 1)];
      })) : {};
    return { code: result.status, log: result.stdout + result.stderr, values };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('missing policy and missing repository default to blocking', () => {
  for (const policy of ['', '{}', '{"other":{"vulnerabilities":{"expires_at":"2099-12-31","description":"Other repo"}}}']) {
    const result = resolve(policy);
    assert.equal(result.code, 0, result.log);
    assert.equal(result.values.allow_vulnerabilities, 'false');
    assert.equal(result.values.allow_misconfigurations, 'false');
    assert.deepEqual(JSON.parse(result.values.exception_details), {});
  }
});

test('categories are independent and an active exception includes its expiry and reason', () => {
  const result = resolve(JSON.stringify({ 'netops-data-chains': {
    vulnerabilities: { expires_at: '2099-12-31', description: 'Waiting for dependency update' },
  } }));
  assert.equal(result.code, 0, result.log);
  assert.equal(result.values.allow_vulnerabilities, 'true');
  assert.equal(result.values.allow_misconfigurations, 'false');
  assert.deepEqual(JSON.parse(result.values.exception_details).vulnerabilities, {
    status: 'active', expires_at: '2099-12-31', description: 'Waiting for dependency update',
  });
});

test('expired exception blocks again without editing policy', () => {
  const result = resolve(JSON.stringify({ 'netops-data-chains': {
    vulnerabilities: { expires_at: '2000-01-01', description: 'Old exception' },
    misconfigurations: { expires_at: '2099-12-31', description: 'Pending hardening' },
  } }));
  assert.equal(result.code, 0, result.log);
  assert.equal(result.values.allow_vulnerabilities, 'false');
  assert.equal(result.values.allow_misconfigurations, 'true');
  assert.equal(JSON.parse(result.values.exception_details).vulnerabilities.status, 'expired');
});

test('expires_at includes the full Vietnam calendar day', () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  for (const [expires_at, allowed] of [[today, 'true'], [yesterday, 'false']]) {
    const result = resolve(JSON.stringify({ 'netops-data-chains': {
      vulnerabilities: { expires_at, description: 'Boundary check' },
    } }));
    assert.equal(result.code, 0, result.log);
    assert.equal(result.values.allow_vulnerabilities, allowed);
  }
});

test('malformed current-repository exception fails closed', () => {
  const badEntries = [
    { vulnerabilities: {} },
    { vulnerabilities: { expires_at: 'bcbcaa', description: 'Invalid date' } },
    { vulnerabilities: { expires_at: '2027-02-30', description: 'Impossible date' } },
    { vulnerabilities: { expires_at: '2099-12-31' } },
    { vulnerabilities: true },
    { vulnerabilities: false },
    { vulnerabilities: null },
    { misconfigurations: { expires_at: '2099-12-31', description: '   ' } },
    { typo: { expires_at: '2099-12-31', description: 'Wrong category' } },
  ];
  for (const entry of badEntries) {
    const result = resolve(JSON.stringify({ 'netops-data-chains': entry }));
    assert.notEqual(result.code, 0, JSON.stringify(entry));
    assert.deepEqual(result.values, {}, JSON.stringify(entry));
  }
  for (const policy of ['{', '[]', 'true', '{} {}']) assert.notEqual(resolve(policy).code, 0, policy);
  for (const value of [true, false, null]) assert.notEqual(resolve(JSON.stringify({ 'netops-data-chains': value })).code, 0);
});

test('invalid exception for another repository does not break this repository', () => {
  const result = resolve('{"netops-data-chains":{},"other":{"vulnerabilities":{"expires_at":"bcbcaa"}}}');
  assert.equal(result.code, 0, result.log);
  assert.equal(result.values.allow_vulnerabilities, 'false');
});
