const { connectDB, getDB, closeDB } = require('../db');

async function main() {
    await connectDB();
    const db = getDB();
    const date = '2026-06-23';

    const mohits = await db.collection('employees').find({
        $or: [
            { firstName: /mohit/i },
            { lastName: /mohit/i },
            { email: /mohit/i }
        ]
    }).toArray();

    const result = [];
    for (const emp of mohits) {
        const leave = await db.collection('leaves').findOne({
            employeeId: emp.id,
            status: 'approved',
            startDate: { $lte: date },
            endDate: { $gte: date }
        });

        const att = await db.collection('attendance').findOne({ date });
        const rec = att?.records?.[emp.id] || att?.records?.[String(emp.id)] || null;

        result.push({
            employeeId: emp.id,
            name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
            email: emp.email || null,
            leaveOnDate: leave
                ? { type: leave.leaveType, halfDay: !!leave.halfDay, startDate: leave.startDate, endDate: leave.endDate }
                : null,
            attendanceOnDate: rec
        });
    }

    console.log(JSON.stringify({ date, totalMohits: mohits.length, result }, null, 2));
}

main()
    .catch((e) => {
        console.error(e?.message || e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
