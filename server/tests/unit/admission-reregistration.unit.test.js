const {
    normalizeReRegistrationConfig,
    generateReRegistrationPeriods,
    buildLiveFeePeriodSchedule
} = require('../../utils/admission-reregistration');

describe('Unit: admission re-registration periods', () => {
    test('generates yearly periods with configured applicability and fee overrides', () => {
        const periods = generateReRegistrationPeriods({
            duration: 3,
            reRegistration: {
                type: 'yearly',
                periodFee: 12000,
                applicablePeriods: [1, 3],
                periodFeeOverrides: [{ periodNumber: 3, fee: 15000 }]
            }
        });

        expect(periods).toHaveLength(3);
        expect(periods.map((period) => period.status)).toEqual(['pending', 'na', 'pending']);
        expect(periods[0].applicableFee).toBe(12000);
        expect(periods[1].applicableFee).toBe(0);
        expect(periods[2].applicableFee).toBe(15000);
    });

    test('generates semester periods using the configured number per academic year', () => {
        const periods = generateReRegistrationPeriods({
            duration: 2,
            reRegistration: {
                type: 'semester-wise',
                semestersPerAcademicYear: 3,
                periodFee: 5000
            }
        });

        expect(periods).toHaveLength(6);
        expect(periods.map((period) => period.academicYearNumber)).toEqual([1, 1, 1, 2, 2, 2]);
        expect(periods.map((period) => period.semesterNumber)).toEqual([1, 2, 3, 1, 2, 3]);
    });

    test('period counts scale with yearly and semester course durations', () => {
        const yearlyOne = generateReRegistrationPeriods({
            duration: 1,
            reRegistration: { type: 'yearly', periodFee: 10000 }
        });
        const yearlyFour = generateReRegistrationPeriods({
            duration: 4,
            reRegistration: { type: 'yearly', periodFee: 10000 }
        });
        const semesterOne = generateReRegistrationPeriods({
            duration: 1,
            reRegistration: { type: 'semester-wise', semestersPerAcademicYear: 2, periodFee: 5000 }
        });
        const semesterFour = generateReRegistrationPeriods({
            duration: 4,
            reRegistration: { type: 'semester-wise', semestersPerAcademicYear: 2, periodFee: 5000 }
        });

        expect(yearlyOne).toHaveLength(1);
        expect(yearlyFour).toHaveLength(4);
        expect(semesterOne).toHaveLength(2);
        expect(semesterFour).toHaveLength(8);
    });

    test('projects period fees and payment status from saved feeManagement installments', () => {
        const schedule = buildLiveFeePeriodSchedule({
            admissionType: 'semester-wise',
            courseDuration: 2,
            courseReRegistrationSnapshot: {
                duration: 2,
                reRegistration: {
                    type: 'semester-wise',
                    semestersPerAcademicYear: 2,
                    applicablePeriods: [1, 2, 4]
                }
            },
            feeManagement: {
                admissionType: 'semester-wise',
                duration: 2,
                installments: [
                    { installmentNumber: 1, originalFees: 20000, calculatedFees: 20000, feesPaid: 20000, remainingFees: 0, status: 'paid' },
                    { installmentNumber: 2, originalFees: 20000, calculatedFees: 20000, feesPaid: 5000, remainingFees: 15000, status: 'pending' },
                    { installmentNumber: 3, originalFees: 20000, calculatedFees: 20000, feesPaid: 0, remainingFees: 0, status: 'paid' },
                    { installmentNumber: 4, originalFees: 20000, calculatedFees: 20000, feesPaid: 0, remainingFees: 20000, status: 'pending' }
                ]
            }
        });

        expect(schedule.reRegistrationType).toBe('semester-wise');
        expect(schedule.periods.map((period) => period.status)).toEqual(['paid', 'unpaid', 'na', 'unpaid']);
        expect(schedule.periods.map((period) => period.applicableFee)).toEqual([20000, 20000, 0, 20000]);
        expect(schedule.summary.applicableFees).toBe(60000);
        expect(schedule.summary.paidAmount).toBe(20000);
        expect(schedule.summary.pendingAmount).toBe(40000);
    });

    test('does not infer re-registration cadence from admission type without a course snapshot', () => {
        const schedule = buildLiveFeePeriodSchedule({
            admissionType: 'semester-wise',
            feeManagement: {
                admissionType: 'semester-wise',
                duration: 2,
                installments: [
                    { installmentNumber: 1, calculatedFees: 10000, feesPaid: 10000, remainingFees: 0, status: 'paid' },
                    { installmentNumber: 2, calculatedFees: 10000, feesPaid: 0, remainingFees: 10000, status: 'pending' },
                    { installmentNumber: 3, calculatedFees: 10000, feesPaid: 0, remainingFees: 10000, status: 'pending' },
                    { installmentNumber: 4, calculatedFees: 10000, feesPaid: 0, remainingFees: 10000, status: 'pending' }
                ]
            }
        });

        expect(schedule.reRegistrationType).toBeNull();
        expect(schedule.periods).toHaveLength(0);
        expect(schedule.configurationError).toMatch(/configuration is missing/);
    });

    test('rejects missing semester configuration and duplicate period values', () => {
        expect(() => normalizeReRegistrationConfig({ type: 'semester-wise', periodFee: 10 }, 2))
            .toThrow(/semestersPerAcademicYear/);
        expect(() => normalizeReRegistrationConfig({
            type: 'yearly', periodFee: 10, applicablePeriods: [1, 1]
        }, 2)).toThrow(/Duplicate applicable period/);
    });
});