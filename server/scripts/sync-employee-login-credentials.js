const crypto = require('crypto');
const { connectDB, getDB, isDBConnected, closeDB } = require('../db');

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function normalizePhone(value) {
    return typeof value === 'string' ? value.trim() : value;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
}

async function run() {
    await connectDB();
    if (!isDBConnected()) {
        console.error('Database not connected. Aborting sync.');
        process.exitCode = 1;
        return;
    }

    const db = getDB();
    const employees = await db.collection('employees').find({}).toArray();

    let updatedCount = 0;
    let skippedNoPhone = 0;

    for (const employee of employees) {
        const normalizedEmail = normalizeEmail(employee.email);
        const normalizedCompanyEmail = normalizeEmail(employee.companyEmail);
        const normalizedPhone = normalizePhone(employee.phone);

        const updates = {};

        if (normalizedEmail !== employee.email) updates.email = normalizedEmail;
        if (normalizedCompanyEmail !== employee.companyEmail) updates.companyEmail = normalizedCompanyEmail;
        if (normalizedPhone !== employee.phone) updates.phone = normalizedPhone;

        if (normalizedPhone) {
            const { hash, salt } = hashPassword(normalizedPhone);
            updates.passwordHash = hash;
            updates.passwordSalt = salt;
        } else {
            skippedNoPhone += 1;
        }

        if (Object.keys(updates).length > 0) {
            await db.collection('employees').updateOne(
                { _id: employee._id },
                { $set: updates }
            );
            updatedCount += 1;
        }
    }

    console.log(`Synced credentials for ${updatedCount} employee records.`);
    if (skippedNoPhone > 0) {
        console.log(`${skippedNoPhone} employees had no phone number; password not reset for them.`);
    }
}

run()
    .catch((error) => {
        console.error('Sync failed:', error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
