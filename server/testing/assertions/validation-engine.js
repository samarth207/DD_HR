const assert = require('assert');

function assertStatus(actual, expected, label = 'status') {
    assert.strictEqual(actual, expected, `${label} mismatch. expected=${expected}, actual=${actual}`);
}

function assertTruthy(value, label) {
    assert.ok(value, `${label} should be truthy`);
}

function assertDeepEqual(actual, expected, label = 'payload') {
    assert.deepStrictEqual(actual, expected, `${label} mismatch`);
}

function assertRupeeMatch(expected, actual, label = 'salary') {
    const delta = Math.abs((Number(expected) || 0) - (Number(actual) || 0));
    assert.ok(delta < 1, `${label} mismatch >= Rs1. expected=${expected}, actual=${actual}, delta=${delta.toFixed(2)}`);
}

module.exports = {
    assertStatus,
    assertTruthy,
    assertDeepEqual,
    assertRupeeMatch
};
