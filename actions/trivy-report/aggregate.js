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

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
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
const mailStatus = totals.failures ? 'SCAN FAILED' : gateFailed ? 'ACTION REQUIRED' : totalFindings ? 'FINDINGS ALLOWED' : 'CLEAN';
const highlightedScans = scans.filter((scan) => !scan.scanOk || scan.vulnerabilities.length + scan.secrets.length + scan.misconfigurations.length > 0);
const cleanScans = scans.length - highlightedScans.length;

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
  `TRIVY SCAN — ${mailStatus}`,
  `REPOSITORY: ${env.GITHUB_REPOSITORY || ''}`,
  `FULL REPORT: ${runUrl}`,
  '',
  'FINDINGS SUMMARY',
  `SCANS: ${scans.length} (${cleanScans} clean)`,
  `VULNERABILITIES: ${totals.vulnerabilities}`,
  `SECRETS: ${totals.secrets}`,
  `MISCONFIGURATIONS: ${totals.misconfigurations}`,
  `SCAN FAILURES: ${totals.failures}`,
  '',
  'SCANS NEEDING ATTENTION',
  ...highlightedScans.map((scan) => {
    const result = !scan.scanOk ? 'SCAN FAILED' : scan.ignoreFinding ? 'FINDINGS ALLOWED BY IGNORE_FINDING' : 'BLOCKING FINDINGS';
    return `${scan.kind.toUpperCase()}: ${scan.target} — ${scan.vulnerabilities.length} vulnerabilities, ${scan.secrets.length} secrets, ${scan.misconfigurations.length} misconfigurations (${result})`;
  }),
  ...(!highlightedScans.length ? ['None'] : []),
  '',
  'Open the workflow run Summary for CVEs, affected packages, fixed versions, files, and remediation details.',
  'Secret values are never included in this email.',
];
fs.writeFileSync(mailPath, `${body.join('\n')}\n`);

const accent = totals.failures ? '#b42318' : gateFailed ? '#c2410c' : totalFindings ? '#9a6700' : '#1a7f37';
const cards = [
  ['VULNERABILITIES', totals.vulnerabilities],
  ['SECRETS', totals.secrets],
  ['MISCONFIGURATIONS', totals.misconfigurations],
  ['SCAN FAILURES', totals.failures],
].map(([label, count]) => `<td style="padding:12px;border:1px solid #d0d7de;text-align:center"><div style="font-size:12px;font-weight:700;color:#57606a">${label}</div><div style="font-size:26px;font-weight:700;color:${count ? accent : '#24292f'}">${count}</div></td>`).join('');
const rows = highlightedScans.map((scan) => {
  const result = !scan.scanOk ? 'SCAN FAILED' : scan.ignoreFinding ? 'ALLOWED BY IGNORE_FINDING' : 'ACTION REQUIRED';
  return `<tr><td style="padding:10px;border-bottom:1px solid #d0d7de"><strong>${html(scan.kind.toUpperCase())}</strong><br>${html(scan.target)}</td><td style="padding:10px;border-bottom:1px solid #d0d7de;text-align:center">${scan.vulnerabilities.length}</td><td style="padding:10px;border-bottom:1px solid #d0d7de;text-align:center">${scan.secrets.length}</td><td style="padding:10px;border-bottom:1px solid #d0d7de;text-align:center">${scan.misconfigurations.length}</td><td style="padding:10px;border-bottom:1px solid #d0d7de;color:${accent};font-weight:700">${result}</td></tr>`;
}).join('');
const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#24292f;line-height:1.5;max-width:760px;margin:0 auto;padding:24px">
<div style="border-left:6px solid ${accent};padding:12px 18px;background:#f6f8fa"><div style="font-size:12px;font-weight:700;color:${accent}">TRIVY SECURITY SCAN</div><h1 style="font-size:24px;margin:4px 0;color:${accent}">${mailStatus}</h1><div><strong>Repository:</strong> ${html(env.GITHUB_REPOSITORY || '')}</div></div>
<h2 style="font-size:17px;margin-top:28px">FINDINGS SUMMARY</h2><p><strong>${scans.length} scans</strong> completed or attempted · <strong>${cleanScans} clean</strong></p>
<table style="border-collapse:collapse;width:100%"><tr>${cards}</tr></table>
<h2 style="font-size:17px;margin-top:28px">SCANS NEEDING ATTENTION</h2>
${highlightedScans.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr style="background:#f6f8fa;text-align:left"><th style="padding:10px">TARGET</th><th>VULNS</th><th>SECRETS</th><th>MISCONFIGS</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>None.</p>'}
<p style="margin-top:28px"><a href="${html(runUrl)}" style="display:inline-block;padding:12px 18px;background:#0969da;color:#fff;text-decoration:none;font-weight:700;border-radius:6px">OPEN FULL GITHUB SUMMARY</a></p>
<p style="font-size:13px;color:#57606a">The Summary includes CVEs, affected packages, fixed versions, files, and remediation details. Secret values are not included in this email.</p>
</body></html>`;
fs.writeFileSync(mailPath.replace(/\.txt$/, '.html'), htmlBody);

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
  subject: `[TRIVY][${mailStatus}] ${totals.vulnerabilities} vulns, ${totals.secrets} secrets — ${env.GITHUB_REPOSITORY || 'repository'}`,
  artifact_name: `trivy-mail-${runId}-${runAttempt}-${env.GITHUB_JOB || 'job'}`,
};
for (const [key, value] of Object.entries(outputs)) fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
return outputs;
}

if (require.main === module) aggregate();
module.exports = { aggregate };
