const INSTALLMENT_STATUS = {
    PENDING: 'pending',
    PAID: 'paid'
};

const ADMISSION_TYPE = {
    ONE_TIME: 'one-time',
    YEARLY: 'yearly',
    SEMESTER: 'semester-wise'
};

const DISCOUNT_TYPE = {
    WHOLE_FEES: 'whole-fees',
    YEARLY: 'yearly',
    SEMESTER: 'semester'
};

const SUPPORTED_ADMISSION_TYPES = new Set([
    ADMISSION_TYPE.ONE_TIME,
    ADMISSION_TYPE.YEARLY,
    ADMISSION_TYPE.SEMESTER,
    'annual',
    'semester',
    'one time',
    'onetime'
]);

const SUPPORTED_DISCOUNT_TYPES = new Set([
    DISCOUNT_TYPE.WHOLE_FEES,
    DISCOUNT_TYPE.YEARLY,
    DISCOUNT_TYPE.SEMESTER,
    'whole fee',
    'wholefees'
]);

const DISCOUNT_COMPATIBILITY = {
    [ADMISSION_TYPE.ONE_TIME]: new Set([DISCOUNT_TYPE.WHOLE_FEES]),
    [ADMISSION_TYPE.YEARLY]: new Set([DISCOUNT_TYPE.WHOLE_FEES, DISCOUNT_TYPE.YEARLY]),
    [ADMISSION_TYPE.SEMESTER]: new Set([DISCOUNT_TYPE.WHOLE_FEES, DISCOUNT_TYPE.SEMESTER])
};

function roundCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 100) / 100;
}

function clampDiscountPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > 100) return 100;
    return Math.round(num * 100) / 100;
}

function normalizeAdmissionType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'annual') return ADMISSION_TYPE.YEARLY;
    if (raw === 'semester') return ADMISSION_TYPE.SEMESTER;
    if (raw === 'one time' || raw === 'onetime') return ADMISSION_TYPE.ONE_TIME;
    return raw;
}

function normalizeDiscountType(value, admissionType) {
    const raw = String(value || '').trim().toLowerCase();

    if (!raw) {
        if (admissionType === ADMISSION_TYPE.YEARLY) return DISCOUNT_TYPE.YEARLY;
        if (admissionType === ADMISSION_TYPE.SEMESTER) return DISCOUNT_TYPE.SEMESTER;
        return DISCOUNT_TYPE.WHOLE_FEES;
    }

    if (raw === 'whole fee' || raw === 'wholefees') return DISCOUNT_TYPE.WHOLE_FEES;
    return raw;
}

function getInstallmentCount(admissionType, duration) {
    if (admissionType === ADMISSION_TYPE.ONE_TIME) return 1;
    if (admissionType === ADMISSION_TYPE.YEARLY) return duration;
    if (admissionType === ADMISSION_TYPE.SEMESTER) return duration * 2;
    throw new Error(`Unsupported admission type '${admissionType}'`);
}

