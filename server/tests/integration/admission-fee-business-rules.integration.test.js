const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { migrateAdmissionFeeManagement } = require('../../scripts/migrate-admission-fee-management');

jest.mock('../../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(true)
}));

describe('Integration: admission fee business rules', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;
    let universityId;
    let courseYearlyId;
    let courseSemesterId;

    function isolatedDb(raw, suffix = '_FeeRuleTest') {
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
        rawDb = client.db('hr_portal_fee_rules');
        db = isolatedDb(rawDb);
        setDBForTesting(db);
        http = request(createApp({ includeAuthRoutes: false }));

        await db.collection('employees').insertOne({
            id: 3001,
            firstName: 'Rule',
            lastName: 'Tester',
            email: 'rule.tester@example.com',
            department: 'Sales',
            status: 'Active'
        });

        universityId = new ObjectId();
        await db.collection('universities').insertOne({
            _id: universityId,
            name: 'Rules University',
            code: 'RULEU',
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        courseYearlyId = new ObjectId();
        await db.collection('courses').insertOne({
            _id: courseYearlyId,
            name: 'BBA',
            code: 'BBA-RULE',
            universityId,
            universityName: 'Rules University',
            duration: 3,
            totalFees: 150000,
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        courseSemesterId = new ObjectId();
        await db.collection('courses').insertOne({
            _id: courseSemesterId,
            name: 'BCA',
            code: 'BCA-RULE',
            universityId,
            universityName: 'Rules University',
            duration: 2,
            totalFees: 120000,
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('create: university, course, duration and yearly whole-fees combination is accepted', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2026-11',
            customerName: 'Valid Yearly Whole',
            customerPhone: '9010000001',
            customerEmail: 'valid.yearly@example.com',
            admissionDate: '2026-11-01',
            admissionType: 'yearly',
            courseId: String(courseYearlyId),
            universityId: String(universityId),
            status: 'approved',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'whole-fees',
                duration: 3,
                totalFees: 150000,
                discountPercent: 10,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 10,
                        originalFees: 50000,
                        calculatedFees: 45000,
                        feesPaid: 45000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 10,
                        originalFees: 50000,
                        calculatedFees: 45000,
                        feesPaid: 0,
                        remainingFees: 45000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 10,
                        originalFees: 50000,
                        calculatedFees: 45000,
                        feesPaid: 0,
                        remainingFees: 45000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Valid Yearly Whole' });
        expect(saved).toBeTruthy();
        expect(saved.course).toBe('BBA');
        expect(saved.universityName).toBe('Rules University');
        expect(saved.feeManagement.installments).toHaveLength(3);
    });

    test('create: semester-wise with semester discount generates duration*2 installments and summary', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2026-11',
            customerName: 'Valid Semester Discount',
            customerPhone: '9010000002',
            customerEmail: 'valid.semester@example.com',
            admissionDate: '2026-11-02',
            admissionType: 'semester-wise',
            courseId: String(courseSemesterId),
            universityId: String(universityId),
            status: 'approved',
            feeManagement: {
                admissionType: 'semester-wise',
                discountType: 'semester',
                duration: 2,
                totalFees: 120000,
                installmentDiscounts: { 1: 0, 2: 5, 3: 10, 4: 15 },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Semester 1',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 30000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Semester 2',
                        discountPercent: 5,
                        originalFees: 30000,
                        calculatedFees: 28500,
                        feesPaid: 0,
                        remainingFees: 28500,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Semester 3',
                        discountPercent: 10,
                        originalFees: 30000,
                        calculatedFees: 27000,
                        feesPaid: 0,
                        remainingFees: 27000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 4,
                        installmentName: 'Semester 4',
                        discountPercent: 15,
                        originalFees: 30000,
                        calculatedFees: 25500,
                        feesPaid: 0,
                        remainingFees: 25500,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Valid Semester Discount' });
        expect(saved.feeManagement.installments).toHaveLength(4);
        expect(saved.feeManagement.summary.totalDiscount).toBeGreaterThan(0);
        // Since first installment is paid, outstanding should be less than total payable
        expect(saved.feeManagement.summary.outstandingFees).toBeLessThan(saved.feeManagement.summary.totalFeesPayable);
    });

    test('api validation: invalid admissionType-discountType combinations are rejected', async () => {
        const payloads = [
            {
                customerName: 'Invalid OneTime Yearly',
                admissionType: 'one-time',
                feeManagement: {
                    admissionType: 'one-time',
                    discountType: 'yearly',
                    duration: 1,
                    totalFees: 20000,
                    discountPercent: 10,
                    installments: [
                        {
                            installmentNumber: 1,
                            installmentName: 'Installment 1',
                            discountPercent: 10,
                            originalFees: 20000,
                            calculatedFees: 18000,
                            feesPaid: 18000,
                            remainingFees: 0,
                            status: 'paid'
                        }
                    ]
                }
            },
            {
                customerName: 'Invalid Yearly Semester',
                admissionType: 'yearly',
                feeManagement: {
                    admissionType: 'yearly',
                    discountType: 'semester',
                    duration: 2,
                    totalFees: 60000,
                    discountPercent: 10,
                    installments: [
                        {
                            installmentNumber: 1,
                            installmentName: 'Year 1',
                            discountPercent: 10,
                            originalFees: 30000,
                            calculatedFees: 27000,
                            feesPaid: 27000,
                            remainingFees: 0,
                            status: 'paid'
                        },
                        {
                            installmentNumber: 2,
                            installmentName: 'Year 2',
                            discountPercent: 10,
                            originalFees: 30000,
                            calculatedFees: 27000,
                            feesPaid: 0,
                            remainingFees: 27000,
                            status: 'pending'
                        }
                    ]
                }
            },
            {
                customerName: 'Invalid Semester Yearly',
                admissionType: 'semester-wise',
                feeManagement: {
                    admissionType: 'semester-wise',
                    discountType: 'yearly',
                    duration: 2,
                    totalFees: 60000,
                    discountPercent: 10,
                    installments: [
                        {
                            installmentNumber: 1,
                            installmentName: 'Semester 1',
                            discountPercent: 10,
                            originalFees: 15000,
                            calculatedFees: 13500,
                            feesPaid: 13500,
                            remainingFees: 0,
                            status: 'paid'
                        },
                        {
                            installmentNumber: 2,
                            installmentName: 'Semester 2',
                            discountPercent: 10,
                            originalFees: 15000,
                            calculatedFees: 13500,
                            feesPaid: 0,
                            remainingFees: 13500,
                            status: 'pending'
                        },
                        {
                            installmentNumber: 3,
                            installmentName: 'Semester 3',
                            discountPercent: 10,
                            originalFees: 15000,
                            calculatedFees: 13500,
                            feesPaid: 0,
                            remainingFees: 13500,
                            status: 'pending'
                        },
                        {
                            installmentNumber: 4,
                            installmentName: 'Semester 4',
                            discountPercent: 10,
                            originalFees: 15000,
                            calculatedFees: 13500,
                            feesPaid: 0,
                            remainingFees: 13500,
                            status: 'pending'
                        }
                    ]
                }
            }
        ];

        for (const rule of payloads) {
            const response = await http.post('/api/admissions').send({
                employeeId: 3001,
                month: '2026-11',
                customerName: rule.customerName,
                customerPhone: '9010000099',
                customerEmail: 'invalid.rule@example.com',
                admissionDate: '2026-11-03',
                admissionType: rule.admissionType,
                revenue: 30000,
                status: 'pending',
                ...rule
            });

            expect(response.status).toBe(400);
            expect(String(response.body?.error || '')).toMatch(/not allowed/i);
        }
    });

    test('view: admissions endpoint returns computed fee summary and status compatibility', async () => {
        const response = await http.get('/api/admissions?employeeId=3001&month=2026-11');
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);

        const row = response.body.find((item) => item.customerName === 'Valid Yearly Whole');
        expect(row).toBeTruthy();
        expect(row.feeManagement).toBeTruthy();
        expect(row.feeManagement.summary).toBeTruthy();
        expect(typeof row.status).toBe('string');
    });

    test('edit: pending installments recalculate while paid installment is locked', async () => {
        const create = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2026-12',
            customerName: 'Edit Pending Paid Lock',
            customerPhone: '9010000004',
            customerEmail: 'edit.pending@example.com',
            admissionDate: '2026-12-01',
            admissionType: 'yearly',
            revenue: 90000,
            status: 'approved',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'whole-fees',
                duration: 3,
                totalFees: 90000,
                discountPercent: 10,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 10,
                        originalFees: 30000,
                        calculatedFees: 27000,
                        feesPaid: 27000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 10,
                        originalFees: 30000,
                        calculatedFees: 27000,
                        feesPaid: 0,
                        remainingFees: 27000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 10,
                        originalFees: 30000,
                        calculatedFees: 27000,
                        feesPaid: 0,
                        remainingFees: 27000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(create.status).toBe(200);
        const created = await db.collection('admissions').findOne({ customerName: 'Edit Pending Paid Lock' });

        const originalFirst = created.feeManagement.installments[0].calculatedFees;

        const edit = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Edit Pending Paid Lock',
            customerPhone: '9010000004',
            customerEmail: 'edit.pending@example.com',
            admissionDate: '2026-12-01',
            admissionType: 'yearly',
            revenue: 90000,
            reviewNote: 'Recalculate pending only',
            feeManagement: {
                discountType: 'whole-fees',
                discountPercent: 20
            }
        });

        expect(edit.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: created._id });
        expect(updated.feeManagement.installments[0].status).toBe('paid');
        expect(updated.feeManagement.installments[0].calculatedFees).toBe(originalFirst);
        expect(updated.feeManagement.installments[1].calculatedFees).toBeLessThan(originalFirst);
    });

    test('api validation: edit rejects invalid discount type combination', async () => {
        const existing = await db.collection('admissions').findOne({ customerName: 'Edit Pending Paid Lock' });

        const edit = await http.put(`/api/admissions/${existing._id.toString()}`).send({
            customerName: 'Edit Pending Paid Lock',
            customerPhone: '9010000004',
            customerEmail: 'edit.pending@example.com',
            admissionDate: '2026-12-01',
            admissionType: 'yearly',
            revenue: 90000,
            reviewNote: 'Attempt invalid combination',
            feeManagement: {
                discountType: 'semester',
                discountPercent: 5
            }
        });

        expect(edit.status).toBe(400);
        expect(String(edit.body?.error || '')).toMatch(/not allowed/i);
    });

    test('migration: legacy admission is upgraded with feeManagement and view remains compatible', async () => {
        await db.collection('admissions').insertOne({
            employeeId: 3001,
            month: '2026-10',
            customerName: 'Legacy Migration Candidate',
            admissionDate: '2026-10-11',
            admissionType: 'semester-wise',
            revenue: 45000,
            status: 'approved'
        });

        const migration = await migrateAdmissionFeeManagement(db, { migrationId: 'RULE_MIGRATION_1' });
        expect(migration.migrated).toBeGreaterThanOrEqual(1);

        const migrated = await db.collection('admissions').findOne({ customerName: 'Legacy Migration Candidate' });
        expect(migrated.feeManagement).toBeTruthy();
        expect(Array.isArray(migrated.feeManagement.installments)).toBe(true);
        expect(migrated.feeManagement.summary.outstandingFees).toBeGreaterThanOrEqual(0);
    });

    test('edge case validation: invalid courseDuration and invalid course-university mismatch are rejected', async () => {
        const badDuration = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2026-12',
            customerName: 'Bad Duration',
            customerPhone: '9010000111',
            customerEmail: 'bad.duration@example.com',
            admissionDate: '2026-12-10',
            admissionType: 'yearly',
            revenue: 50000,
            courseId: String(courseYearlyId),
            courseDuration: 0,
            status: 'pending',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'whole-fees',
                duration: 3,
                totalFees: 50000,
                discountPercent: 0,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 16667,
                        calculatedFees: 16667,
                        feesPaid: 16667,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 0,
                        originalFees: 16667,
                        calculatedFees: 16667,
                        feesPaid: 0,
                        remainingFees: 16667,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 16666,
                        calculatedFees: 16666,
                        feesPaid: 0,
                        remainingFees: 16666,
                        status: 'pending'
                    }
                ]
            }
        });
        expect(badDuration.status).toBe(400);

        const anotherUniversityId = new ObjectId();
        await db.collection('universities').insertOne({
            _id: anotherUniversityId,
            name: 'Other University',
            code: 'OTHERU',
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const mismatch = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2026-12',
            customerName: 'Bad University Course Pair',
            customerPhone: '9010000112',
            customerEmail: 'bad.mismatch@example.com',
            admissionDate: '2026-12-11',
            admissionType: 'yearly',
            revenue: 50000,
            courseId: String(courseYearlyId),
            universityId: String(anotherUniversityId),
            status: 'pending',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'whole-fees',
                duration: 3,
                totalFees: 50000,
                discountPercent: 0,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 16667,
                        calculatedFees: 16667,
                        feesPaid: 16667,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 0,
                        originalFees: 16667,
                        calculatedFees: 16667,
                        feesPaid: 0,
                        remainingFees: 16667,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 16666,
                        calculatedFees: 16666,
                        feesPaid: 0,
                        remainingFees: 16666,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(mismatch.status).toBe(400);
        expect(String(mismatch.body?.error || '')).toMatch(/does not belong/i);
    });

    test('regression: legacy annual alias still works for existing API payload style', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 3001,
            month: '2027-01',
            customerName: 'Legacy Annual Alias',
            customerPhone: '9010000200',
            customerEmail: 'legacy.alias@example.com',
            admissionDate: '2027-01-02',
            admissionType: 'annual',
            revenue: 47000,
            status: 'approved',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 1,
                totalFees: 47000,
                installmentDiscounts: {
                    1: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 47000,
                        calculatedFees: 47000,
                        feesPaid: 47000,
                        remainingFees: 0,
                        status: 'paid'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);
        const saved = await db.collection('admissions').findOne({ customerName: 'Legacy Annual Alias' });
        expect(saved.feeManagement.admissionType).toBe('yearly');
    });
});
