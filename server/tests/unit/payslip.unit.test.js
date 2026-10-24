const readPdf = require('../helpers/read-pdf');
const { buildPayslipModel, createPayslipPdf, amountInWords, payslipFilename } = require('../../utils/payslip');
const { calculate } = require('../../../salary-breakup-utils');

const employee = {
    id: 11, firstName: 'Sample', lastName: 'Employee', department: 'Sales', position: 'Assistant Team Leader',
    gender: 'Male', dateOfBirth: '1999-05-23', location: 'Noida', unit: 'Noida', pan: 'ABCDE1234F'
};
function payroll(overrides = {}) {
    return {
        grossSalary: 45000, effectiveGross: 45000, netSalary: 25333, totalDeductions: 19667,
        totalEarnings: 45000, dailyRate: 1500, lopDays: 13.55, unpaidLeaveDeduction: 19667,
        lateAttendanceDeduction: 0, monthlyIncentive: 0, dailyBonusTotal: 0,
        salaryComponents: calculate(45000), ...overrides
    };
}

describe('Payslip model and reference-format PDF', () => {
    test.each([
        [0, 'ZERO ONLY'], [2533300, 'TWENTY FIVE THOUSAND THREE HUNDRED THIRTY THREE ONLY'],
        [2002199, 'TWENTY THOUSAND TWENTY ONE AND NINETY NINE PAISE ONLY'],
        [10000000, 'ONE LAKH ONLY'], [1000000000, 'ONE CRORE ONLY']
    ])('spells net pay %s exactly including paise', (value, words) => {
        expect(amountInWords(value)).toBe(words);
    });

    test('shows full components, incentives, joining proration and LOP without changing net', () => {
        const model = buildPayslipModel(employee, payroll({
            effectiveGross: 22500, monthlyIncentive: 2000, dailyBonusTotal: 500,
            totalEarnings: 25000, totalDeductions: 1500, unpaidLeaveDeduction: 750,
            lateAttendanceDeduction: 750, lopDays: 1, netSalary: 23500
        }), 5, 2026);
        expect(model.earnings.map(row => row.amount)).toEqual([2250000, 900000, 1350000, 200000, 50000]);
        expect(model.deductions).toEqual([
            { label: 'Joining-month Proration', amount: 2250000 },
            { label: 'Loss of Pay / LWP (1.00 Days)', amount: 150000 }
        ]);
        expect(model.totalEarnings - model.totalDeductions).toBe(model.net);
        expect(model.payableDays).toBe('14.00');
        expect(model.lwp).toBe('1.00');
    });

    test('preserves paise, handles zero net floor, and does not fabricate legacy components or days', () => {
        const legacy = buildPayslipModel(employee, {
            grossSalary: 20021.99, totalDeductions: 21.99, netSalary: 20000
        }, 10, 2026);
        expect(legacy.earnings).toEqual([{ label: 'Gross Salary', amount: 2002199 }]);
        expect(legacy.deductions).toEqual([{ label: 'Other Deductions', amount: 2199 }]);
        expect(legacy.payableDays).toBe('-');
        const zero = buildPayslipModel(employee, payroll({ totalDeductions: 50000, unpaidLeaveDeduction: 50000, netSalary: 0 }), 5, 2026);
        expect(zero.netWords).toBe('ZERO ONLY');
        expect(zero.notes).toContain('Net pay is floored at zero.');
    });

    test.each([
        { netSalary: 100 }, { totalDeductions: null }, { salaryComponents: calculate(50000) },
        { unpaidLeaveDeduction: 20000 }, { totalEarnings: 100 }
    ])('rejects inconsistent or missing saved payroll: %s', overrides => {
        expect(() => buildPayslipModel(employee, payroll(overrides), 5, 2026)).toThrow();
    });

    test('uses immutable employee snapshot and safe attachment name', () => {
        const model = buildPayslipModel(employee, payroll({
            payslipEmployee: { id: 11, name: 'Recorded / Name\r\n', position: 'Recorded Role' }
        }), 5, 2026);
        expect(model.employee.position).toBe('Recorded Role');
        expect(payslipFilename(model)).toBe('Payslip_Recorded_Name_May_2026.pdf');
        expect(model.notes.join(' ')).not.toContain('current profile');
    });

    test('generates one A4 page with sample headings, logo, amounts, employee fields and disclaimer', async () => {
        const model = buildPayslipModel(employee, payroll(), 5, 2026);
        const pdf = await createPayslipPdf(model);
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        const text = readPdf(pdf);
        expect(text.total).toBe(1);
        for (const phrase of ['DegreeDrishti', 'Plot No- D22, Sector 3, Noida 201301',
            'Pay Slip for the month of May 2026', 'Emp Code', 'Sample Employee', 'Assistant Team Leader',
            '23 May 1999', 'ABCDE1234F', 'Payable Days', 'LWP', 'Arrear Days',
            'Earnings', 'Deductions', 'Description', 'Monthly', 'Amount',
            'Basic Salary', '22,500.00', '9,000.00', '13,500.00', '19,667.00',
            'GROSS EARNINGS', 'TOTAL DEDUCTIONS', 'Loss of Pay / LWP (13.55 Days)', 'Net Pay', '25,333.00', model.netWords,
            'Disclaimer: This is a system generated payslip, does not require any signature.']) {
            expect(text.text).toContain(phrase);
        }
        expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
        expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    });

    test('fits long net-pay words and extra earnings in one page', async () => {
        const model = buildPayslipModel(employee, payroll({
            grossSalary: 9999999.99, effectiveGross: 9999999.99, salaryComponents: calculate(9999999.99),
            netSalary: 10002499.99, totalEarnings: 10002499.99,
            monthlyIncentive: 2000, dailyBonusTotal: 500, totalDeductions: 0,
            unpaidLeaveDeduction: 0, lopDays: 0
        }), 10, 2026);
        const result = readPdf(await createPayslipPdf(model));
        expect(result.total).toBe(1);
        expect(result.text.replace(/\s+/g, ' ')).toContain(model.netWords);
    });

    test('preserves existing 31-day joining-month payroll without capping its saved earnings', () => {
        const model = buildPayslipModel(employee, payroll({
            grossSalary: 30000, effectiveGross: 31000, totalEarnings: 31000,
            salaryComponents: calculate(30000), totalDeductions: 0, unpaidLeaveDeduction: 0,
            netSalary: 31000, dailyRate: 1000, lopDays: 0
        }), 5, 2026);
        expect(model.earnings.at(-1)).toEqual({ label: 'Joining-month Adjustment', amount: 100000 });
        expect(model.totalEarnings).toBe(3100000);
        expect(model.payableDays).toBe('31.00');
    });

    test('uses the existing aggregate LOP amount without duplicating deductions', () => {
        const model = buildPayslipModel(employee, payroll({
            lopDeduction: 19667, unpaidLeaveDeduction: undefined, lateAttendanceDeduction: undefined
        }), 5, 2026);
        expect(model.deductions).toEqual([{ label: 'Loss of Pay / LWP (13.55 Days)', amount: 1966700 }]);
        expect(model.totalDeductions).toBe(1966700);
        expect(model.net).toBe(2533300);
    });

    test('zero LOP is visible and contradictory saved LOP is rejected', () => {
        const model = buildPayslipModel(employee, payroll({
            lopDays: 0, lopDeduction: 0, unpaidLeaveDeduction: 0, totalDeductions: 0, netSalary: 45000
        }), 5, 2026);
        expect(model.deductions).toEqual([{ label: 'Loss of Pay / LWP (0.00 Days)', amount: 0 }]);
        expect(() => buildPayslipModel(employee, payroll({ lopDeduction: 100 }), 5, 2026)).toThrow('Saved LOP does not match');
        expect(() => buildPayslipModel(employee, payroll({
            lopDeduction: 20000, unpaidLeaveDeduction: undefined, lateAttendanceDeduction: undefined
        }), 5, 2026)).toThrow('exceed total deductions');
    });
});
