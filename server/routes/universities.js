const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB, isDBConnected } = require('../db');

const router = express.Router();

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const UNIVERSITY_NAME_MIN = 2;
const UNIVERSITY_NAME_MAX = 160;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeUniversityName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeSearch(value) {
    return String(value || '').trim();
}

function parsePagination(query) {
    const page = Math.max(DEFAULT_PAGE, parseInt(query.page, 10) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}

function validateUniversityPayload(payload = {}, { partial = false } = {}) {
    const updates = {};

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
        const name = normalizeUniversityName(payload.name);
        if (!name) throw new Error('University name is required');
        if (name.length < UNIVERSITY_NAME_MIN || name.length > UNIVERSITY_NAME_MAX) {
            throw new Error(`University name must be between ${UNIVERSITY_NAME_MIN} and ${UNIVERSITY_NAME_MAX} characters`);
        }
        updates.name = name;
        updates.normalizedName = name.toLowerCase();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'code')) {
        const code = String(payload.code || '').trim().toUpperCase();
        if (code && code.length > 32) throw new Error('University code must be at most 32 characters');
        updates.code = code;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'country')) {
        const country = String(payload.country || '').trim();
        if (country.length > 64) throw new Error('Country must be at most 64 characters');
        updates.country = country;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'state')) {
        const state = String(payload.state || '').trim();
        if (state.length > 64) throw new Error('State must be at most 64 characters');
        updates.state = state;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'city')) {
        const city = String(payload.city || '').trim();
        if (city.length > 64) throw new Error('City must be at most 64 characters');
        updates.city = city;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'website')) {
        const website = String(payload.website || '').trim();
        if (website.length > 200) throw new Error('Website must be at most 200 characters');
        updates.website = website;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
        const notes = String(payload.notes || '').trim();
        if (notes.length > 500) throw new Error('Notes must be at most 500 characters');
        updates.notes = notes;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
        updates.isActive = Boolean(payload.isActive);
    }

    return updates;
}

async function ensureUniqueUniversity(db, { normalizedName, code, excludeId = null }) {
    const query = { isDeleted: { $ne: true } };
    const clashes = [];

    if (normalizedName) clashes.push({ normalizedName });
    if (code) clashes.push({ code });
    if (!clashes.length) return;

    query.$or = clashes;
    if (excludeId) query._id = { $ne: excludeId };

    const existing = await db.collection('universities').findOne(query, { projection: { _id: 1, name: 1, code: 1 } });
    if (existing) {
        throw new Error('University with same name or code already exists');
    }
}

function requireManagement(req, res, next) {
    if (!req.auth) return next(); // compatibility for tests and non-auth app mode
    if (req.auth.role === 'admin' || req.auth.role === 'hr') return next();
    return res.status(403).json({ error: 'Forbidden' });
}

