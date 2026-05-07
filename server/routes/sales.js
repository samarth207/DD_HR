const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// Get all sales data
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const salesData = await db.collection('sales').find({}).toArray();
        
        // Convert array to nested object structure for compatibility
        const formatted = {};
        salesData.forEach(record => {
            if (!formatted[record.month]) {
                formatted[record.month] = {};
            }
            formatted[record.month][record.employeeId] = {
                salesTarget: record.salesTarget,
                salesAchieved: record.salesAchieved,
                revenueTarget: record.revenueTarget,
                revenueAchieved: record.revenueAchieved
            };
        });
        
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get sales data by month
router.get('/month/:month', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const salesData = await db.collection('sales').find({ 
            month: req.params.month 
        }).toArray();
        res.json(salesData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update or create sales record
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, employeeId, data } = req.body;
        
        await db.collection('sales').updateOne(
            { month, employeeId },
            { 
                $set: { 
                    month, 
                    employeeId, 
                    ...data,
                    updatedAt: new Date()
                } 
            },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Sales data saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
