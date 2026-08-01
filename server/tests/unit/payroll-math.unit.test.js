const { calculateExpectedSalary } = require('../../testing/factories/seed-factory');

describe('Unit: payroll salary formula helper', () => {
    test('calculates deductions and net salary correctly for late + unpaid + incentives', () => {
        const result = calculateExpectedSalary({
            monthlySalary: 30000,
            unpaidLeaveDays: 1,
            lateCount: 3,
            lateDaysHalfDay: 3,
            monthlyIncentive: 2000,
            dailyBonus: 1000,
            advanceDeduction: 500
        });

        expect(result.dailyRate).toBe(1000);
        expect(result.unpaidDeduction).toBe(1000);
        expect(result.lateDeduction).toBe(500);
        expect(result.netSalary).toBe(31000);
    });

    test('net salary is floored at zero', () => {
        const result = calculateExpectedSalary({
            monthlySalary: 2000,
            unpaidLeaveDays: 3,
            lateCount: 9,
            lateDaysHalfDay: 3,
            monthlyIncentive: 0,
            dailyBonus: 0,
            advanceDeduction: 10000
        });

        expect(result.netSalary).toBe(0);
    });
});
