const {
    getAdmissionMonthKey,
    extractInstallments,
    summarizeInstallments,
    buildFeeReportMetrics,
    buildFeeMonthlySeries,
    buildFeeTypeSeries
} = require('../../../fee-reporting-utils');

describe('Unit: fee reporting utils', () => {
    const admissions = [
        {
            month: '2026-08',
            customerName: 'A',
            admissionType: 'yearly',
            feeManagement: {
                installments: [
                    { installmentNumber: 1, originalFees: 50000, calculatedFees: 45000, feesPaid: 15000, remainingFees: 30000, status: 'pending' },
                    { installmentNumber: 2, originalFees: 50000, calculatedFees: 40000, feesPaid: 40000, remainingFees: 0, status: 'paid' }
                ]
            }
        },
        {
            month: '2026-08',
            customerName: 'B',
            admissionType: 'one-time',
            feeManagement: {
                installments: [
                    { installmentNumber: 1, originalFees: 30000, calculatedFees: 30000, feesPaid: 0, remainingFees: 30000, status: 'pending' }
                ]
            }
        },
        {
            admissionDate: '2026-07-15',
            customerName: 'Legacy',
            revenue: 20000
        }
    ];

    test('extracts month key from month field and admissionDate fallback', () => {
        expect(getAdmissionMonthKey(admissions[0])).toBe('2026-08');
        expect(getAdmissionMonthKey(admissions[2])).toBe('2026-07');
    });

    test('extractInstallments falls back to revenue-only record', () => {
        const rows = extractInstallments(admissions[2]);
        expect(rows).toHaveLength(1);
        expect(rows[0].calculatedFees).toBe(20000);
        expect(rows[0].remainingFees).toBe(20000);
    });

    test('summarizes outstanding, collected, discount and pending', () => {
        const rows = extractInstallments(admissions[0]);
        const summary = summarizeInstallments(rows);

        expect(summary.collected).toBe(55000);
        expect(summary.outstanding).toBe(30000);
        expect(summary.discount).toBe(15000);
        expect(summary.pendingCount).toBe(1);
    });

    test('builds fee report metrics by month filter', () => {
        const metrics = buildFeeReportMetrics(admissions, { month: '2026-08' });

        expect(metrics.admissionsCount).toBe(2);
        expect(metrics.installmentsCount).toBe(3);
        expect(metrics.collected).toBe(55000);
        expect(metrics.outstanding).toBe(60000);
        expect(metrics.discount).toBe(15000);
        expect(metrics.pending).toBe(2);
    });

    test('buildFeeMonthlySeries creates sorted monthly rollups', () => {
        const series = buildFeeMonthlySeries(admissions);
        expect(series).toHaveLength(2);
        expect(series[0].month).toBe('2026-07');
        expect(series[1].month).toBe('2026-08');
    });

    test('buildFeeTypeSeries aggregates by admission type', () => {
        const byType = buildFeeTypeSeries(admissions);
        const yearly = byType.find((row) => row.type === 'yearly');
        const oneTime = byType.find((row) => row.type === 'one-time');

        expect(yearly).toBeTruthy();
        expect(oneTime).toBeTruthy();
        expect(yearly.discount).toBe(15000);
        expect(oneTime.outstanding).toBe(30000);
    });
});
