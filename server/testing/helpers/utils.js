function nowIso() {
    return new Date().toISOString();
}

function runId() {
    return `TR-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function testCaseId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = {
    nowIso,
    runId,
    testCaseId,
    round2
};