function coerceDuration(value, admissionType) {
    if (admissionType === ADMISSION_TYPE.ONE_TIME) return 1;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getInstallmentLabel(admissionType, installmentNumber) {
    if (admissionType === ADMISSION_TYPE.ONE_TIME) return 'Installment 1';
    if (admissionType === ADMISSION_TYPE.YEARLY) return `Year ${installmentNumber}`;
    return `Semester ${installmentNumber}`;
}

function getYearNumber(admissionType, installmentNumber) {
    if (admissionType === ADMISSION_TYPE.ONE_TIME) return 1;
    if (admissionType === ADMISSION_TYPE.YEARLY) return installmentNumber;
    return Math.ceil(installmentNumber / 2);
}

function getSemesterNumber(admissionType, installmentNumber) {
    if (admissionType !== ADMISSION_TYPE.SEMESTER) return null;
    return installmentNumber;
}

function splitAmount(total, count) {
    if (count <= 0) return [];
    const totalRounded = roundCurrency(total);
    const base = roundCurrency(totalRounded / count);
    const parts = [];
    let consumed = 0;

    for (let i = 1; i <= count; i++) {
        if (i === count) {
            parts.push(roundCurrency(totalRounded - consumed));
        } else {
            parts.push(base);
            consumed = roundCurrency(consumed + base);
        }
    }

    return parts;
}

function normalizeInstallmentStatus(value) {
    return String(value || '').trim().toLowerCase() === INSTALLMENT_STATUS.PAID
        ? INSTALLMENT_STATUS.PAID
        : INSTALLMENT_STATUS.PENDING;
}

function getDiscountMap(input) {
    const map = new Map();
    if (!input) return map;

    if (Array.isArray(input)) {
        input.forEach((item) => {
            const key = Number(item?.installmentNumber ?? item?.yearNumber ?? item?.semesterNumber);
            if (!Number.isFinite(key) || key < 1) return;
            map.set(key, clampDiscountPercent(item?.discountPercent));
        });
        return map;
    }

    if (typeof input === 'object') {
        Object.entries(input).forEach(([rawKey, rawValue]) => {
            const key = Number(String(rawKey).replace(/[^0-9]/g, ''));
            if (!Number.isFinite(key) || key < 1) return;
            map.set(key, clampDiscountPercent(rawValue));
        });
    }

    return map;
}

function getExistingPaidAmount(installment) {
    const explicit = Number(installment?.feesPaid);
    if (Number.isFinite(explicit) && explicit >= 0) return roundCurrency(explicit);

    const calculated = roundCurrency(installment?.calculatedFees);
    const remaining = roundCurrency(installment?.remainingFees);
    const implicitPaid = roundCurrency(calculated - remaining);
    return Math.max(0, implicitPaid);
}

function buildInstallmentsSkeleton(admissionType, duration, totalFees) {
    const count = getInstallmentCount(admissionType, duration);
    const split = splitAmount(totalFees, count);

    return split.map((originalFees, index) => {
        const installmentNumber = index + 1;
        return {
            installmentNumber,
            installmentName: getInstallmentLabel(admissionType, installmentNumber),
            yearNumber: getYearNumber(admissionType, installmentNumber),
            semesterNumber: getSemesterNumber(admissionType, installmentNumber),
            discountPercent: 0,
            originalFees,
            calculatedFees: originalFees,
            remainingFees: originalFees,
            feesPaid: 0,
            status: INSTALLMENT_STATUS.PENDING
        };
    });
}

function deriveDiscountPercent({
    discountType,
    wholeDiscountPercent,
    discountMap,
    installment,
    existingInstallment,
    respectExplicitDiscount
}) {
    // If respectExplicitDiscount is true and the existing installment has an explicitly set discountPercent, respect it
    // This allows admins to correct mistakes by explicitly setting the discount in installments array
    if (respectExplicitDiscount && existingInstallment && existingInstallment.discountPercent !== undefined && existingInstallment.discountPercent !== null) {
        return clampDiscountPercent(existingInstallment.discountPercent);
    }

    if (discountType === DISCOUNT_TYPE.WHOLE_FEES) {
        return wholeDiscountPercent;
    }

    if (discountType === DISCOUNT_TYPE.YEARLY) {
        const yearKey = Number(installment.yearNumber);
        if (discountMap.has(yearKey)) return discountMap.get(yearKey);
        return clampDiscountPercent(existingInstallment?.discountPercent);
    }

    const semesterKey = Number(installment.semesterNumber || installment.installmentNumber);
    if (discountMap.has(semesterKey)) return discountMap.get(semesterKey);
    return clampDiscountPercent(existingInstallment?.discountPercent);
}

function recalculatePendingInstallment({ installment, discountPercent }) {
    const normalizedDiscount = clampDiscountPercent(discountPercent);
    const originalFees = roundCurrency(installment.originalFees);
    const calculatedFees = roundCurrency(originalFees * (1 - normalizedDiscount / 100));
    const feesPaid = 0;
    const remainingFees = calculatedFees;
    const status = INSTALLMENT_STATUS.PENDING;

    return {
        ...installment,
        discountPercent: normalizedDiscount,
        originalFees,
        calculatedFees,
        feesPaid,
        remainingFees,
        status
    };
}

function validateInstallmentCollection(installments, expectedCount) {
    if (!Array.isArray(installments) || installments.length !== expectedCount) {
        throw new Error(`feeManagement.installments must contain exactly ${expectedCount} installment(s)`);
    }
}

function normalizeExistingInstallment(source, fallback, admissionType) {
    const installmentNumber = fallback.installmentNumber;
    const status = normalizeInstallmentStatus(source?.status || fallback.status);
    const originalFees = roundCurrency(source?.originalFees ?? fallback.originalFees);
    const yearNumber = Number(source?.yearNumber);
    const semesterNumber = Number(source?.semesterNumber);

    return {
        installmentNumber,
        installmentName: String(source?.installmentName || fallback.installmentName || getInstallmentLabel(admissionType, installmentNumber)).trim(),
        yearNumber: Number.isFinite(yearNumber) ? yearNumber : fallback.yearNumber,
        semesterNumber: Number.isFinite(semesterNumber) ? semesterNumber : fallback.semesterNumber,
        discountPercent: clampDiscountPercent(source?.discountPercent ?? fallback.discountPercent),
        originalFees,
        calculatedFees: roundCurrency(source?.calculatedFees ?? fallback.calculatedFees),
        remainingFees: roundCurrency(source?.remainingFees ?? fallback.remainingFees),
        feesPaid: getExistingPaidAmount(source || fallback),
        status
    };
}

function buildSummary(totalFees, installments) {
    const actualFees = roundCurrency(totalFees);
    const totalDiscount = roundCurrency(
        installments.reduce((sum, item) => sum + (roundCurrency(item.originalFees) - roundCurrency(item.calculatedFees)), 0)
    );
    const totalFeesPayable = roundCurrency(
        installments.reduce((sum, item) => sum + roundCurrency(item.calculatedFees), 0)
    );
    const feesPaid = roundCurrency(
        installments.reduce((sum, item) => sum + Math.min(roundCurrency(item.feesPaid), roundCurrency(item.calculatedFees)), 0)
    );
    const outstandingFees = roundCurrency(
        installments.reduce((sum, item) => sum + Math.max(0, roundCurrency(item.remainingFees)), 0)
    );

    return {
        actualFees,
        totalDiscount,
        totalFeesPayable,
        feesPaid,
        outstandingFees
    };
}

function validateInstallmentValues(installment) {
    const discountPercent = clampDiscountPercent(installment.discountPercent);
    if (discountPercent !== installment.discountPercent) {
        throw new Error(`Installment ${installment.installmentNumber} has invalid discountPercent. Use a value between 0 and 100.`);
    }

    ['originalFees', 'calculatedFees', 'remainingFees', 'feesPaid'].forEach((field) => {
        const value = Number(installment[field]);
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Installment ${installment.installmentNumber} has invalid ${field}. Use a non-negative number.`);
        }
    });

    if (roundCurrency(installment.calculatedFees) > roundCurrency(installment.originalFees)) {
        throw new Error(`Installment ${installment.installmentNumber} cannot have calculatedFees greater than originalFees.`);
    }

    if (roundCurrency(installment.remainingFees) > roundCurrency(installment.calculatedFees)) {
        throw new Error(`Installment ${installment.installmentNumber} cannot have remainingFees greater than calculatedFees.`);
    }

    if (roundCurrency(installment.feesPaid) > roundCurrency(installment.calculatedFees)) {
        throw new Error(`Installment ${installment.installmentNumber} cannot have feesPaid greater than calculatedFees.`);
    }
}

function calculateFeeManagement(input = {}, context = {}) {
    const admissionType = normalizeAdmissionType(input.admissionType || context.admissionType);
    if (!SUPPORTED_ADMISSION_TYPES.has(admissionType)) {
        throw new Error('feeManagement requires a supported admissionType: one-time, yearly, or semester-wise');
    }

    const duration = coerceDuration(input.duration ?? context.duration, admissionType);
    if (duration < 1) {
        throw new Error('feeManagement.duration must be at least 1 for yearly or semester-wise admissions');
    }

    const totalFeesRaw = input.totalFees ?? input.actualFees ?? input.fees ?? context.totalFees ?? context.actualFees ?? context.revenue ?? 0;
    const totalFees = roundCurrency(totalFeesRaw);
    if (!Number.isFinite(totalFees) || totalFees < 0) {
        throw new Error('feeManagement.actualFees must be a non-negative number');
    }

    const discountType = normalizeDiscountType(input.discountType, admissionType);
    if (!SUPPORTED_DISCOUNT_TYPES.has(discountType)) {
        throw new Error('feeManagement requires a supported discountType: whole-fees, yearly, or semester');
    }

    const allowedDiscountTypes = DISCOUNT_COMPATIBILITY[admissionType];
    if (allowedDiscountTypes && !allowedDiscountTypes.has(discountType)) {
        throw new Error(`Discount type '${discountType}' is not allowed for admission type '${admissionType}'`);
    }

    const expectedCount = getInstallmentCount(admissionType, duration);
    const defaultInstallments = buildInstallmentsSkeleton(admissionType, duration, totalFees);

    const existingInstallments = Array.isArray(input.installments) ? input.installments : null;
    if (existingInstallments) {
        validateInstallmentCollection(existingInstallments, expectedCount);
    }

    const discountMap = getDiscountMap(input.installmentDiscounts || input.discounts);
    const wholeDiscountPercent = clampDiscountPercent(
        input.discountPercent ?? input.wholeDiscountPercent ?? input.initialDiscount ?? 0
    );

    const installments = defaultInstallments.map((fallback, index) => {
        const existing = existingInstallments ? normalizeExistingInstallment(existingInstallments[index], fallback, admissionType) : fallback;
        const status = normalizeInstallmentStatus(existing.status);

        if (status === INSTALLMENT_STATUS.PAID) {
            const paidInstallment = {
                ...existing,
                status: INSTALLMENT_STATUS.PAID
            };
            validateInstallmentValues(paidInstallment);
            return paidInstallment;
        }

        const discountPercent = deriveDiscountPercent({
            discountType,
            wholeDiscountPercent,
            discountMap,
            installment: fallback,
            existingInstallment: existing,
            respectExplicitDiscount: input.respectExplicitDiscount || false
        });

        const pending = recalculatePendingInstallment({
            installment: existing,
            discountPercent
        });
        validateInstallmentValues(pending);
        return pending;
    });

    const summary = buildSummary(totalFees, installments);

    return {
        schemaVersion: 2,
        admissionType,
        discountType,
        duration,
        summary,
        installments,
        updatedAt: new Date(),
        legacyMigration: {
            migratedFromRevenueOnly: false,
            requiresReview: false,
            migratedAt: null
        }
    };
}

function normalizeAdmissionFeeManagement(input = {}, context = {}) {
    return calculateFeeManagement(input, context);
}

function buildLegacyFeeManagement(admission = {}) {
    const admissionType = normalizeAdmissionType(admission.admissionType) || ADMISSION_TYPE.ONE_TIME;
    const totalFees = roundCurrency(admission.courseTotalFees ?? admission.totalFees ?? admission.fees ?? admission.revenue ?? 0);
    const durationRaw = admission.courseDuration ?? admission.duration;
    const duration = coerceDuration(durationRaw, admissionType) || 1;

    const feeManagement = calculateFeeManagement({
        admissionType,
        discountType: normalizeDiscountType('', admissionType),
        duration,
        totalFees
    }, {
        admissionType,
        totalFees,
        revenue: admission.revenue
    });

    feeManagement.legacyMigration = {
        migratedFromRevenueOnly: true,
        requiresReview: admissionType !== ADMISSION_TYPE.ONE_TIME && !admission.courseDuration,
        migratedAt: new Date(),
        sourceRevenue: roundCurrency(admission.revenue || 0),
        notes: admissionType === ADMISSION_TYPE.ONE_TIME
            ? 'Generated from legacy revenue-only admission.'
            : 'Generated from legacy admission. Validate duration and installment discounts manually.'
    };

    return feeManagement;
}

module.exports = {
    INSTALLMENT_STATUS,
    ADMISSION_TYPE,
    DISCOUNT_TYPE,
    normalizeAdmissionType,
    normalizeDiscountType,
    getInstallmentCount,
    calculateFeeManagement,
    normalizeAdmissionFeeManagement,
    buildLegacyFeeManagement
};
