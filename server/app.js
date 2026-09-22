const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const helmet = require('helmet');
const { isDBConnected } = require('./db');
const { requireAuth, requireManagement } = require('./middleware/authz');
const {
    apiLimiter,
    authLimiter,
    sensitiveLimiter,
    corsOptions,
    helmetConfig,
    sanitizeObject,
    securityLogger,
    securityMonitor,
    csrfProtection,
    getCSRFToken
} = require('./middleware/security');

function createApp(options = {}) {
    const {
        includeAuthRoutes = true,
        includeAdmissionsRoutes = true
    } = options;

    const app = express();

    // Security headers
    app.use(helmet(helmetConfig));

    // Security logging and monitoring
    app.use(securityLogger);
    app.use(securityMonitor);

    // CORS configuration
    app.use(cors(corsOptions));

    // Rate limiting
    app.use('/api/', apiLimiter);
    app.use('/api/auth/', authLimiter);

    // Body parsing with input sanitization
    app.use(bodyParser.json({
        limit: '10mb',
        verify: (req, res, buf, encoding) => {
            // Sanitize request body
            if (buf && buf.length) {
                try {
                    const body = JSON.parse(buf.toString(encoding || 'utf8'));
                    req.body = sanitizeObject(body);
                } catch (e) {
                    // If parsing fails, let bodyParser handle it
                }
            }
        }
    }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

    // CSRF protection for state-changing operations
    app.use(csrfProtection);

    app.use(express.static(path.join(__dirname, '..')));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

    const employeesRoutes = require('./routes/employees');
    const leavesRoutes = require('./routes/leaves');
    const holidaysRoutes = require('./routes/holidays');
    const salesRoutes = require('./routes/sales');
    const incentivesRoutes = require('./routes/incentives');
    const accountRoutes = require('./routes/account');
    const universitiesRoutes = require('./routes/universities');
    const coursesRoutes = require('./routes/courses');
    const attendanceRoutes = require('./routes/attendance');
    const salaryPaymentsRoutes = require('./routes/salaryPayments');
    const adminRoutes = require('./routes/admin');
    const analyticsRoutes = require('./routes/analytics');
    let authRoutes = null;
    let admissionsRoutes = null;
    if (includeAuthRoutes) authRoutes = require('./routes/auth');
    if (includeAdmissionsRoutes) admissionsRoutes = require('./routes/admissions');
    const testingRoutes = require('./routes/testing');
    const authGuard = includeAuthRoutes ? requireAuth : (req, res, next) => next();
    const admissionsGuard = includeAuthRoutes
        ? [requireAuth]
        : [];

    // API Versioning - v1 endpoints
    app.use('/api/v1/employees', authGuard, employeesRoutes);
    app.use('/api/v1/leaves', authGuard, leavesRoutes);
    app.use('/api/v1/holidays', authGuard, holidaysRoutes);
    app.use('/api/v1/sales', authGuard, salesRoutes);
    // Critical security hardening: require valid auth token for payroll-related APIs.
    app.use('/api/v1/incentives', authGuard, incentivesRoutes);
    app.use('/api/v1/account', accountRoutes);
    app.use('/api/v1/attendance', authGuard, attendanceRoutes);
    app.use('/api/v1/universities', authGuard, universitiesRoutes);
    app.use('/api/v1/courses', authGuard, coursesRoutes);
    app.use('/api/v1/salary-payments', authGuard, salaryPaymentsRoutes);
    app.use('/api/v1/admin', adminRoutes);
    app.use('/api/v1/analytics', analyticsRoutes);
    if (authRoutes) app.use('/api/v1/auth', authRoutes);
    if (admissionsRoutes) app.use('/api/v1/admissions', ...admissionsGuard, admissionsRoutes);
    app.use('/api/v1/testing', testingRoutes);

    // Legacy routes (without version) for backward compatibility
    app.use('/api/employees', authGuard, employeesRoutes);
    app.use('/api/leaves', authGuard, leavesRoutes);
    app.use('/api/holidays', authGuard, holidaysRoutes);
    app.use('/api/sales', authGuard, salesRoutes);
    app.use('/api/incentives', authGuard, incentivesRoutes);
    app.use('/api/account', accountRoutes);
    app.use('/api/attendance', authGuard, attendanceRoutes);
    app.use('/api/universities', authGuard, universitiesRoutes);
    app.use('/api/courses', authGuard, coursesRoutes);
    app.use('/api/salary-payments', authGuard, salaryPaymentsRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/analytics', analyticsRoutes);
    if (authRoutes) app.use('/api/auth', authRoutes);
    if (admissionsRoutes) app.use('/api/admissions', ...admissionsGuard, admissionsRoutes);
    app.use('/api/testing', testingRoutes);

    app.get('/api/v1/health', (req, res) => {
        res.json({ status: 'OK', message: 'DD HR portal API is running', dbConnected: isDBConnected(), version: '1.0.0' });
    });

    // Legacy health endpoint for backward compatibility
    app.get('/api/health', (req, res) => {
        res.json({ status: 'OK', message: 'DD HR portal API is running', dbConnected: isDBConnected(), version: '1.0.0' });
    });

    // CSRF token endpoint
    app.get('/api/v1/csrf-token', getCSRFToken);
    app.get('/api/csrf-token', getCSRFToken);

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    });

    app.use((err, req, res, next) => {
        console.error('Error:', err);
        
        // Don't expose error details in production
        const isDevelopment = process.env.NODE_ENV === 'development';
        
        res.status(err.status || 500).json({
            error: isDevelopment ? err.message : 'An error occurred. Please try again later.',
            ...(isDevelopment && { stack: err.stack })
        });
    });

    return app;
}

module.exports = { createApp };
