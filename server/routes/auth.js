const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { getDB, isDBConnected } = require('../db');
const {
    deletePasswordHash,
    deletePasswordSalt,
    TOKEN_SECRET,
    TOKEN_TTL_MS
} = require('../config/admin-credentials');

// ── Token helpers ────────────────────────────────────────────────────────────

function createToken(payload) {
    const data = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    return `${encoded}.${sig}`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf      = Buffer.from(sig,      'hex');
    if (expectedBuf.length !== sigBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;
    try {
        const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
        if (data.exp < Date.now()) return null; // expired
        return data;
    } catch { return null; }
}

// ── POST /api/auth/admin-login ───────────────────────────────────────────────
// Body: { password }
router.post('/admin-login', (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });

    try {
        const candidate = crypto.scryptSync(password, deletePasswordSalt, 64).toString('hex');
        const match = crypto.timingSafeEqual(
            Buffer.from(deletePasswordHash, 'hex'),
            Buffer.from(candidate, 'hex')
        );
        if (!match) return res.status(401).json({ error: 'Incorrect password' });
        const token = createToken({ role: 'admin' });
        res.json({ success: true, token, role: 'admin' });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── POST /api/auth/employee-login ────────────────────────────────────────────
// Body: { email, phone }  — phone is used as the employee "password"
router.post('/employee-login', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { email, phone } = req.body || {};
    if (!email || !phone) return res.status(400).json({ error: 'Email and phone required' });

    try {
        const db = getDB();
        // Match by personal email (case-insensitive) AND phone
        const emp = await db.collection('employees').findOne({
            email: { $regex: new RegExp(`^${email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            phone: phone.trim()
        });
        if (!emp) return res.status(401).json({ error: 'Invalid email or phone number' });
        if (emp.status !== 'Active') return res.status(403).json({ error: 'Account is inactive. Contact admin.' });

        const token = createToken({
            role: 'employee',
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`
        });
        res.json({
            success: true,
            token,
            role: 'employee',
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            position: emp.position
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
// Header: Authorization: Bearer <token>
router.get('/me', async (req, res) => {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(raw);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    if (payload.role === 'admin') {
        return res.json({ role: 'admin' });
    }

    // For employee, return fresh data from DB
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    try {
        const db  = getDB();
        const emp = await db.collection('employees').findOne({ id: payload.employeeId });
        if (!emp) return res.status(401).json({ error: 'Employee not found' });
        res.json({
            role: 'employee',
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            position: emp.position,
            salary: emp.salary,
            salaryDay: emp.salaryDay,
            leaveBalance: emp.leaveBalance
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

module.exports = router;
module.exports.verifyToken = verifyToken;
