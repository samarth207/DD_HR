const { calculateFeeManagement } = require('../../utils/admission-fee-management');

describe('Performance: admission fee management engine', () => {
    test('calculates large batch of mixed scenarios within acceptable latency', () => {
        const start = Date.now();
        const loops = 2500;

        for (let i = 0; i < loops; i += 1) {
            const type = i % 3 === 0 ? 'one-time' : (i % 3 === 1 ? 'yearly' : 'semester-wise');
            const discountType = type === 'one-time'
                ? 'whole-fees'
                : (type === 'yearly' ? (i % 2 === 0 ? 'whole-fees' : 'yearly') : (i % 2 === 0 ? 'whole-fees' : 'semester'));
            const duration = type === 'one-time' ? 1 : (type === 'yearly' ? 3 : 2);
            const totalFees = 80000 + (i % 1000);

            const payload = {
                admissionType: type,
                discountType,
                duration,
                totalFees,
                discountPercent: i % 21
            };

            if (discountType === 'yearly') {
                payload.installmentDiscounts = { 1: 10, 2: 5, 3: 0 };
            }
            if (discountType === 'semester') {
                payload.installmentDiscounts = { 1: 0, 2: 5, 3: 10, 4: 15 };
            }

            const result = calculateFeeManagement(payload);
            expect(result.summary.totalFeesPayable).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(result.installments)).toBe(true);
        }

        const elapsed = Date.now() - start;

        // Keep threshold practical for CI environments while still catching major regressions.
        expect(elapsed).toBeLessThan(5000);
    });
});
