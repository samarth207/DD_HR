const fs = require('fs');
const readline = require('readline');
const { generateFeatureTestFile } = require('../testing/framework/test-case-generator');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            i += 1;
        }
    }
    return args;
}

function toTitle(value) {
    return String(value || '')
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join(' ');
}

function parseJsonSafe(raw, fallback = {}) {
    if (!raw || !String(raw).trim()) return fallback;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

async function askQuestion(rl, label, fallback = '') {
    const suffix = fallback ? ` (default: ${fallback})` : '';
    const answer = await new Promise((resolve) => {
        rl.question(`${label}${suffix}: `, resolve);
    });
    const value = String(answer || '').trim();
    return value || fallback;
}

async function promptMissingValues(args) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
        const featureName = args.feature || await askQuestion(rl, 'Feature name', 'New Feature');
        const moduleName = args.module || await askQuestion(rl, 'Module name', toTitle(featureName));
        const method = String(args.method || await askQuestion(rl, 'HTTP method', 'post')).toLowerCase();
        const endpoint = args.endpoint || await askQuestion(rl, 'API endpoint', '/api/example');
        const expectedStatus = parseInt(args.status || await askQuestion(rl, 'Expected status code', '200'), 10);

        const payloadInput = args.payload || await askQuestion(
            rl,
            'JSON payload (single line JSON)',
            '{}'
        );
        const payload = parseJsonSafe(payloadInput, {});

        return {
            featureName,
            moduleName,
            method,
            endpoint,
            expectedStatus: Number.isInteger(expectedStatus) ? expectedStatus : 200,
            payload
        };
    } finally {
        rl.close();
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const cfg = await promptMissingValues(args);

    if (args['dry-run']) {
        const temp = generateFeatureTestFile(cfg);
        const content = fs.readFileSync(temp.filePath, 'utf8');
        fs.unlinkSync(temp.filePath);
        console.log(content);
        return;
    }

    const generated = generateFeatureTestFile(cfg);

    console.log('Generated feature test file:');
    console.log(generated.filePath);
    console.log('Next steps:');
    console.log('1) Add feature-specific DB assertions in the generated file.');
    console.log('2) Run: npm run test:e2e');
    console.log('3) For persisted report: npm run test:e2e:report');
}

main().catch((error) => {
    console.error('Failed to generate test case:', error.message);
    process.exit(1);
});
