const salaryCycleUtils = require('../../../salary-cycle-utils');

describe('Unit: salary-cycle-utils', () => {
    test('first salary month is prorated from hire date to month end', () => {
        const cycle = salaryCycleUtils.getSalaryCycleForMonth('2026-06', '2026-06-14');
        expect(cycle).toBeTruthy();
        expect(cycle.isFirstSalaryMonth).toBe(true);
        expect(cycle.proratedDays).toBe(17);
        expect(cycle.workingDays).toBe(17);
    });

    test('non-first salary month uses full calendar month', () => {
        const cycle = salaryCycleUtils.getSalaryCycleForMonth('2026-07', '2026-06-14');
        expect(cycle).toBeTruthy();
        expect(cycle.isFirstSalaryMonth).toBe(false);
        expect(cycle.proratedDays).toBe(31);
        expect(cycle.workingDays).toBe(31);
    });

    test('invalid month key returns null', () => {
        const cycle = salaryCycleUtils.getSalaryCycleForMonth('2026-13', '2026-06-14');
        expect(cycle).toBeNull();
    });
});
