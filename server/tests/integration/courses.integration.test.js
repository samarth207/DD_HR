const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');

describe('Integration: course master APIs', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;
    let universityId;
    let employeeId;

    function isolatedDb(raw, suffix = '_CourseTest') {
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
        rawDb = client.db('hr_portal_courses');

        db = isolatedDb(rawDb);
        setDBForTesting(db);
        http = request(createApp({ includeAuthRoutes: false }));

        const uniRes = await http.post('/api/universities').send({ name: 'Course University', code: 'CU' });
        universityId = String(uniRes.body.id);

        employeeId = 99001;
        await db.collection('employees').insertOne({
            id: employeeId,
            firstName: 'Course',
            lastName: 'Tester',
            email: 'course.tester@example.com',
            department: 'Sales',
            status: 'Active'
        });
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('creates a course linked to one university', async () => {
        const response = await http.post('/api/courses').send({
            name: 'B.Tech CSE',
            universityId,
            duration: 4,
            totalFees: 320000,
            code: 'BTCSE'
        });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.course.name).toBe('B.Tech CSE');
        expect(String(response.body.course.universityId)).toBe(universityId);
        expect(response.body.course.duration).toBe(4);
        expect(response.body.course.totalFees).toBe(320000);
    });

    test('rejects duplicate course name for same university', async () => {
        const response = await http.post('/api/courses').send({
            name: 'B.Tech CSE',
            universityId,
            duration: 4,
            totalFees: 300000
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/same name already exists/i);
    });

    test('allows same course name across different universities', async () => {
        const uni = await http.post('/api/universities').send({ name: 'Second University', code: 'SU' });
        const response = await http.post('/api/courses').send({
            name: 'MBA',
            universityId: String(uni.body.id),
            duration: 2,
            totalFees: 200000,
            code: 'MBA-SU'
        });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
    });

    test('rejects decimal duration and zero fees', async () => {
        const decimalDuration = await http.post('/api/courses').send({
            name: 'Invalid Decimal Duration',
            universityId,
            duration: 2.5,
            totalFees: 150000,
            code: 'INV-DD'
        });
        expect(decimalDuration.status).toBe(400);
        expect(decimalDuration.body.error).toMatch(/positive integer/i);

        const zeroFees = await http.post('/api/courses').send({
            name: 'Invalid Zero Fees',
            universityId,
            duration: 2,
            totalFees: 0,
            code: 'INV-ZF'
        });
        expect(zeroFees.status).toBe(400);
        expect(zeroFees.body.error).toMatch(/positive number/i);
    });

    test('supports search, pagination and dropdown filters', async () => {
        await http.post('/api/courses').send({
            name: 'MBA',
            universityId,
            duration: 2,
            totalFees: 180000,
            code: 'MBA'
        });

        const paged = await http.get('/api/courses?page=1&limit=1&search=b.tech');
        expect(paged.status).toBe(200);
        expect(paged.body.data.length).toBe(1);
        expect(paged.body.pagination.total).toBeGreaterThanOrEqual(1);

        const dropdown = await http.get(`/api/courses/dropdown?universityId=${universityId}&search=mba`);
        expect(dropdown.status).toBe(200);
        expect(dropdown.body.data.length).toBe(1);
        expect(dropdown.body.data[0].name).toBe('MBA');
    });

    test('dropdown hides inactive and deleted courses by default', async () => {
        const inactiveCreate = await http.post('/api/courses').send({
            name: 'Hidden Inactive Course',
            universityId,
            duration: 1,
            totalFees: 50000,
            isActive: false,
            code: 'HIC'
        });
        expect(inactiveCreate.status).toBe(201);

        const deletedCreate = await http.post('/api/courses').send({
            name: 'Hidden Deleted Course',
            universityId,
            duration: 1,
            totalFees: 50000,
            code: 'HDC'
        });
        expect(deletedCreate.status).toBe(201);
        const deletedId = String(deletedCreate.body.id);
        const deleted = await http.delete(`/api/courses/${deletedId}`);
        expect(deleted.status).toBe(200);

        const dropdown = await http.get(`/api/courses/dropdown?universityId=${universityId}`);
        expect(dropdown.status).toBe(200);
        const names = dropdown.body.data.map((row) => row.name);
        expect(names).not.toContain('Hidden Inactive Course');
        expect(names).not.toContain('Hidden Deleted Course');
    });

    test('soft delete and restore course', async () => {
        const created = await http.post('/api/courses').send({
            name: 'BBA',
            universityId,
            duration: 3,
            totalFees: 210000,
            code: 'BBA'
        });

        const id = String(created.body.id);

        const deleted = await http.delete(`/api/courses/${id}`);
        expect(deleted.status).toBe(200);

        const hidden = await http.get('/api/courses?search=bba');
        expect(hidden.status).toBe(200);
        expect(hidden.body.data.length).toBe(0);

        const restored = await http.patch(`/api/courses/${id}/restore`);
        expect(restored.status).toBe(200);

        const visible = await http.get('/api/courses?search=bba');
        expect(visible.status).toBe(200);
        expect(visible.body.data.length).toBe(1);
    });

    test('admission creation can set courseDuration and courseTotalFees', async () => {
        const course = await db.collection('courses').findOne({ code: 'BTCSE' });

        const response = await http.post('/api/admissions').send({
            employeeId,
            month: '2026-08',
            customerName: 'Student One',
            customerPhone: '9999999001',
            customerEmail: 'student.one@example.com',
            admissionDate: '2026-08-01',
            admissionType: 'annual',
            revenue: 50000,
            status: 'pending',
            courseId: String(course._id),
            universityId,
            courseDuration: 5,
            courseTotalFees: 450000,
            feeManagement: {
                admissionType: 'yearly',
                discountType: 'yearly',
                duration: 5,
                totalFees: 450000,
                installmentDiscounts: {
                    1: 0,
                    2: 0,
                    3: 0,
                    4: 0,
                    5: 0
                },
                installments: [
                    {
                        installmentNumber: 1,
                        installmentName: 'Year 1',
                        discountPercent: 0,
                        originalFees: 90000,
                        calculatedFees: 90000,
                        feesPaid: 90000,
                        remainingFees: 0,
                        status: 'paid'
                    },
                    {
                        installmentNumber: 2,
                        installmentName: 'Year 2',
                        discountPercent: 0,
                        originalFees: 90000,
                        calculatedFees: 90000,
                        feesPaid: 0,
                        remainingFees: 90000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 3,
                        installmentName: 'Year 3',
                        discountPercent: 0,
                        originalFees: 90000,
                        calculatedFees: 90000,
                        feesPaid: 0,
                        remainingFees: 90000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 4,
                        installmentName: 'Year 4',
                        discountPercent: 0,
                        originalFees: 90000,
                        calculatedFees: 90000,
                        feesPaid: 0,
                        remainingFees: 90000,
                        status: 'pending'
                    },
                    {
                        installmentNumber: 5,
                        installmentName: 'Year 5',
                        discountPercent: 0,
                        originalFees: 90000,
                        calculatedFees: 90000,
                        feesPaid: 0,
                        remainingFees: 90000,
                        status: 'pending'
                    }
                ]
            }
        });

        expect(response.status).toBe(200);

        const admission = await db.collection('admissions').findOne({ customerName: 'Student One' });
        expect(admission).toBeTruthy();
        expect(String(admission.courseId)).toBe(String(course._id));
        expect(String(admission.universityId)).toBe(universityId);
        expect(admission.course).toBe('B.Tech CSE');
        expect(admission.universityName).toBe('Course University');
        expect(admission.courseDuration).toBe(5);
        expect(admission.courseTotalFees).toBe(450000);
    });

    test('admission edit rejects courseDuration and courseTotalFees changes', async () => {
        const admission = await db.collection('admissions').findOne({ customerName: 'Student One' });

        const response = await http.put(`/api/admissions/${admission._id.toString()}`).send({
            customerName: 'Student One',
            customerPhone: '9999999001',
            customerEmail: 'student.one@example.com',
            admissionDate: '2026-08-01',
            admissionType: 'annual',
            revenue: 50000,
            courseDuration: 4,
            courseTotalFees: 400000
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/editable only during admission creation/i);
    });

    test('course validation enforces university ownership', async () => {
        const anotherUniId = new ObjectId();
        await db.collection('universities').insertOne({
            _id: anotherUniId,
            name: 'Other University',
            normalizedName: 'other university',
            isActive: true,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            deletedBy: null
        });

        const course = await db.collection('courses').findOne({ code: 'MBA' });
        const response = await http.post('/api/admissions').send({
            employeeId,
            month: '2026-08',
            customerName: 'Student Two',
            customerPhone: '9999999002',
            customerEmail: 'student.two@example.com',
            admissionDate: '2026-08-03',
            admissionType: 'annual',
            revenue: 45000,
            status: 'pending',
            courseId: String(course._id),
            universityId: String(anotherUniId)
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/does not belong/i);
    });
});