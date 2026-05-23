const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

let client;
let db;

async function connectDB(retries = 3, delay = 2000) {
    const opts = {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        tls: true,
        tlsAllowInvalidCertificates: false,
        family: 4,
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            client = new MongoClient(uri, opts);
            await client.connect();
            console.log('✅ Connected to MongoDB Atlas');

            db = client.db(dbName);
            console.log(`✅ Using database: ${dbName}`);

            await createIndexes();
            return db;
        } catch (error) {
            const isSSLError = error.message && error.message.includes('SSL');
            if (attempt < retries) {
                console.warn(`⚠️  MongoDB attempt ${attempt} failed (${error.message}). Retrying in ${delay / 1000}s…`);
                // On SSL errors, relax certificate validation for the retry
                if (isSSLError) opts.tlsAllowInvalidCertificates = true;
                await new Promise(r => setTimeout(r, delay));
            } else {
                console.error('❌ MongoDB connection error:', error.message || error);
                console.warn('⚠️  Server will start without database. API routes will be unavailable.');
                db = null;
                return null;
            }
        }
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
    return db; // may be null if not connected
}

function isDBConnected() {
    return db !== null && db !== undefined;
}

async function closeDB() {
    if (client) {
        await client.close();
        console.log('✅ MongoDB connection closed');
    }
}

module.exports = { connectDB, getDB, isDBConnected, closeDB };
