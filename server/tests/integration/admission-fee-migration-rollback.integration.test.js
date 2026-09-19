const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');

const { migrateAdmissionFeeManagement } = require('../../scripts/migrate-admission-fee-management');
const { rollbackAdmissionFeeManagementMigration } = require('../../scripts/rollback-admission-fee-management-migration');

describe('Integration: admission fee migration and rollback', () => {
    let mongod;
    let client;
    let rawDb;
    let db;

    function isolatedDb(raw, suffix = '_FeeMigTest') {
        return {
            ...raw,
            collection(name, options) {
                if (name.startsWith('Testing')) return raw.collection(name, options);
                return raw.collection(`${name}${suffix}`, options);
            }
        };
    }

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        rawDb = client.db('hr_portal_fee_migration');
        db = isolatedDb(rawDb);
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
    });

    test('migrates admissions with missing installments and preserves backup for rollback', async () => {
        const legacyNoFee = {
            employeeId: 701,
            month: '2026-06',
            customerName: 'Legacy No Fee',
            admissionDate: '2026-06-01',
            admissionType: 'one-time',
            revenue: 25000
        };

        const legacyNoInstallments = {
            employeeId: 702,
            month: '2026-06',
            customerName: 'Legacy No Installments',
            admissionDate: '2026-06-10',
            admissionType: 'yearly',
            revenue: 60000,
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 2,
                summary: {
                    actualFees: 60000,
                    totalDiscount: 0,
                    totalFeesPayable: 60000,
                    feesPaid: 0,
                    outstandingFees: 60000
                }
            }
        };

        await db.collection('admissions').insertMany([legacyNoFee, legacyNoInstallments]);

        const run = await migrateAdmissionFeeManagement(db, { migrationId: 'TEST_MIGRATION_1' });
        expect(run.migrationId).toBe('TEST_MIGRATION_1');
        expect(run.migrated).toBeGreaterThanOrEqual(2);

        const migratedNoFee = await db.collection('admissions').findOne({ customerName: 'Legacy No Fee' });
        expect(migratedNoFee.feeManagement).toBeTruthy();
        expect(migratedNoFee.feeManagement.installments.length).toBeGreaterThan(0);
        expect(migratedNoFee.feeManagementMigration.previousFeeManagementExists).toBe(false);
        expect(migratedNoFee.feeManagementMigration.rollbackAvailable).toBe(true);
        expect(migratedNoFee.feeManagementMigrationBackup).toBeNull();

        const migratedNoInstallments = await db.collection('admissions').findOne({ customerName: 'Legacy No Installments' });
        expect(migratedNoInstallments.feeManagement).toBeTruthy();
        expect(migratedNoInstallments.feeManagement.installments.length).toBeGreaterThan(0);
        expect(migratedNoInstallments.feeManagementMigration.previousFeeManagementExists).toBe(true);
        expect(migratedNoInstallments.feeManagementMigrationBackup).toBeTruthy();
        expect(migratedNoInstallments.feeManagementMigrationBackup.duration).toBe(2);
        expect(Array.isArray(migratedNoInstallments.feeManagementMigrationBackup.installments)).toBe(false);
    });

    test('rollback restores previous state without data loss', async () => {
        const rolledBack = await rollbackAdmissionFeeManagementMigration(db, { migrationId: 'TEST_MIGRATION_1' });
        expect(rolledBack.rolledBack).toBeGreaterThanOrEqual(2);

        const restoredNoFee = await db.collection('admissions').findOne({ customerName: 'Legacy No Fee' });
        expect(restoredNoFee.feeManagement).toBeUndefined();
        expect(restoredNoFee.feeManagementMigration).toBeUndefined();
        expect(restoredNoFee.feeManagementMigrationBackup).toBeUndefined();

        const restoredNoInstallments = await db.collection('admissions').findOne({ customerName: 'Legacy No Installments' });
        expect(restoredNoInstallments.feeManagement).toBeTruthy();
        expect(restoredNoInstallments.feeManagement.installments).toBeUndefined();
        expect(restoredNoInstallments.feeManagement.duration).toBe(2);
        expect(restoredNoInstallments.feeManagementMigration).toBeUndefined();
        expect(restoredNoInstallments.feeManagementMigrationBackup).toBeUndefined();
    });
});
