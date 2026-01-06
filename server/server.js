const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import routes
const employeesRoutes = require('./routes/employees');
const leavesRoutes = require('./routes/leaves');
const holidaysRoutes = require('./routes/holidays');
const salesRoutes = require('./routes/sales');
const incentivesRoutes = require('./routes/incentives');
const logsRoutes = require('./routes/logs');
const accountRoutes = require('./routes/account');

// Use routes
app.use('/api/employees', employeesRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/incentives', incentivesRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/account', accountRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'HR Portal API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`📊 API endpoint: http://localhost:${PORT}/api`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⚠️ Shutting down gracefully...');
    const { closeDB } = require('./db');
    await closeDB();
    process.exit(0);
});

startServer();
