const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { deletePasswordHash, deletePasswordSalt } = require('../config/admin-credentials');
const { getDB, isDBConnected } = require('../db');

/**
 * POST /api/admin/verify-delete-password
 * Body: { password: string }
 * Returns: { valid: true } or 401
 *
 * Uses Node's built-in scrypt — no external dependencies.
 * The plaintext password is never stored or logged.
 */
router.post('/verify-delete-password', (req, res) => {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Password required' });
    }

    try {
        const candidate = crypto.scryptSync(password, deletePasswordSalt, 64).toString('hex');
        const storedBuf   = Buffer.from(deletePasswordHash, 'hex');
        const candidateBuf = Buffer.from(candidate, 'hex');

        // Constant-time comparison to prevent timing attacks
        const match = storedBuf.length === candidateBuf.length &&
            crypto.timingSafeEqual(storedBuf, candidateBuf);

        if (match) return res.json({ valid: true });
        return res.status(401).json({ valid: false, error: 'Incorrect password' });
    } catch (err) {
        return res.status(500).json({ error: 'Verification failed' });
    }
});

/**
 * GET /api/admin/email-settings
 * Returns: { enabled: boolean }
 * 
 * Get the current email enabled/disabled status
 */
router.get('/email-settings', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    
    try {
        const db = getDB();
        const setting = await db.collection('appSettings').findOne({ _id: 'emailSettings' });
        
        // Default to enabled if setting doesn't exist
        const enabled = setting ? setting.enabled !== false : true;
        
        res.json({ enabled });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/admin/email-settings
 * Body: { enabled: boolean }
 * Returns: { success: true, enabled: boolean }
 * 
 * Update the email enabled/disabled status
 */
router.put('/email-settings', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        
        const db = getDB();
        await db.collection('appSettings').updateOne(
            { _id: 'emailSettings' },
            { $set: { enabled, updatedAt: new Date() } },
            { upsert: true }
        );
        
        const status = enabled ? 'enabled' : 'disabled';
        console.log(`📧 Email sending has been ${status} by admin`);
        
        res.json({ success: true, enabled });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
