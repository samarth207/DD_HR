const { TESTING_COLLECTIONS } = require('../constants');

class TestingRepository {
    constructor(db) {
        this.db = db;
    }

    async initIndexes() {
        await Promise.all([
            this.db.collection(TESTING_COLLECTIONS.runs).createIndex({ runId: 1 }, { unique: true }),
            this.db.collection(TESTING_COLLECTIONS.logs).createIndex({ runId: 1, at: 1 }),
            this.db.collection(TESTING_COLLECTIONS.expected).createIndex({ runId: 1, testCaseId: 1 }),
            this.db.collection(TESTING_COLLECTIONS.results).createIndex({ runId: 1, testCaseId: 1 }),
            this.db.collection(TESTING_COLLECTIONS.summary).createIndex({ createdAt: -1 })
        ]);
    }

    async createRun(runDoc) {
        await this.db.collection(TESTING_COLLECTIONS.runs).insertOne(runDoc);
    }

    async updateRun(runId, updates) {
        await this.db.collection(TESTING_COLLECTIONS.runs).updateOne(
            { runId },
            { $set: updates }
        );
    }

    async log(entry) {
        await this.db.collection(TESTING_COLLECTIONS.logs).insertOne(entry);
    }

    async saveExpected(entry) {
        await this.db.collection(TESTING_COLLECTIONS.expected).insertOne(entry);
    }

    async saveResult(entry) {
        await this.db.collection(TESTING_COLLECTIONS.results).insertOne(entry);
    }

    async saveSummary(entry) {
        await this.db.collection(TESTING_COLLECTIONS.summary).insertOne(entry);
    }
}

module.exports = { TestingRepository };
