const { connectDB, getDB, closeDB } = require('../db');

async function rollbackAdmissionFeeManagementMigration(db, options = {}) {
    const admissions = db.collection('admissions');
    const migrationId = String(options.migrationId || '').trim();
    const batchSize = Math.max(1, parseInt(options.batchSize, 10) || 250);

    const query = migrationId
        ? { 'feeManagementMigration.migrationId': migrationId }
        : { 'feeManagementMigration.rollbackAvailable': true };

    const cursor = admissions.find(query).batchSize(batchSize);
    const operations = [];

    const results = {
        migrationId: migrationId || 'ALL',
        scanned: 0,
        rolledBack: 0,
        skipped: 0,
        errors: []
    };

    while (await cursor.hasNext()) {
        const admission = await cursor.next();
        results.scanned += 1;

        try {
            const hadPrevious = Boolean(admission?.feeManagementMigration?.previousFeeManagementExists);
            const backup = admission?.feeManagementMigrationBackup;

            if (hadPrevious && !backup) {
                results.skipped += 1;
                results.errors.push({
                    admissionId: String(admission?._id || ''),
                    message: 'Rollback skipped: missing backup for previously existing feeManagement.'
                });
                continue;
            }

            const update = {
                $unset: {
                    feeManagementMigration: '',
                    feeManagementMigrationBackup: '',
                    feeManagementMigratedAt: ''
                }
            };

            if (hadPrevious) {
                update.$set = { feeManagement: backup };
            } else {
                update.$unset.feeManagement = '';
            }

            operations.push({
                updateOne: {
                    filter: { _id: admission._id },
                    update
                }
            });
            results.rolledBack += 1;
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

    const migrationId = process.argv[2] || '';
    const results = await rollbackAdmissionFeeManagementMigration(db, { migrationId });
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

module.exports = { rollbackAdmissionFeeManagementMigration };
