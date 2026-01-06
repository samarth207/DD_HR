const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

let client;
let db;

async function connectDB() {
    try {
        client = new MongoClient(uri);
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas');
        
        db = client.db(dbName);
        console.log(`✅ Using database: ${dbName}`);
        
        // Create indexes for better performance
        await createIndexes();
        
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

async function createIndexes() {
    try {
        await db.collection('employees').createIndex({ id: 1 }, { unique: true });
        await db.collection('employees').createIndex({ email: 1 }, { unique: true });
        await db.collection('employees').createIndex({ status: 1 });
        await db.collection('employees').createIndex({ department: 1 });
        
        await db.collection('leaves').createIndex({ id: 1 }, { unique: true });
        await db.collection('leaves').createIndex({ employeeId: 1 });
        await db.collection('leaves').createIndex({ status: 1 });
        
        await db.collection('holidays').createIndex({ id: 1 }, { unique: true });
        await db.collection('holidays').createIndex({ date: 1 });
        
        await db.collection('sales').createIndex({ month: 1, employeeId: 1 });
        
        await db.collection('incentives').createIndex({ employeeId: 1 });
        await db.collection('incentives').createIndex({ type: 1 });
        
        await db.collection('logs').createIndex({ timestamp: -1 });
        await db.collection('logs').createIndex({ type: 1 });
        
        console.log('✅ Database indexes created');
    } catch (error) {
        console.log('⚠️ Index creation warning:', error.message);
    }
}

function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB first.');
    }
    return db;
}

async function closeDB() {
    if (client) {
        await client.close();
        console.log('✅ MongoDB connection closed');
    }
}

module.exports = { connectDB, getDB, closeDB };
