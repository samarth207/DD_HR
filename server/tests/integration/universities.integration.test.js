const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const request = require('supertest');

const { setDBForTesting } = require('../../db');
const { createApp } = require('../../app');

describe('Integration: universities master APIs', () => {
    let mongod;
    let client;
    let rawDb;
    let db;
    let http;

    function isolatedDb(raw, suffix = '_UniTest') {
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
        rawDb = client.db('hr_portal_universities');

        db = isolatedDb(rawDb);
        setDBForTesting(db);
        http = request(createApp({ includeAuthRoutes: false }));
    });

    afterAll(async () => {
        if (client) await client.close();
        if (mongod) await mongod.stop();
        setDBForTesting(null);
    });

    test('creates a university with normalized name', async () => {
        const response = await http.post('/api/universities').send({
            name: '  Delhi   University  ',
            code: 'du',
            country: 'India'
        });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.university.name).toBe('Delhi University');
        expect(response.body.university.code).toBe('DU');
        expect(response.body.university.isDeleted).toBe(false);
        expect(response.body.university.isActive).toBe(true);
    });

    test('rejects duplicate active university name', async () => {
        const response = await http.post('/api/universities').send({ name: 'delhi university' });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/already exists/i);
    });

    test('supports list pagination and search', async () => {
        await http.post('/api/universities').send({ name: 'Mumbai University', code: 'MU' });
        await http.post('/api/universities').send({ name: 'Anna University', code: 'AU' });
        await http.post('/api/universities').send({ name: 'Inactive University', code: 'IU', isActive: false });

        const page1 = await http.get('/api/universities?page=1&limit=2');
        expect(page1.status).toBe(200);
        expect(page1.body.data.length).toBe(2);
        expect(page1.body.pagination.total).toBeGreaterThanOrEqual(3);

        const search = await http.get('/api/universities?search=anna');
        expect(search.status).toBe(200);
        expect(search.body.data.length).toBe(1);
        expect(search.body.data[0].name).toBe('Anna University');

        const activeOnly = await http.get('/api/universities?activeOnly=true');
        expect(activeOnly.status).toBe(200);
        const activeNames = activeOnly.body.data.map((item) => item.name);
        expect(activeNames).not.toContain('Inactive University');
    });

    test('soft delete hides record from default list and supports restore', async () => {
        const created = await http.post('/api/universities').send({ name: 'Pune University', code: 'PU' });
        const id = created.body.id;

        const deleted = await http.delete(`/api/universities/${id}`);
        expect(deleted.status).toBe(200);
        expect(deleted.body.success).toBe(true);

        const listDefault = await http.get('/api/universities?search=pune');
        expect(listDefault.status).toBe(200);
        expect(listDefault.body.data.length).toBe(0);

        const listDeleted = await http.get('/api/universities?includeDeleted=true&search=pune');
        expect(listDeleted.status).toBe(200);
        expect(listDeleted.body.data.length).toBe(1);
        expect(listDeleted.body.data[0].isDeleted).toBe(true);

        const restored = await http.patch(`/api/universities/${id}/restore`);
        expect(restored.status).toBe(200);

        const listAfterRestore = await http.get('/api/universities?search=pune');
        expect(listAfterRestore.status).toBe(200);
        expect(listAfterRestore.body.data.length).toBe(1);
        expect(listAfterRestore.body.data[0].isDeleted).toBe(false);
    });

    test('dropdown returns master items and optional legacy admission names', async () => {
        await db.collection('admissions').insertMany([
            { employeeId: 1, month: '2026-08', customerName: 'A', admissionDate: '2026-08-01', admissionType: 'one-time', revenue: 1, universityName: 'Legacy Institute' },
            { employeeId: 1, month: '2026-08', customerName: 'B', admissionDate: '2026-08-02', admissionType: 'one-time', revenue: 1, universityName: 'Legacy Institute' }
        ]);

        const dropdown = await http.get('/api/universities/dropdown?includeLegacyAdmissions=true&search=legacy');
        expect(dropdown.status).toBe(200);
        expect(Array.isArray(dropdown.body.data)).toBe(true);
        const legacy = dropdown.body.data.find((item) => item.name === 'Legacy Institute');
        expect(legacy).toBeTruthy();
        expect(legacy.source).toBe('legacy-admissions');
    });

    test('validates payloads', async () => {
        const response = await http.post('/api/universities').send({ name: ' ' });
        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/required/i);
    });
});