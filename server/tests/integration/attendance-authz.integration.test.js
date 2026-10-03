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
    const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    return `${encoded}.${signature}`;
}

describe('Integration: attendance authentication and authorization', () => {
    let mongod;
    let client;
    let db;
    let http;
    const tokens = {};
    const csrfTokens = {};
    const date = '2026-10-03';
    const records = {
        '7001': { time: '10:05', status: 'present' },
        '7002': { time: '09:55', status: 'present' }
    };

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        db = client.db('hr_portal_attendance_authz');
        setDBForTesting(db);
        http = request(createApp({ includeAuthRoutes: true }));
        for (const role of ['admin', 'hr', 'employee']) {
            tokens[role] = createToken({ role, employeeId: 7001 });
            const response = await http.get('/api/csrf-token')
                .set('Authorization', `Bearer ${tokens[role]}`);
            expect(response.status).toBe(200);
            csrfTokens[role] = response.body.csrfToken;
        }
    });

    beforeEach(async () => {
        await db.collection('attendance').deleteMany({});
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    describe.each(['/api/v1/attendance', '/api/attendance'])('%s', prefix => {
        test.each(['hr', 'admin'])('%s can persist and read attendance', async role => {
            const response = await http.put(`${prefix}/${date}`)
                .set('Authorization', `Bearer ${tokens[role]}`)
                .set('X-CSRF-Token', csrfTokens[role])
                .send(records);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            const stored = await db.collection('attendance').findOne({ date });
            expect(stored.records).toEqual(records);

            const read = await http.get(`${prefix}/${date}`)
                .set('Authorization', `Bearer ${tokens[role]}`);
            expect(read.status).toBe(200);
            expect(read.body).toEqual(records);
        });

        test('employee cannot change attendance', async () => {
            await db.collection('attendance').insertOne({ date, records });
            const response = await http.put(`${prefix}/${date}`)
                .set('Authorization', `Bearer ${tokens.employee}`)
                .set('X-CSRF-Token', csrfTokens.employee)
                .send({ '7001': { time: null, status: 'absent' } });

            expect(response.status).toBe(403);
            const stored = await db.collection('attendance').findOne({ date });
            expect(stored.records).toEqual(records);
        });

        test('employee can only read their own attendance', async () => {
            await db.collection('attendance').insertOne({ date, records });
            const response = await http.get(`${prefix}/${date}`)
                .set('Authorization', `Bearer ${tokens.employee}`);

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ '7001': records['7001'] });
        });

        test('unauthenticated access is rejected', async () => {
            const response = await http.get(`${prefix}/${date}`);
            expect(response.status).toBe(401);
        });
    });
});