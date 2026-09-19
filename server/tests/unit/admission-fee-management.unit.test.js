const {
    calculateFeeManagement,
    normalizeAdmissionFeeManagement,
    buildLegacyFeeManagement,
    getInstallmentCount
} = require('../../utils/admission-fee-management');

describe('Unit: admission-fee-management', () => {
    test('one-time admissions create a single installment summary', () => {
        const feeManagement = normalizeAdmissionFeeManagement({
            admissionType: 'one-time',
            discountType: 'whole-fees',
            duration: 1,
            actualFees: 50000,
            discountPercent: 10
        }, { revenue: 50000 });

        expect(getInstallmentCount(feeManagement.admissionType, feeManagement.duration)).toBe(1);
        expect(feeManagement.installments).toHaveLength(1);
        expect(feeManagement.summary.actualFees).toBe(50000);
        expect(feeManagement.summary.totalFeesPayable).toBe(45000);
        expect(feeManagement.summary.totalDiscount).toBe(5000);
        expect(feeManagement.summary.outstandingFees).toBe(45000);
    });

    test('yearly admissions apply independent year discounts', () => {
        const feeManagement = calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'yearly',
            duration: 3,
            actualFees: 90000,
            installmentDiscounts: {
                1: 10,
                2: 20,
                3: 0
            }
        }, { revenue: 90000 });

        expect(feeManagement.installments).toHaveLength(3);
        expect(feeManagement.installments[0].installmentName).toBe('Year 1');
        expect(feeManagement.installments[2].installmentName).toBe('Year 3');
        expect(feeManagement.installments[0].calculatedFees).toBe(27000);
        expect(feeManagement.installments[1].calculatedFees).toBe(24000);
        expect(feeManagement.installments[2].calculatedFees).toBe(30000);
    });

    test('semester admissions support duration times two installments with independent semester discounts', () => {
        const feeManagement = calculateFeeManagement({
            admissionType: 'semester-wise',
            discountType: 'semester',
            duration: 2,
            actualFees: 120000,
            installmentDiscounts: {
                1: 0,
                2: 5,
                3: 10,
                4: 15
            }
        }, { revenue: 120000 });

        expect(feeManagement.installments).toHaveLength(4);
        expect(feeManagement.installments[1].installmentName).toBe('Semester 2');
        expect(feeManagement.installments[3].yearNumber).toBe(2);
        expect(feeManagement.summary.totalFeesPayable).toBe(111000);
        expect(feeManagement.summary.totalDiscount).toBe(9000);
    });

    test('whole-fee discount distributes equally to all pending installments', () => {
        const feeManagement = calculateFeeManagement({
            admissionType: 'semester-wise',
            discountType: 'whole-fees',
            duration: 2,
            totalFees: 100000,
            discountPercent: 10
        });

        const calculated = feeManagement.installments.map((item) => item.calculatedFees);
        expect(calculated).toEqual([22500, 22500, 22500, 22500]);
        expect(feeManagement.summary.totalFeesPayable).toBe(90000);
    });

    test('paid installments never change while pending installments recalculate', () => {
        const firstPass = calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'whole-fees',
            duration: 3,
            totalFees: 90000,
            discountPercent: 10
        });

        const withPaid = firstPass.installments.map((item, index) => (
            index === 0
                ? {
                    ...item,
                    status: 'paid',
                    remainingFees: 0,
                    feesPaid: item.calculatedFees
                }
                : item
        ));

        const secondPass = calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'whole-fees',
            duration: 3,
            totalFees: 90000,
            discountPercent: 20,
            installments: withPaid
        });

        expect(secondPass.installments[0].calculatedFees).toBe(withPaid[0].calculatedFees);
        expect(secondPass.installments[0].status).toBe('paid');
        expect(secondPass.installments[1].calculatedFees).toBe(24000);
        expect(secondPass.installments[2].calculatedFees).toBe(24000);
    });

    test('legacy revenue-only admissions backfill with review marker for non one-time types', () => {
        const feeManagement = buildLegacyFeeManagement({
            admissionType: 'annual',
            revenue: 30000
        });

        expect(feeManagement.summary.actualFees).toBe(30000);
        expect(feeManagement.legacyMigration.migratedFromRevenueOnly).toBe(true);
        expect(feeManagement.legacyMigration.requiresReview).toBe(true);
        expect(feeManagement.installments).toHaveLength(1);
    });

    test('invalid installment counts are rejected', () => {
        expect(() => calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'yearly',
            duration: 2,
            actualFees: 60000,
            installments: [{ installmentNumber: 1 }]
        }, { revenue: 60000 })).toThrow('exactly 2 installment(s)');
    });

    test('one-time admissions reject yearly or semester discount types', () => {
        expect(() => calculateFeeManagement({
            admissionType: 'one-time',
            discountType: 'yearly',
            duration: 1,
            actualFees: 30000
        }, { revenue: 30000 })).toThrow("not allowed for admission type 'one-time'");

        expect(() => calculateFeeManagement({
            admissionType: 'one-time',
            discountType: 'semester',
            duration: 1,
            actualFees: 30000
        }, { revenue: 30000 })).toThrow("not allowed for admission type 'one-time'");
    });

    test('yearly admissions reject semester discount type', () => {
        expect(() => calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'semester',
            duration: 2,
            actualFees: 80000
        }, { revenue: 80000 })).toThrow("not allowed for admission type 'yearly'");
    });

    test('semester-wise admissions reject yearly discount type', () => {
        expect(() => calculateFeeManagement({
            admissionType: 'semester-wise',
            discountType: 'yearly',
            duration: 2,
            actualFees: 80000
        }, { revenue: 80000 })).toThrow("not allowed for admission type 'semester-wise'");
    });

    test('pending installments do not retain partial payment values', () => {
        const feeManagement = calculateFeeManagement({
            admissionType: 'yearly',
            discountType: 'whole-fees',
            duration: 3,
            totalFees: 90000,
            discountPercent: 10,
            installments: [
                {
                    installmentNumber: 1,
                    status: 'pending',
                    originalFees: 30000,
                    calculatedFees: 27000,
                    remainingFees: 12000,
                    feesPaid: 15000
                },
                {
                    installmentNumber: 2,
                    status: 'pending',
                    originalFees: 30000,
                    calculatedFees: 27000,
                    remainingFees: 27000,
                    feesPaid: 0
                },
                {
                    installmentNumber: 3,
                    status: 'pending',
                    originalFees: 30000,
                    calculatedFees: 27000,
                    remainingFees: 27000,
                    feesPaid: 0
                }
            ]
        }, { revenue: 90000 });

        expect(feeManagement.installments[0].status).toBe('pending');
        expect(feeManagement.installments[0].feesPaid).toBe(0);
        expect(feeManagement.installments[0].remainingFees).toBe(feeManagement.installments[0].calculatedFees);
        expect(feeManagement.summary.feesPaid).toBe(0);
    });
});