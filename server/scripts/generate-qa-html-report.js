const fs = require('fs');
const path = require('path');

const reportsDir = path.join(__dirname, '..', 'testing', 'reports');
const jsonPath = path.join(reportsDir, 'jest-results.json');
const htmlPath = path.join(reportsDir, 'latest-report.html');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readResults() {
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Missing Jest JSON report at ${jsonPath}`);
    }
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function renderSummary(results) {
    const total = results.numTotalTests || 0;
    const passed = results.numPassedTests || 0;
    const failed = results.numFailedTests || 0;
    const pending = results.numPendingTests || 0;
    const durationMs = (results.testResults || []).reduce((sum, suite) => sum + (suite.endTime - suite.startTime), 0);
    const status = failed > 0 ? 'FAILED' : 'PASSED';

    return `
    <section class=\"cards\">
      <div class=\"card\"><h3>Status</h3><p class=\"${failed > 0 ? 'bad' : 'good'}\">${status}</p></div>
      <div class=\"card\"><h3>Total Tests</h3><p>${total}</p></div>
      <div class=\"card\"><h3>Passed</h3><p class=\"good\">${passed}</p></div>
      <div class=\"card\"><h3>Failed</h3><p class=\"${failed > 0 ? 'bad' : ''}\">${failed}</p></div>
      <div class=\"card\"><h3>Pending</h3><p>${pending}</p></div>
      <div class=\"card\"><h3>Duration</h3><p>${(durationMs / 1000).toFixed(2)}s</p></div>
    </section>
  `;
}

function renderSuites(results) {
    const suites = results.testResults || [];
    return suites.map((suite) => {
        const assertions = suite.assertionResults || [];
        const failedAssertions = assertions.filter((a) => a.status === 'failed');
        const passedCount = assertions.filter((a) => a.status === 'passed').length;
        const failedCount = failedAssertions.length;
        const duration = ((suite.endTime - suite.startTime) / 1000).toFixed(2);

        const rows = assertions.map((a) => {
            const failures = (a.failureMessages || [])
                .map((msg) => `<pre>${escapeHtml(msg)}</pre>`)
                .join('');
            return `
          <tr>
            <td>${escapeHtml(a.title)}</td>
            <td>${escapeHtml(a.ancestorTitles?.join(' > ') || '-')}</td>
            <td class=\"${a.status === 'failed' ? 'bad' : 'good'}\">${escapeHtml(a.status)}</td>
            <td>${a.duration != null ? `${a.duration}ms` : '-'}</td>
          </tr>
          ${failures ? `<tr><td colspan=\"4\">${failures}</td></tr>` : ''}
        `;
        }).join('');

        return `
      <section class=\"suite\">
        <h2>${escapeHtml(suite.name)}</h2>
        <p>Passed: <strong class=\"good\">${passedCount}</strong> | Failed: <strong class=\"${failedCount > 0 ? 'bad' : ''}\">${failedCount}</strong> | Duration: ${duration}s</p>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Group</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4">No test assertions found</td></tr>'}
          </tbody>
        </table>
      </section>
    `;
    }).join('\n');
}

function renderHtml(results) {
    const generatedAt = new Date().toLocaleString();
    return `<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>HR Portal QA Report</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: #f5f7fb; color: #1f2937; }
    header { background: #111827; color: #fff; padding: 20px 24px; }
    header h1 { margin: 0 0 4px; font-size: 24px; }
    header p { margin: 0; color: #cbd5e1; }
    main { padding: 20px 24px 40px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
    .card h3 { margin: 0 0 8px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .card p { margin: 0; font-size: 24px; font-weight: 700; }
    .good { color: #047857; }
    .bad { color: #b91c1c; }
    .suite { margin-top: 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
    .suite h2 { margin: 0 0 8px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
    pre { margin: 8px 0 0; background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; }
  </style>
</head>
<body>
  <header>
    <h1>HR Portal Automated QA Report</h1>
    <p>Generated at ${escapeHtml(generatedAt)}</p>
  </header>
  <main>
    ${renderSummary(results)}
    ${renderSuites(results)}
  </main>
</body>
</html>`;
}

function main() {
    fs.mkdirSync(reportsDir, { recursive: true });
    const results = readResults();
    const html = renderHtml(results);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`✅ HTML report generated: ${htmlPath}`);
}

main();
