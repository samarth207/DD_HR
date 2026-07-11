
const path = require('path');
const { connectDB } = require('./db');
const { createApp } = require('./app');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = createApp();
const PORT = process.env.PORT || 3000;

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
