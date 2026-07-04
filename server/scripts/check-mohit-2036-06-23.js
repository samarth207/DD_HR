const { connectDB, getDB, closeDB } = require('../db');

async function main() {
    await connectDB();
    const db = getDB();
    const date = '2036-06-23';

    const emp = await db.collection('employees').findOne({
        $or: [
            { firstName: /^mohit$/i },
            { lastName: /^mohit$/i },
            { email: /mohit/i }
        ]
    });

    if (!emp) {
        console.log('Mohit not found');
        return;
    }

    const leave = await db.collection('leaves').findOne({
        employeeId: emp.id,
        status: 'approved',
        startDate: { $lte: date },
        endDate: { $gte: date }
    });

    const att = await db.collection('attendance').findOne({ date });
    const rec = att?.records?.[emp.id] || att?.records?.[String(emp.id)] || null;

    console.log(JSON.stringify({
        employeeId: emp.id,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        date,
        leaveOnDate: leave
            ? {
                leaveType: leave.leaveType,
                halfDay: !!leave.halfDay,
                startDate: leave.startDate,
                endDate: leave.endDate
            }
            : null,
        attendanceOnDate: rec
    }, null, 2));
}

main()
    .catch((e) => {
        console.error(e?.message || e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