// GET /api/universities
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { page, limit, skip } = parsePagination(req.query);
        const search = normalizeSearch(req.query.search);
        const includeDeleted = String(req.query.includeDeleted || '').toLowerCase() === 'true';
        const activeOnly = String(req.query.activeOnly || '').toLowerCase() === 'true';

        const query = {};
        if (!includeDeleted) query.isDeleted = { $ne: true };
        if (activeOnly) query.isActive = true;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } },
                { city: { $regex: search, $options: 'i' } },
                { state: { $regex: search, $options: 'i' } },
                { country: { $regex: search, $options: 'i' } }
            ];
        }

        const [items, total] = await Promise.all([
            db.collection('universities').find(query).sort({ name: 1 }).skip(skip).limit(limit).toArray(),
            db.collection('universities').countDocuments(query)
        ]);

        res.json({
            data: items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/universities/dropdown
router.get('/dropdown', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const search = normalizeSearch(req.query.search);
        const includeLegacyAdmissions = String(req.query.includeLegacyAdmissions || '').toLowerCase() === 'true';
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));

        const query = { isDeleted: { $ne: true }, isActive: true };
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const masters = await db.collection('universities')
            .find(query)
            .project({ _id: 1, name: 1, code: 1 })
            .sort({ name: 1 })
            .limit(limit)
            .toArray();

        let legacy = [];
        if (includeLegacyAdmissions) {
            const pipeline = [
                {
                    $match: {
                        universityName: { $exists: true, $type: 'string', $ne: '' }
                    }
                },
                {
                    $group: {
                        _id: { $trim: { input: '$universityName' } },
                        count: { $sum: 1 }
                    }
                },
                {
                    $match: {
                        _id: { $ne: '' }
                    }
                },
                {
                    $sort: { count: -1, _id: 1 }
                },
                {
                    $limit: limit
                }
            ];

            const legacyRows = await db.collection('admissions').aggregate(pipeline).toArray();
            const masterNames = new Set(masters.map((m) => String(m.name || '').toLowerCase()));
            legacy = legacyRows
                .filter((row) => !masterNames.has(String(row._id || '').toLowerCase()))
                .map((row) => ({
                    _id: null,
                    name: row._id,
                    code: '',
                    source: 'legacy-admissions',
                    usageCount: row.count
                }));
        }

        res.json({
            data: masters.map((item) => ({ ...item, source: 'master' })).concat(legacy)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/universities/:id
router.get('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid university ID' });

        const university = await db.collection('universities').findOne({ _id: new ObjectId(id) });
        if (!university) return res.status(404).json({ error: 'University not found' });

        res.json(university);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/universities
router.post('/', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const payload = validateUniversityPayload(req.body || {}, { partial: false });

        await ensureUniqueUniversity(db, {
            normalizedName: payload.normalizedName,
            code: payload.code
        });

        const now = new Date();
        const university = {
            ...payload,
            isActive: payload.isActive !== false,
            isDeleted: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            deletedBy: null
        };

        if (req.auth) {
            university.createdBy = req.auth.role || 'system';
            university.updatedBy = req.auth.role || 'system';
        }

        const result = await db.collection('universities').insertOne(university);
        res.status(201).json({ success: true, id: result.insertedId, university });
    } catch (error) {
        const status = /already exists|required|must be/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// PUT /api/universities/:id
router.put('/:id', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid university ID' });

        const updates = validateUniversityPayload(req.body || {}, { partial: true });
        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        await ensureUniqueUniversity(db, {
            normalizedName: updates.normalizedName,
            code: updates.code,
            excludeId: new ObjectId(id)
        });

        updates.updatedAt = new Date();
        if (req.auth) updates.updatedBy = req.auth.role || 'system';

        const result = await db.collection('universities').updateOne(
            { _id: new ObjectId(id) },
            { $set: updates }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'University not found' });
        const university = await db.collection('universities').findOne({ _id: new ObjectId(id) });
        res.json({ success: true, university });
    } catch (error) {
        const status = /required|must be|already exists|No valid fields|Invalid/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// DELETE /api/universities/:id (soft delete)
router.delete('/:id', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid university ID' });

        const updates = {
            isDeleted: true,
            isActive: false,
            deletedAt: new Date(),
            updatedAt: new Date()
        };
        if (req.auth) {
            updates.deletedBy = req.auth.role || 'system';
            updates.updatedBy = req.auth.role || 'system';
        }

        const result = await db.collection('universities').updateOne(
            { _id: new ObjectId(id), isDeleted: { $ne: true } },
            { $set: updates }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'University not found or already deleted' });
        res.json({ success: true, message: 'University deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/universities/:id/restore
router.patch('/:id/restore', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid university ID' });

        const updates = {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date()
        };
        if (req.auth) updates.updatedBy = req.auth.role || 'system';

        const result = await db.collection('universities').updateOne(
            { _id: new ObjectId(id), isDeleted: true },
            { $set: updates }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'Deleted university not found' });
        res.json({ success: true, message: 'University restored' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;