const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');

const { TestingRepository } = require('../../testing/repositories/testing-repository');
const { TestRunner } = require('../../testing/framework/test-runner');
const { CleanupManager } = require('../../testing/framework/cleanup-manager');
const { createHttpClient } = require('../../testing/framework/http-client');
const {
    buildEmployee,
    buildLeave,
    buildHoliday,
    buildSales,
    calculateExpectedSalary
} = require('../../testing/factories/seed-factory');
const {
    assertStatus,
    assertTruthy,
    assertDeepEqual,
    assertRupeeMatch
} = require('../../testing/assertions/validation-engine');

jest.setTimeout(120000);

describe('HR Portal Automation Framework (isolated)', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let app;
    let http;
    let repo;
    let runner;
    const persistMode = process.env.PERSIST_TEST_REPORTS === 'true';

    function isolatedDb(raw, suffix = '_Test') {
        return {
            ...raw,
            collection(name, options) {
                if (name.startsWith('Testing')) return raw.collection(name, options);
                return raw.collection(`${name}${suffix}`, options);
            }
        };
    }

    async function runCase(moduleName, caseName, expected, fn) {
        const ctx = runner.createCase(moduleName, caseName, expected);
        await runner.beginCase(ctx);

        const cleanup = new CleanupManager();
        const databaseChanges = [];

        try {
            const result = await fn({ cleanup, databaseChanges });
            const rollback = await cleanup.run();

            await runner.endCase(ctx, {
                status: 'passed',
                actualResult: result.actualResult,
                databaseValidation: result.databaseValidation,
                apiValidation: result.apiValidation,
                businessRuleValidation: result.businessRuleValidation,
                rollbackStatus: rollback.ok ? 'completed' : 'partial-failed',
                databaseChanges: [...databaseChanges, { rollback: rollback.details }],
                apiResponse: result.apiResponse
            });

            return { ok: true };
        } catch (error) {
            // Keep raw failure visible in Jest output for troubleshooting.
            console.error(`[automation-case-failed] ${moduleName} :: ${caseName}`, error);
            const rollback = await cleanup.run();
            await runner.endCase(ctx, {
                status: 'failed',
                actualResult: null,
                databaseValidation: false,
                apiValidation: false,
                businessRuleValidation: false,
                rollbackStatus: rollback.ok ? 'completed' : 'partial-failed',
                databaseChanges: [...databaseChanges, { rollback: rollback.details }],
                apiResponse: null,
                errorStack: error.stack
            });
            return { ok: false, error };
        }
    }

    async function createEmployeeForTest(overrides = {}, cleanup = null) {
        const payload = buildEmployee(overrides);
        const response = await http.send('post', '/api/employees', payload);
        if (response.status !== 201) {
            throw new Error(`employee create failed: ${response.status} ${JSON.stringify(response.body)}`);
        }
        assertStatus(response.status, 201, 'employee create');
        const employeeId = response.body.employee.id;
        if (cleanup) {
            cleanup.add(`delete employee ${employeeId}`, async () => {
                await db.collection('employees').deleteOne({ id: employeeId });
                await db.collection('leaves').deleteMany({ employeeId });
                await db.collection('sales').deleteMany({ employeeId });
                await db.collection('daily_bonuses').deleteMany({ employeeId });
                await db.collection('monthly_incentives').deleteMany({ key: { $regex: `_${employeeId}$` } });
                await db.collection('salary_advances').deleteMany({ employeeId });
                await db.collection('salaryPayments').deleteMany({ employeeId });
            });
        }
        return employeeId;
    }

    beforeAll(async () => {
        if (persistMode) {
            const uri = process.env.TESTING_MONGODB_URI || process.env.MONGODB_URI;
            const dbName = process.env.TESTING_DB_NAME || process.env.DB_NAME;
            if (!uri || !dbName) {
                throw new Error('Persist mode requires TESTING_MONGODB_URI/TESTING_DB_NAME or MONGODB_URI/DB_NAME');
            }
            client = new MongoClient(uri);
            await client.connect();
            rawDb = client.db(dbName);
        } else {
            mongod = await MongoMemoryServer.create();
            client = new MongoClient(mongod.getUri());
            await client.connect();
            rawDb = client.db('hr_portal_automation');
        }
        db = isolatedDb(rawDb, '_Test');
        setDBForTesting(db);

        app = createApp({ includeAuthRoutes: false });

        repo = new TestingRepository(db);
        await repo.initIndexes();

        runner = new TestRunner(repo);
        await runner.start();

        http = createHttpClient(app, async (level, message, meta) => {
            await runner.log(level, message, meta);
        });
    });

    afterAll(async () => {
        if (runner) {
            const summary = await runner.finish();
            await runner.log('info', 'Automation run summary', summary);
        }

        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('Employee IDs remain sequential and are never recycled', async () => {
        const result = await runCase(
            'Employee',
            'Sequential ID generation without recycle',
            { idProgression: [100001, 100002] },
            async ({ cleanup, databaseChanges }) => {
                const first = await http.send('post', '/api/employees', buildEmployee({ id: 100001 }), { module: 'Employee' });
                if (first.status !== 201) {
                    throw new Error(`first employee create failed: ${first.status} ${JSON.stringify(first.body)}`);
                }
                assertStatus(first.status, 201, 'create first employee');
                const firstId = first.body.employee.id;

                const deleteFirst = await http.send('delete', `/api/employees/${firstId}`);
                assertStatus(deleteFirst.status, 200, 'delete first employee');

                const second = await http.send('post', '/api/employees', buildEmployee({ id: null }));
                if (second.status !== 201) {
                    throw new Error(`second employee create failed: ${second.status} ${JSON.stringify(second.body)}`);
                }
                assertStatus(second.status, 201, 'create second employee');
                const secondId = second.body.employee.id;

                cleanup.add('delete second employee', async () => {
                    await db.collection('employees').deleteOne({ id: secondId });
                });

                databaseChanges.push({ action: 'employee.create-delete-create', firstId, secondId });

                assertDeepEqual([firstId, secondId], [100001, 100002], 'sequential ids');

                return {
                    actualResult: { idProgression: [firstId, secondId] },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: second.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Leave on holiday is rejected', async () => {
        const result = await runCase(
            'Leave',
            'Holiday leave rejection',
            { status: 400, contains: 'Cannot apply leave on holiday' },
            async ({ cleanup, databaseChanges }) => {
                const employeeId = await createEmployeeForTest({}, cleanup);
                const holiday = buildHoliday({ id: 92001, date: '2026-07-15', name: 'QA Holiday' });

                const holidayResp = await http.send('post', '/api/holidays', holiday);
                assertStatus(holidayResp.status, 201, 'create holiday');

                cleanup.add('delete holiday', async () => {
                    await db.collection('holidays').deleteOne({ id: holiday.id });
                });

                const leaveReq = buildLeave({
                    id: 93001,
                    employeeId,
                    startDate: '2026-07-15',
                    endDate: '2026-07-15',
                    leaveType: 'Paid Leave'
                });

                const leaveResp = await http.send('post', '/api/leaves', leaveReq);
                assertStatus(leaveResp.status, 400, 'leave reject on holiday');
                assertTruthy(String(leaveResp.body.error || '').includes('Cannot apply leave on holiday'), 'holiday rejection message');

                databaseChanges.push({ action: 'holiday+leave-validation', employeeId });

                return {
                    actualResult: { status: leaveResp.status, error: leaveResp.body.error },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: leaveResp.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Paid leave is rejected during probation', async () => {
        const result = await runCase(
            'Leave',
            'Probation paid leave rejection',
            { status: 400, probation: true },
            async ({ cleanup, databaseChanges }) => {
                const employeeId = await createEmployeeForTest({ isOnProbation: true }, cleanup);

                const leaveReq = buildLeave({
                    id: 94001,
                    employeeId,
                    startDate: '2026-07-20',
                    endDate: '2026-07-20',
                    leaveType: 'Paid Leave'
                });

                const leaveResp = await http.send('post', '/api/leaves', leaveReq);
                assertStatus(leaveResp.status, 400, 'probation paid leave rejection');
                assertTruthy(leaveResp.body.probation === true, 'probation flag');

                databaseChanges.push({ action: 'probation-leave-attempt', employeeId });

                return {
                    actualResult: leaveResp.body,
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: leaveResp.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Sandwich leave is calculated correctly', async () => {
        const result = await runCase(
            'Leave',
            'Holiday sandwich policy (Sat + Mon)',
            { sandwichDays: 1, paidSandwichDays: 1 },
            async ({ cleanup, databaseChanges }) => {
                const employeeId = await createEmployeeForTest({}, cleanup);

                const satLeave = buildLeave({
                    id: 95001,
                    employeeId,
                    leaveType: 'Unpaid Leave',
                    startDate: '2026-06-13',
                    endDate: '2026-06-13'
                });
                const monLeave = buildLeave({
                    id: 95002,
                    employeeId,
                    leaveType: 'Paid Leave',
                    startDate: '2026-06-15',
                    endDate: '2026-06-15'
                });

                const satResp = await http.send('post', '/api/leaves', satLeave);
                assertStatus(satResp.status, 201, 'create saturday leave');

                const monResp = await http.send('post', '/api/leaves', monLeave);
                assertStatus(monResp.status, 201, 'create monday leave');

                cleanup.add('delete sandwich leaves', async () => {
                    await db.collection('leaves').deleteMany({ id: { $in: [95001, 95002] } });
                });

                const saved = await db.collection('leaves').findOne({ id: 95002 });
                assertDeepEqual(
                    { sandwichDays: saved.sandwichDays, paidSandwichDays: saved.paidSandwichDays },
                    { sandwichDays: 1, paidSandwichDays: 1 },
                    'sandwich days'
                );

                databaseChanges.push({ action: 'sandwich-rule-check', employeeId, leaveId: 95002 });

                return {
                    actualResult: { sandwichDays: saved.sandwichDays, paidSandwichDays: saved.paidSandwichDays },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: monResp.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Sales tracking updates month summary correctly', async () => {
        const result = await runCase(
            'Sales',
            'Create and verify monthly sales record',
            { salesAchieved: 18, revenueAchieved: 380000 },
            async ({ cleanup, databaseChanges }) => {
                const employeeId = await createEmployeeForTest({}, cleanup);

                const salesPayload = buildSales({ employeeId });
                const saveResp = await http.send('post', '/api/sales', salesPayload);
                assertStatus(saveResp.status, 200, 'save sales data');

                const monthResp = await http.send('get', '/api/sales/month/2026-06');
                assertStatus(monthResp.status, 200, 'fetch monthly sales');

                const row = monthResp.body.find((r) => r.employeeId === employeeId);
                assertTruthy(!!row, 'sales row exists for employee');
                assertDeepEqual(
                    { salesAchieved: row.salesAchieved, revenueAchieved: row.revenueAchieved },
                    { salesAchieved: 18, revenueAchieved: 380000 },
                    'sales summary values'
                );

                databaseChanges.push({ action: 'sales-upsert', employeeId, month: '2026-06' });

                return {
                    actualResult: { salesAchieved: row.salesAchieved, revenueAchieved: row.revenueAchieved },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: row
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Late policy affects salary calculation with Rs1 strict validation', async () => {
        const result = await runCase(
            'Salary',
            'Late count to half-day deduction salary preview',
            { netSalary: 'expected formula match with < Rs1 delta' },
            async ({ cleanup, databaseChanges }) => {
                const employeeId = await createEmployeeForTest({ hireDate: '2026-05-12', salary: 30000 }, cleanup);

                const settingsResp = await http.send('put', '/api/attendance/settings', {
                    officeStartTime: '09:00',
                    lateThresholdMins: 10,
                    lateDaysHalfDay: 3
                });
                assertStatus(settingsResp.status, 200, 'save attendance settings');

                cleanup.add('clear attendance settings', async () => {
                    await db.collection('appSettings').deleteOne({ _id: 'attendanceSettings' });
                });

                const lateDates = ['2026-05-14', '2026-05-15', '2026-05-16'];
                for (const date of lateDates) {
                    const attendance = {};
                    attendance[String(employeeId)] = { status: 'Present', time: '10:00' };
                    const attResp = await http.send('put', `/api/attendance/${date}`, attendance);
                    assertStatus(attResp.status, 200, `attendance upsert ${date}`);
                    cleanup.add(`delete attendance ${date}`, async () => {
                        await db.collection('attendance').deleteOne({ date });
                    });
                }

                const bonusResp = await http.send('post', '/api/incentives/daily', {
                    id: 96001,
                    employeeId,
                    date: '2026-06-05',
                    amount: 1000,
                    reason: 'daily target achieved'
                });
                assertStatus(bonusResp.status, 201, 'daily bonus created');

                cleanup.add('delete daily bonus', async () => {
                    await db.collection('daily_bonuses').deleteOne({ id: 96001 });
                });

                const monthlyIncResp = await http.send('post', '/api/incentives/monthly', {
                    key: `2026-06_${employeeId}`,
                    data: { paid: true, paidDate: '2026-06-30', amount: 2000 }
                });
                assertStatus(monthlyIncResp.status, 200, 'monthly incentive saved');

                cleanup.add('delete monthly incentive', async () => {
                    await db.collection('monthly_incentives').deleteOne({ key: `2026-06_${employeeId}` });
                });

                const previewResp = await http.send('get', `/api/salary-payments/preview?employeeId=${employeeId}&month=6&year=2026`);
                assertStatus(previewResp.status, 200, 'salary preview response');

                const expected = calculateExpectedSalary({
                    monthlySalary: 30000,
                    lateCount: 3,
                    lateDaysHalfDay: 3,
                    monthlyIncentive: 2000,
                    dailyBonus: 1000,
                    unpaidLeaveDays: 0,
                    advanceDeduction: 0
                });

                const actualNet = previewResp.body.breakup.netSalary;
                assertRupeeMatch(expected.netSalary, actualNet, 'salary net payable');

                databaseChanges.push({ action: 'salary-preview-validation', employeeId, expectedNet: expected.netSalary, actualNet });

                return {
                    actualResult: { expectedNet: expected.netSalary, actualNet },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: previewResp.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });

    test('Cascade delete removes employee-linked business records', async () => {
        const result = await runCase(
            'Employee',
            'Cascade delete removes leave, sales, incentive records',
            { orphanRecords: 0 },
            async ({ databaseChanges }) => {
                const createResp = await http.send('post', '/api/employees', buildEmployee());
                assertStatus(createResp.status, 201, 'employee created');
                const employeeId = createResp.body.employee.id;

                await http.send('post', '/api/leaves', buildLeave({ id: 97001, employeeId, leaveType: 'Unpaid Leave', startDate: '2026-06-22', endDate: '2026-06-22' }));
                await http.send('post', '/api/sales', buildSales({ employeeId }));
                await http.send('post', '/api/incentives/daily', { id: 97002, employeeId, date: '2026-06-10', amount: 500 });
                await http.send('post', '/api/incentives/advance', { id: 97003, employeeId, date: '2026-06-11', amount: 1500 });

                const delResp = await http.send('delete', `/api/employees/${employeeId}`);
                assertStatus(delResp.status, 200, 'employee deleted');

                const [employeeRow, leaveCount, salesCount, bonusCount, advanceCount] = await Promise.all([
                    db.collection('employees').findOne({ id: employeeId }),
                    db.collection('leaves').countDocuments({ employeeId }),
                    db.collection('sales').countDocuments({ employeeId }),
                    db.collection('daily_bonuses').countDocuments({ employeeId }),
                    db.collection('salary_advances').countDocuments({ employeeId })
                ]);

                assertDeepEqual(
                    {
                        employeeExists: !!employeeRow,
                        leaveCount,
                        salesCount,
                        bonusCount,
                        advanceCount
                    },
                    {
                        employeeExists: false,
                        leaveCount: 0,
                        salesCount: 0,
                        bonusCount: 0,
                        advanceCount: 0
                    },
                    'cascade delete verification'
                );

                databaseChanges.push({ action: 'cascade-delete-validated', employeeId });

                return {
                    actualResult: { orphanRecords: leaveCount + salesCount + bonusCount + advanceCount },
                    databaseValidation: true,
                    apiValidation: true,
                    businessRuleValidation: true,
                    apiResponse: delResp.body
                };
            }
        );

        expect(result.ok).toBe(true);
    });
});
