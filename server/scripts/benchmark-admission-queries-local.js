const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { benchmark } = require('./benchmark-admission-queries');

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

async function seed(db, count = 4000) {
    const admissions = db.collection('admissions');
    const sales = db.collection('sales');

    const statuses = ['approved', 'approved', 'approved', 'pending', 'rejected'];
    const admissionTypes = ['one-time', 'yearly', 'semester-wise'];
    const months = [];
    for (let m = 1; m <= 12; m += 1) months.push(monthKey(2026, m));

    const docs = [];
    for (let i = 0; i < count; i += 1) {
        const month = months[randInt(0, months.length - 1)];
        const [year, mon] = month.split('-').map(Number);
        const day = randInt(1, 28);
        const date = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const employeeId = randInt(1001, 1080);
        const revenue = randInt(12000, 150000);
        const status = statuses[randInt(0, statuses.length - 1)];
        const admissionType = admissionTypes[randInt(0, admissionTypes.length - 1)];

        const totalFees = revenue;
        const outstanding = status === 'approved' ? randInt(0, totalFees) : totalFees;
        const paid = Math.max(0, totalFees - outstanding);

        docs.push({
            employeeId,
            month,
            status,
            admissionDate: date,
            admissionType,
            revenue,
            feeManagement: {
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Installment 1',
                        status: outstanding > 0 ? 'pending' : 'paid',
                        originalFees: totalFees,
                        calculatedFees: totalFees,
                        feesPaid: paid,
                        remainingFees: outstanding
                    }
                ],
                summary: {
                    actualFees: totalFees,
                    totalDiscount: 0,
                    totalFeesPayable: totalFees,
                    feesPaid: paid,
                    outstandingFees: outstanding
                },
                legacyMigration: {
                    requiresReview: false
                }
            }
        });
    }

    if (docs.length) {
        await admissions.insertMany(docs, { ordered: false });
    }

    const salesDocs = [];
    for (const month of months) {
        for (let e = 1001; e <= 1080; e += 1) {
            salesDocs.push({
                month,
                employeeId: e,
                salesTarget: randInt(5, 20)
            });
        }
    }
    await sales.insertMany(salesDocs, { ordered: false });
}

async function createBenchmarkIndexes(db) {
    await db.collection('admissions').createIndex({ employeeId: 1, month: 1 });
    await db.collection('admissions').createIndex({ employeeId: 1, month: 1, status: 1, admissionDate: -1 });
    await db.collection('admissions').createIndex({ status: 1, month: 1, employeeId: 1, admissionDate: -1 });
    await db.collection('admissions').createIndex({ status: 1, month: 1 });
    await db.collection('admissions').createIndex({ status: 1, admissionDate: -1 });
    await db.collection('admissions').createIndex({ admissionType: 1, month: 1 });
    await db.collection('admissions').createIndex({ courseId: 1, universityId: 1, month: 1 });
    await db.collection('admissions').createIndex({ 'feeManagement.legacyMigration.requiresReview': 1, month: 1 });
    await db.collection('admissions').createIndex({ 'feeManagement.summary.outstandingFees': 1, status: 1 });
    await db.collection('admissions').createIndex({
        status: 1,
        month: 1,
        'feeManagement.installments.status': 1,
        'feeManagement.summary.outstandingFees': 1
    });
    await db.collection('admissions').createIndex(
        { 'feeManagementMigration.migrationId': 1 },
        { sparse: true }
    );
    await db.collection('admissions').createIndex(
        { 'feeManagementMigration.rollbackAvailable': 1 },
        { sparse: true }
    );

    await db.collection('sales').createIndex({ month: 1, employeeId: 1 });
    await db.collection('incentive_payments').createIndex({ employeeId: 1, incentiveMonth: 1, status: 1 });
    await db.collection('incentive_payments').createIndex({ status: 1, employeeId: 1, incentiveMonth: 1, createdAt: -1 });
}

async function main() {
    const mongod = await MongoMemoryServer.create();
    const client = new MongoClient(mongod.getUri());

    try {
        await client.connect();
        const db = client.db('benchmark_admissions');

        await seed(db, 4000);
        await createBenchmarkIndexes(db);

        const report = await benchmark(db, { iterations: 30, month: '2026-08' });
        report.environment = {
            source: 'mongodb-memory-server',
            documents: {
                admissions: await db.collection('admissions').countDocuments({}),
                sales: await db.collection('sales').countDocuments({})
            }
        };

        console.log(JSON.stringify(report, null, 2));
    } finally {
        await client.close();
        await mongod.stop();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exitCode = 1;
    });
}
