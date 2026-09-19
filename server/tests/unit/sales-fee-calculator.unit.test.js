const {
    normalizeAdmissionType,
    getInstallmentCount,
    validateLiveFeeInput,
    calculateSummaryFromInstallments,
    buildLiveFeeCalculation
} = require('../../../sales-fee-calculator');

describe('Unit: sales live fee calculator', () => {
    test('normalizes legacy admission type aliases', () => {
        expect(normalizeAdmissionType('annual')).toBe('yearly');
        expect(normalizeAdmissionType('semester')).toBe('semester-wise');
        expect(normalizeAdmissionType('one time')).toBe('one-time');
    });

    test('computes installment counts from admission type and duration', () => {
        expect(getInstallmentCount('one-time', 3)).toBe(1);
        expect(getInstallmentCount('yearly', 3)).toBe(3);
        expect(getInstallmentCount('semester-wise', 2)).toBe(4);
    });

    test('regenerates one-time summary with whole-fees discount', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'one-time',
            discountType: 'whole-fees',
            discountPercent: 10,
            duration: 1,
            totalFees: 50000
        });

        expect(result.installments).toHaveLength(1);
        expect(result.summary.actualFees).toBe(50000);
        expect(result.summary.totalDiscount).toBe(5000);
        expect(result.summary.totalFeesPayable).toBe(45000);
    });

    test('one-time generates exactly 1 row with default discount and pending status', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'one-time',
            discountType: 'whole-fees',
            duration: 1,
            totalFees: 12000
        });

        expect(result.installments).toHaveLength(1);
        expect(result.installments[0].discountPercent).toBe(0);
        expect(result.installments[0].status).toBe('pending');
    });

    test('regenerates yearly calculation when duration or fees change', () => {
        const first = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 5,
            duration: 2,
            totalFees: 100000
        });

        const second = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 5,
            duration: 4,
            totalFees: 120000
        });

        expect(first.installments).toHaveLength(2);
        expect(second.installments).toHaveLength(4);
        expect(first.summary.totalFeesPayable).toBe(95000);
        expect(second.summary.totalFeesPayable).toBe(114000);
    });

    test('yearly generates N rows with default discount and pending status', () => {
        const duration = 5;
        const result = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            duration,
            totalFees: 200000
        });

        expect(result.installments).toHaveLength(duration);
        expect(result.installments.every((item) => item.discountPercent === 0)).toBe(true);
        expect(result.installments.every((item) => item.status === 'pending')).toBe(true);
    });

    test('yearly accepts installment-specific discount map and recalculates only the targeted year', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            duration: 3,
            totalFees: 90000,
            installmentDiscounts: { 1: 10, 2: 20, 3: 0 }
        });

        expect(result.installments).toHaveLength(3);
        expect(result.installments[0].calculatedFees).toBe(27000);
        expect(result.installments[1].calculatedFees).toBe(24000);
        expect(result.installments[2].calculatedFees).toBe(30000);
        expect(result.summary.totalFeesPayable).toBe(81000);
    });

    test('regenerates semester schedule instantly on admission type change', () => {
        const yearly = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 0,
            duration: 3,
            totalFees: 90000
        });

        const semesterWise = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            discountPercent: 0,
            duration: 3,
            totalFees: 90000
        });

        expect(yearly.installments).toHaveLength(3);
        expect(semesterWise.installments).toHaveLength(6);
        expect(semesterWise.installments[0].installmentName).toBe('Semester 1');
        expect(semesterWise.installments[5].installmentName).toBe('Semester 6');
    });

    test('semester-wise generates 2N rows with default discount and pending status', () => {
        const duration = 4;
        const result = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            duration,
            totalFees: 160000
        });

        expect(result.installments).toHaveLength(duration * 2);
        expect(result.installments.every((item) => item.discountPercent === 0)).toBe(true);
        expect(result.installments.every((item) => item.status === 'pending')).toBe(true);
    });

    test('semester-wise accepts installment-specific discount map and only changes the edited semester', () => {
        const baseline = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            duration: 2,
            totalFees: 120000,
            installmentDiscounts: { 1: 0, 2: 5, 3: 10, 4: 15 }
        });

        const changed = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            duration: 2,
            totalFees: 120000,
            installmentDiscounts: { 1: 0, 2: 10, 3: 10, 4: 15 }
        });

        expect(baseline.installments).toHaveLength(4);
        expect(baseline.installments[0].calculatedFees).toBe(30000);
        expect(baseline.installments[1].calculatedFees).toBe(28500);
        expect(baseline.installments[2].calculatedFees).toBe(27000);
        expect(baseline.installments[3].calculatedFees).toBe(25500);
        expect(changed.installments[0].calculatedFees).toBe(baseline.installments[0].calculatedFees);
        expect(changed.installments[1].calculatedFees).not.toBe(baseline.installments[1].calculatedFees);
        expect(changed.installments[2].calculatedFees).toBe(baseline.installments[2].calculatedFees);
        expect(changed.installments[3].calculatedFees).toBe(baseline.installments[3].calculatedFees);
    });

    test('invalid discount percent is rejected by validation engine', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 250,
            duration: 2,
            totalFees: 80000
        });

        expect(result.validation.isValid).toBe(false);
        expect(result.validation.errors.join(' ')).toMatch(/between 0 and 100/i);
        expect(result.installments).toHaveLength(0);
        expect(result.summary.actualFees).toBe(80000);
        expect(result.summary.totalFeesPayable).toBe(0);
    });

    test('summary engine calculates actual, discount, payable, paid, and outstanding', () => {
        const summary = calculateSummaryFromInstallments(100000, [
            {
                originalFees: 50000,
                calculatedFees: 45000,
                feesPaid: 10000,
                remainingFees: 35000
            },
            {
                originalFees: 50000,
                calculatedFees: 40000,
                feesPaid: 5000,
                remainingFees: 35000
            }
        ]);

        expect(summary.actualFees).toBe(100000);
        expect(summary.totalDiscount).toBe(15000);
        expect(summary.totalFeesPayable).toBe(85000);
        expect(summary.feesPaid).toBe(15000);
        expect(summary.outstandingFees).toBe(70000);
    });

    test('live build output includes read-only summary defaults for paid and outstanding', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            discountPercent: 0,
            duration: 2,
            totalFees: 120000
        });

        expect(result.summary.actualFees).toBe(120000);
        expect(result.summary.totalDiscount).toBe(0);
        expect(result.summary.totalFeesPayable).toBe(120000);
        expect(result.summary.feesPaid).toBe(0);
        expect(result.summary.outstandingFees).toBe(120000);
    });

    test('validation rejects discount outside 0-100 range', () => {
        const invalidLow = validateLiveFeeInput({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: -1,
            duration: 2,
            totalFees: 1000
        });

        const invalidHigh = validateLiveFeeInput({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 101,
            duration: 2,
            totalFees: 1000
        });

        expect(invalidLow.isValid).toBe(false);
        expect(invalidHigh.isValid).toBe(false);
        expect(invalidLow.errors.join(' ')).toMatch(/between 0 and 100/i);
        expect(invalidHigh.errors.join(' ')).toMatch(/between 0 and 100/i);
    });

    test('validation rejects non-positive fees', () => {
        const zeroFees = validateLiveFeeInput({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 0,
            duration: 2,
            totalFees: 0
        });

        const negativeFees = validateLiveFeeInput({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 0,
            duration: 2,
            totalFees: -100
        });

        expect(zeroFees.isValid).toBe(false);
        expect(negativeFees.isValid).toBe(false);
        expect(zeroFees.errors.join(' ')).toMatch(/fees must be a positive number/i);
    });

    test('validation rejects non-positive duration for non one-time admission', () => {
        const zeroDuration = validateLiveFeeInput({
            admissionType: 'yearly',
            discountType: 'yearly',
            discountPercent: 0,
            duration: 0,
            totalFees: 1000
        });

        expect(zeroDuration.isValid).toBe(false);
        expect(zeroDuration.errors.join(' ')).toMatch(/duration must be a positive number/i);
    });

    test('validation blocks one-time with semester or yearly discount', () => {
        const withSemester = validateLiveFeeInput({
            admissionType: 'one-time',
            discountType: 'semester',
            discountPercent: 0,
            duration: 1,
            totalFees: 1000
        });

        const withYearly = validateLiveFeeInput({
            admissionType: 'one-time',
            discountType: 'yearly',
            discountPercent: 0,
            duration: 1,
            totalFees: 1000
        });

        expect(withSemester.isValid).toBe(false);
        expect(withYearly.isValid).toBe(false);
        expect(withSemester.errors.join(' ')).toMatch(/one-time admission type cannot use yearly or semester discount/i);
    });

    test('invalid combinations produce no installment rows', () => {
        const invalid = buildLiveFeeCalculation({
            admissionType: 'one-time',
            discountType: 'yearly',
            discountPercent: 10,
            duration: 1,
            totalFees: 50000
        });

        expect(invalid.validation.isValid).toBe(false);
        expect(invalid.installments).toHaveLength(0);
    });

    test('installment numbers are unique to avoid duplicate calculations/rows', () => {
        const result = buildLiveFeeCalculation({
            admissionType: 'semester-wise',
            discountType: 'semester',
            discountPercent: 5,
            duration: 3,
            totalFees: 150000
        });

        const numbers = result.installments.map((item) => item.installmentNumber);
        const unique = new Set(numbers);
        expect(unique.size).toBe(numbers.length);
    });
});
