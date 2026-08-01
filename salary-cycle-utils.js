(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SalaryCycleUtils = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    function parseDateOnly(dateInput) {
        if (!dateInput) return null;
        if (dateInput instanceof Date) {
            if (Number.isNaN(dateInput.getTime())) return null;
            const copy = new Date(dateInput);
            copy.setHours(0, 0, 0, 0);
            return copy;
        }

        if (typeof dateInput !== 'string') return null;
        const value = dateInput.includes('T') ? dateInput : `${dateInput}T00:00:00`;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function endOfDay(date) {
        const copy = new Date(date);
        copy.setHours(23, 59, 59, 999);
        return copy;
    }

    function getMonthKeyFromParts(year, month) {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    function getMonthKeyFromDate(dateInput) {
        const date = parseDateOnly(dateInput) || parseDateOnly(new Date());
        return getMonthKeyFromParts(date.getFullYear(), date.getMonth() + 1);
    }

    function parseMonthKey(monthKey) {
        const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
        if (!m) return null;
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        if (!year || month < 1 || month > 12) return null;
        return { year, month };
    }

    function getMonthStart(monthKey) {
        const parsed = parseMonthKey(monthKey);
        if (!parsed) return null;
        return new Date(parsed.year, parsed.month - 1, 1);
    }

    function getMonthEnd(monthKey) {
        const parsed = parseMonthKey(monthKey);
        if (!parsed) return null;
        return endOfDay(new Date(parsed.year, parsed.month, 0));
    }

    function getMonthBounds(monthKey) {
        const monthStart = getMonthStart(monthKey);
        const monthEnd = getMonthEnd(monthKey);
        if (!monthStart || !monthEnd) return null;
        return { monthStart, monthEnd };
    }

    function addMonths(monthKey, delta) {
        const parsed = parseMonthKey(monthKey);
        if (!parsed) return null;
        const d = new Date(parsed.year, parsed.month - 1 + delta, 1);
        return getMonthKeyFromParts(d.getFullYear(), d.getMonth() + 1);
    }

    function diffDaysInclusive(startDate, endDate) {
        const start = parseDateOnly(startDate);
        const end = parseDateOnly(endDate);
        if (!start || !end || end < start) return 0;
        return Math.floor((end - start) / MS_PER_DAY) + 1;
    }

    function getSalaryCycleForMonth(monthKey, hireDate) {
        const bounds = getMonthBounds(monthKey);
        if (!bounds) return null;

        const { monthStart, monthEnd } = bounds;
        const hire = parseDateOnly(hireDate);
        const isFirstSalaryMonth = Boolean(
            hire &&
            hire.getFullYear() === monthStart.getFullYear() &&
            hire.getMonth() === monthStart.getMonth()
        );

        // New policy: recurring salary cycle is always calendar month.
        // Join date only impacts first-month proration.
        const cycleStart = isFirstSalaryMonth && hire > monthStart ? hire : monthStart;
        const cycleEnd = monthEnd;
        const proratedDays = diffDaysInclusive(cycleStart, cycleEnd);
        const totalDaysInMonth = diffDaysInclusive(monthStart, monthEnd);

        return {
            monthKey,
            monthStart,
            monthEnd,
            cycleStart,
            cycleEnd,
            isFirstSalaryMonth,
            proratedDays,
            workingDays: proratedDays,
            totalDaysInMonth
        };
    }

    function resolveBaseMonthKey(reference) {
        if (typeof reference === 'string' && parseMonthKey(reference)) return reference;
        return getMonthKeyFromDate(reference || new Date());
    }

    function getCurrentCycle(hireDate, referenceDate) {
        const monthKey = resolveBaseMonthKey(referenceDate);
        return getSalaryCycleForMonth(monthKey, hireDate);
    }

    function getPreviousCycle(hireDate, referenceDate) {
        const monthKey = addMonths(resolveBaseMonthKey(referenceDate), -1);
        return getSalaryCycleForMonth(monthKey, hireDate);
    }

    function getNextCycle(hireDate, referenceDate) {
        const monthKey = addMonths(resolveBaseMonthKey(referenceDate), 1);
        return getSalaryCycleForMonth(monthKey, hireDate);
    }

    function getProratedDays(monthKey, hireDate) {
        const cycle = getSalaryCycleForMonth(monthKey, hireDate);
        return cycle ? cycle.proratedDays : 0;
    }

    function getWorkingDays(monthKey, hireDate) {
        const cycle = getSalaryCycleForMonth(monthKey, hireDate);
        return cycle ? cycle.workingDays : 0;
    }

    return {
        parseDateOnly,
        parseMonthKey,
        getMonthKeyFromParts,
        getMonthKeyFromDate,
        getMonthStart,
        getMonthEnd,
        getMonthBounds,
        addMonths,
        getSalaryCycleForMonth,
        getCurrentCycle,
        getPreviousCycle,
        getNextCycle,
        getProratedDays,
        getWorkingDays,
        diffDaysInclusive
    };
});
