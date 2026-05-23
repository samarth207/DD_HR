const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { deletePasswordHash, deletePasswordSalt } = require('../config/admin-credentials');

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

module.exports = router;
