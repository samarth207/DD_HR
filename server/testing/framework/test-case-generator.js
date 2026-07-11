const fs = require('fs');
const path = require('path');

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `feature-${Date.now()}`;
}

function parsePayload(payload) {
    if (payload === undefined || payload === null || payload === '') return {};
    if (typeof payload === 'object') return payload;
    try {
        return JSON.parse(String(payload));
    } catch (error) {
        throw new Error('Invalid JSON payload');
    }
}

function buildTemplate(config) {
    const payloadText = JSON.stringify(config.payload, null, 8)
        .split('\n')
        .map((line) => `        ${line}`)
        .join('\n');

    const expectedText = JSON.stringify({ status: config.expectedStatus }, null, 8)
        .split('\n')
        .map((line) => `            ${line}`)
        .join('\n');

    return `const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');

const { setDBForTesting } = require('../../../db');
const { createApp } = require('../../../app');

const { TestingRepository } = require('../../../testing/repositories/testing-repository');
const { TestRunner } = require('../../../testing/framework/test-runner');
const { CleanupManager } = require('../../../testing/framework/cleanup-manager');
const { createHttpClient } = require('../../../testing/framework/http-client');
const { assertStatus } = require('../../../testing/assertions/validation-engine');

jest.setTimeout(120000);

describe('Generated Feature Tests: ${config.featureName}', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let app;
    let http;
    let repo;
    let runner;

    function isolatedDb(raw, suffix = '_Test') {
        return {
            ...raw,
            collection(name, options) {
                if (name.startsWith('Testing')) return raw.collection(name, options);
                return raw.collection(name + suffix, options);
            }
        };
    }

    async function runCase(moduleName, caseName, expected, fn) {
        const ctx = runner.createCase(moduleName, caseName, expected);
        await runner.beginCase(ctx);

        const cleanup = new CleanupManager();
        const databaseChanges = [];

        try {
            const result = await fn({ cleanup, databaseChanges });
            const rollback = await cleanup.run();

            await runner.endCase(ctx, {
                status: 'passed',
                actualResult: result.actualResult,
                databaseValidation: result.databaseValidation,
                apiValidation: result.apiValidation,
                businessRuleValidation: result.businessRuleValidation,
                rollbackStatus: rollback.ok ? 'completed' : 'partial-failed',
                databaseChanges: [...databaseChanges, { rollback: rollback.details }],
                apiResponse: result.apiResponse
            });

            return { ok: true };
        } catch (error) {
            const rollback = await cleanup.run();
            await runner.endCase(ctx, {
                status: 'failed',
                actualResult: null,
                databaseValidation: false,
                apiValidation: false,
                businessRuleValidation: false,
                rollbackStatus: rollback.ok ? 'completed' : 'partial-failed',
                databaseChanges: [...databaseChanges, { rollback: rollback.details }],
                apiResponse: null,
                errorStack: error.stack
            });
            return { ok: false, error };
        }
    }

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        client = new MongoClient(mongod.getUri());
        await client.connect();

        rawDb = client.db('hr_portal_automation');
        db = isolatedDb(rawDb, '_Test');
        setDBForTesting(db);

        app = createApp({ includeAuthRoutes: false });

        repo = new TestingRepository(db);
        await repo.initIndexes();

        runner = new TestRunner(repo);
        await runner.start();

        http = createHttpClient(app, async (level, message, meta) => {
            await runner.log(level, message, meta);
        });
    });

    afterAll(async () => {
        if (runner) {
            const summary = await runner.finish();
            await runner.log('info', 'Automation run summary', summary);
        }

        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('${config.featureName}', async () => {
        const result = await runCase(
            '${config.moduleName}',
            '${config.featureName}',
${expectedText},
            async ({ databaseChanges }) => {
                const payload =
${payloadText};

                const response = await http.send('${config.method}', '${config.endpoint}', payload);
                assertStatus(response.status, ${config.expectedStatus}, 'feature status');

                // TODO: Add feature-specific DB validation here.
                databaseChanges.push({
                    action: 'feature-validation',
                    note: 'Add DB and business rule checks for ${config.featureName}'
                });

                return {
                    actualResult: response.body,
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: response.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });
});
`;
}

function normalizeConfig(input) {
    const featureName = String(input.featureName || '').trim();
    const moduleName = String(input.moduleName || '').trim();
    const endpoint = String(input.endpoint || '').trim();
    const method = String(input.method || 'post').trim().toLowerCase();
    const expectedStatus = parseInt(input.expectedStatus, 10);

    if (!featureName) throw new Error('featureName is required');
    if (!moduleName) throw new Error('moduleName is required');
    if (!endpoint.startsWith('/api/')) throw new Error('endpoint must start with /api/');
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) throw new Error('invalid method');
    if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
        throw new Error('expectedStatus must be a valid HTTP status code');
    }

    return {
        featureName,
        moduleName,
        endpoint,
        method,
        expectedStatus,
        payload: parsePayload(input.payload)
    };
}

function generateFeatureTestFile(config, options = {}) {
    const normalized = normalizeConfig(config);
    const targetDir = options.targetDir || path.join(__dirname, '..', '..', 'tests', 'e2e', 'generated');

    fs.mkdirSync(targetDir, { recursive: true });

    const slug = slugify(normalized.featureName);
    let filePath = path.join(targetDir, `${slug}.test.js`);
    if (fs.existsSync(filePath)) {
        filePath = path.join(targetDir, `${slug}-${Date.now()}.test.js`);
    }

    const content = buildTemplate(normalized);
    fs.writeFileSync(filePath, content, 'utf8');

    return {
        filePath,
        relativePath: path.relative(path.join(__dirname, '..', '..'), filePath).replace(/\\/g, '/'),
        config: normalized
    };
}

module.exports = {
    normalizeConfig,
    generateFeatureTestFile
};
