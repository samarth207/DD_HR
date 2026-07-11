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
        if (data.exp < Date.now()) return null;
        return data;
    } catch { return null; }
}

// Helper: hash a password with a given salt (or generate new salt)
function hashPassword(password, salt) {
    const s = salt || crypto.randomBytes(32).toString('hex');
    const h = crypto.scryptSync(password, s, 64).toString('hex');
    return { hash: h, salt: s };
}

// ── POST /api/auth/admin-login ───────────────────────────────────────────────
router.post('/admin-login', async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required' });

    try {
        // Check DB for updated admin password first
        let storedHash = deletePasswordHash;
        let storedSalt = deletePasswordSalt;

        if (isDBConnected()) {
            const db = getDB();
            const setting = await db.collection('settings').findOne({ key: 'adminPassword' });
            if (setting && setting.hash && setting.salt) {
                storedHash = setting.hash;
                storedSalt = setting.salt;
            }
        }

        const candidate = crypto.scryptSync(password, storedSalt, 64).toString('hex');
        const match = crypto.timingSafeEqual(
            Buffer.from(storedHash, 'hex'),
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
// Body: { email, password }  — password defaults to phone number for new employees
router.post('/employee-login', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const db = getDB();
        const loginId = String(email || '').trim();
        const escapedLoginId = loginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const loginRegex = new RegExp(`^${escapedLoginId}$`, 'i');
        const emp = await db.collection('employees').findOne({
            $or: [
                { email: { $regex: loginRegex } },
                { companyEmail: { $regex: loginRegex } },
                { phone: loginId }
            ]
        });
        if (!emp) return res.status(401).json({ error: 'Invalid email or password' });
        if (emp.status !== 'Active') return res.status(403).json({ error: 'Account is inactive. Contact admin.' });

        let authenticated = false;

        if (emp.passwordHash && emp.passwordSalt) {
            // New secure path: verify hashed password
            const candidate = crypto.scryptSync(String(password).trim(), emp.passwordSalt, 64).toString('hex');
            authenticated = crypto.timingSafeEqual(
                Buffer.from(emp.passwordHash, 'hex'),
                Buffer.from(candidate, 'hex')
            );
        } else {
            // Legacy fallback: phone number as password (for employees added before this update)
            authenticated = emp.phone && emp.phone.trim() === String(password).trim();
            // Migrate: hash it now so future logins use proper hash
            if (authenticated) {
                const { hash, salt } = hashPassword(String(password).trim());
                await db.collection('employees').updateOne(
                    { id: emp.id },
                    { $set: { passwordHash: hash, passwordSalt: salt } }
                );
            }
        }

        if (!authenticated) return res.status(401).json({ error: 'Invalid email or password' });

        const token = createToken({
            role: 'employee',
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`
        });
        res.json({
            success: true, token, role: 'employee',
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            position: emp.position
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ── POST /api/auth/change-employee-password ───────────────────────────────────
// Header: Authorization: Bearer <token>
// Body: { currentPassword, newPassword }
router.post('/change-employee-password', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(raw);
    if (!payload || payload.role !== 'employee') return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    try {
        const db  = getDB();
        const emp = await db.collection('employees').findOne({ id: payload.employeeId });
        if (!emp) return res.status(404).json({ error: 'Employee not found' });

        // Verify current password (hashed or legacy phone fallback)
        let valid = false;
        if (emp.passwordHash && emp.passwordSalt) {
            const candidate = crypto.scryptSync(currentPassword.trim(), emp.passwordSalt, 64).toString('hex');
            valid = crypto.timingSafeEqual(Buffer.from(emp.passwordHash, 'hex'), Buffer.from(candidate, 'hex'));
        } else {
            valid = emp.phone && emp.phone.trim() === currentPassword.trim();
        }
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

        const { hash, salt } = hashPassword(newPassword.trim());
        await db.collection('employees').updateOne(
            { id: payload.employeeId },
            { $set: { passwordHash: hash, passwordSalt: salt } }
        );
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ── POST /api/auth/change-admin-password ─────────────────────────────────────
// Header: Authorization: Bearer <token>  (admin only)
// Body: { currentPassword, newPassword }
router.post('/change-admin-password', async (req, res) => {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(raw);
    if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    try {
        let storedHash = deletePasswordHash;
        let storedSalt = deletePasswordSalt;

        if (isDBConnected()) {
            const db = getDB();
            const setting = await db.collection('settings').findOne({ key: 'adminPassword' });
            if (setting && setting.hash && setting.salt) {
                storedHash = setting.hash;
                storedSalt = setting.salt;
            }
        }

        const candidate = crypto.scryptSync(currentPassword.trim(), storedSalt, 64).toString('hex');
        const match = crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(candidate, 'hex'));
        if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

        const { hash, salt } = hashPassword(newPassword.trim());

        if (isDBConnected()) {
            const db = getDB();
            await db.collection('settings').updateOne(
                { key: 'adminPassword' },
                { $set: { key: 'adminPassword', hash, salt, updatedAt: new Date() } },
                { upsert: true }
            );
        }
        res.json({ success: true, message: 'Admin password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ── POST /api/auth/reset-employee-password ────────────────────────────────────
// Admin only — resets employee password back to their phone number
// Header: Authorization: Bearer <token>
// Body: { employeeId }
router.post('/reset-employee-password', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json({ error: 'Database not connected' });
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(raw);
    if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Unauthorized' });

    const { employeeId } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });

    try {
        const db  = getDB();
        const emp = await db.collection('employees').findOne({ id: parseInt(employeeId) });
        if (!emp) return res.status(404).json({ error: 'Employee not found' });
        if (!emp.phone) return res.status(400).json({ error: 'Employee has no phone number to reset to' });

        const { hash, salt } = hashPassword(emp.phone.trim());
        await db.collection('employees').updateOne(
            { id: emp.id },
            { $set: { passwordHash: hash, passwordSalt: salt } }
        );
        res.json({ success: true, message: `Password reset to phone number for ${emp.firstName} ${emp.lastName}` });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = verifyToken(raw);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    if (payload.role === 'admin') return res.json({ role: 'admin' });

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
            leaveBalance: emp.leaveBalance,
            hireDate: emp.hireDate || null
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

module.exports = router;
module.exports.verifyToken = verifyToken;
