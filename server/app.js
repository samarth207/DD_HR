const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { isDBConnected } = require('./db');

function createApp(options = {}) {
    const {
        includeAuthRoutes = true,
        includeAdmissionsRoutes = true
    } = options;

    const app = express();

    app.use(cors());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.use(express.static(path.join(__dirname, '..')));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

    const employeesRoutes = require('./routes/employees');
    const leavesRoutes = require('./routes/leaves');
    const holidaysRoutes = require('./routes/holidays');
    const salesRoutes = require('./routes/sales');
    const incentivesRoutes = require('./routes/incentives');
    const logsRoutes = require('./routes/logs');
    const accountRoutes = require('./routes/account');
    const attendanceRoutes = require('./routes/attendance');
    const salaryPaymentsRoutes = require('./routes/salaryPayments');
    const adminRoutes = require('./routes/admin');
    let authRoutes = null;
    let admissionsRoutes = null;
    if (includeAuthRoutes) authRoutes = require('./routes/auth');
    if (includeAdmissionsRoutes) admissionsRoutes = require('./routes/admissions');
    const testingRoutes = require('./routes/testing');

    app.use('/api/employees', employeesRoutes);
    app.use('/api/leaves', leavesRoutes);
    app.use('/api/holidays', holidaysRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/incentives', incentivesRoutes);
    app.use('/api/logs', logsRoutes);
    app.use('/api/account', accountRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/salary-payments', salaryPaymentsRoutes);
    app.use('/api/admin', adminRoutes);
    if (authRoutes) app.use('/api/auth', authRoutes);
    if (admissionsRoutes) app.use('/api/admissions', admissionsRoutes);
    app.use('/api/testing', testingRoutes);

    app.get('/api/health', (req, res) => {
        res.json({ status: 'OK', message: 'DD HR portal API is running', dbConnected: isDBConnected() });
    });

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    });

    app.use((err, req, res, next) => {
        console.error('Error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    });

    return app;
}

module.exports = { createApp };
