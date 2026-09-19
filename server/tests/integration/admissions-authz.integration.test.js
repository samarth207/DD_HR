const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { TOKEN_SECRET, TOKEN_TTL_MS } = require('../../config/admin-credentials');

jest.mock('../../utils/mailer', () => ({
    sendMail: jest.fn().mockResolvedValue(true)
}));

function createToken(payload) {
    const data = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    return `${encoded}.${sig}`;
}

describe('Integration: admissions authentication and authorization', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;
    let adminToken;
    let hrToken;
    let employeeToken;
    let createdAdmissionId;

    function isolatedDb(raw, suffix = '_AdmAuthTest') {
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
        rawDb = client.db('hr_portal_admissions_authz');
        db = isolatedDb(rawDb);
        setDBForTesting(db);

        http = request(createApp({ includeAuthRoutes: true }));

        await db.collection('employees').insertOne({
            id: 5001,
            firstName: 'Auth',
            lastName: 'Tester',
            email: 'auth.tester@example.com',
            department: 'Sales',
            status: 'Active'
        });

        adminToken = createToken({ role: 'admin' });
        hrToken = createToken({ role: 'hr' });
        employeeToken = createToken({ role: 'employee', employeeId: 5001, name: 'Auth Tester' });

        const create = await http
            .post('/api/admissions')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                employeeId: 5001,
                month: '2026-11',
                customerName: 'Auth Protected Record',
                customerPhone: '9001001001',
                customerEmail: 'auth.protected@example.com',
                admissionDate: '2026-11-11',
                admissionType: 'one-time',
                revenue: 2000,
                status: 'pending'
            });

        expect(create.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Auth Protected Record' });
        createdAdmissionId = String(saved._id);
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('security: unauthenticated requests are blocked for admissions APIs', async () => {
        const getRes = await http.get('/api/admissions?month=2026-11');
        const postRes = await http.post('/api/admissions').send({});
        const putRes = await http.put(`/api/admissions/${createdAdmissionId}`).send({});
        const delRes = await http.delete(`/api/admissions/${createdAdmissionId}`);
        const approvalRes = await http.put(`/api/admissions/${createdAdmissionId}/status`).send({ status: 'approved' });

        expect(getRes.status).toBe(401);
        expect(postRes.status).toBe(401);
        expect(putRes.status).toBe(401);
        expect(delRes.status).toBe(401);
        expect(approvalRes.status).toBe(401);
    });

    test('authorization: employee role can create/read own admissions but is forbidden for management actions', async () => {
        const getRes = await http.get('/api/admissions?month=2026-11').set('Authorization', `Bearer ${employeeToken}`);
        const postRes = await http
            .post('/api/admissions')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                employeeId: 5001,
                month: '2026-11',
                customerName: 'Employee Own Record',
                customerPhone: '9001001002',
                customerEmail: 'employee.own@example.com',
                admissionDate: '2026-11-12',
                admissionType: 'one-time',
                revenue: 1500,
                status: 'pending'
            });

        const employeeOwn = await db.collection('admissions').findOne({ customerName: 'Employee Own Record' });

        const editRes = await http
            .put(`/api/admissions/${createdAdmissionId}`)
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                customerName: 'Edited By Employee',
                customerPhone: '9001001001',
                customerEmail: 'edited.by.employee@example.com',
                admissionDate: '2026-11-11',
                admissionType: 'one-time',
                revenue: 999
            });

        const deleteRes = await http
            .delete(`/api/admissions/${createdAdmissionId}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        const approvalRes = await http
            .put(`/api/admissions/${createdAdmissionId}/status`)
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({ status: 'approved' });

        const impersonationRes = await http
            .post('/api/admissions')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                employeeId: 9999,
                month: '2026-11',
                customerName: 'Employee Impersonation Attempt',
                customerPhone: '9001001999',
                customerEmail: 'impersonation@example.com',
                admissionDate: '2026-11-13',
                admissionType: 'one-time',
                revenue: 1200,
                status: 'approved'
            });

        expect(getRes.status).toBe(200);
        expect(postRes.status).toBe(200);
        expect(employeeOwn).toBeTruthy();
        expect(employeeOwn.status).toBe('pending');
        expect(editRes.status).toBe(403);
        expect(deleteRes.status).toBe(403);
        expect(approvalRes.status).toBe(403);
        expect(impersonationRes.status).toBe(403);
    });

    test('authorization: hr role can access and update admissions APIs', async () => {
        const getRes = await http.get('/api/admissions?month=2026-11').set('Authorization', `Bearer ${hrToken}`);
        expect(getRes.status).toBe(200);

        const approvalRes = await http
            .put(`/api/admissions/${createdAdmissionId}/status`)
            .set('Authorization', `Bearer ${hrToken}`)
            .send({ status: 'approved' });

        expect(approvalRes.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ _id: new ObjectId(createdAdmissionId) });
        expect(saved.status).toBe('approved');
    });

    test('authorization: admin role retains full admissions API access', async () => {
        const create = await http
            .post('/api/admissions')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                employeeId: 5001,
                month: '2026-12',
                customerName: 'Admin Managed Record',
                customerPhone: '9001001003',
                customerEmail: 'admin.managed@example.com',
                admissionDate: '2026-12-01',
                admissionType: 'one-time',
                revenue: 500,
                status: 'pending'
            });

        expect(create.status).toBe(200);

        const saved = await db.collection('admissions').findOne({ customerName: 'Admin Managed Record' });

        const edit = await http
            .put(`/api/admissions/${saved._id.toString()}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                customerName: 'Admin Managed Record',
                customerPhone: '9001001003',
                customerEmail: 'admin.managed@example.com',
                admissionDate: '2026-12-01',
                admissionType: 'one-time',
                revenue: 700,
                reviewNote: 'Admin update'
            });

        expect(edit.status).toBe(200);

        const del = await http
            .delete(`/api/admissions/${saved._id.toString()}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(del.status).toBe(200);
    });

    test('regression: auth routes remain available and token-based access works for admissions API', async () => {
        const login = await http.post('/api/auth/admin-login').send({ password: 'admin123' });

        // Credential may vary by environment, but route must stay active.
        expect([200, 401]).toContain(login.status);

        const fallbackAccess = await http
            .get('/api/admissions?month=2026-11')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(fallbackAccess.status).toBe(200);
    });
});
