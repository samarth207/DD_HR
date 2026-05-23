const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

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
