
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { connectDB, isDBConnected } = require('./db');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// Serve uploaded documents
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
const employeesRoutes = require('./routes/employees');
const leavesRoutes = require('./routes/leaves');
const holidaysRoutes = require('./routes/holidays');
const salesRoutes = require('./routes/sales');
const incentivesRoutes = require('./routes/incentives');
const logsRoutes = require('./routes/logs');
const accountRoutes = require('./routes/account');
const attendanceRoutes = require('./routes/attendance');

// Use routes
app.use('/api/employees', employeesRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/incentives', incentivesRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/attendance', attendanceRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'HR Portal API is running', dbConnected: isDBConnected() });
});

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
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
    } catch (error) {
        console.warn('⚠️  Starting without database connection.');
    }
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📊 API endpoint: http://localhost:${PORT}/api`);
    });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⚠️ Shutting down gracefully...');
    const { closeDB } = require('./db');
    await closeDB();
    process.exit(0);
});

startServer();
