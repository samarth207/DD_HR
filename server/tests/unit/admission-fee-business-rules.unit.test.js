const {
    calculateFeeManagement,
    normalizeAdmissionFeeManagement,
    buildLegacyFeeManagement,
    ADMISSION_TYPE,
    DISCOUNT_TYPE
} = require('../../utils/admission-fee-management');

describe('Unit: admission fee business rules', () => {
    test('one-time supports whole-fees only and generates exactly one installment', () => {
        const fee = normalizeAdmissionFeeManagement({
            admissionType: ADMISSION_TYPE.ONE_TIME,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 1,
            totalFees: 50000,
            discountPercent: 10
        });

        expect(fee.admissionType).toBe('one-time');
        expect(fee.discountType).toBe('whole-fees');
        expect(fee.installments).toHaveLength(1);
        expect(fee.summary.actualFees).toBe(50000);
        expect(fee.summary.totalDiscount).toBe(5000);
        expect(fee.summary.totalFeesPayable).toBe(45000);
        expect(fee.summary.outstandingFees).toBe(45000);
    });

    test('yearly supports whole-fees and yearly discount types', () => {
        const whole = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 3,
            totalFees: 90000,
            discountPercent: 10
        });
        expect(whole.installments).toHaveLength(3);
        expect(whole.summary.totalFeesPayable).toBe(81000);

        const yearly = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.YEARLY,
            duration: 3,
            totalFees: 90000,
            installmentDiscounts: { 1: 10, 2: 20, 3: 0 }
        });
        expect(yearly.installments[0].installmentName).toBe('Year 1');
        expect(yearly.installments[1].installmentName).toBe('Year 2');
        expect(yearly.installments[2].installmentName).toBe('Year 3');
    });

    test('semester-wise supports whole-fees and semester discount types with duration*2 installments', () => {
        const whole = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.SEMESTER,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 2,
            totalFees: 100000,
            discountPercent: 10
        });
        expect(whole.installments).toHaveLength(4);
        expect(whole.installments[0].installmentName).toBe('Semester 1');
        expect(whole.installments[3].installmentName).toBe('Semester 4');

        const semester = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.SEMESTER,
            discountType: DISCOUNT_TYPE.SEMESTER,
            duration: 2,
            totalFees: 100000,
            installmentDiscounts: { 1: 0, 2: 5, 3: 10, 4: 15 }
        });

        expect(semester.installments).toHaveLength(4);
        expect(semester.summary.totalDiscount).toBeGreaterThan(0);
        expect(semester.summary.outstandingFees).toBe(semester.summary.totalFeesPayable);
    });

    test('invalid admissionType-discountType combinations are rejected', () => {
        expect(() => calculateFeeManagement({
            admissionType: ADMISSION_TYPE.ONE_TIME,
            discountType: DISCOUNT_TYPE.YEARLY,
            duration: 1,
            totalFees: 10000
        })).toThrow("not allowed for admission type 'one-time'");

        expect(() => calculateFeeManagement({
            admissionType: ADMISSION_TYPE.ONE_TIME,
            discountType: DISCOUNT_TYPE.SEMESTER,
            duration: 1,
            totalFees: 10000
        })).toThrow("not allowed for admission type 'one-time'");

        expect(() => calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.SEMESTER,
            duration: 2,
            totalFees: 20000
        })).toThrow("not allowed for admission type 'yearly'");

        expect(() => calculateFeeManagement({
            admissionType: ADMISSION_TYPE.SEMESTER,
            discountType: DISCOUNT_TYPE.YEARLY,
            duration: 2,
            totalFees: 20000
        })).toThrow("not allowed for admission type 'semester-wise'");
    });

    test('summary calculation keeps outstanding in sync with pending installments', () => {
        const first = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 3,
            totalFees: 90000,
            discountPercent: 10
        });

        const paidInstallments = first.installments.map((row, idx) => (
            idx === 0
                ? { ...row, status: 'paid', feesPaid: row.calculatedFees, remainingFees: 0 }
                : row
        ));

        const next = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 3,
            totalFees: 90000,
            discountPercent: 20,
            installments: paidInstallments
        });

        expect(next.installments[0].status).toBe('paid');
        expect(next.installments[0].calculatedFees).toBe(paidInstallments[0].calculatedFees);
        expect(next.summary.feesPaid).toBe(next.installments[0].calculatedFees);
        expect(next.summary.outstandingFees).toBe(
            next.installments[1].remainingFees + next.installments[2].remainingFees
        );
    });

    test('pending installment edit recalculates while paid installment remains locked', () => {
        const base = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.SEMESTER,
            discountType: DISCOUNT_TYPE.SEMESTER,
            duration: 2,
            totalFees: 120000,
            installmentDiscounts: { 1: 0, 2: 0, 3: 0, 4: 0 }
        });

        const withPaid = base.installments.map((item, index) => (
            index === 1
                ? { ...item, status: 'paid', feesPaid: item.calculatedFees, remainingFees: 0 }
                : item
        ));

        const edited = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.SEMESTER,
            discountType: DISCOUNT_TYPE.SEMESTER,
            duration: 2,
            totalFees: 120000,
            installmentDiscounts: { 1: 10, 2: 40, 3: 20, 4: 30 },
            installments: withPaid
        });

        expect(edited.installments[1].status).toBe('paid');
        expect(edited.installments[1].calculatedFees).toBe(withPaid[1].calculatedFees);
        expect(edited.installments[0].calculatedFees).not.toBe(base.installments[0].calculatedFees);
    });

    test('legacy migration preserves compatibility and produces feeManagement summary', () => {
        const migrated = buildLegacyFeeManagement({
            admissionType: 'annual',
            revenue: 60000
        });

        expect(migrated.admissionType).toBe('yearly');
        expect(migrated.summary.actualFees).toBe(60000);
        expect(migrated.summary.totalFeesPayable).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(migrated.installments)).toBe(true);
        expect(migrated.legacyMigration.migratedFromRevenueOnly).toBe(true);
    });

    test('edge case: duration is normalized to integer for non one-time admissions', () => {
        const fee = calculateFeeManagement({
            admissionType: ADMISSION_TYPE.YEARLY,
            discountType: DISCOUNT_TYPE.WHOLE_FEES,
            duration: 2.9,
            totalFees: 100000,
            discountPercent: 10
        });

        expect(fee.duration).toBe(2);
        expect(fee.installments).toHaveLength(2);
    });
});
