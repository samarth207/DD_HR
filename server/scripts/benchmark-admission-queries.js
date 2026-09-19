const { connectDB, getDB, closeDB } = require('../db');

function formatMsFromNs(nanos) {
    return Number(nanos) / 1e6;
}

async function measure(label, iterations, fn) {
    for (let i = 0; i < 3; i += 1) {
        await fn();
    }

    const samples = [];
    for (let i = 0; i < iterations; i += 1) {
        const start = process.hrtime.bigint();
        await fn();
        const end = process.hrtime.bigint();
        samples.push(formatMsFromNs(end - start));
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const avgMs = total / samples.length;
    const p50Ms = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;

    return {
        label,
        iterations,
        avgMs: Math.round(avgMs * 1000) / 1000,
        p50Ms: Math.round(p50Ms * 1000) / 1000,
        p95Ms: Math.round(p95Ms * 1000) / 1000
    };
}

function extractWinningStage(explain) {
    const qp = explain?.queryPlanner || {};
    return qp.winningPlan || qp.winningPlan?.inputStage || null;
}

function findIndexName(plan) {
    if (!plan || typeof plan !== 'object') return null;
    if (plan.indexName) return plan.indexName;
    if (Array.isArray(plan.inputStages)) {
        for (const stage of plan.inputStages) {
            const result = findIndexName(stage);
            if (result) return result;
        }
    }
    if (plan.inputStage) return findIndexName(plan.inputStage);
    if (plan.innerStage) return findIndexName(plan.innerStage);
    if (plan.outerStage) return findIndexName(plan.outerStage);
    if (plan.shards && Array.isArray(plan.shards)) {
        for (const shard of plan.shards) {
            const result = findIndexName(shard?.winningPlan || shard?.executionStages);
            if (result) return result;
        }
    }
    return null;
}

function extractDocsExamined(explain) {
    const stats = explain?.executionStats;
    if (!stats) return null;
    return {
        nReturned: stats.nReturned,
        totalDocsExamined: stats.totalDocsExamined,
        totalKeysExamined: stats.totalKeysExamined
    };
}

async function benchmark(db, options = {}) {
    const admissions = db.collection('admissions');
    const sales = db.collection('sales');

    const iterations = Math.max(3, parseInt(options.iterations, 10) || 20);
    const month = String(options.month || new Date().toISOString().slice(0, 7));

    const sampleAdmission = await admissions.findOne({});
    const sampleEmployeeId = sampleAdmission?.employeeId || 0;

    const admissionListQuery = {
        employeeId: sampleEmployeeId,
        month,
        status: 'approved'
    };

    const installmentOutstandingQuery = {
        status: 'approved',
        month,
        'feeManagement.installments.status': 'pending',
        'feeManagement.summary.outstandingFees': { $gt: 0 }
    };

    const migrationScanQuery = {
        $or: [
            { feeManagement: { $exists: false } },
            { feeManagement: null },
            { 'feeManagement.installments': { $exists: false } },
            { 'feeManagement.installments.0': { $exists: false } }
        ]
    };

    const analyticsPipeline = [
        { $match: { status: 'approved', month } },
        {
            $group: {
                _id: '$employeeId',
                totalAdmissions: { $sum: 1 },
                totalRevenue: { $sum: '$revenue' }
            }
        }
    ];

    const timed = [];

    timed.push(await measure('Admission list query', iterations, async () => {
        await admissions.find(admissionListQuery).sort({ admissionDate: -1 }).limit(100).toArray();
    }));

    timed.push(await measure('Installment pending/outstanding query', iterations, async () => {
        await admissions.find(installmentOutstandingQuery).limit(100).toArray();
    }));

    timed.push(await measure('Migration candidates query', iterations, async () => {
        await admissions.find(migrationScanQuery).limit(200).toArray();
    }));

    timed.push(await measure('Dashboard sales month query', iterations, async () => {
        await sales.find({ month }).toArray();
    }));

    timed.push(await measure('Analytics group by employee', iterations, async () => {
        await admissions.aggregate(analyticsPipeline).toArray();
    }));

    const admissionExplain = await admissions.find(admissionListQuery).sort({ admissionDate: -1 }).limit(100).explain('executionStats');
    const installmentExplain = await admissions.find(installmentOutstandingQuery).limit(100).explain('executionStats');
    const migrationExplain = await admissions.find(migrationScanQuery).limit(200).explain('executionStats');
    const dashboardExplain = await sales.find({ month }).explain('executionStats');
    const analyticsExplain = await admissions.aggregate(analyticsPipeline).explain('executionStats');

    const plans = [
        ['Admission list query', admissionExplain],
        ['Installment pending/outstanding query', installmentExplain],
        ['Migration candidates query', migrationExplain],
        ['Dashboard sales month query', dashboardExplain],
        ['Analytics group by employee', analyticsExplain]
    ].map(([label, explain]) => ({
        label,
        indexName: findIndexName(extractWinningStage(explain)) || 'N/A',
        ...extractDocsExamined(explain)
    }));

    return {
        generatedAt: new Date().toISOString(),
        parameters: {
            iterations,
            month,
            sampleEmployeeId
        },
        timed,
        plans
    };
}

async function main() {
    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    const iterations = process.argv[2] || '20';
    const month = process.argv[3] || '';

    const report = await benchmark(db, { iterations, month });
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error?.stack || error?.message || error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await closeDB();
        });
}

module.exports = { benchmark };
