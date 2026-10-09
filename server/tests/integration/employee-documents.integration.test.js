const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../db', () => ({ getDB: jest.fn(), isDBConnected: jest.fn(() => true) }));

const { getDB } = require('../../db');
const employeesRouter = require('../../routes/employees');
const { createApp } = require('../../app');

describe('Employee document uploads', () => {
    const employeeId = crypto.randomInt(100000000, 999999999);
    const uploadsRoot = path.resolve(__dirname, '../../../uploads');
    const employeeDir = path.join(uploadsRoot, `employee-${employeeId}`);
    const legacyDir = path.resolve(__dirname, '../../uploads', `employee-${employeeId}`);
    let employee;
    let collection;
    let app;

    beforeEach(() => {
        employee = { id: employeeId, documents: {} };
        collection = {
            findOne: jest.fn(async () => employee),
            updateOne: jest.fn(async (filter, update) => {
                for (const [field, value] of Object.entries(update.$set || {})) {
                    employee.documents[field.split('.')[1]] = value;
                }
                for (const field of Object.keys(update.$unset || {})) {
                    delete employee.documents[field.split('.')[1]];
                }
                return { matchedCount: 1 };
            })
        };
        getDB.mockReturnValue({ collection: () => collection });
        app = express();
        app.use((req, res, next) => {
            req.auth = { role: 'employee', employeeId };
            next();
        });
        app.use('/api/employees', employeesRouter);
        app.use('/uploads', express.static(uploadsRoot));
        app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')));
        app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
    });

    afterEach(() => {
        fs.rmSync(employeeDir, { recursive: true, force: true });
        fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    function uploadDocument(docType = 'pan_card', contents = 'document bytes', id = employeeId) {
        return request(app).post(`/api/employees/${id}/documents`)
            .attach('file', Buffer.from(contents), { filename: 'employee.pdf', contentType: 'application/pdf' })
            .field('docType', docType);
    }

    test('file-first multipart uploads persist bytes in root uploads and serve the saved URL', async () => {
        const response = await uploadDocument();
        expect(response.status).toBe(200);
        const doc = response.body.document;
        expect(fs.readFileSync(path.join(employeeDir, doc.filename), 'utf8')).toBe('document bytes');
        expect(fs.existsSync(legacyDir)).toBe(false);
        expect(employee.documents.pan_card).toEqual(doc);
        expect((await request(app).get(doc.url)).status).toBe(200);
        const listing = await request(app).get(`/api/employees/${employeeId}/documents`);
        expect(listing.body.documents.pan_card).toEqual(doc);
    });

    test('application serves uploaded documents with same-origin frame headers', async () => {
        const uploaded = await uploadDocument();
        expect(uploaded.status).toBe(200);
        const application = createApp({ includeAuthRoutes: false, includeAdmissionsRoutes: false });
        const response = await request(application).get(uploaded.body.document.url);
        expect(response.status).toBe(200);
        expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'self'");
        expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('legacy uploaded documents allow same-origin previews', async () => {
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'pan_card.pdf'), 'legacy bytes');
        const application = createApp({ includeAuthRoutes: false, includeAdmissionsRoutes: false });
        const response = await request(application).get(`/uploads/employee-${employeeId}/pan_card.pdf`);
        expect(response.status).toBe(200);
        expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    });

    test('viewer page allows same-origin frames but cannot itself be framed', async () => {
        const application = createApp({ includeAuthRoutes: false, includeAdmissionsRoutes: false });
        const response = await request(application).get('/employees.html');
        expect(response.status).toBe(200);
        expect(response.headers['x-frame-options']).toBe('DENY');
        expect(response.headers['content-security-policy']).toContain("frame-src 'self'");
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    });

    test('different document types do not overwrite each other when file comes first', async () => {
        const first = await uploadDocument('pan_card', 'PAN bytes');
        const second = await uploadDocument('address_proof', 'address bytes');
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.document.filename).not.toBe(second.body.document.filename);
        expect(fs.readFileSync(path.join(employeeDir, first.body.document.filename), 'utf8')).toBe('PAN bytes');
        expect(fs.readFileSync(path.join(employeeDir, second.body.document.filename), 'utf8')).toBe('address bytes');
    });

    test('successful replacement removes only the previous document', async () => {
        const first = await uploadDocument();
        const second = await uploadDocument('pan_card', 'replacement bytes');
        expect(second.status).toBe(200);
        expect(fs.existsSync(path.join(employeeDir, first.body.document.filename))).toBe(false);
        expect(fs.readFileSync(path.join(employeeDir, second.body.document.filename), 'utf8')).toBe('replacement bytes');
        expect(fs.readdirSync(employeeDir)).toEqual([second.body.document.filename]);
    });

    test('locked replacement preserves the original file and metadata', async () => {
        const first = await uploadDocument();
        employee.documents.pan_card.locked = true;
        const saved = { ...employee.documents.pan_card };
        const response = await uploadDocument('pan_card', 'rejected bytes');
        expect(response.status).toBe(423);
        expect(employee.documents.pan_card).toEqual(saved);
        expect(fs.readFileSync(path.join(employeeDir, first.body.document.filename), 'utf8')).toBe('document bytes');
        expect(fs.readdirSync(employeeDir)).toEqual([first.body.document.filename]);
    });

    test.each(['', 'unknown_type', '../pan_card'])('invalid document type %p leaves no orphaned file', async docType => {
        const response = await uploadDocument(docType);
        expect(response.status).toBe(400);
        expect(fs.readdirSync(employeeDir)).toEqual([]);
        expect(collection.updateOne).not.toHaveBeenCalled();
    });

    test('missing employee leaves no orphaned file', async () => {
        collection.findOne.mockResolvedValue(null);
        expect((await uploadDocument()).status).toBe(404);
        expect(fs.readdirSync(employeeDir)).toEqual([]);
    });

    test('database failure preserves the previous document and cleans up the new file', async () => {
        const first = await uploadDocument();
        collection.updateOne.mockRejectedValue(new Error('Database write failed'));
        expect((await uploadDocument('pan_card', 'rejected bytes')).status).toBe(500);
        expect(fs.readFileSync(path.join(employeeDir, first.body.document.filename), 'utf8')).toBe('document bytes');
        expect(fs.readdirSync(employeeDir)).toEqual([first.body.document.filename]);
    });

    test('replacement keeps legacy server/uploads files compatible and removes the old file', async () => {
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'pan_card.pdf'), 'legacy bytes');
        employee.documents.pan_card = { filename: 'pan_card.pdf', url: `/uploads/employee-${employeeId}/pan_card.pdf` };
        expect((await request(app).get(employee.documents.pan_card.url)).status).toBe(200);
        const response = await uploadDocument();
        expect(response.status).toBe(200);
        expect(fs.existsSync(path.join(legacyDir, 'pan_card.pdf'))).toBe(false);
        expect(fs.existsSync(path.join(employeeDir, response.body.document.filename))).toBe(true);
    });

    test('delete removes the saved file and document metadata', async () => {
        const uploaded = await uploadDocument();
        const response = await request(app).delete(`/api/employees/${employeeId}/documents/pan_card`);
        expect(response.status).toBe(200);
        expect(fs.existsSync(path.join(employeeDir, uploaded.body.document.filename))).toBe(false);
        expect(employee.documents.pan_card).toBeUndefined();
    });

    test('employee cannot upload to another employee before files are written', async () => {
        expect((await uploadDocument('pan_card', 'forbidden bytes', employeeId + 1)).status).toBe(403);
        expect(fs.existsSync(path.join(uploadsRoot, `employee-${employeeId + 1}`))).toBe(false);
        expect(collection.findOne).not.toHaveBeenCalled();
    });

    test('unsupported files are rejected before storage', async () => {
        const response = await request(app).post(`/api/employees/${employeeId}/documents`)
            .attach('file', Buffer.from('executable'), { filename: 'bad.exe', contentType: 'application/octet-stream' })
            .field('docType', 'pan_card');
        expect(response.status).toBe(400);
        expect(fs.existsSync(employeeDir)).toBe(false);
    });

    test('oversized uploads are rejected and removed', async () => {
        const response = await request(app).post(`/api/employees/${employeeId}/documents`)
            .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.pdf', contentType: 'application/pdf' })
            .field('docType', 'pan_card');
        expect(response.status).toBe(400);
        expect(fs.readdirSync(employeeDir)).toEqual([]);
    });
});