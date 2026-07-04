const { connectDB, getDB, closeDB } = require('../db');

const EMPLOYEE_ID = 1779706053441;

function getStatus(admission) {
    const status = typeof admission?.status === 'string' ? admission.status.trim().toLowerCase() : '';
    return status || 'approved';
}

async function main() {
    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    const admissions = db.collection('admissions');
    const sales = db.collection('sales');

    const records = await admissions.find({ employeeId: EMPLOYEE_ID }).toArray();

    const approvedByMonth = new Map();
    for (const record of records) {
        if (getStatus(record) !== 'approved') continue;
        const month = String(record.month || '').trim();
        if (!month) continue;
        const agg = approvedByMonth.get(month) || { count: 0, revenue: 0 };
        agg.count += 1;
        agg.revenue += parseFloat(record.revenue) || 0;
        approvedByMonth.set(month, agg);
    }

    const deleteResult = await admissions.deleteMany({ employeeId: EMPLOYEE_ID });

    const salesRollbacks = [];
    for (const [month, agg] of approvedByMonth.entries()) {
        await sales.updateOne(
            { month, employeeId: EMPLOYEE_ID },
            {
                $inc: {
                    salesAchieved: -agg.count,
                    revenueAchieved: -agg.revenue
                },
                $set: { updatedAt: new Date() }
            }
        );
        salesRollbacks.push({ month, admissionsRemoved: agg.count, revenueRemoved: agg.revenue });
    }

    console.log(JSON.stringify({
        employeeId: EMPLOYEE_ID,
        admissionsFound: records.length,
        deleted: deleteResult.deletedCount,
        salesRollbacks
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
