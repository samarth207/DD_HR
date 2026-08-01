const { connectDB, getDB, closeDB } = require('../db');
const salaryCycleUtils = require('../../salary-cycle-utils');

function monthKeyFromParts(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function parseMonthKeyFromLegacyKey(key) {
    const match = String(key || '').match(/^(\d{4}-\d{2})_(.+)$/);
    if (!match) return null;
    return { monthKey: match[1], employeeIdFromKey: match[2] };
}

function buildSalaryPeriod(monthKey, hireDate) {
    const cycle = salaryCycleUtils.getSalaryCycleForMonth(monthKey, hireDate || null);
    if (!cycle) return null;
    const toDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
        monthKey: cycle.monthKey,
        cycleStart: toDate(cycle.cycleStart),
        cycleEnd: toDate(cycle.cycleEnd),
        isFirstSalaryMonth: Boolean(cycle.isFirstSalaryMonth),
        salaryPeriod: {
            start: toDate(cycle.cycleStart),
            end: toDate(cycle.cycleEnd),
            isFirstSalaryMonth: Boolean(cycle.isFirstSalaryMonth)
        }
    };
}

function needsSalaryPeriodUpdate(doc, target) {
    if (!doc.salaryPeriod) return true;
    return (
        doc.salaryPeriod.start !== target.salaryPeriod.start ||
        doc.salaryPeriod.end !== target.salaryPeriod.end ||
        Boolean(doc.salaryPeriod.isFirstSalaryMonth) !== Boolean(target.salaryPeriod.isFirstSalaryMonth) ||
        doc.cycleStart !== target.cycleStart ||
        doc.cycleEnd !== target.cycleEnd ||
        Boolean(doc.isFirstSalaryMonth) !== Boolean(target.isFirstSalaryMonth) ||
        doc.monthKey !== target.monthKey
    );
}

async function migrateModernSalaryPayments(db, employeeHireDateMap) {
    const cursor = db.collection('salaryPayments').find({});
    const nowIso = new Date().toISOString();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        scanned++;

        const year = parseInt(doc?.year, 10);
        const month = parseInt(doc?.month, 10);
        const employeeId = doc?.employeeId != null ? String(doc.employeeId) : null;
        if (!year || !month || month < 1 || month > 12 || !employeeId) {
            skipped++;
            continue;
        }

        const monthKey = monthKeyFromParts(year, month);
        const hireDate = employeeHireDateMap.get(employeeId) || null;
        const target = buildSalaryPeriod(monthKey, hireDate);
        if (!target) {
            skipped++;
            continue;
        }

        if (!needsSalaryPeriodUpdate(doc, target)) {
            continue;
        }

        await db.collection('salaryPayments').updateOne(
            { _id: doc._id },
            {
                $set: {
                    monthKey: target.monthKey,
                    cycleStart: target.cycleStart,
                    cycleEnd: target.cycleEnd,
                    isFirstSalaryMonth: target.isFirstSalaryMonth,
                    salaryPeriod: target.salaryPeriod,
                    salaryPeriodMigratedAt: nowIso
                }
            }
        );

        updated++;
    }

    return { scanned, updated, skipped };
}

async function migrateLegacySalaryPayments(db, employeeHireDateMap) {
    const cursor = db.collection('salary_payments').find({});
    const nowIso = new Date().toISOString();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        scanned++;

        let monthKey = null;
        let employeeId = doc?.employeeId != null ? String(doc.employeeId) : null;

        const parsedKey = parseMonthKeyFromLegacyKey(doc?.key);
        if (parsedKey?.monthKey) {
            monthKey = parsedKey.monthKey;
            if (!employeeId) employeeId = String(parsedKey.employeeIdFromKey);
        }

        if (!monthKey) {
            const year = parseInt(doc?.year, 10);
            const month = parseInt(doc?.month, 10);
            if (year && month >= 1 && month <= 12) {
                monthKey = monthKeyFromParts(year, month);
            }
        }

        if (!monthKey) {
            skipped++;
            continue;
        }

        const hireDate = employeeHireDateMap.get(String(employeeId || '')) || null;
        const target = buildSalaryPeriod(monthKey, hireDate);
        if (!target) {
            skipped++;
            continue;
        }

        if (!needsSalaryPeriodUpdate(doc, target)) {
            continue;
        }

        await db.collection('salary_payments').updateOne(
            { _id: doc._id },
            {
                $set: {
                    monthKey: target.monthKey,
                    cycleStart: target.cycleStart,
                    cycleEnd: target.cycleEnd,
                    isFirstSalaryMonth: target.isFirstSalaryMonth,
                    salaryPeriod: target.salaryPeriod,
                    salaryPeriodMigratedAt: nowIso
                }
            }
        );

        updated++;
    }

    return { scanned, updated, skipped };
}

async function main() {
    await connectDB();
    const db = getDB();
    if (!db) {
        throw new Error('Database not connected');
    }

    const employees = await db.collection('employees').find({}, { projection: { id: 1, hireDate: 1 } }).toArray();
    const employeeHireDateMap = new Map();
    for (const emp of employees) {
        if (emp?.id == null) continue;
        employeeHireDateMap.set(String(emp.id), emp.hireDate || null);
    }

    const modern = await migrateModernSalaryPayments(db, employeeHireDateMap);
    const legacy = await migrateLegacySalaryPayments(db, employeeHireDateMap);

    console.log(JSON.stringify({
        success: true,
        note: 'Non-destructive migration only. No salary records are deleted.',
        employeeCount: employees.length,
        salaryPayments: modern,
        salary_payments: legacy
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
