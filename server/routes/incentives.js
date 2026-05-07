const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// Get incentive configuration
router.get('/config', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const config = await db.collection('incentive_config').findOne({});
        
        if (!config) {
            // Return default config
            const defaultConfig = {
                slabs: { 100: 3, 150: 4, 200: 7 },
                courseRewards: { onetime: 1000, annual: 500, semester: 300 },
                dailyTarget: { salesCount: 2, bonusAmount: 1000 }
            };
            res.json(defaultConfig);
        } else {
            res.json(config);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save incentive configuration
router.post('/config', async (req, res) => {
    try {
        const db = getDB();
        const config = req.body;
        
        await db.collection('incentive_config').updateOne(
            {},
            { $set: config },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Configuration saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all incentive data
router.get('/data', async (req, res) => {
    try {
        const db = getDB();
        
        const monthlyIncentives = await db.collection('monthly_incentives').find({}).toArray();
        const dailyBonuses = await db.collection('daily_bonuses').find({}).sort({ date: -1 }).toArray();
        const salaryAdvances = await db.collection('salary_advances').find({}).sort({ date: -1 }).toArray();
        const salaryPayments = await db.collection('salary_payments').find({}).toArray();
        
        // Format monthly incentives
        const formattedMonthly = {};
        monthlyIncentives.forEach(item => {
            formattedMonthly[item.key] = {
                paid: item.paid,
                paidDate: item.paidDate,
                amount: item.amount
            };
        });
        
        // Format salary payments
        const formattedPayments = {};
        salaryPayments.forEach(item => {
            formattedPayments[item.key] = {
                paid: item.paid,
                paidDate: item.paidDate,
                grossSalary: item.grossSalary,
                deductions: item.deductions,
                netSalary: item.netSalary
            };
        });
        
        res.json({
            monthlyIncentives: formattedMonthly,
            dailyBonuses,
            salaryAdvances,
            salaryPayments: formattedPayments
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save monthly incentive payment
router.post('/monthly', async (req, res) => {
    try {
        const db = getDB();
        const { key, data } = req.body;
        
        await db.collection('monthly_incentives').updateOne(
            { key },
            { $set: { key, ...data, updatedAt: new Date() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Monthly incentive saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add daily bonus
router.post('/daily', async (req, res) => {
    try {
        const db = getDB();
        const bonus = req.body;
        
        await db.collection('daily_bonuses').insertOne(bonus);
        res.status(201).json({ success: true, bonus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add salary advance
router.post('/advance', async (req, res) => {
    try {
        const db = getDB();
        const advance = req.body;
        
        await db.collection('salary_advances').insertOne(advance);
        res.status(201).json({ success: true, advance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update salary advance status
router.put('/advance/:id', async (req, res) => {
    try {
        const db = getDB();
        const advanceId = parseInt(req.params.id);
        const updates = req.body;
        
        const result = await db.collection('salary_advances').updateOne(
            { id: advanceId },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Advance not found' });
        }
        
        res.json({ success: true, message: 'Advance updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save salary payment
router.post('/salary-payment', async (req, res) => {
    try {
        const db = getDB();
        const { key, data } = req.body;
        
        await db.collection('salary_payments').updateOne(
            { key },
            { $set: { key, ...data, updatedAt: new Date() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Salary payment saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
