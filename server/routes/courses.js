const express = require('express');
const { ObjectId } = require('mongodb');
const { getDB, isDBConnected } = require('../db');

const router = express.Router();

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const COURSE_NAME_MIN = 2;
const COURSE_NAME_MAX = 160;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeCourseName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
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

function validateDuration(value) {
    const duration = Number(value);
    if (!Number.isInteger(duration) || duration <= 0) {
        throw new Error('Duration must be a positive integer');
    }
    return duration;
}

function validateTotalFees(value) {
    const totalFees = Number(value);
    if (!Number.isFinite(totalFees) || totalFees <= 0) {
        throw new Error('Total fees must be a positive number');
    }
    return Math.round(totalFees * 100) / 100;
}

function parseUniversityId(value) {
    const raw = String(value || '').trim();
    if (!ObjectId.isValid(raw)) throw new Error('Valid universityId is required');
    return new ObjectId(raw);
}

async function getActiveUniversity(db, universityId) {
    return db.collection('universities').findOne({
        _id: universityId,
        isDeleted: { $ne: true },
        isActive: true
    });
}

async function validateCoursePayload(db, payload = {}, { partial = false } = {}) {
    const updates = {};

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
        const name = normalizeCourseName(payload.name);
        if (!name) throw new Error('Course name is required');
        if (name.length < COURSE_NAME_MIN || name.length > COURSE_NAME_MAX) {
            throw new Error(`Course name must be between ${COURSE_NAME_MIN} and ${COURSE_NAME_MAX} characters`);
        }
        updates.name = name;
        updates.normalizedName = name.toLowerCase();
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'universityId')) {
        const universityId = parseUniversityId(payload.universityId);
        const university = await getActiveUniversity(db, universityId);
        if (!university) throw new Error('Active university not found for universityId');
        updates.universityId = universityId;
        updates.universityName = university.name;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'duration')) {
        updates.duration = validateDuration(payload.duration);
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'totalFees')) {
        updates.totalFees = validateTotalFees(payload.totalFees);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'code')) {
        const code = String(payload.code || '').trim().toUpperCase();
        if (code.length > 32) throw new Error('Course code must be at most 32 characters');
        updates.code = code;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
        updates.isActive = Boolean(payload.isActive);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
        const notes = String(payload.notes || '').trim();
        if (notes.length > 500) throw new Error('Notes must be at most 500 characters');
        updates.notes = notes;
    }

    return updates;
}

async function ensureUniqueCourse(db, { normalizedName, universityId, code, excludeId = null }) {
    if (normalizedName && universityId) {
        const nameQuery = {
            normalizedName,
            universityId,
            isDeleted: { $ne: true }
        };
        if (excludeId) nameQuery._id = { $ne: excludeId };
        const existingName = await db.collection('courses').findOne(nameQuery, { projection: { _id: 1 } });
        if (existingName) {
            throw new Error('Course with same name already exists for this university');
        }
    }

    if (code) {
        const codeQuery = { code, isDeleted: { $ne: true } };
        if (excludeId) codeQuery._id = { $ne: excludeId };
        const existingCode = await db.collection('courses').findOne(codeQuery, { projection: { _id: 1 } });
        if (existingCode) {
            throw new Error('Course code already exists');
        }
    }
}

function requireManagement(req, res, next) {
    if (!req.auth) return next();
    if (req.auth.role === 'admin' || req.auth.role === 'hr') return next();
    return res.status(403).json({ error: 'Forbidden' });
}

