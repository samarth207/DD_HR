const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// Get account details
router.get('/', async (req, res) => {
    try {
        const db = getDB();
        const account = await db.collection('account').findOne({});
        
        if (!account) {
            // Return default account
            const defaultAccount = {
                firstName: 'Admin',
                lastName: 'User',
                email: 'admin@hrportal.com',
                phone: '',
                role: 'HR Manager',
                joinDate: new Date().toISOString().split('T')[0]
            };
            res.json(defaultAccount);
        } else {
            res.json(account);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update account details
router.put('/', async (req, res) => {
    try {
        const db = getDB();
        const accountData = req.body;
        
        await db.collection('account').updateOne(
            {},
            { $set: accountData },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Account updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
