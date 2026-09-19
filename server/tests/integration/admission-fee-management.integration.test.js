const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { migrateAdmissionFeeManagement } = require('../../scripts/migrate-admission-fee-management');

jest.mock('../../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(true)
}));

describe('Integration: admission fee-management', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;
    let seededUniversityId;
    let seededCourseId;

    function isolatedDb(raw, suffix = '_FeeTest') {
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
        rawDb = client.db('hr_portal_admission_fee');
        db = isolatedDb(rawDb);
        setDBForTesting(db);
        http = request(createApp({ includeAuthRoutes: false }));

        await db.collection('employees').insertOne({
            id: 2001,
            firstName: 'Fee',
            lastName: 'Owner',
            email: 'fee.owner@example.com',
            department: 'Sales',
            status: 'Active'
        });

        seededUniversityId = new ObjectId();
        await db.collection('universities').insertOne({
            _id: seededUniversityId,
            name: 'AutoGen University',
            code: 'AUTOUNI',
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        seededCourseId = new ObjectId();
        await db.collection('courses').insertOne({
            _id: seededCourseId,
            name: 'MBA',
            code: 'MBA-AUTO',
            universityId: seededUniversityId,
            universityName: 'AutoGen University',
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

    test('legacy payloads auto-generate feeManagement without frontend changes', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Legacy Capture',
            customerPhone: '9999999999',
            customerEmail: 'legacy@example.com',
            admissionDate: '2026-08-01',
            admissionType: 'annual',
            revenue: 45000,
            status: 'approved',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 1,
                totalFees: 45000,
                installmentDiscounts: {
                    1: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 45000,
                        calculatedFees: 45000,
                        feesPaid: 45000,
                        remainingFees: 0,
                        status: 'paid'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Legacy Capture' });
        expect(saved).toBeTruthy();
        expect(saved.revenue).toBe(45000);
        expect(saved.feeManagement).toBeTruthy();
        expect(saved.feeManagement.admissionType).toBe('yearly');
        expect(saved.feeManagement.discountType).toBe('yearly');
        expect(saved.feeManagement.duration).toBe(1);
        expect(saved.feeManagement.installments).toHaveLength(1);
        expect(saved.feeManagement.summary.actualFees).toBe(45000);
        expect(saved.feeManagement.legacyMigration.migratedFromRevenueOnly).toBe(false);
    });

    test('post admission auto-generates university, course, duration, fees, schedule and summary from master data', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Course Snapshot Capture',
            customerPhone: '9898989898',
            customerEmail: 'snapshot@example.com',
            admissionDate: '2026-08-04',
            admissionType: 'semester-wise',
            revenue: 50000,
            courseId: seededCourseId.toString(),
            universityId: seededUniversityId.toString(),
            status: 'approved',
            feeManagement: {
                admissionType: 'semester-wise',
                discountType: 'semester',
                duration: 2,
                totalFees: 120000,
                installmentDiscounts: {
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0
                },
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
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Semester 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 4,
                        installmentName: 'Semester 4',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Course Snapshot Capture' });
        expect(saved).toBeTruthy();
        expect(String(saved.courseId)).toBe(String(seededCourseId));
        expect(String(saved.universityId)).toBe(String(seededUniversityId));
        expect(saved.course).toBe('MBA');
        expect(saved.universityName).toBe('AutoGen University');
        expect(saved.courseDuration).toBe(2);
        expect(saved.courseTotalFees).toBe(120000);

        expect(saved.feeManagement.admissionType).toBe('semester-wise');
        expect(saved.feeManagement.discountType).toBe('semester');
        expect(saved.feeManagement.duration).toBe(2);
        expect(saved.feeManagement.installments).toHaveLength(4);
        expect(saved.feeManagement.summary.actualFees).toBe(120000);
        expect(saved.feeManagement.summary.totalFeesPayable).toBe(120000);

        expect(saved.duration).toBe(2);
        expect(saved.totalFees).toBe(120000);
        expect(saved.fees).toBe(120000);
        expect(saved.discountType).toBe('semester');

        // Revenue credit is locked to first installment payable at creation.
        expect(saved.revenue).toBe(30000);
    });

    test('explicit feeManagement payload is normalized and persisted', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Structured Capture',
            customerPhone: '8888888888',
            customerEmail: 'structured@example.com',
            admissionDate: '2026-08-02',
            admissionType: 'yearly',
            revenue: 90000,
            status: 'pending',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 3,
                actualFees: 90000,
                installmentDiscounts: {
                    1: 10,
                    2: 20,
                    3: 0
                },
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
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Structured Capture' });
        expect(saved.feeManagement.legacyMigration.migratedFromRevenueOnly).toBe(false);
        expect(saved.feeManagement.installments).toHaveLength(3);
        expect(saved.feeManagement.installments[0].installmentName).toBe('Year 1');
        expect(saved.feeManagement.installments[0].calculatedFees).toBe(27000);
        expect(saved.feeManagement.installments[1].calculatedFees).toBe(24000);
        expect(saved.revenue).toBe(27000);
    });

    test('admission creation requires first installment to be marked as paid', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'First Installment Not Paid',
            customerPhone: '8777777777',
            customerEmail: 'notpaid@example.com',
            admissionDate: '2026-08-02',
            admissionType: 'yearly',
            revenue: 90000,
            status: 'pending',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 3,
                actualFees: 90000,
                installmentDiscounts: {
                    1: 10,
                    2: 20,
                    3: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 10,
                        originalFees: 30000,
                        calculatedFees: 27000,
                        feesPaid: 0,
                        remainingFees: 27000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('First installment must be marked as paid for admission to be created');
    });

    test('editing a legacy admission preserves locked credited revenue after creation', async () => {
        const admission = await db.collection('admissions').findOne({ customerName: 'Legacy Capture' });

        const response = await http.put(`/api/admissions/${admission._id.toString()}`).send({
            customerName: 'Legacy Capture',
            customerPhone: '9999999999',
            customerEmail: 'legacy@example.com',
            admissionDate: '2026-08-01',
            admissionType: 'annual',
            revenue: 52000,
            universityName: 'Updated University',
            reviewNote: 'Revenue corrected'
        });

        expect(response.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: admission._id });
        expect(updated.revenue).toBe(45000);
        expect(updated.feeManagement.summary.actualFees).toBe(45000);
        expect(updated.feeManagement.legacyMigration.migratedFromRevenueOnly).toBe(false);
    });

    test('editing first installment revises locked credited revenue', async () => {
        const admission = await db.collection('admissions').findOne({ customerName: 'Structured Capture' });

        const response = await http.put(`/api/admissions/${admission._id.toString()}`).send({
            customerName: 'Structured Capture',
            customerPhone: '8888888888',
            customerEmail: 'structured@example.com',
            admissionDate: '2026-08-02',
            admissionType: 'yearly',
            reviewNote: 'Adjust first installment discount',
            feeManagement: {
                discountType: 'yearly',
                installmentDiscounts: {
                    1: 30,
                    2: 20,
                    3: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 30,
                        originalFees: 30000,
                        calculatedFees: 21000,
                        feesPaid: 21000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: admission._id });
        expect(updated.feeManagement.installments[0].calculatedFees).toBe(21000);
        expect(updated.creditedRevenue).toBe(21000);
        expect(updated.revenue).toBe(21000);
    });

    test('paid installments remain unchanged while pending installments recalculate', async () => {
        const createResponse = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Pending Recalc Guard',
            customerPhone: '7777777777',
            customerEmail: 'pending@example.com',
            admissionDate: '2026-08-03',
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

        expect(createResponse.status).toBe(200);

        const created = await db.collection('admissions').findOne({ customerName: 'Pending Recalc Guard' });

        const editResponse = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Pending Recalc Guard',
            customerPhone: '7777777777',
            customerEmail: 'pending@example.com',
            admissionDate: '2026-08-03',
            admissionType: 'yearly',
            revenue: 90000,
            reviewNote: 'Apply new discount policy',
            feeManagement: {
                discountType: 'whole-fees',
                discountPercent: 20
            }
        });

        expect(editResponse.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: created._id });
        expect(updated.feeManagement.installments[0].status).toBe('paid');
        expect(updated.feeManagement.installments[0].calculatedFees).toBe(27000);
        expect(updated.feeManagement.installments[1].calculatedFees).toBe(24000);
        expect(updated.feeManagement.installments[2].calculatedFees).toBe(24000);
    });

    test('paid installments are locked against edit attempts and pending rows stay unpaid', async () => {
        const createResponse = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Paid Lock Edit Guard',
            customerPhone: '7777777000',
            customerEmail: 'lock@example.com',
            admissionDate: '2026-08-04',
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

        expect(createResponse.status).toBe(200);

        const created = await db.collection('admissions').findOne({ customerName: 'Paid Lock Edit Guard' });
        const originalPaid = {
            ...created.feeManagement.installments[0],
            status: 'paid',
            feesPaid: created.feeManagement.installments[0].calculatedFees,
            remainingFees: 0
        };

        const storedInstallments = created.feeManagement.installments.map((item, index) => (
            index === 0 ? originalPaid : item
        ));

        await db.collection('admissions').updateOne(
            { _id: created._id },
            { $set: { 'feeManagement.installments': storedInstallments } }
        );

        const tampered = storedInstallments.map((item, index) => (
            index === 0
                ? {
                    ...item,
                    calculatedFees: 1,
                    feesPaid: 1,
                    remainingFees: 999
                }
                : item
        ));

        const editResponse = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Paid Lock Edit Guard',
            customerPhone: '7777777000',
            customerEmail: 'lock@example.com',
            admissionDate: '2026-08-04',
            admissionType: 'yearly',
            revenue: 90000,
            reviewNote: 'Try to tamper with paid installment',
            feeManagement: {
                discountType: 'whole-fees',
                discountPercent: 20,
                installments: tampered
            }
        });

        expect(editResponse.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: created._id });
        expect(updated.feeManagement.installments[0].calculatedFees).toBe(originalPaid.calculatedFees);
        expect(updated.feeManagement.installments[0].feesPaid).toBe(originalPaid.feesPaid);
        expect(updated.feeManagement.installments[0].remainingFees).toBe(0);
        expect(updated.feeManagement.installments[1].feesPaid).toBe(0);
        expect(updated.feeManagement.installments[1].remainingFees).toBe(updated.feeManagement.installments[1].calculatedFees);
    });

    test('pending admission allows admin to undo paid installment before approval', async () => {
        const createResponse = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Pending Undo Paid Guard',
            customerPhone: '7666666666',
            customerEmail: 'pending-undo@example.com',
            admissionDate: '2026-08-05',
            admissionType: 'yearly',
            revenue: 90000,
            status: 'pending',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 3,
                totalFees: 90000,
                installmentDiscounts: {
                    1: 10,
                    2: 20,
                    3: 0
                },
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
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(createResponse.status).toBe(200);

        const created = await db.collection('admissions').findOne({ customerName: 'Pending Undo Paid Guard' });
        const editResponse = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Pending Undo Paid Guard',
            customerPhone: '7666666666',
            customerEmail: 'pending-undo@example.com',
            admissionDate: '2026-08-05',
            admissionType: 'yearly',
            revenue: created.revenue,
            reviewNote: 'Undo paid before approval',
            feeManagement: {
                discountType: 'yearly',
                installmentDiscounts: {
                    1: 15,
                    2: 20,
                    3: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 15,
                        originalFees: 30000,
                        calculatedFees: 25500,
                        feesPaid: 0,
                        remainingFees: 25500,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(editResponse.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: created._id });
        expect(updated.status).toBe('pending');
        expect(updated.feeManagement.installments[0].status).toBe('pending');
        expect(updated.feeManagement.installments[0].feesPaid).toBe(0);
        expect(updated.feeManagement.installments[0].remainingFees).toBe(updated.feeManagement.installments[0].calculatedFees);
        expect(updated.feeManagement.installments[0].discountPercent).toBe(15);
    });

    test('approved admission allows admin to undo paid installment with corrected discount', async () => {
        const createResponse = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-08',
            customerName: 'Approved Undo Paid Guard',
            customerPhone: '7555555555',
            customerEmail: 'approved-undo@example.com',
            admissionDate: '2026-08-06',
            admissionType: 'yearly',
            revenue: 90000,
            status: 'approved',
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 3,
                totalFees: 90000,
                installmentDiscounts: {
                    1: 10,
                    2: 20,
                    3: 0
                },
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
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(createResponse.status).toBe(200);

        const created = await db.collection('admissions').findOne({ customerName: 'Approved Undo Paid Guard' });
        const editResponse = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Approved Undo Paid Guard',
            customerPhone: '7555555555',
            customerEmail: 'approved-undo@example.com',
            admissionDate: '2026-08-06',
            admissionType: 'yearly',
            revenue: created.revenue,
            reviewNote: 'Undo paid after approval with corrected discount',
            feeManagement: {
                discountType: 'yearly',
                installmentDiscounts: {
                    1: 15,
                    2: 20,
                    3: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 15,
                        originalFees: 30000,
                        calculatedFees: 25500,
                        feesPaid: 0,
                        remainingFees: 25500,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 20,
                        originalFees: 30000,
                        calculatedFees: 24000,
                        feesPaid: 0,
                        remainingFees: 24000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 30000,
                        calculatedFees: 30000,
                        feesPaid: 0,
                        remainingFees: 30000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(editResponse.status).toBe(200);

        const updated = await db.collection('admissions').findOne({ _id: created._id });
        expect(updated.status).toBe('approved');
        expect(updated.feeManagement.installments[0].status).toBe('pending');
        expect(updated.feeManagement.installments[0].feesPaid).toBe(0);
        expect(updated.feeManagement.installments[0].remainingFees).toBe(updated.feeManagement.installments[0].calculatedFees);
        expect(updated.feeManagement.installments[0].discountPercent).toBe(15);
    });

    test('migration script backfills admissions missing feeManagement', async () => {
        await db.collection('admissions').insertOne({
            employeeId: 2001,
            month: '2026-07',
            customerName: 'Needs Migration',
            admissionDate: '2026-07-12',
            admissionType: 'one-time',
            revenue: 30000,
            status: 'approved'
        });

        const results = await migrateAdmissionFeeManagement(db);
        expect(results.migrated).toBeGreaterThanOrEqual(1);

        const migrated = await db.collection('admissions').findOne({ customerName: 'Needs Migration' });
        expect(migrated.feeManagement).toBeTruthy();
        expect(migrated.feeManagement.summary.totalFeesPayable).toBe(30000);
    });

    test('concurrent approval requests increment sales aggregates only once', async () => {
        const create = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-11',
            customerName: 'Concurrent Approval Guard',
            customerPhone: '7000000001',
            customerEmail: 'concurrent.approval@example.com',
            admissionDate: '2026-11-01',
            admissionType: 'one-time',
            revenue: 1000,
            status: 'pending',
            feeManagement: {
                admissionType: 'one-time',
                discountType: 'whole-fees',
                duration: 1,
                totalFees: 1000,
                discountPercent: 0,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Installment 1',
                        discountPercent: 0,
                        originalFees: 1000,
                        calculatedFees: 1000,
                        feesPaid: 1000,
                        remainingFees: 0,
                        status: 'paid'
                    }
                ]
            }
        });

        expect(create.status).toBe(200);
        const created = await db.collection('admissions').findOne({ customerName: 'Concurrent Approval Guard' });

        const [r1, r2] = await Promise.all([
            http.put(`/api/admissions/${created._id.toString()}/status`).send({ status: 'approved' }),
            http.put(`/api/admissions/${created._id.toString()}/status`).send({ status: 'approved' })
        ]);

        expect([r1.status, r2.status]).toEqual([200, 200]);

        const sales = await db.collection('sales').findOne({ month: '2026-11', employeeId: 2001 });
        expect(sales).toBeTruthy();
        expect(sales.salesAchieved).toBe(1);
        expect(sales.revenueAchieved).toBe(1000);

        const admission = await db.collection('admissions').findOne({ _id: created._id });
        expect(admission.status).toBe('approved');
    });

    test('duplicate sequential approval does not increment twice', async () => {
        const create = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-12',
            customerName: 'Sequential Approval Guard',
            customerPhone: '7000000002',
            customerEmail: 'sequential.approval@example.com',
            admissionDate: '2026-12-01',
            admissionType: 'one-time',
            revenue: 500,
            status: 'pending',
            feeManagement: {
                admissionType: 'one-time',
                discountType: 'whole-fees',
                duration: 1,
                totalFees: 500,
                discountPercent: 0,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Installment 1',
                        discountPercent: 0,
                        originalFees: 500,
                        calculatedFees: 500,
                        feesPaid: 500,
                        remainingFees: 0,
                        status: 'paid'
                    }
                ]
            }
        });

        expect(create.status).toBe(200);
        const created = await db.collection('admissions').findOne({ customerName: 'Sequential Approval Guard' });

        const first = await http.put(`/api/admissions/${created._id.toString()}/status`).send({ status: 'approved' });
        const second = await http.put(`/api/admissions/${created._id.toString()}/status`).send({ status: 'approved' });

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const sales = await db.collection('sales').findOne({ month: '2026-12', employeeId: 2001 });
        expect(sales).toBeTruthy();
        expect(sales.salesAchieved).toBe(1);
        expect(sales.revenueAchieved).toBe(500);
    });

    test('post admission rejects invalid one-time and yearly discount combination', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-09',
            customerName: 'Invalid One-Time Discount',
            customerPhone: '9000000001',
            customerEmail: 'invalid-one-time@example.com',
            admissionDate: '2026-09-01',
            admissionType: 'one-time',
            revenue: 25000,
            feeManagement: {
                admissionType: 'one-time',
                discountType: 'yearly',
                duration: 1,
                actualFees: 25000,
                discountPercent: 10
            }
        });

        expect(response.status).toBe(400);
        expect(String(response.body?.error || '')).toMatch(/not allowed/i);
    });

    test('post admission rejects invalid yearly and semester discount combination', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-09',
            customerName: 'Invalid Yearly Discount',
            customerPhone: '9000000002',
            customerEmail: 'invalid-yearly@example.com',
            admissionDate: '2026-09-02',
            admissionType: 'yearly',
            revenue: 75000,
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'semester',
                duration: 2,
                actualFees: 75000,
                discountPercent: 10,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 10,
                        originalFees: 37500,
                        calculatedFees: 33750,
                        feesPaid: 33750,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 10,
                        originalFees: 37500,
                        calculatedFees: 33750,
                        feesPaid: 0,
                        remainingFees: 33750,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(400);
        expect(String(response.body?.error || '')).toMatch(/not allowed/i);
    });

    test('post admission rejects invalid semester-wise and yearly discount combination', async () => {
        const response = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-09',
            customerName: 'Invalid Semester Discount',
            customerPhone: '9000000003',
            customerEmail: 'invalid-semester@example.com',
            admissionDate: '2026-09-03',
            admissionType: 'semester-wise',
            revenue: 95000,
            feeManagement: {
                admissionType: 'semester-wise',
                discountType: 'yearly',
                duration: 2,
                actualFees: 95000,
                discountPercent: 10,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Semester 1',
                        discountPercent: 10,
                        originalFees: 23750,
                        calculatedFees: 21375,
                        feesPaid: 21375,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Semester 2',
                        discountPercent: 10,
                        originalFees: 23750,
                        calculatedFees: 21375,
                        feesPaid: 0,
                        remainingFees: 21375,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Semester 3',
                        discountPercent: 10,
                        originalFees: 23750,
                        calculatedFees: 21375,
                        feesPaid: 0,
                        remainingFees: 21375,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 4,
                        installmentName: 'Semester 4',
                        discountPercent: 10,
                        originalFees: 23750,
                        calculatedFees: 21375,
                        feesPaid: 0,
                        remainingFees: 21375,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(400);
        expect(String(response.body?.error || '')).toMatch(/not allowed/i);
    });

    test('edit admission rejects invalid discount combination', async () => {
        const create = await http.post('/api/admissions').send({
            employeeId: 2001,
            month: '2026-10',
            customerName: 'Edit Invalid Discount Guard',
            customerPhone: '9000000004',
            customerEmail: 'edit-invalid@example.com',
            admissionDate: '2026-10-01',
            admissionType: 'yearly',
            revenue: 72000,
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'whole-fees',
                duration: 2,
                actualFees: 72000,
                discountPercent: 0,
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 36000,
                        calculatedFees: 36000,
                        feesPaid: 36000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 0,
                        originalFees: 36000,
                        calculatedFees: 36000,
                        feesPaid: 0,
                        remainingFees: 36000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(create.status).toBe(200);
        const created = await db.collection('admissions').findOne({ customerName: 'Edit Invalid Discount Guard' });

        const edit = await http.put(`/api/admissions/${created._id.toString()}`).send({
            customerName: 'Edit Invalid Discount Guard',
            customerPhone: '9000000004',
            customerEmail: 'edit-invalid@example.com',
            admissionDate: '2026-10-01',
            admissionType: 'yearly',
            revenue: 72000,
            reviewNote: 'Try invalid discount policy',
            feeManagement: {
                discountType: 'semester',
                discountPercent: 10
            }
        });

        expect(edit.status).toBe(400);
        expect(String(edit.body?.error || '')).toMatch(/not allowed/i);
    });
});