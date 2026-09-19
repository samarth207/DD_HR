(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.SalesFeeCalculator = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    const ALLOWED_ADMISSION_TYPES = new Set(['one-time', 'yearly', 'semester-wise']);
    const ALLOWED_DISCOUNT_TYPES = new Set(['whole-fees', 'yearly', 'semester']);

    const DISCOUNT_COMPATIBILITY = {
        'one-time': new Set(['whole-fees']),
        yearly: new Set(['whole-fees', 'yearly']),
        'semester-wise': new Set(['whole-fees', 'semester'])
    };

    function roundCurrency(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.round(num * 100) / 100;
    }

    function clampPercent(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        if (num < 0) return 0;
        if (num > 100) return 100;
        return roundCurrency(num);
    }

    function normalizeAdmissionType(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'annual') return 'yearly';
        if (raw === 'semester') return 'semester-wise';
        if (raw === 'one time' || raw === 'onetime') return 'one-time';
        return raw;
    }

    function normalizeDiscountType(value, admissionType) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw) return raw;
        if (admissionType === 'yearly') return 'yearly';
        if (admissionType === 'semester-wise') return 'semester';
        return 'whole-fees';
    }

    function getDiscountMap(input) {
        const map = new Map();
        if (!input) return map;

        if (Array.isArray(input)) {
            input.forEach(function(item) {
                const key = Number(item?.installmentNumber ?? item?.yearNumber ?? item?.semesterNumber);
                const value = Number(item?.discountPercent);
                if (!Number.isFinite(key) || key < 1) return;
                map.set(key, clampPercent(value));
            });
            return map;
        }

        if (typeof input === 'object') {
            Object.entries(input).forEach(function(entry) {
                const rawKey = entry[0];
                const rawValue = entry[1];
                const key = Number(String(rawKey).replace(/[^0-9]/g, ''));
                if (!Number.isFinite(key) || key < 1) return;
                map.set(key, clampPercent(rawValue));
            });
        }

        return map;
    }

    function getInstallmentCount(admissionType, duration) {
        if (admissionType === 'one-time') return 1;
        if (admissionType === 'yearly') return duration;
        if (admissionType === 'semester-wise') return duration * 2;
        return 0;
    }

    function getInstallmentLabel(admissionType, installmentNumber) {
        if (admissionType === 'one-time') return 'Installment 1';
        if (admissionType === 'yearly') return 'Year ' + installmentNumber;
        return 'Semester ' + installmentNumber;
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

    function validateLiveFeeInput(input) {
        const normalizedType = normalizeAdmissionType(input?.admissionType);
        const discountType = normalizeDiscountType(input?.discountType, normalizedType);
        const rawDiscount = Number(input?.discountPercent);
        const rawDuration = Number(input?.duration);
        const rawTotalFees = Number(input?.totalFees);
        const installmentDiscountMap = getDiscountMap(input?.installmentDiscounts || input?.discounts);
        const hasDiscountInput = input?.discountPercent !== undefined
            && input?.discountPercent !== null
            && String(input?.discountPercent).trim() !== '';

        const errors = [];

        if (!ALLOWED_ADMISSION_TYPES.has(normalizedType)) {
            errors.push('Select a valid admission type.');
        }

        if (!ALLOWED_DISCOUNT_TYPES.has(discountType)) {
            errors.push('Select a valid discount type.');
        }

        if (hasDiscountInput && (!Number.isFinite(rawDiscount) || rawDiscount < 0 || rawDiscount > 100)) {
            errors.push('Discount must be between 0 and 100.');
        }

        installmentDiscountMap.forEach(function(value) {
            if (!Number.isFinite(value) || value < 0 || value > 100) {
                errors.push('Installment discount must be between 0 and 100.');
            }
        });

        if (!Number.isFinite(rawTotalFees) || rawTotalFees <= 0) {
            errors.push('Fees must be a positive number.');
        }

        if (normalizedType === 'one-time') {
            if (discountType === 'yearly' || discountType === 'semester') {
                errors.push('One-Time admission type cannot use Yearly or Semester discount.');
            }
        } else if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
            errors.push('Duration must be a positive number.');
        }

        const compatibility = DISCOUNT_COMPATIBILITY[normalizedType];
        if (compatibility && !compatibility.has(discountType)) {
            errors.push('Selected admission type and discount type combination is not valid.');
        }

        const duration = normalizedType === 'one-time'
            ? 1
            : (Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0);

        const totalFees = roundCurrency(Number.isFinite(rawTotalFees) ? rawTotalFees : 0);
        const discountPercent = roundCurrency(hasDiscountInput && Number.isFinite(rawDiscount) ? rawDiscount : 0);

        return {
            isValid: errors.length === 0,
            errors,
            normalized: {
                admissionType: normalizedType,
                discountType,
                duration,
                totalFees,
                discountPercent
            }
        };
    }

    function calculateSummaryFromInstallments(actualFees, installments) {
        const safeInstallments = Array.isArray(installments) ? installments : [];
        const normalizedActualFees = Math.max(0, roundCurrency(actualFees));

        const totalDiscount = roundCurrency(safeInstallments.reduce(function(sum, item) {
            const original = Math.max(0, roundCurrency(item?.originalFees));
            const calculated = Math.max(0, roundCurrency(item?.calculatedFees));
            return sum + Math.max(0, roundCurrency(original - calculated));
        }, 0));

        const totalFeesPayable = roundCurrency(safeInstallments.reduce(function(sum, item) {
            return sum + Math.max(0, roundCurrency(item?.calculatedFees));
        }, 0));

        const feesPaid = roundCurrency(safeInstallments.reduce(function(sum, item) {
            const calculated = Math.max(0, roundCurrency(item?.calculatedFees));
            const paid = Math.max(0, roundCurrency(item?.feesPaid));
            return sum + Math.min(calculated, paid);
        }, 0));

        const outstandingFees = roundCurrency(safeInstallments.reduce(function(sum, item) {
            const calculated = Math.max(0, roundCurrency(item?.calculatedFees));
            const paid = Math.max(0, roundCurrency(item?.feesPaid));
            const fallbackRemaining = Math.max(0, roundCurrency(calculated - Math.min(calculated, paid)));
            const remaining = roundCurrency(item?.remainingFees);
            const normalizedRemaining = Number.isFinite(remaining)
                ? Math.max(0, Math.min(calculated, remaining))
                : fallbackRemaining;
            return sum + normalizedRemaining;
        }, 0));

        return {
            actualFees: normalizedActualFees,
            totalDiscount,
            totalFeesPayable,
            feesPaid,
            outstandingFees
        };
    }

    function buildLiveFeeCalculation(input) {
        const validation = validateLiveFeeInput(input || {});
        const normalizedType = validation.normalized.admissionType;
        const discountType = validation.normalized.discountType;
        const duration = validation.normalized.duration;
        const totalFees = validation.normalized.totalFees;
        const discountPercent = validation.normalized.discountPercent;

        if (!validation.isValid) {
            return {
                admissionType: normalizedType,
                discountType,
                duration,
                validation,
                summary: calculateSummaryFromInstallments(Math.max(0, totalFees), []),
                installments: []
            };
        }

        const installmentCount = getInstallmentCount(normalizedType, duration);
        if (!installmentCount || totalFees <= 0) {
            return {
                admissionType: normalizedType,
                discountType,
                duration,
                validation,
                summary: calculateSummaryFromInstallments(Math.max(0, totalFees), []),
                installments: []
            };
        }

        const baseParts = splitAmount(totalFees, installmentCount);
        let wholeDiscountParts = null;
        const installmentDiscountMap = getDiscountMap(input?.installmentDiscounts || input?.discounts);
        const hasInstallmentDiscounts = installmentDiscountMap.size > 0;

        if (discountType === 'whole-fees') {
            const totalDiscount = roundCurrency(totalFees * (discountPercent / 100));
            wholeDiscountParts = splitAmount(totalDiscount, installmentCount);
        }

        const installments = baseParts.map(function(originalFees, index) {
            const installmentNumber = index + 1;
            let discountAmount = 0;
            let rowDiscountPercent = discountPercent;

            if (discountType === 'whole-fees') {
                discountAmount = roundCurrency((wholeDiscountParts && wholeDiscountParts[index]) || 0);
            } else if (hasInstallmentDiscounts) {
                rowDiscountPercent = clampPercent(installmentDiscountMap.get(installmentNumber) || 0);
                discountAmount = roundCurrency(originalFees * (rowDiscountPercent / 100));
            } else {
                discountAmount = roundCurrency(originalFees * (discountPercent / 100));
            }

            const calculatedFees = Math.max(0, roundCurrency(originalFees - discountAmount));

            return {
                installmentNumber,
                installmentName: getInstallmentLabel(normalizedType, installmentNumber),
                originalFees,
                discountPercent: rowDiscountPercent,
                discountAmount,
                calculatedFees,
                feesPaid: 0,
                remainingFees: calculatedFees,
                status: 'pending'
            };
        });

        return {
            admissionType: normalizedType,
            discountType,
            duration,
            validation,
            summary: calculateSummaryFromInstallments(totalFees, installments),
            installments
        };
    }

    return {
        roundCurrency,
        clampPercent,
        normalizeAdmissionType,
        normalizeDiscountType,
        getInstallmentCount,
        validateLiveFeeInput,
        calculateSummaryFromInstallments,
        buildLiveFeeCalculation
    };
}));
