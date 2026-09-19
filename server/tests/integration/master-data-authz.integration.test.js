const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');
const { TOKEN_SECRET, TOKEN_TTL_MS } = require('../../config/admin-credentials');

function createToken(payload) {
    const data = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    return `${encoded}.${sig}`;
}

describe('Integration: master data authentication and authorization', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;
    let adminToken;
    let hrToken;
    let employeeToken;

    function isolatedDb(raw, suffix = '_MasterAuthTest') {
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
        rawDb = client.db('hr_portal_master_authz');
        db = isolatedDb(rawDb);
        setDBForTesting(db);

        http = request(createApp({ includeAuthRoutes: true }));

        adminToken = createToken({ role: 'admin' });
        hrToken = createToken({ role: 'hr' });
        employeeToken = createToken({ role: 'employee', employeeId: 7001, name: 'Master Viewer' });
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('security: unauthenticated access is blocked for universities and courses APIs', async () => {
        const uniList = await http.get('/api/universities');
        const uniCreate = await http.post('/api/universities').send({ name: 'Auth Uni' });
        const courseList = await http.get('/api/courses');
        const courseCreate = await http.post('/api/courses').send({ name: 'Auth Course' });

        expect(uniList.status).toBe(401);
        expect(uniCreate.status).toBe(401);
        expect(courseList.status).toBe(401);
        expect(courseCreate.status).toBe(401);
    });

    test('authorization: employee can read but cannot mutate master data', async () => {
        const uniList = await http.get('/api/universities').set('Authorization', `Bearer ${employeeToken}`);
        const courseList = await http.get('/api/courses').set('Authorization', `Bearer ${employeeToken}`);

        const uniCreate = await http
            .post('/api/universities')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({ name: 'Employee Forbidden Uni' });

        expect(uniList.status).toBe(200);
        expect(courseList.status).toBe(200);
        expect(uniCreate.status).toBe(403);
    });

    test('authorization: hr can create/update/restore university and course', async () => {
        const uniCreate = await http
            .post('/api/universities')
            .set('Authorization', `Bearer ${hrToken}`)
            .send({ name: 'HR Managed University', code: 'HRU', isActive: true });

        expect(uniCreate.status).toBe(201);
        const universityId = String(uniCreate.body.id);

        const uniUpdate = await http
            .put(`/api/universities/${universityId}`)
            .set('Authorization', `Bearer ${hrToken}`)
            .send({ name: 'HR Managed University Updated', isActive: true });

        expect(uniUpdate.status).toBe(200);

        const courseCreate = await http
            .post('/api/courses')
            .set('Authorization', `Bearer ${hrToken}`)
            .send({
                name: 'HR Course',
                universityId,
                duration: 2,
                totalFees: 120000,
                code: 'HRC'
            });

        expect(courseCreate.status).toBe(201);
        const courseId = String(courseCreate.body.id);

        const deleted = await http
            .delete(`/api/courses/${courseId}`)
            .set('Authorization', `Bearer ${hrToken}`);
        expect(deleted.status).toBe(200);

        const restored = await http
            .patch(`/api/courses/${courseId}/restore`)
            .set('Authorization', `Bearer ${hrToken}`);
        expect(restored.status).toBe(200);
    });

    test('authorization: admin retains full master management access', async () => {
        const uniCreate = await http
            .post('/api/universities')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Admin Managed University', code: 'AMU', isActive: true });

        expect(uniCreate.status).toBe(201);
        const universityId = String(uniCreate.body.id);

        const courseCreate = await http
            .post('/api/courses')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Admin Managed Course',
                universityId,
                duration: 3,
                totalFees: 200000,
                code: 'AMC'
            });

        expect(courseCreate.status).toBe(201);
    });

    test('regression: auth route remains available', async () => {
        const login = await http.post('/api/auth/admin-login').send({ password: 'admin123' });
        expect([200, 401]).toContain(login.status);
    });
});
