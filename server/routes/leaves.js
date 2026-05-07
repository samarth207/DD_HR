const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// Get all leaves
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const leaves = await db.collection('leaves').find({}).sort({ startDate: -1 }).toArray();
        res.json(leaves);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get leaves by employee ID
router.get('/employee/:id', async (req, res) => {
    try {
        const db = getDB();
        const leaves = await db.collection('leaves').find({ 
            employeeId: parseInt(req.params.id) 
        }).sort({ startDate: -1 }).toArray();
        res.json(leaves);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new leave
router.post('/', async (req, res) => {
    try {
        const db = getDB();
        const leave = req.body;
        await db.collection('leaves').insertOne(leave);
        res.status(201).json({ success: true, leave });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update leave
router.put('/:id', async (req, res) => {
    try {
        const db = getDB();
        const leaveId = parseInt(req.params.id);
        const { _id, ...updates } = req.body;
        
        const result = await db.collection('leaves').updateOne(
            { id: leaveId },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Leave not found' });
        }
        
        res.json({ success: true, message: 'Leave updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete leave
router.delete('/:id', async (req, res) => {
    try {
        const db = getDB();
        const leaveId = parseInt(req.params.id);
        
        const result = await db.collection('leaves').deleteOne({ id: leaveId });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Leave not found' });
        }
        
        res.json({ success: true, message: 'Leave deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
