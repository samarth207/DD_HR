const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const XLSX = require('xlsx');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { ensureAdmissionManagementIndexes } = require('../../utils/admission-indexes');
const { TOKEN_SECRET, TOKEN_TTL_MS } = require('../../config/admin-credentials');

jest.mock('sanitize-html', () => (input) => input);
jest.mock('../../utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

function createToken(payload) {
    const data = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    return `${encoded}.${signature}`;
}

describe('Integration: admission allocation and re-registration', () => {
    let mongod;
    let client;
    let db;
    let http;
    let adminToken;
    let hrToken;
    let employeeOneToken;
    let employeeTwoToken;
    let courseId;
    let admissionOneId;
    let admissionTwoId;
    let legacyAdmissionId;

    function isolatedDb(raw) {
        return {
            ...raw,
            collection(name, options) {
                return raw.collection(`${name}_YearDriveTest`, options);
            }
        };
    }

    async function csrfToken(token) {
        const response = await http.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        return response.body.csrfToken;
    }

    async function post(path, token, body) {
        const csrf = await csrfToken(token);
        return http.post(path)
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrf)
            .send(body);
    }

    async function put(path, token, body) {
        const csrf = await csrfToken(token);
        return http.put(path)
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrf)
            .send(body);
    }

    async function patch(path, token, body = {}) {
        const csrf = await csrfToken(token);
        return http.patch(path)
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', csrf)
            .send(body);
    }

    async function createAdmission({
        employeeId = 6011,
        year,
        drive = 'Drive 1',
        name = 'Allocated Student',
        courseId: selectedCourseId = courseId,
        admissionType = 'semester-wise',
        duration = 2,
        totalFees = 20000
    } = {}) {
        const installmentCount = admissionType === 'yearly' ? duration : admissionType === 'semester-wise' ? duration * 2 : 1;
        const baseFee = Math.round((totalFees / installmentCount) * 100) / 100;
        const installments = Array.from({ length: installmentCount }, (_, index) => {
            const installmentNumber = index + 1;
            const originalFees = installmentNumber === installmentCount
                ? Math.round((totalFees - baseFee * (installmentCount - 1)) * 100) / 100
                : baseFee;
            const paid = installmentNumber === 1;
            return {
                installmentNumber,
                installmentName: admissionType === 'yearly' ? `Year ${installmentNumber}` : admissionType === 'semester-wise' ? `Semester ${installmentNumber}` : 'Installment 1',
                originalFees,
                calculatedFees: originalFees,
                remainingFees: paid ? 0 : originalFees,
                feesPaid: paid ? originalFees : 0,
                status: paid ? 'paid' : 'pending'
            };
        });
        const payload = {
            employeeId,
            month: '2026-10',
            customerName: name,
            customerPhone: '9001001001',
            customerEmail: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
            admissionDate: '2026-10-01',
            admissionType,
            admissionDrive: drive,
            revenue: totalFees,
            status: 'pending',
            courseId: selectedCourseId,
            feeManagement: { admissionType, discountType: 'whole-fees', duration, totalFees, installments }
        };
        if (year !== undefined) payload.admissionYear = year;
        return post('/api/admissions', adminToken, payload);
    }

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        db = isolatedDb(client.db('hr_portal_year_drive_rereg'));
        setDBForTesting(db);
        await ensureAdmissionManagementIndexes(db);
        await db.collection('employees').insertOne({ id: 6011, department: 'Sales' });
        http = request(createApp({ includeAuthRoutes: true }));

        adminToken = createToken({ role: 'admin' });
        hrToken = createToken({ role: 'hr' });
        employeeOneToken = createToken({ role: 'employee', employeeId: 6011 });
        employeeTwoToken = createToken({ role: 'employee', employeeId: 6012 });

        const university = await post('/api/universities', adminToken, { name: 'Re-registration University' });
        expect(university.status).toBe(201);
        const course = await post('/api/courses', adminToken, {
            name: 'Configurable Course',
            universityId: String(university.body.id),
            duration: 2,
            totalFees: 100000,
            reRegistration: {
                type: 'semester-wise',
                semestersPerAcademicYear: 2,
                periodFee: 5000,
                applicablePeriods: [1, 2, 4],
                periodFeeOverrides: [{ periodNumber: 2, fee: 5500 }]
            }
        });
        expect(course.status).toBe(201);
        courseId = String(course.body.id);

        const first = await createAdmission({ name: 'Employee One Student' });
        expect(first.status).toBe(200);
        const firstDoc = await db.collection('admissions').findOne({ customerName: 'Employee One Student' });
        admissionOneId = String(firstDoc._id);

        const second = await createAdmission({
            employeeId: 6012,
            year: 2025,
            drive: 'Drive 2',
            name: 'Employee Two Student'
        });
        expect(second.status).toBe(200);
        const secondDoc = await db.collection('admissions').findOne({ customerName: 'Employee Two Student' });
        admissionTwoId = String(secondDoc._id);

        const legacy = await db.collection('admissions').insertOne({
            employeeId: 6011,
            customerName: 'Historical Unallocated',
            admissionDate: '2024-02-01',
            month: '2024-02',
            status: 'approved',
            revenue: 500
        });
        legacyAdmissionId = String(legacy.insertedId);
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('defaults the year, accepts another year, and rejects invalid or missing drives', async () => {
        const current = await db.collection('admissions').findOne({ _id: new ObjectId(admissionOneId) });
        expect(current.admissionYear).toBe(new Date().getFullYear());
        expect(current.admissionDrive).toBe('Drive 1');

        const selectedYear = await db.collection('admissions').findOne({ _id: new ObjectId(admissionTwoId) });
        expect(selectedYear.admissionYear).toBe(2025);
        expect(selectedYear.admissionDrive).toBe('Drive 2');

        const futureYear = new Date().getFullYear() + 1;
        const futureAdmission = await createAdmission({
            employeeId: 6015,
            year: futureYear,
            drive: 'Drive 2',
            name: 'Future Year Student'
        });
        expect(futureAdmission.status).toBe(200);
        const savedFuture = await db.collection('admissions').findOne({ customerName: 'Future Year Student' });
        expect(savedFuture.admissionYear).toBe(futureYear);
        expect(savedFuture.admissionDrive).toBe('Drive 2');

        const base = {
            employeeId: 6011,
            month: '2026-10',
            customerName: 'Invalid allocation',
            admissionDate: '2026-10-02',
            admissionType: 'one-time',
            admissionYear: 2026
        };
        const missingDrive = await post('/api/admissions', adminToken, base);
        const invalidDrive = await post('/api/admissions', adminToken, { ...base, admissionDrive: 'Drive 3' });
        const invalidYear = await post('/api/admissions', adminToken, { ...base, admissionDrive: 'Drive 1', admissionYear: '20x6' });
        expect(missingDrive.status).toBe(400);
        expect(invalidDrive.status).toBe(400);
        expect(invalidYear.status).toBe(400);
    });

    test('rejects invalid course re-registration configuration', async () => {
        const invalid = await put(`/api/courses/${courseId}`, adminToken, {
            reRegistration: {
                type: 'semester-wise',
                periodFee: 5000
            }
        });
        expect(invalid.status).toBe(400);
        expect(invalid.body.error).toMatch(/semestersPerAcademicYear/);
    });

    test('allocation is immutable and historical admissions remain unchanged', async () => {
        const record = await db.collection('admissions').findOne({ _id: new ObjectId(admissionOneId) });
        const attempted = await put(`/api/admissions/${admissionOneId}`, adminToken, {
            customerName: record.customerName,
            admissionDate: record.admissionDate,
            admissionType: record.admissionType,
            revenue: record.revenue,
            admissionYear: 2025,
            admissionDrive: 'Drive 2'
        });
        expect(attempted.status).toBe(400);
        const attemptedYearOnly = await put(`/api/admissions/${admissionOneId}`, adminToken, { admissionYear: 2025 });
        const attemptedDriveOnly = await put(`/api/admissions/${admissionOneId}`, adminToken, { admissionDrive: 'Drive 2' });
        expect(attemptedYearOnly.status).toBe(400);
        expect(attemptedDriveOnly.status).toBe(400);
        expect((await db.collection('admissions').findOne({ _id: new ObjectId(admissionOneId) })).admissionYear)
            .toBe(new Date().getFullYear());

        const historic = await db.collection('admissions').findOne({ _id: new ObjectId(legacyAdmissionId) });
        expect(historic).not.toHaveProperty('admissionYear');
        expect(historic).not.toHaveProperty('admissionDrive');
    });

    test('projects Live Fee Calculation periods without creating separate schedule records', async () => {
        const first = await post(`/api/admissions/${admissionOneId}/re-registration-periods/generate`, employeeOneToken, {});
        const repeated = await post(`/api/admissions/${admissionOneId}/re-registration-periods/generate`, employeeOneToken, {});
        expect(first.status).toBe(200);
        expect(repeated.status).toBe(200);
        expect(first.body.data.periods).toHaveLength(4);
        expect(first.body.data.periods[0].status).toBe('paid');
        expect(first.body.data.periods[0].applicableFee).toBe(5000);
        expect(first.body.data.periods[1].status).toBe('unpaid');
        expect(first.body.data.periods[2].status).toBe('na');
        expect(first.body.data.periods[3].status).toBe('unpaid');
        expect(first.body.data.summary.applicableFees).toBe(15000);
        expect(first.body.data.summary.paidAmount).toBe(5000);
        expect(String(first.body.data.admissionId)).toBe(admissionOneId);
        expect(await db.collection('admissionReRegistrations').countDocuments({ admissionId: new ObjectId(admissionOneId) }))
            .toBe(0);

        const changedCourseConfig = await put(`/api/courses/${courseId}`, adminToken, {
            reRegistration: { type: 'yearly', periodFee: 9000 }
        });
        expect(changedCourseConfig.status).toBe(200);

        const secondAdmissionSchedule = await post(
            `/api/admissions/${admissionTwoId}/re-registration-periods/generate`,
            employeeTwoToken,
            {}
        );
        expect(secondAdmissionSchedule.status).toBe(200);
        expect(String(secondAdmissionSchedule.body.data.admissionId)).toBe(admissionTwoId);
        expect(secondAdmissionSchedule.body.data.periods).toHaveLength(4);
        expect(secondAdmissionSchedule.body.data.periods[0].applicableFee).toBe(5000);
        expect(String(secondAdmissionSchedule.body.data.admissionId)).not.toBe(String(first.body.data.admissionId));

        const otherEmployee = await http.get(`/api/admissions/${admissionOneId}/re-registration-periods`)
            .set('Authorization', `Bearer ${employeeTwoToken}`);
        const otherEmployeeSummary = await http.get(`/api/admissions/${admissionOneId}/re-registration-summary`)
            .set('Authorization', `Bearer ${employeeTwoToken}`);
        const otherEmployeeGenerate = await post(`/api/admissions/${admissionOneId}/re-registration-periods/generate`, employeeTwoToken, {});
        expect(otherEmployee.status).toBe(403);
        expect(otherEmployeeSummary.status).toBe(403);
        expect(otherEmployeeGenerate.status).toBe(403);
    });

    test('fee period status follows the existing Live Fee Calculation and rejects a separate payment ledger', async () => {
        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(admissionOneId) });
        const periods = await http.get(`/api/admissions/${admissionOneId}/re-registration-periods`)
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(periods.status).toBe(200);
        expect(periods.body.source).toBe('feeManagement');
        expect(periods.body.data.map((period) => period.status)).toEqual(['paid', 'unpaid', 'na', 'unpaid']);

        const separatePayment = await post(`/api/admissions/${admissionOneId}/re-registration-periods/semester-2/payments`, employeeOneToken, {
            amount: 5000,
            idempotencyKey: 'obsolete-payment-key',
            transactionReference: 'obsolete-payment-reference'
        });
        expect(separatePayment.status).toBe(410);

        const partiallyPaidInstallments = admission.feeManagement.installments.map((installment) => (
            installment.installmentNumber === 2
                ? { ...installment, status: 'paid', feesPaid: 2500, remainingFees: 2500 }
                : installment
        ));
        const partialUpdate = await put(`/api/admissions/${admissionOneId}`, adminToken, {
            customerName: admission.customerName,
            admissionDate: admission.admissionDate,
            admissionType: admission.admissionType,
            revenue: admission.revenue,
            feeManagement: { ...admission.feeManagement, installments: partiallyPaidInstallments }
        });
        expect(partialUpdate.status).toBe(200);
        const partialProjection = await http.get(`/api/admissions/${admissionOneId}/re-registration-periods`)
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(partialProjection.body.data[1].status).toBe('unpaid');
        expect(partialProjection.body.data[1].paidAmount).toBe(0);

        const fullyPaidInstallments = admission.feeManagement.installments.map((installment) => (
            installment.installmentNumber === 2
                ? { ...installment, status: 'paid', feesPaid: installment.calculatedFees, remainingFees: 0 }
                : installment
        ));
        const fullUpdate = await put(`/api/admissions/${admissionOneId}`, adminToken, {
            customerName: admission.customerName,
            admissionDate: admission.admissionDate,
            admissionType: admission.admissionType,
            revenue: admission.revenue,
            feeManagement: { ...admission.feeManagement, installments: fullyPaidInstallments }
        });
        expect(fullUpdate.status).toBe(200);
        const paidProjection = await http.get(`/api/admissions/${admissionOneId}/re-registration-periods`)
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(paidProjection.body.data[1].status).toBe('paid');
        expect(paidProjection.body.data[1].paidAmount).toBe(5000);

        const summary = await http.get(`/api/admissions/${admissionOneId}/re-registration-summary`)
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(summary.body.summary.applicableFees).toBe(15000);
        expect(summary.body.summary.paidAmount).toBe(10000);
        expect(summary.body.summary.pendingAmount).toBe(5000);
        expect(summary.body.summary.notApplicablePeriodCount).toBe(1);
        expect(await db.collection('admissionReRegistrations').countDocuments({ admissionId: new ObjectId(admissionOneId) }))
            .toBe(0);
    });

    test('dashboard filters and totals are server-scoped by year, drive, course, and payment status', async () => {
        const driveOne = await http.get('/api/admission-reports/dashboard?admissionYear=2026&admissionDrive=Drive%201')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(driveOne.status).toBe(200);
        expect(driveOne.body.summary.admissionCount).toBe(1);
        expect(driveOne.body.summary.drive1Count).toBe(1);
        expect(driveOne.body.summary.drive2Count).toBe(0);
        expect(driveOne.body.summary.applicableFees).toBe(15000);
        expect(driveOne.body.summary.paidAmount).toBe(10000);
        expect(driveOne.body.summary.pendingAmount).toBe(5000);
        expect(driveOne.body.data[0].periods).toHaveLength(4);
        expect(driveOne.body.periodTotals.semesterWise).toHaveLength(4);
        expect(driveOne.body.periodTotals.yearly).toHaveLength(0);

        const searched = await http.get('/api/admission-reports/dashboard?admissionYear=2026&search=Employee%20One%20Student')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(searched.status).toBe(200);
        expect(searched.body.summary.admissionCount).toBe(1);
        expect(searched.body.data[0].studentName).toBe('Employee One Student');

        const driveTwo = await http.get(`/api/admission-reports/dashboard?admissionYear=2025&admissionDrive=Drive%202&courseId=${courseId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(driveTwo.status).toBe(200);
        expect(driveTwo.body.summary.admissionCount).toBe(1);
        expect(driveTwo.body.byDrive.find((item) => item.drive === 'Drive 1').admissionCount).toBe(0);
        expect(driveTwo.body.byDrive.find((item) => item.drive === 'Drive 2').admissionCount).toBe(1);

        const paidOnly = await http.get('/api/admission-reports/dashboard?admissionYear=2026&paymentStatus=paid')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(paidOnly.status).toBe(200);
        expect(paidOnly.body.summary.admissionCount).toBe(1);

        const employeeOwn = await http.get('/api/admission-reports/dashboard?admissionYear=2026&admissionDrive=Drive%201')
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(employeeOwn.status).toBe(200);
        expect(employeeOwn.body.summary.admissionCount).toBe(1);
        expect(employeeOwn.body.data.every((item) => item.employeeId === 6011)).toBe(true);

        const employeeOther = await http.get('/api/admission-reports/dashboard?admissionYear=2025&employeeId=6012')
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(employeeOther.status).toBe(403);

        const baseCourse = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
        const shortCourse = await post('/api/courses', adminToken, {
            name: 'Short Semester Course',
            universityId: String(baseCourse.universityId),
            duration: 1,
            totalFees: 50000,
            reRegistration: {
                type: 'semester-wise',
                semestersPerAcademicYear: 2,
                periodFee: 4000
            }
        });
        expect(shortCourse.status).toBe(201);
        const shortAdmission = await createAdmission({
            employeeId: 6014,
            year: 2026,
            drive: 'Drive 1',
            name: 'Short Semester Student',
            courseId: String(shortCourse.body.id),
            duration: 1,
            totalFees: 8000
        });
        expect(shortAdmission.status).toBe(200);

        const mixedSemesters = await http.get('/api/admission-reports/dashboard?admissionYear=2026&admissionDrive=Drive%201&reRegistrationType=semester-wise')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(mixedSemesters.status).toBe(200);
        expect(mixedSemesters.body.summary.admissionCount).toBe(2);
        expect(mixedSemesters.body.periodTotals.semesterWise).toHaveLength(4);
        expect(mixedSemesters.body.periodTotals.semesterWise[3].naCount).toBe(1);
        expect(mixedSemesters.body.periodTotals.semesterWise[3].applicableFees).toBe(5000);

        const virtualCreate = await createAdmission({
            employeeId: 6013,
            year: 2024,
            drive: 'Drive 2',
            name: 'Virtual Dashboard Student',
            admissionType: 'yearly',
            duration: 2,
            totalFees: 20000
        });
        expect(virtualCreate.status).toBe(200);
        const virtualAdmission = await db.collection('admissions').findOne({ customerName: 'Virtual Dashboard Student' });
        const virtualDashboard = await http.get('/api/admission-reports/dashboard?admissionYear=2024&admissionDrive=Drive%202')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(virtualDashboard.status).toBe(200);
        expect(virtualDashboard.body.data[0].reRegistrationType).toBe('yearly');
        expect(virtualDashboard.body.data[0].periods).toHaveLength(2);
        expect(await db.collection('admissionReRegistrations').countDocuments({ admissionId: virtualAdmission._id })).toBe(0);

        const invalidYear = await http.get('/api/admission-reports/dashboard?admissionYear=20x6')
            .set('Authorization', `Bearer ${adminToken}`);
        const invalidDrive = await http.get('/api/admission-reports/dashboard?admissionDrive=Drive%203')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(invalidYear.status).toBe(400);
        expect(invalidDrive.status).toBe(400);
    });

    test('management can mark a Live Fee Calculation period paid from the dashboard API', async () => {
        const endpoint = `/api/admissions/${admissionOneId}/fee-installments/4/mark-paid`;
        const invalidAdmissionId = await patch('/api/admissions/not-an-object-id/fee-installments/4/mark-paid', adminToken);
        const invalidInstallment = await patch(`/api/admissions/${admissionOneId}/fee-installments/0/mark-paid`, adminToken);
        expect(invalidAdmissionId.status).toBe(400);
        expect(invalidInstallment.status).toBe(400);

        const obsoletePaymentFlow = await post(`/api/admissions/${admissionOneId}/re-registration-periods/semester-4/payments`, employeeOneToken, {
            amount: 5000,
            idempotencyKey: 'obsolete-flow-key',
            transactionReference: 'obsolete-flow-reference'
        });
        expect(obsoletePaymentFlow.status).toBe(410);

        const employeeAttempt = await patch(endpoint, employeeOneToken);
        expect(employeeAttempt.status).toBe(403);

        const notApplicable = await patch(`/api/admissions/${admissionOneId}/fee-installments/3/mark-paid`, adminToken);
        expect(notApplicable.status).toBe(400);

        const marked = await patch(endpoint, adminToken, {
            admissionYear: 2025,
            admissionDrive: 'Drive 2',
            employeeId: 6012,
            feesPaid: 1,
            remainingFees: 999999,
            status: 'pending'
        });
        expect(marked.status).toBe(200);
        expect(marked.body.installment.status).toBe('paid');
        expect(marked.body.installment.feesPaid).toBe(marked.body.installment.calculatedFees);
        expect(marked.body.installment.remainingFees).toBe(0);
        const markedAdmission = await db.collection('admissions').findOne({ _id: new ObjectId(admissionOneId) });
        expect(markedAdmission.employeeId).toBe(6011);
        expect(markedAdmission.admissionYear).toBe(new Date().getFullYear());
        expect(markedAdmission.admissionDrive).toBe('Drive 1');

        const duplicate = await patch(endpoint, adminToken);
        expect(duplicate.status).toBe(200);
        expect(duplicate.body.duplicate).toBe(true);

        const refreshedDashboard = await http.get('/api/admission-reports/dashboard?admissionYear=2026&admissionDrive=Drive%201')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(refreshedDashboard.body.summary.paidAmount).toBe(19000);
        expect(refreshedDashboard.body.summary.pendingAmount).toBe(4000);
    });

    test('scopes admission reads, reports, and workbook exports to the signed-in employee', async () => {
        const forbiddenList = await http.get('/api/admissions?employeeId=6012').set('Authorization', `Bearer ${employeeOneToken}`);
        const forbiddenDetail = await http.get(`/api/admissions/${admissionTwoId}`).set('Authorization', `Bearer ${employeeOneToken}`);
        const ownDetail = await http.get(`/api/admissions/${admissionOneId}`).set('Authorization', `Bearer ${employeeOneToken}`);
        expect(forbiddenList.status).toBe(403);
        expect(forbiddenDetail.status).toBe(403);
        expect(ownDetail.status).toBe(200);

        const ownAggregate = await http.get('/api/admission-reports/aggregates?groupBy=year-drive')
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(ownAggregate.status).toBe(200);
        expect(ownAggregate.body.totals.admissionCount).toBe(2);

        const forbiddenAggregate = await http.get('/api/admission-reports/aggregates?employeeId=6012')
            .set('Authorization', `Bearer ${employeeOneToken}`);
        expect(forbiddenAggregate.status).toBe(403);

        const adminAggregate = await http.get('/api/admission-reports/aggregates?admissionYear=2025&admissionDrive=Drive%202')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(adminAggregate.status).toBe(200);
        expect(adminAggregate.body.totals.admissionCount).toBe(1);

        await db.collection('admissions').updateOne(
            { _id: new ObjectId(legacyAdmissionId) },
            { $set: { admissionYear: '=1+1', course: '=1+1' } }
        );
        const workbook = await http.get('/api/admission-reports/export.xlsx')
            .set('Authorization', `Bearer ${employeeOneToken}`)
            .buffer(true)
            .parse((response, callback) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => callback(null, Buffer.concat(chunks)));
            });
        expect(workbook.status).toBe(200);
        expect(workbook.headers['content-type']).toMatch(/spreadsheetml/);
        expect(workbook.body.length).toBeGreaterThan(0);
        const workbookRows = XLSX.utils.sheet_to_json(XLSX.read(workbook.body, { type: 'buffer' }).Sheets.Admissions);
        expect(workbookRows.map((row) => row.Admission)).toEqual(expect.arrayContaining([admissionOneId, legacyAdmissionId]));
        expect(workbookRows.map((row) => row.Admission)).not.toContain(admissionTwoId);
        const legacyWorkbookRow = workbookRows.find((row) => row.Admission === legacyAdmissionId);
        expect(legacyWorkbookRow.Year).toBe("'=1+1");
        expect(legacyWorkbookRow.Course).toBe("'=1+1");
        const unauthenticatedWorkbook = await http.get('/api/admission-reports/export.xlsx');
        expect(unauthenticatedWorkbook.status).toBe(401);

        await db.collection('admissions').insertMany(Array.from({ length: 10001 }, (_, index) => ({
            employeeId: 6019,
            admissionYear: 2099,
            admissionDrive: 'Drive 1',
            customerName: `Export Limit ${index}`,
            admissionDate: '2099-01-01',
            status: 'approved',
            revenue: 0
        })));
        const oversizedWorkbook = await http.get('/api/admission-reports/export.xlsx?admissionYear=2099')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(oversizedWorkbook.status).toBe(413);

        const unauthenticatedAnalytics = await http.get('/api/analytics/departments');
        const adminAnalytics = await http.get('/api/v1/analytics/departments')
            .set('Authorization', `Bearer ${adminToken}`);
        const employeeAnalytics = await http.get('/api/v1/analytics/departments')
            .set('Authorization', `Bearer ${employeeOneToken}`);
        const hrAnalytics = await http.get('/api/v1/analytics/departments')
            .set('Authorization', `Bearer ${hrToken}`);
        expect(unauthenticatedAnalytics.status).toBe(401);
        expect(adminAnalytics.status).toBe(200);
        expect(adminAnalytics.body.departments).toEqual(['Sales']);
        expect(employeeAnalytics.status).toBe(403);
        expect(hrAnalytics.status).toBe(403);
    });
});