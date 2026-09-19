(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.FeeReportingUtils = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    function roundCurrency(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.round(num * 100) / 100;
    }

    function normalizeInstallmentStatus(value) {
        return String(value || '').trim().toLowerCase() === 'paid' ? 'paid' : 'pending';
    }

    function getAdmissionMonthKey(admission) {
        const month = String(admission?.month || '').trim();
        if (/^\d{4}-\d{2}$/.test(month)) return month;

        const rawDate = admission?.admissionDate;
        if (!rawDate) return '';
        const dt = new Date(String(rawDate));
        if (Number.isNaN(dt.getTime())) return '';
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }

    function buildFallbackInstallment(admission) {
        const revenue = Math.max(0, roundCurrency(admission?.revenue));
        if (revenue <= 0) return [];
        return [{
            installmentNumber: 1,
            installmentName: 'Installment 1',
            originalFees: revenue,
            calculatedFees: revenue,
            feesPaid: 0,
            remainingFees: revenue,
            status: 'pending'
        }];
    }

    function extractInstallments(admission) {
        const list = Array.isArray(admission?.feeManagement?.installments)
            ? admission.feeManagement.installments
            : buildFallbackInstallment(admission);

        return list.map((item, index) => {
            const original = Math.max(0, roundCurrency(item?.originalFees));
            const calculated = Math.max(0, roundCurrency(item?.calculatedFees ?? original));
            const paid = Math.max(0, roundCurrency(item?.feesPaid));
            const fallbackRemaining = Math.max(0, roundCurrency(calculated - Math.min(calculated, paid)));
            const givenRemaining = roundCurrency(item?.remainingFees);
            const remaining = Number.isFinite(givenRemaining)
                ? Math.max(0, Math.min(calculated, givenRemaining))
                : fallbackRemaining;

            return {
                installmentNumber: Number(item?.installmentNumber) || index + 1,
                installmentName: item?.installmentName || `Installment ${index + 1}`,
                status: normalizeInstallmentStatus(item?.status),
                originalFees: original,
                calculatedFees: calculated,
                feesPaid: Math.min(calculated, paid),
                remainingFees: remaining,
                discountAmount: Math.max(0, roundCurrency(original - calculated))
            };
        });
    }

    function summarizeInstallments(installments) {
        const rows = Array.isArray(installments) ? installments : [];
        const collected = roundCurrency(rows.reduce((sum, row) => sum + row.feesPaid, 0));
        const outstanding = roundCurrency(rows.reduce((sum, row) => sum + row.remainingFees, 0));
        const discount = roundCurrency(rows.reduce((sum, row) => sum + row.discountAmount, 0));
        const pendingCount = rows.filter((row) => row.status !== 'paid' || row.remainingFees > 0).length;
        const pendingAmount = roundCurrency(rows.reduce((sum, row) => (
            row.status !== 'paid' || row.remainingFees > 0
                ? sum + row.remainingFees
                : sum
        ), 0));

        return {
            collected,
            outstanding,
            discount,
            pendingCount,
            pendingAmount,
            rowsCount: rows.length
        };
    }

    function buildFeeReportMetrics(admissions, options) {
        const list = Array.isArray(admissions) ? admissions : [];
        const monthFilter = String(options?.month || '').trim();

        const scoped = monthFilter
            ? list.filter((admission) => getAdmissionMonthKey(admission) === monthFilter)
            : list;

        const totals = {
            admissionsCount: scoped.length,
            installmentsCount: 0,
            outstanding: 0,
            collected: 0,
            discount: 0,
            pending: 0,
            pendingAmount: 0
        };

        scoped.forEach((admission) => {
            const summary = summarizeInstallments(extractInstallments(admission));
            totals.installmentsCount += summary.rowsCount;
            totals.outstanding += summary.outstanding;
            totals.collected += summary.collected;
            totals.discount += summary.discount;
            totals.pending += summary.pendingCount;
            totals.pendingAmount += summary.pendingAmount;
        });

        totals.outstanding = roundCurrency(totals.outstanding);
        totals.collected = roundCurrency(totals.collected);
        totals.discount = roundCurrency(totals.discount);
        totals.pendingAmount = roundCurrency(totals.pendingAmount);

        return totals;
    }

    function buildFeeMonthlySeries(admissions) {
        const list = Array.isArray(admissions) ? admissions : [];
        const monthMap = new Map();

        list.forEach((admission) => {
            const key = getAdmissionMonthKey(admission);
            if (!key) return;

            const current = monthMap.get(key) || {
                month: key,
                outstanding: 0,
                collected: 0,
                discount: 0,
                pending: 0,
                pendingAmount: 0
            };

            const summary = summarizeInstallments(extractInstallments(admission));
            current.outstanding += summary.outstanding;
            current.collected += summary.collected;
            current.discount += summary.discount;
            current.pending += summary.pendingCount;
            current.pendingAmount += summary.pendingAmount;

            monthMap.set(key, current);
        });

        return Array.from(monthMap.values())
            .map((item) => ({
                month: item.month,
                outstanding: roundCurrency(item.outstanding),
                collected: roundCurrency(item.collected),
                discount: roundCurrency(item.discount),
                pending: item.pending,
                pendingAmount: roundCurrency(item.pendingAmount)
            }))
            .sort((a, b) => String(a.month).localeCompare(String(b.month)));
    }

    function buildFeeTypeSeries(admissions) {
        const list = Array.isArray(admissions) ? admissions : [];
        const typeMap = new Map();

        list.forEach((admission) => {
            const type = String(admission?.feeManagement?.admissionType || admission?.admissionType || 'unknown').trim().toLowerCase() || 'unknown';
            const current = typeMap.get(type) || {
                type,
                outstanding: 0,
                collected: 0,
                discount: 0,
                pending: 0
            };
            const summary = summarizeInstallments(extractInstallments(admission));
            current.outstanding += summary.outstanding;
            current.collected += summary.collected;
            current.discount += summary.discount;
            current.pending += summary.pendingCount;
            typeMap.set(type, current);
        });

        return Array.from(typeMap.values()).map((item) => ({
            type: item.type,
            outstanding: roundCurrency(item.outstanding),
            collected: roundCurrency(item.collected),
            discount: roundCurrency(item.discount),
            pending: item.pending
        }));
    }

    return {
        roundCurrency,
        normalizeInstallmentStatus,
        getAdmissionMonthKey,
        extractInstallments,
        summarizeInstallments,
        buildFeeReportMetrics,
        buildFeeMonthlySeries,
        buildFeeTypeSeries
    };
}));
