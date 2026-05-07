const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// Get all holidays
router.get('/', async (req, res) => {
    try {
        const db = getDB();
        const holidays = await db.collection('holidays').find({}).sort({ date: 1 }).toArray();
        res.json(holidays);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new holiday
router.post('/', async (req, res) => {
    try {
        const db = getDB();
        const holiday = req.body;
        await db.collection('holidays').insertOne(holiday);
        res.status(201).json({ success: true, holiday });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update holiday
router.put('/:id', async (req, res) => {
    try {
        const db = getDB();
        const holidayId = parseInt(req.params.id);
        const { _id, ...updates } = req.body;
        
        const result = await db.collection('holidays').updateOne(
            { id: holidayId },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Holiday not found' });
        }
        
        res.json({ success: true, message: 'Holiday updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete holiday
router.delete('/:id', async (req, res) => {
    try {
        const db = getDB();
        const holidayId = parseInt(req.params.id);
        
        const result = await db.collection('holidays').deleteOne({ id: holidayId });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Holiday not found' });
        }
        
        res.json({ success: true, message: 'Holiday deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
