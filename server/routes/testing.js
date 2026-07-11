const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { generateFeatureTestFile } = require('../testing/framework/test-case-generator');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

async function buildFullReport(db, runId, moduleName, status) {
    const run = await db.collection('TestingRuns').findOne({ runId });
    if (!run) return null;

    const resultQuery = { runId };
    if (moduleName) resultQuery.module = moduleName;
    if (status) resultQuery.status = status;

    const [results, expected, logs] = await Promise.all([
        db.collection('TestingResults').find(resultQuery).sort({ startedAt: 1 }).toArray(),
        db.collection('TestingExpected').find({ runId }).toArray(),
        db.collection('TestingLogs').find({ runId }).sort({ at: 1 }).toArray()
    ]);

    const expectedByCase = expected.reduce((acc, row) => {
        acc[row.testCaseId] = row;
        return acc;
    }, {});

    const cases = results.map((row) => {
        const exp = expectedByCase[row.testCaseId] || null;
        const caseLogs = logs.filter((l) => l.testCaseId === row.testCaseId);
        return {
            ...row,
            expectedRecord: exp,
            logs: caseLogs
        };
    });

    const summary = {
        total: cases.length,
        passed: cases.filter((c) => c.status === 'passed').length,
        failed: cases.filter((c) => c.status === 'failed').length,
        skipped: cases.filter((c) => c.status === 'skipped').length,
        modules: Array.from(new Set(cases.map((c) => c.module).filter(Boolean)))
    };

    return {
        run,
        summary,
        cases,
        logs
    };
}

function buildEasySummary(report) {
    const failedCases = report.cases.filter((c) => c.status === 'failed');
    const salesCases = report.cases.filter((c) => String(c.module).toLowerCase() === 'sales');

    const salesInsights = [];
    for (const c of salesCases) {
        const data = c.apiResponse || c.actualResult || {};
        salesInsights.push({
            caseName: c.name,
            salesTarget: data.salesTarget,
            salesAchieved: data.salesAchieved,
            revenueTarget: data.revenueTarget,
            revenueAchieved: data.revenueAchieved,
            raw: data
        });
    }

    const timeline = report.cases.map((c) => ({
        module: c.module,
        test: c.name,
        status: c.status,
        timeMs: c.executionTimeMs
    }));

    const plainStatus = report.summary.failed > 0
        ? 'Some tests failed. Please review failed cases below.'
        : 'All tests passed. System behavior matches expected results.';

    const keyPoints = [
        `Total tests: ${report.summary.total}`,
        `Passed: ${report.summary.passed}`,
        `Failed: ${report.summary.failed}`,
        `Modules covered: ${report.summary.modules.join(', ') || 'N/A'}`
    ];

    return {
        runId: report.run.runId,
        status: report.run.status,
        plainStatus,
        keyPoints,
        timeline,
        salesInsights,
        failedCases: failedCases.map((c) => ({
            module: c.module,
            test: c.name,
            errorStack: c.errorStack,
            actualResult: c.actualResult,
            apiResponse: c.apiResponse
        }))
    };
}

router.get('/summary', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const filter = {};
        if (req.query.module) filter.module = req.query.module;
        if (req.query.status) filter.status = req.query.status;
        if (req.query.from || req.query.to) {
            filter.createdAt = {};
            if (req.query.from) filter.createdAt.$gte = req.query.from;
            if (req.query.to) filter.createdAt.$lte = req.query.to;
        }
        const docs = await db.collection('TestingSummary').find(filter).sort({ createdAt: -1 }).limit(200).toArray();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/runs', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const runs = await db.collection('TestingRuns').find({}).sort({ startTime: -1 }).limit(200).toArray();
        res.json(runs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/runs/:runId/results', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const results = await db.collection('TestingResults').find({ runId: req.params.runId }).sort({ startedAt: 1 }).toArray();
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/runs/:runId/logs', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const logs = await db.collection('TestingLogs').find({ runId: req.params.runId }).sort({ at: 1 }).toArray();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/runs/:runId/expected', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const docs = await db.collection('TestingExpected').find({ runId: req.params.runId }).sort({ createdAt: 1 }).toArray();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/runs/:runId/full-report', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const report = await buildFullReport(db, req.params.runId, req.query.module, req.query.status);
        if (!report) return res.status(404).json({ error: 'Run not found' });
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/latest-report', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const latest = await db.collection('TestingRuns').find({}).sort({ startTime: -1 }).limit(1).toArray();
        if (!latest.length) return res.status(404).json({ error: 'No test runs found' });

        const report = await buildFullReport(db, latest[0].runId, req.query.module, req.query.status);
        if (!report) return res.status(404).json({ error: 'Run not found' });
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/latest-easy-summary', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const latest = await db.collection('TestingRuns').find({}).sort({ startTime: -1 }).limit(1).toArray();
        if (!latest.length) return res.status(404).json({ error: 'No test runs found' });

        const report = await buildFullReport(db, latest[0].runId);
        if (!report) return res.status(404).json({ error: 'Run not found' });

        res.json(buildEasySummary(report));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/generate-case', async (req, res) => {
    try {
        const { featureName, moduleName, method, endpoint, expectedStatus, payload } = req.body || {};
        const generated = generateFeatureTestFile({
            featureName,
            moduleName,
            method,
            endpoint,
            expectedStatus,
            payload
        });

        res.status(201).json({
            success: true,
            message: 'Feature test file generated',
            filePath: generated.filePath,
            relativePath: generated.relativePath,
            config: generated.config
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
