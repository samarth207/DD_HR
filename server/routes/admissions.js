const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// GET /api/admissions?employeeId=X&month=YYYY-MM
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const query = {};
        if (req.query.employeeId) query.employeeId = parseInt(req.query.employeeId);
        if (req.query.month)      query.month = req.query.month;
        const records = await db.collection('admissions').find(query).sort({ admissionDate: -1 }).toArray();
        res.json(records);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admissions - Add one admission record and update sales aggregate
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const {
            employeeId,
            month,
            customerName,
            customerPhone,
            customerEmail,
            admissionDate,
            admissionType,
            revenue,
            universityName
        } = req.body;

        if (!employeeId || !month || !customerName || !admissionDate || !admissionType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Insert the individual admission record
        const admission = {
            employeeId: parseInt(employeeId),
            month,
            customerName: String(customerName).trim(),
            customerPhone: customerPhone ? String(customerPhone).trim() : '',
            customerEmail: customerEmail ? String(customerEmail).trim() : '',
            universityName: universityName ? String(universityName).trim() : '',
            admissionDate,
            admissionType,
            revenue: parseFloat(revenue) || 0,
            createdAt: new Date()
        };

        await db.collection('admissions').insertOne(admission);

        // Update the sales aggregate (salesAchieved + revenueAchieved)
        await db.collection('sales').updateOne(
            { month, employeeId: parseInt(employeeId) },
            {
                $inc: {
                    salesAchieved: 1,
                    revenueAchieved: parseFloat(revenue) || 0
                },
                $setOnInsert: {
                    salesTarget: 0,
                    revenueTarget: 0,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        // Also update updatedAt on existing docs
        await db.collection('sales').updateOne(
            { month, employeeId: parseInt(employeeId) },
            { $set: { updatedAt: new Date() } }
        );

        res.json({ success: true, message: 'Admission recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admissions/:id
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const { ObjectId } = require('mongodb');
        const db = getDB();
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });

        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(id) });
        if (!admission) return res.status(404).json({ error: 'Admission not found' });

        await db.collection('admissions').deleteOne({ _id: new ObjectId(id) });

        // Decrement the sales aggregate
        await db.collection('sales').updateOne(
            { month: admission.month, employeeId: admission.employeeId },
            {
                $inc: {
                    salesAchieved: -1,
                    revenueAchieved: -(parseFloat(admission.revenue) || 0)
                },
                $set: { updatedAt: new Date() }
            }
        );

        res.json({ success: true, message: 'Admission deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
