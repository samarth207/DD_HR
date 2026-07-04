const { connectDB, getDB, closeDB } = require('../db');

function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function main() {
    await connectDB();
    const db = getDB();

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

    const base = new Date('2036-06-23T00:00:00');
    const rows = [];

    for (let i = -7; i <= 7; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        const date = formatDate(d);

        const leave = await db.collection('leaves').findOne({
            employeeId: emp.id,
            status: 'approved',
            startDate: { $lte: date },
            endDate: { $gte: date }
        });

        const att = await db.collection('attendance').findOne({ date });
        const rec = att?.records?.[emp.id] || att?.records?.[String(emp.id)] || null;

        if (leave || rec) {
            rows.push({
                date,
                leave: leave
                    ? { type: leave.leaveType, halfDay: !!leave.halfDay, startDate: leave.startDate, endDate: leave.endDate }
                    : null,
                attendance: rec
            });
        }
    }

    console.log(JSON.stringify({
        employeeId: emp.id,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        matches: rows
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
