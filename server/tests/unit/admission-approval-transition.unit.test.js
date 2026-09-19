const admissionsRouter = require('../../routes/admissions');

describe('Unit: admission approval transition guard', () => {
    const rule = admissionsRouter.shouldIncrementSalesForApprovalTransition;

    test('increments only for pending -> approved', () => {
        expect(rule('pending', 'approved')).toBe(true);
        expect(rule('approved', 'approved')).toBe(false);
        expect(rule('rejected', 'approved')).toBe(false);
        expect(rule('pending', 'rejected')).toBe(false);
    });
});
