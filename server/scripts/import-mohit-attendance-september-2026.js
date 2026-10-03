const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const employeeId = 1779705854092;
const halfDayNote = 'Half Day Leave (First Half)';
const source = [
    [1, 'present', '09:57', null],
    [2, 'present', '09:55', null],
    [3, 'present', '09:55', null],
    [4, 'present', '10:00', halfDayNote],
    [5, 'present', '09:58', null],
    [6, 'absent', null, null],
    [7, 'on-leave', null, 'Unpaid Leave'],
    [8, 'on-leave', null, 'Unpaid Leave'],
    [9, 'on-leave', null, 'Unpaid Leave'],
    [10, 'present', '09:57', halfDayNote],
    [11, 'on-leave', null, 'Unpaid Leave'],
    [12, 'on-leave', null, 'Unpaid Leave'],
    [13, 'on-leave', null, 'Unpaid Leave'],
    [14, 'on-leave', null, 'Unpaid Leave'],
    [15, 'on-leave', null, 'Unpaid Leave'],
    [16, 'on-leave', null, 'Unpaid Leave'],
    [17, 'on-leave', null, 'Unpaid Leave'],
    [18, 'on-leave', null, 'Unpaid Leave'],
    [19, 'present', '09:58', null],
    [20, 'absent', null, null],
    [21, 'on-leave', null, 'Paid Leave'],
    [22, 'on-leave', null, 'Unpaid Leave'],
    [23, 'absent', null, null],
    [24, 'late', '10:45', null],
    [25, 'present', '10:09', null],
    [26, 'present', '08:51', halfDayNote],
    [27, 'absent', null, null],
    [28, 'present', '10:00', null],
    [29, 'present', '09:58', null],
    [30, 'on-leave', null, 'Unpaid Leave']
];

async function main() {
    assert.equal(source.length, 30);
    source.forEach(([day], index) => assert.equal(day, index + 1));
    const client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15000,
        family: 4
    });
    try {
        await client.connect();
        const db = client.db(process.env.DB_NAME);
        const suffix = process.env.COLLECTION_SUFFIX || '';
        const employees = await db.collection(`employees${suffix}`).find({
            firstName: /^\s*Mohit\s*$/i,
            lastName: /^\s*Gupta\s*$/i
        }, { projection: { id: 1 } }).toArray();
        assert.equal(employees.length, 1, 'Expected exactly one Mohit Gupta');
        assert.equal(employees[0].id, employeeId, 'Employee identity mismatch');

        const attendance = db.collection(`attendance${suffix}`);
        const range = { date: { $gte: '2026-09-01', $lte: '2026-09-30' } };
        const before = await attendance.find(range).toArray();
        assert.equal(new Set(before.map(doc => doc.date)).size, before.length,
            'Duplicate attendance dates require manual review');
        const leaves = await db.collection(`leaves${suffix}`).find({
            employeeId,
            status: 'approved',
            startDate: { $lte: '2026-09-30' },
            endDate: { $gte: '2026-09-01' }
        }).toArray();
        const entries = source.map(([day, status, time, notes]) => ({
            date: `2026-09-${String(day).padStart(2, '0')}`,
            record: { status, time, notes, lateByMins: status === 'late' ? 45 : null }
        }));
        const recordPath = `records.${employeeId}`;
        for (const { date, record } of entries) {
            const existing = before.find(doc => doc.date === date)?.records?.[employeeId];
            if (existing) assert.deepEqual(existing, record, `Conflicting attendance on ${date}`);
            const matchingLeaves = leaves.filter(leave => date >= leave.startDate && date <= leave.endDate);
            if (record.notes) {
                assert.equal(matchingLeaves.length, 1, `Expected one matching leave on ${date}`);
                const leave = matchingLeaves[0];
                if (record.notes === halfDayNote) {
                    assert.equal(leave.halfDay, true, `Expected half-day leave on ${date}`);
                    assert.equal(leave.halfDaySession, 'First Half');
                } else {
                    assert.equal(leave.leaveType, record.notes, `Leave type mismatch on ${date}`);
                    assert.notEqual(leave.halfDay, true);
                }
            } else {
                assert.equal(matchingLeaves.length, 0, `Unexpected approved leave on ${date}`);
            }
        }
        const summary = entries.reduce((totals, { record }) => {
            totals[record.status] = (totals[record.status] || 0) + 1;
            return totals;
        }, {});
        if (!process.argv.includes('--apply')) {
            console.log(JSON.stringify({ mode: 'dry-run', employeeId, dates: entries.length, summary, conflicts: 0 }));
            return;
        }
        await attendance.bulkWrite(entries.map(({ date, record }) => ({
            updateOne: {
                filter: { date },
                update: { $set: { [recordPath]: record }, $setOnInsert: { date } },
                upsert: true
            }
        })), { ordered: true });

        const after = await attendance.find(range).toArray();
        assert.equal(after.length, 30);
        for (const { date, record } of entries) {
            assert.deepEqual(after.find(doc => doc.date === date)?.records?.[employeeId], record,
                `Read-back mismatch on ${date}`);
        }
        for (const doc of before) {
            const saved = after.find(entry => entry.date === doc.date);
            for (const [otherId, record] of Object.entries(doc.records || {})) {
                if (otherId !== String(employeeId)) assert.deepEqual(saved.records[otherId], record);
            }
        }
        console.log(JSON.stringify({ mode: 'applied', employeeId, verifiedDates: after.length, summary,
            existingLeavesUnchanged: true, otherEmployeesPreserved: true }));
    } finally {
        await client.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});