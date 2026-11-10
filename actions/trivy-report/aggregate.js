const fs = require('node:fs');
const path = require('node:path');

function findMetadata(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) return findMetadata(name);
    return entry.isFile() && entry.name === 'meta.json' ? [name] : [];
  });
}

function findings(report, key) {
  return (Array.isArray(report?.Results) ? report.Results : []).flatMap((result) =>
    (result[key] || []).map((finding) => ({ target: result.Target || '', ...finding }))
  );
}

function clean(value) {
  return String(value ?? '-').replace(/[\r\n|]/g, ' ');
}

function table(items, columns) {
  if (!items.length) return '';
  return [
    `| ${columns.map(([label]) => label).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...items.map((item) => `| ${columns.map(([, field]) => clean(item[field])).join(' | ')} |`),
    '',
  ].join('\n');
}

function aggregate(env = process.env, mailPath = 'trivy-aggregate-mail.txt') {
const runId = env.GITHUB_RUN_ID || 'local';
const runAttempt = env.GITHUB_RUN_ATTEMPT || '1';
const reportDir = env.REPORT_DIR || path.join(env.RUNNER_TEMP || '.', 'trivy-collect', `${runId}-${runAttempt}`);
const runUrl = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY || ''}/actions/runs/${runId}`;
const scans = findMetadata(reportDir).sort().map((metadataPath) => {
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const reportPath = path.join(path.dirname(metadataPath), 'report.json');
  let report = null;
  try {
    if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (_) {
    report = null;
  }
  const vulnerabilities = findings(report, 'Vulnerabilities');
  const secrets = findings(report, 'Secrets');
  const misconfigurations = findings(report, 'Misconfigurations');
  return {
    kind: meta.kind || 'unknown',
    target: meta.target || 'unknown',
    ignoreFinding: meta.ignore_finding === true,
    scanOk: meta.scan_ok === true && report !== null && Array.isArray(report.Results),
    vulnerabilities, secrets, misconfigurations,
  };
});

const totals = scans.reduce((sum, scan) => ({
  vulnerabilities: sum.vulnerabilities + scan.vulnerabilities.length,
  secrets: sum.secrets + scan.secrets.length,
  misconfigurations: sum.misconfigurations + scan.misconfigurations.length,
  failures: sum.failures + (scan.scanOk ? 0 : 1),
}), { vulnerabilities: 0, secrets: 0, misconfigurations: 0, failures: 0 });
if (scans.length === 0) totals.failures = 1;
const totalFindings = totals.vulnerabilities + totals.secrets + totals.misconfigurations;
const gateFailed = totals.failures > 0 || scans.some((scan) =>
  !scan.ignoreFinding && scan.vulnerabilities.length + scan.secrets.length + scan.misconfigurations.length > 0
);
const status = totals.failures ? 'Scan failed' : totalFindings ? 'Findings found' : 'Clean';

const summary = [
  `# Trivy report — ${status}`,
  '',
  `**Run:** ${runUrl}  `,
  `**Scans:** ${scans.length} · **Vulnerabilities:** ${totals.vulnerabilities} · **Secrets:** ${totals.secrets} · **Misconfigurations:** ${totals.misconfigurations} · **Scan failures:** ${totals.failures}`,
  '',
  '| Scan | Target | Vulnerabilities | Secrets | Misconfigurations | Result |',
  '| --- | --- | ---: | ---: | ---: | --- |',
  ...scans.map((scan) => {
    const count = scan.vulnerabilities.length + scan.secrets.length + scan.misconfigurations.length;
    const result = !scan.scanOk ? 'Scan failed' : count === 0 ? 'Clean' : scan.ignoreFinding ? 'Findings allowed' : 'Blocking findings';
    return `| ${clean(scan.kind)} | ${clean(scan.target)} | ${scan.vulnerabilities.length} | ${scan.secrets.length} | ${scan.misconfigurations.length} | ${result} |`;
  }),
  '',
];
if (!scans.length) summary.push('No scan results were collected. Check the scan steps.', '');

for (const scan of scans) {
  const count = scan.vulnerabilities.length + scan.secrets.length + scan.misconfigurations.length;
  if (!count) continue;
  summary.push(`<details><summary>${clean(scan.kind)}: ${clean(scan.target)} — ${count} findings</summary>`, '');
  if (scan.vulnerabilities.length) {
    summary.push('### Vulnerabilities', '', table(scan.vulnerabilities,
      [['Severity', 'Severity'], ['CVE', 'VulnerabilityID'], ['Package', 'PkgName'], ['Installed', 'InstalledVersion'], ['Fixed in', 'FixedVersion'], ['File', 'target']]));
  }
  if (scan.secrets.length) {
    summary.push('### Secrets', '', table(scan.secrets,
      [['Severity', 'Severity'], ['Rule', 'RuleID'], ['Title', 'Title'], ['File', 'target'], ['Line', 'StartLine']]));
  }
  if (scan.misconfigurations.length) {
    summary.push('### Misconfigurations', '', table(scan.misconfigurations,
      [['Severity', 'Severity'], ['Rule', 'ID'], ['Title', 'Title'], ['File', 'target'], ['Resolution', 'Resolution']]));
  }
  summary.push('</details>', '');
}
fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);

const body = [
  `Trivy report — ${status}`,
  `Repository: ${env.GITHUB_REPOSITORY || ''}`,
  `Run: ${runUrl}`,
  '',
  `Scans: ${scans.length}; vulnerabilities: ${totals.vulnerabilities}; secrets: ${totals.secrets}; misconfigurations: ${totals.misconfigurations}; scan failures: ${totals.failures}`,
  '',
  ...scans.map((scan) => {
    const count = scan.vulnerabilities.length + scan.secrets.length + scan.misconfigurations.length;
    const result = !scan.scanOk ? 'SCAN FAILED' : count === 0 ? 'Clean' : scan.ignoreFinding ? 'Findings allowed by ignore_finding' : 'Blocking findings';
    return `${scan.kind}: ${scan.target} — ${scan.vulnerabilities.length} vulnerabilities, ${scan.secrets.length} secrets, ${scan.misconfigurations.length} misconfigurations (${result})`;
  }),
  '',
  'Open the run summary for finding details. Secret values are not included.',
];
fs.writeFileSync(mailPath, `${body.join('\n')}\n`);

const recipients = [env.MAIL_RECEIVERS || '', totals.secrets ? env.IT_TEAM_EMAIL || '' : '']
  .join(',').split(',').map((value) => value.trim())
  .filter((value) => value && !value.includes('noreply.github.com'));
if (!recipients.length && env.MAIL_USERNAME) recipients.push(env.MAIL_USERNAME);
const uniqueRecipients = [...new Set(recipients)];
const outputs = {
  scan_count: scans.length,
  finding_count: totalFindings,
  gate_failed: gateFailed,
  send_mail: totalFindings > 0 || totals.failures > 0,
  mail_receivers: uniqueRecipients.join(','),
  subject: `[Trivy] ${status} — ${env.GITHUB_REPOSITORY || 'repository'}`,
};
for (const [key, value] of Object.entries(outputs)) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
return outputs;
}

if (require.main === module) aggregate();
module.exports = { aggregate };
