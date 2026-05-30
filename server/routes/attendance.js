const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// GET /api/attendance/settings  — fetch office/late settings
router.get('/settings', async (req, res) => {
    try {
        const db = getDB();
        const doc = await db.collection('appSettings').findOne({ _id: 'attendanceSettings' });
        if (doc) {
            const { _id, ...settings } = doc;
            res.json(settings);
        } else {
            res.json({ officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/attendance/settings  — upsert office/late settings
router.put('/settings', async (req, res) => {
    try {
        const db = getDB();
        const { officeStartTime, lateThresholdMins, lateDaysHalfDay } = req.body;
        await db.collection('appSettings').updateOne(
            { _id: 'attendanceSettings' },
            { $set: { officeStartTime, lateThresholdMins: Number(lateThresholdMins), lateDaysHalfDay: Number(lateDaysHalfDay) } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/:date  — records for one day
router.get('/:date', async (req, res) => {
    try {
        const db = getDB();
        const doc = await db.collection('attendance').findOne({ date: req.params.date });
        res.json(doc ? doc.records : {});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/attendance/:date  — upsert full records object for a day
router.put('/:date', async (req, res) => {
    try {
        const db = getDB();
        await db.collection('attendance').updateOne(
            { date: req.params.date },
            { $set: { date: req.params.date, records: req.body } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/month/:month  — all records for a month prefix (YYYY-MM)
router.get('/month/:month', async (req, res) => {
    try {
        const db = getDB();
        const docs = await db.collection('attendance')
            .find({ date: { $regex: `^${req.params.month}` } })
            .sort({ date: 1 })
            .toArray();
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
