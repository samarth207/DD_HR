const { calculate, rows, renderTable } = require('../../../salary-breakup-utils');
const { buildSalaryChange, hasSalaryBreakupForMonth, salaryForMonth, withCurrentSalary } = require('../../utils/salary-history');
const { buildSalaryCreditedEmail } = require('../../utils/emailTemplates');

describe('Automatic monthly CTC breakup', () => {
    test('calculates the requested 50/20/30 split and yearly amounts', () => {
        expect(calculate(50000)).toEqual({
            basicSalary: { monthly: 25000, yearly: 300000 },
            houseRentAllowance: { monthly: 10000, yearly: 120000 },
            specialAllowance: { monthly: 15000, yearly: 180000 },
            subTotal: { monthly: 50000, yearly: 600000 },
            ctc: { monthly: 50000, yearly: 600000 }
        });
        expect(calculate(30000).basicSalary.monthly).toBe(15000);
        expect(calculate(0).ctc.yearly).toBe(0);
    });

    test.each([0.01, 0.03, 12345.67, 50000.99])('keeps rounded components and annual totals consistent for %s', value => {
        const result = calculate(value);
        const components = [result.basicSalary, result.houseRentAllowance, result.specialAllowance];
        expect(components.reduce((sum, amount) => sum + Math.round(amount.monthly * 100), 0)).toBe(Math.round(value * 100));
        expect(components.reduce((sum, amount) => sum + Math.round(amount.yearly * 100), 0)).toBe(Math.round(value * 100) * 12);
        expect(result.ctc).toEqual(result.subTotal);
    });

    test.each([undefined, null, '', ' ', true, {}, -1, 'abc', Infinity, NaN, 10.001, Number.MAX_SAFE_INTEGER])('rejects invalid CTC %s', value => {
        expect(() => calculate(value)).toThrow(/Monthly CTC/);
    });

    test('can record components without changing a legacy salary, effective-dated only', () => {
        const employee = { salary: 50000, hireDate: '2026-01-01' };
        expect(hasSalaryBreakupForMonth(employee, '2026-05')).toBe(false);
        expect(() => buildSalaryChange(employee, { salary: 50000, salaryBreakupEnabled: true })).toThrow(/effective date/);
        employee.salaryHistory = buildSalaryChange(employee, {
            salary: 50000, salaryBreakupEnabled: true, salaryEffectiveDate: '2026-06-01'
        });
        expect(hasSalaryBreakupForMonth(employee, '2026-05')).toBe(false);
        expect(hasSalaryBreakupForMonth(employee, '2026-06')).toBe(true);
        expect(salaryForMonth(employee, '2026-05')).toBe(50000);
        employee.salaryHistory = buildSalaryChange(employee, { salary: 60000, salaryEffectiveDate: '2026-07-01' });
        expect(hasSalaryBreakupForMonth(employee, '2026-07')).toBe(true);
        expect(salaryForMonth(employee, '2026-07')).toBe(60000);
        expect(() => buildSalaryChange(employee, { salary: 60000, salaryBreakupEnabled: true, salaryEffectiveDate: '2026-08-01' })).toThrow(/must differ/);
    });

    test('ordinary edits preserve legacy records and scheduled activation does not change the current profile', () => {
        const employee = { salary: 50000 };
        expect(buildSalaryChange(employee, { salary: 50000, salaryBreakupEnabled: false })).toBeNull();
        employee.salaryHistory = buildSalaryChange(employee, {
            salary: 50000, salaryBreakupEnabled: true, salaryEffectiveDate: '9999-01-01'
        });
        expect(withCurrentSalary(employee).salaryBreakupEnabled).toBe(false);
        expect(buildSalaryChange(employee, { salary: 50000, salaryBreakupEnabled: false })).toBeNull();
    });

    test('renders monthly and yearly tables with a supplied amount-privacy formatter', () => {
        const result = calculate(50000);
        expect(rows(result)).toHaveLength(5);
        const table = renderTable(result, () => 'HIDDEN');
        expect(table).toContain('Monthly (INR)');
        expect(table).toContain('Yearly (INR)');
        expect(table.match(/HIDDEN/g)).toHaveLength(10);
        expect(table).not.toContain('25000');
        expect(table).not.toContain('Yearly figures are monthly amounts');
        expect(table).not.toContain('fully taxable');
        expect(renderTable(null)).toContain('not been recorded');
    });

    test('salary-credit HTML email includes recorded structure without the removed guidance', () => {
        const html = buildSalaryCreditedEmail({
            name: 'Test Employee', month: 'June 2026', employee: { id: 1 },
            breakup: { grossSalary: 50000, salaryComponents: calculate(50000), netSalary: 50000 }
        });
        expect(html).toContain('Basic Salary (50%)');
        expect(html).toContain('House Rent Allowance (20%)');
        expect(html).toContain('Special Allowance (30%)');
        expect(html).toContain('6,00,000');
        expect(html).not.toContain('not year-to-date');
        expect(html).not.toContain('fully taxable');
    });
});
