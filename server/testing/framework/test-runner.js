const { nowIso, runId, testCaseId } = require('../helpers/utils');

class TestRunner {
    constructor(repository) {
        this.repository = repository;
        this.runId = runId();
        this.startedAt = Date.now();
        this.stats = { total: 0, passed: 0, failed: 0, skipped: 0 };
    }

    async start() {
        await this.repository.createRun({
            runId: this.runId,
            startTime: nowIso(),
            endTime: null,
            status: 'running',
            durationMs: 0,
            logs: [],
            databaseChanges: [],
            rollbackStatus: 'pending',
            screenshots: [],
            apiResponse: null,
            errorStack: null
        });
    }

    async log(level, message, meta = {}) {
        await this.repository.log({
            runId: this.runId,
            at: nowIso(),
            level,
            message,
            ...meta
        });
    }

    createCase(moduleName, name, expected) {
        const id = testCaseId(moduleName.replace(/\s+/g, '-').toLowerCase());
        return {
            testCaseId: id,
            module: moduleName,
            name,
            expected,
            startedAt: nowIso(),
            startMs: Date.now()
        };
    }

    async beginCase(ctx) {
        this.stats.total += 1;
        await this.repository.saveExpected({
            runId: this.runId,
            testCaseId: ctx.testCaseId,
            module: ctx.module,
            name: ctx.name,
            expected: ctx.expected,
            createdAt: nowIso()
        });
        await this.log('info', `Starting ${ctx.module} :: ${ctx.name}`, { testCaseId: ctx.testCaseId });
    }

    async endCase(ctx, result) {
        if (result.status === 'passed') this.stats.passed += 1;
        else if (result.status === 'failed') this.stats.failed += 1;
        else this.stats.skipped += 1;

        await this.repository.saveResult({
            runId: this.runId,
            testCaseId: ctx.testCaseId,
            module: ctx.module,
            name: ctx.name,
            startedAt: ctx.startedAt,
            endedAt: nowIso(),
            executionTimeMs: Date.now() - ctx.startMs,
            status: result.status,
            expectedResult: ctx.expected,
            actualResult: result.actualResult,
            databaseValidation: result.databaseValidation,
            apiValidation: result.apiValidation,
            businessRuleValidation: result.businessRuleValidation,
            rollbackStatus: result.rollbackStatus,
            databaseChanges: result.databaseChanges,
            apiResponse: result.apiResponse,
            errorStack: result.errorStack || null
        });

        await this.log(result.status === 'passed' ? 'info' : 'error', `${ctx.module} :: ${ctx.name} -> ${result.status}`, {
            testCaseId: ctx.testCaseId,
            executionTimeMs: Date.now() - ctx.startMs,
            errorStack: result.errorStack || null
        });
    }

    async finish() {
        const durationMs = Date.now() - this.startedAt;
        const status = this.stats.failed > 0 ? 'failed' : 'passed';
        const endTime = nowIso();

        await this.repository.updateRun(this.runId, {
            endTime,
            status,
            durationMs,
            rollbackStatus: 'completed'
        });

        await this.repository.saveSummary({
            runId: this.runId,
            createdAt: endTime,
            status,
            durationMs,
            totalTests: this.stats.total,
            passed: this.stats.passed,
            failed: this.stats.failed,
            skipped: this.stats.skipped
        });

        return {
            runId: this.runId,
            ...this.stats,
            status,
            durationMs
        };
    }
}

module.exports = { TestRunner };
