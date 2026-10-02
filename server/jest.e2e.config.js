module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests/e2e'],
    testMatch: ['**/*.test.js'],
    moduleNameMapper: {
        '^sanitize-html$': '<rootDir>/tests/helpers/sanitize-html.js'
    },
    verbose: true,
    collectCoverage: false
};
