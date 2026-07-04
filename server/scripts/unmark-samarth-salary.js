const { connectDB, getDB, closeDB } = require('../db');

async function main() {
    await connectDB();
    const db = getDB();

    if (!db) {
        console.error('DB not connected');
        process.exit(1);
    }

    const emp = await db.collection('employees').findOne({
        $or: [
            { firstName: { $regex: '^samarth$', $options: 'i' } },
            { lastName: { $regex: '^samarth$', $options: 'i' } },
            { email: { $regex: 'samarth', $options: 'i' } }
        ]
    });

    if (!emp) {
        console.error('Samarth not found');
        process.exit(1);
    }

    const employeeId = parseInt(emp.id, 10);

    const delModern = await db.collection('salaryPayments').deleteMany({ employeeId });
    const delLegacy = await db.collection('salary_payments').deleteMany({
        $or: [
            { employeeId },
            { key: { $regex: `_${employeeId}$` } }
        ]
    });

    console.log(JSON.stringify({
        employeeId: emp.id,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        deletedSalaryPaymentRecordsModern: delModern.deletedCount,
        deletedSalaryPaymentRecordsLegacy: delLegacy.deletedCount
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
