const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// Get all logs
router.get('/', async (req, res) => {
    try {
        const db = getDB();
        const logs = await db.collection('logs').find({}).sort({ timestamp: -1 }).toArray();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new log
router.post('/', async (req, res) => {
    try {
        const db = getDB();
        const log = req.body;
        await db.collection('logs').insertOne(log);
        res.status(201).json({ success: true, log });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear all logs
router.delete('/', async (req, res) => {
    try {
        const db = getDB();
        await db.collection('logs').deleteMany({});
        res.json({ success: true, message: 'All logs cleared' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
