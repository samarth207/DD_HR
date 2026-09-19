const { connectDB, getDB, closeDB } = require('../db');
const { buildLegacyFeeManagement } = require('../utils/admission-fee-management');

function hasInstallments(feeManagement) {
    return Array.isArray(feeManagement?.installments) && feeManagement.installments.length > 0;
}

function needsFeeMigration(admission) {
    if (!admission?.feeManagement) return true;
    return !hasInstallments(admission.feeManagement);
}

async function migrateAdmissionFeeManagement(db, options = {}) {
    const admissions = db.collection('admissions');
    const batchSize = Math.max(1, parseInt(options.batchSize, 10) || 250);
    const migrationId = String(options.migrationId || `admission-fee-migration-${Date.now()}`);
    const query = {
        $or: [
            { feeManagement: { $exists: false } },
            { feeManagement: null },
            { 'feeManagement.installments': { $exists: false } },
            { 'feeManagement.installments.0': { $exists: false } }
        ]
    };

    const cursor = admissions.find(query).batchSize(batchSize);
    const operations = [];
    const results = {
        migrationId,
        scanned: 0,
        migrated: 0,
        skipped: 0,
        errors: []
    };

    while (await cursor.hasNext()) {
        const admission = await cursor.next();
        results.scanned += 1;

        if (!needsFeeMigration(admission)) {
            continue;
        }

        try {
            const previousFeeManagementExists = Boolean(admission?.feeManagement);
            const feeManagement = buildLegacyFeeManagement(admission);
            operations.push({
                updateOne: {
                    filter: { _id: admission._id },
                    update: {
                        $set: {
                            feeManagement,
                            feeManagementMigratedAt: new Date(),
                            feeManagementMigration: {
                                migrationId,
                                migratedAt: new Date(),
                                scriptVersion: 2,
                                previousFeeManagementExists,
                                rollbackAvailable: true
                            },
                            feeManagementMigrationBackup: previousFeeManagementExists
                                ? admission.feeManagement
                                : null
                        }
                    }
                }
            });
            results.migrated += 1;
        } catch (error) {
            results.skipped += 1;
            results.errors.push({
                admissionId: String(admission?._id || ''),
                message: error.message
            });
        }
    }

    if (operations.length) {
        await admissions.bulkWrite(operations, { ordered: false });
    }

    return results;
}

async function main() {
    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    const results = await migrateAdmissionFeeManagement(db);
    console.log(JSON.stringify(results, null, 2));
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

module.exports = { migrateAdmissionFeeManagement };