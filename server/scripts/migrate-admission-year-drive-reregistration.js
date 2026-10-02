const { connectDB, getDB, closeDB } = require('../db');
const { ensureAdmissionManagementIndexes } = require('../utils/admission-indexes');

async function main() {
    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    await ensureAdmissionManagementIndexes(db);
    console.log('Admission allocation and re-registration indexes ensured. No admission records were changed.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error?.stack || error?.message || error);
            process.exitCode = 1;
        })
        .finally(async () => closeDB());
}

module.exports = { main };