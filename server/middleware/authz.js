const authRoute = require('../routes/auth');

const verifyToken = authRoute.verifyToken;

function getBearerToken(req) {
    const raw = String(req.headers.authorization || '');
    if (!raw.startsWith('Bearer ')) return '';
    return raw.slice(7).trim();
}

function requireAuth(req, res, next) {
    const token = getBearerToken(req);
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    req.auth = payload;
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    return next();
}

module.exports = {
    requireAuth,
    requireAdmin
};
