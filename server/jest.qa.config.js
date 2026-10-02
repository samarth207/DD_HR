module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests/e2e', '<rootDir>/tests/integration', '<rootDir>/tests/unit'],
    testMatch: ['**/*.test.js'],
    moduleNameMapper: {
        '^sanitize-html$': '<rootDir>/tests/helpers/sanitize-html.js'
    },
    verbose: true,
    collectCoverage: false,
    testTimeout: 120000
};
