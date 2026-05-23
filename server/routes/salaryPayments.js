const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// GET /api/salary-payments?month=5&year=2026
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const filter = {};
        if (req.query.month) filter.month = parseInt(req.query.month);
        if (req.query.year)  filter.year  = parseInt(req.query.year);
        const records = await db.collection('salaryPayments').find(filter).toArray();
        res.json(records);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/salary-payments  — mark salary as paid
// Body: { employeeId, month, year }
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { employeeId, month, year } = req.body;
        if (!employeeId || !month || !year) {
            return res.status(400).json({ error: 'employeeId, month and year are required' });
        }
        const record = {
            employeeId: parseInt(employeeId),
            month: parseInt(month),
            year:  parseInt(year),
            paidAt: new Date().toISOString()
        };
        // Upsert so repeated marks are idempotent
        await db.collection('salaryPayments').updateOne(
            { employeeId: record.employeeId, month: record.month, year: record.year },
            { $set: record },
            { upsert: true }
        );
        res.status(201).json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/salary-payments  — unmark (undo paid)
// Body: { employeeId, month, year }
router.delete('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { employeeId, month, year } = req.body;
        await db.collection('salaryPayments').deleteOne({
            employeeId: parseInt(employeeId),
            month: parseInt(month),
            year:  parseInt(year)
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