// GET /api/courses
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { page, limit, skip } = parsePagination(req.query);
        const search = normalizeSearch(req.query.search);
        const includeDeleted = String(req.query.includeDeleted || '').toLowerCase() === 'true';
        const activeOnly = String(req.query.activeOnly || '').toLowerCase() === 'true';
        const universityIdRaw = String(req.query.universityId || '').trim();

        const query = {};
        if (!includeDeleted) query.isDeleted = { $ne: true };
        if (activeOnly) query.isActive = true;
        if (universityIdRaw) {
            if (!ObjectId.isValid(universityIdRaw)) {
                return res.status(400).json({ error: 'Invalid universityId' });
            }
            query.universityId = new ObjectId(universityIdRaw);
        }
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } },
                { universityName: { $regex: search, $options: 'i' } }
            ];
        }

        const [items, total] = await Promise.all([
            db.collection('courses').find(query).sort({ universityName: 1, name: 1 }).skip(skip).limit(limit).toArray(),
            db.collection('courses').countDocuments(query)
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

// GET /api/courses/dropdown
router.get('/dropdown', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const search = normalizeSearch(req.query.search);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const universityIdRaw = String(req.query.universityId || '').trim();

        const query = {
            isDeleted: { $ne: true },
            isActive: true
        };

        if (universityIdRaw) {
            if (!ObjectId.isValid(universityIdRaw)) {
                return res.status(400).json({ error: 'Invalid universityId' });
            }
            query.universityId = new ObjectId(universityIdRaw);
        }
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const items = await db.collection('courses')
            .find(query)
            .project({ _id: 1, name: 1, universityId: 1, universityName: 1, duration: 1, totalFees: 1, code: 1 })
            .sort({ name: 1 })
            .limit(limit)
            .toArray();

        res.json({ data: items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/courses/:id
router.get('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid course ID' });

        const course = await db.collection('courses').findOne({ _id: new ObjectId(id) });
        if (!course) return res.status(404).json({ error: 'Course not found' });

        res.json(course);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/courses
router.post('/', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const payload = await validateCoursePayload(db, req.body || {}, { partial: false });

        await ensureUniqueCourse(db, {
            normalizedName: payload.normalizedName,
            universityId: payload.universityId,
            code: payload.code
        });

        const now = new Date();
        const course = {
            ...payload,
            isActive: payload.isActive !== false,
            isDeleted: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            deletedBy: null
        };

        if (req.auth) {
            course.createdBy = req.auth.role || 'system';
            course.updatedBy = req.auth.role || 'system';
        }

        const result = await db.collection('courses').insertOne(course);
        res.status(201).json({ success: true, id: result.insertedId, course });
    } catch (error) {
        const status = /required|must be|already exists|not found/i.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// PUT /api/courses/:id
router.put('/:id', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid course ID' });

        const updates = await validateCoursePayload(db, req.body || {}, { partial: true });
        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        const existing = await db.collection('courses').findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).json({ error: 'Course not found' });

        await ensureUniqueCourse(db, {
            normalizedName: updates.normalizedName || existing.normalizedName,
            universityId: updates.universityId || existing.universityId,
            code: Object.prototype.hasOwnProperty.call(updates, 'code') ? updates.code : existing.code,
            excludeId: new ObjectId(id)
        });

        updates.updatedAt = new Date();
        if (req.auth) updates.updatedBy = req.auth.role || 'system';

        await db.collection('courses').updateOne({ _id: new ObjectId(id) }, { $set: updates });
        const course = await db.collection('courses').findOne({ _id: new ObjectId(id) });
        res.json({ success: true, course });
    } catch (error) {
        const status = /required|must be|already exists|No valid fields|Invalid|not found/i.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// DELETE /api/courses/:id (soft delete)
router.delete('/:id', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid course ID' });

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

        const result = await db.collection('courses').updateOne(
            { _id: new ObjectId(id), isDeleted: { $ne: true } },
            { $set: updates }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'Course not found or already deleted' });
        res.json({ success: true, message: 'Course deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/courses/:id/restore
router.patch('/:id/restore', requireManagement, async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid course ID' });

        const updates = {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date()
        };
        if (req.auth) updates.updatedBy = req.auth.role || 'system';

        const result = await db.collection('courses').updateOne(
            { _id: new ObjectId(id), isDeleted: true },
            { $set: updates }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'Deleted course not found' });
        res.json({ success: true, message: 'Course restored' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;