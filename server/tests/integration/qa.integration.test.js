const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { buildRealisticSeedData, seedRealisticData, buildEmployee } = require('../helpers/qa-seed');

jest.setTimeout(120000);

describe('Integration/API QA Suite (realistic seeded data)', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let app;
    let http;
    let seed;

    function isolatedDb(raw, suffix = '_Test') {
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
        rawDb = client.db('hr_portal_qa');

        db = isolatedDb(rawDb);
        setDBForTesting(db);

        app = createApp({ includeAuthRoutes: false });
        http = request(app);

        seed = buildRealisticSeedData();
        await seedRealisticData(db, seed);
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('API validation: health and base resources are reachable', async () => {
        const [health, employees, leaves] = await Promise.all([
            http.get('/api/health'),
            http.get('/api/employees'),
            http.get('/api/leaves')
        ]);

        expect(health.status).toBe(200);
        expect(health.body.status).toBe('OK');
        expect(Array.isArray(employees.body)).toBe(true);
        expect(Array.isArray(leaves.body)).toBe(true);
    });

    test('Payroll validation: preview returns canonical breakup with expected fields', async () => {
        const employeeId = seed.references.salesEmployeeId;
        const resp = await http.get(`/api/salary-payments/preview?employeeId=${employeeId}&month=6&year=2026`);

        expect(resp.status).toBe(200);
        expect(resp.body.success).toBe(true);
        expect(resp.body.salaryPeriod).toBeTruthy();
        expect(resp.body.breakup).toBeTruthy();

        const breakup = resp.body.breakup;
        expect(typeof breakup.totalEarnings).toBe('number');
        expect(typeof breakup.totalDeductions).toBe('number');
        expect(typeof breakup.netSalary).toBe('number');
        expect(typeof breakup.lateAttendanceDeduction).toBe('number');
        expect(typeof breakup.unpaidLeaveDeduction).toBe('number');
        expect(breakup.totalEarnings - breakup.totalDeductions).toBeCloseTo(breakup.netSalary, 2);
    });

    test('Salary slip validation: mark-paid response preserves salaryPeriod + breakup contract', async () => {
        const employeeId = seed.references.salesEmployeeId;
        const resp = await http.post('/api/salary-payments').send({ employeeId, month: 6, year: 2026 });

        expect(resp.status).toBe(201);
        expect(resp.body.success).toBe(true);
        expect(resp.body.salaryPeriod).toBeTruthy();
        expect(resp.body.breakup).toBeTruthy();

        const { breakup } = resp.body;
        expect(breakup.salaryPeriod).toBeTruthy();
        expect(breakup.salaryPeriod.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(breakup.salaryPeriod.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(breakup.grossSalary).toBeDefined();
        expect(breakup.totalDeductions).toBeDefined();
        expect(breakup.netSalary).toBeDefined();

        const [modern, legacy] = await Promise.all([
            db.collection('salaryPayments').findOne({ employeeId, month: 6, year: 2026 }),
            db.collection('salary_payments').findOne({ key: `2026-06_${employeeId}` })
        ]);

        expect(!!modern).toBe(true);
        expect(!!legacy).toBe(true);
    });

    test('Attendance validation: monthly summary includes salaryPeriod + late half day projection', async () => {
        const employeeId = seed.references.salesEmployeeId;
        const resp = await http.get(`/api/attendance/report/monthly?employeeId=${employeeId}&month=2026-06`);

        expect(resp.status).toBe(200);
        expect(resp.body.salaryPeriod).toBeTruthy();
        expect(resp.body.policy).toBeTruthy();
        expect(resp.body.summary).toBeTruthy();
        expect(resp.body.summary.lateDays).toBeGreaterThanOrEqual(3);
        expect(resp.body.summary.lateHalfDays).toBe(0.5);
    });

    test('Leave validation: paid leave is blocked during probation', async () => {
        const employeeId = seed.references.probationEmployeeId;
        const leaveReq = {
            id: 889901,
            employeeId,
            leaveType: 'Paid Leave',
            startDate: '2026-06-21',
            endDate: '2026-06-21',
            status: 'approved',
            reason: 'QA probation check',
            halfDay: false
        };

        const resp = await http.post('/api/leaves').send(leaveReq);
        expect(resp.status).toBe(400);
        expect(resp.body.probation).toBe(true);
    });

    test('Dashboard validation: KPI source queries are consistent and aggregate-safe', async () => {
        const [employeesResp, leavesResp] = await Promise.all([
            http.get('/api/employees'),
            http.get('/api/leaves')
        ]);

        expect(employeesResp.status).toBe(200);
        expect(leavesResp.status).toBe(200);

        const employees = employeesResp.body;
        const leaves = leavesResp.body;

        const totalEmployees = employees.length;
        const activeEmployees = employees.filter((e) => e.status === 'Active').length;
        const pendingLeaves = leaves.filter((l) => l.status === 'pending').length;

        expect(totalEmployees).toBeGreaterThan(0);
        expect(activeEmployees).toBeGreaterThan(0);
        expect(pendingLeaves).toBeGreaterThanOrEqual(0);
    });

    test('Regression validation: late policy applies salary deduction only, not leave balance mutation', async () => {
        const employeePayload = buildEmployee({
            id: 2999,
            firstName: 'Late',
            lastName: 'OnlySalary',
            salary: 30000,
            leaveBalance: { paidLeave: 10 },
            hireDate: '2026-06-01'
        });

        const create = await http.post('/api/employees').send(employeePayload);
        expect(create.status).toBe(201);

        const employeeId = create.body.employee.id;

        await http.put('/api/attendance/settings').send({
            officeStartTime: '09:00',
            lateThresholdMins: 10,
            lateDaysHalfDay: 3
        });

        const lateDates = ['2026-06-11', '2026-06-12', '2026-06-13'];
        for (const date of lateDates) {
            const attendance = { [String(employeeId)]: { status: 'Present', time: '10:00' } };
            const save = await http.put(`/api/attendance/${date}`).send(attendance);
            expect(save.status).toBe(200);
        }

        const before = await db.collection('employees').findOne({ id: employeeId });
        const preview = await http.get(`/api/salary-payments/preview?employeeId=${employeeId}&month=6&year=2026`);
        const after = await db.collection('employees').findOne({ id: employeeId });

        expect(preview.status).toBe(200);
        expect(preview.body.breakup.lateAttendanceDeduction).toBeGreaterThan(0);
        expect(before.leaveBalance.paidLeave).toBe(10);
        expect(after.leaveBalance.paidLeave).toBe(10);
    });

    test('Edge case validation: invalid/unknown payroll preview inputs are guarded', async () => {
        const missing = await http.get('/api/salary-payments/preview?employeeId=2001&month=6');
        expect(missing.status).toBe(400);

        const unknownEmployee = await http.get('/api/salary-payments/preview?employeeId=999999&month=6&year=2026');
        expect(unknownEmployee.status).toBe(404);

        const invalidAttendanceReport = await http.get('/api/attendance/report/monthly?employeeId=2001');
        expect(invalidAttendanceReport.status).toBe(400);
    });
});
