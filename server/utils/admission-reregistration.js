const REREGISTRATION_TYPES = new Set(['yearly', 'semester-wise']);

function normalizeReRegistrationConfig(config, duration) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Course reRegistration configuration is required');
    }

    const type = String(config.type || '').trim().toLowerCase();
    if (!REREGISTRATION_TYPES.has(type)) {
        throw new Error('reRegistration.type must be yearly or semester-wise');
    }

    const normalizedDuration = Number(duration);
    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 1) {
        throw new Error('Course duration must be a positive integer');
    }

    let semestersPerAcademicYear = null;
    if (type === 'semester-wise') {
        semestersPerAcademicYear = Number(config.semestersPerAcademicYear);
        if (!Number.isInteger(semestersPerAcademicYear) || semestersPerAcademicYear < 1) {
            throw new Error('Semester-wise reRegistration requires a positive semestersPerAcademicYear');
        }
    }

    const periodCount = type === 'yearly'
        ? normalizedDuration
        : normalizedDuration * semestersPerAcademicYear;
    const defaultFee = Number(config.periodFee);
    if (!Number.isFinite(defaultFee) || defaultFee <= 0) {
        throw new Error('reRegistration.periodFee must be a positive number');
    }

    const applicablePeriods = config.applicablePeriods === undefined
        ? Array.from({ length: periodCount }, (_, index) => index + 1)
        : config.applicablePeriods;
    if (!Array.isArray(applicablePeriods)) {
        throw new Error('reRegistration.applicablePeriods must be an array');
    }

    const applicableSet = new Set();
    for (const value of applicablePeriods) {
        const sequence = Number(value);
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > periodCount) {
            throw new Error(`Applicable period must be an integer between 1 and ${periodCount}`);
        }
        if (applicableSet.has(sequence)) throw new Error(`Duplicate applicable period ${sequence}`);
        applicableSet.add(sequence);
    }

    const overrides = new Map();
    const rawOverrides = config.periodFeeOverrides || [];
    if (!Array.isArray(rawOverrides)) {
        throw new Error('reRegistration.periodFeeOverrides must be an array');
    }
    for (const item of rawOverrides) {
        const sequence = Number(item?.periodNumber);
        const fee = Number(item?.fee);
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > periodCount) {
            throw new Error(`Fee override period must be an integer between 1 and ${periodCount}`);
        }
        if (overrides.has(sequence)) throw new Error(`Duplicate fee override for period ${sequence}`);
        if (!Number.isFinite(fee) || fee <= 0) {
            throw new Error(`Fee override for period ${sequence} must be a positive number`);
        }
        overrides.set(sequence, Math.round(fee * 100) / 100);
    }

    return {
        type,
        semestersPerAcademicYear,
        periodFee: Math.round(defaultFee * 100) / 100,
        periodFeeOverrides: Array.from(overrides, ([periodNumber, fee]) => ({ periodNumber, fee })),
        applicablePeriods: Array.from(applicableSet).sort((a, b) => a - b),
        periodCount
    };
}

function generateReRegistrationPeriods(course) {
    const config = normalizeReRegistrationConfig(course?.reRegistration, course?.duration);
    const feeOverrides = new Map(config.periodFeeOverrides.map(({ periodNumber, fee }) => [periodNumber, fee]));

    return Array.from({ length: config.periodCount }, (_, index) => {
        const periodNumber = index + 1;
        const applicable = config.applicablePeriods.includes(periodNumber);
        const academicYearNumber = config.type === 'yearly'
            ? periodNumber
            : Math.ceil(periodNumber / config.semestersPerAcademicYear);
        const semesterNumber = config.type === 'semester-wise'
            ? ((periodNumber - 1) % config.semestersPerAcademicYear) + 1
            : null;

        return {
            periodId: config.type === 'yearly' ? `year-${periodNumber}` : `semester-${periodNumber}`,
            periodNumber,
            periodType: config.type === 'yearly' ? 'academic-year' : 'semester',
            periodLabel: config.type === 'yearly' ? `Year ${periodNumber}` : `Semester ${periodNumber}`,
            academicYearNumber,
            semesterNumber,
            applicable,
            applicableFee: applicable ? (feeOverrides.get(periodNumber) || config.periodFee) : 0,
            status: applicable ? 'pending' : 'na',
            paymentAttempts: []
        };
    });
}

function buildLiveFeePeriodSchedule(admission = {}) {
    const feeManagement = admission.feeManagement || {};
    const installments = Array.isArray(feeManagement.installments) ? feeManagement.installments : [];
    const courseSnapshot = admission.courseReRegistrationSnapshot || {};
    const config = courseSnapshot.reRegistration || {};
    const rawType = String(config.type || feeManagement.admissionType || admission.admissionType || '').trim().toLowerCase();
    const type = rawType === 'annual' ? 'yearly' : rawType === 'semester' ? 'semester-wise' : rawType;

    const savedAdmissionType = String(feeManagement.admissionType || admission.admissionType || '').trim().toLowerCase();
    if (!type && savedAdmissionType === 'one-time') {
        return {
            reRegistrationType: 'one-time',
            periods: [],
            summary: { periodCount: 0, applicablePeriodCount: 0, notApplicablePeriodCount: 0, applicableFees: 0, paidAmount: 0, pendingAmount: 0 },
            configurationError: ''
        };
    }
    if (!REREGISTRATION_TYPES.has(type)) {
        return { reRegistrationType: null, periods: [], summary: null, configurationError: 'Course re-registration configuration is missing or unsupported.' };
    }
    if (!installments.length) {
        return { reRegistrationType: type, periods: [], summary: null, configurationError: 'No saved Live Fee Calculation installments are available.' };
    }

    const snapshotDuration = Number(courseSnapshot.duration);
    const liveDuration = Number(feeManagement.duration ?? admission.duration ?? admission.courseDuration);
    const duration = Number.isInteger(snapshotDuration) && snapshotDuration > 0
        ? snapshotDuration
        : liveDuration;
    if (!Number.isInteger(duration) || duration < 1) {
        return { reRegistrationType: type, periods: [], summary: null, configurationError: 'Course duration is missing from the saved fee calculation.' };
    }

    const liveType = savedAdmissionType;
    const normalizedLiveType = liveType === 'annual' ? 'yearly' : liveType === 'semester' ? 'semester-wise' : liveType;
    if (config.type && normalizedLiveType && normalizedLiveType !== type) {
        return { reRegistrationType: type, periods: [], summary: null, configurationError: 'Course fee cadence does not match the saved Live Fee Calculation.' };
    }

    let semestersPerAcademicYear = Number(config.semestersPerAcademicYear);
    if (type === 'semester-wise' && (!Number.isInteger(semestersPerAcademicYear) || semestersPerAcademicYear < 1)) {
        semestersPerAcademicYear = installments.length % duration === 0 ? installments.length / duration : 0;
    }
    if (type === 'semester-wise' && (!Number.isInteger(semestersPerAcademicYear) || semestersPerAcademicYear < 1)) {
        return { reRegistrationType: type, periods: [], summary: null, configurationError: 'Semester count does not match the saved Live Fee Calculation.' };
    }

    const expectedCount = type === 'yearly' ? duration : duration * semestersPerAcademicYear;
    if (installments.length !== expectedCount) {
        return {
            reRegistrationType: type,
            periods: [],
            summary: null,
            configurationError: `Saved Live Fee Calculation has ${installments.length} period(s); ${expectedCount} expected from the course configuration.`
        };
    }

    const applicableNumbers = Array.isArray(config.applicablePeriods)
        ? new Set(config.applicablePeriods.map(Number))
        : null;
    const periods = installments.map((installment, index) => {
        const periodNumber = Number(installment?.installmentNumber) || index + 1;
        const calculated = Number(installment?.calculatedFees ?? installment?.originalFees);
        const periodFee = Number.isFinite(calculated) ? Math.max(0, Math.round(calculated * 100) / 100) : 0;
        const applicable = !applicableNumbers || applicableNumbers.has(periodNumber);
        const rawPaid = Number(installment?.feesPaid);
        const paidFromRecord = Number.isFinite(rawPaid)
            ? Math.max(0, Math.min(periodFee, Math.round(rawPaid * 100) / 100))
            : (String(installment?.status || '').toLowerCase() === 'paid' ? periodFee : 0);
        const rawRemaining = Number(installment?.remainingFees);
        const remaining = Number.isFinite(rawRemaining)
            ? Math.max(0, Math.round(rawRemaining * 100) / 100)
            : Math.max(0, Math.round((periodFee - paidFromRecord) * 100) / 100);
        const fullyPaid = applicable
            && String(installment?.status || '').toLowerCase() === 'paid'
            && paidFromRecord >= periodFee
            && remaining === 0;
        const academicYearNumber = type === 'yearly' ? periodNumber : Math.ceil(periodNumber / semestersPerAcademicYear);
        const semesterNumber = type === 'semester-wise'
            ? ((periodNumber - 1) % semestersPerAcademicYear) + 1
            : null;

        return {
            periodId: type === 'yearly' ? `year-${periodNumber}` : `semester-${periodNumber}`,
            periodNumber,
            periodType: type === 'yearly' ? 'academic-year' : 'semester',
            periodLabel: type === 'yearly' ? `Year ${periodNumber}` : `Semester ${periodNumber}`,
            academicYearNumber,
            semesterNumber,
            applicable,
            applicableFee: applicable ? periodFee : 0,
            paidAmount: fullyPaid ? periodFee : 0,
            status: !applicable ? 'na' : fullyPaid ? 'paid' : 'unpaid',
            paymentAttempts: [],
            source: 'live-fee-management',
            sourceInstallmentNumber: periodNumber
        };
    });

    const applicable = periods.filter((period) => period.applicable);
    const applicableFees = Math.round(applicable.reduce((sum, period) => sum + period.applicableFee, 0) * 100) / 100;
    const paidAmount = Math.round(applicable.reduce((sum, period) => sum + period.paidAmount, 0) * 100) / 100;
    return {
        reRegistrationType: type,
        periods,
        summary: {
            periodCount: periods.length,
            applicablePeriodCount: applicable.length,
            notApplicablePeriodCount: periods.length - applicable.length,
            applicableFees,
            paidAmount,
            pendingAmount: Math.max(0, Math.round((applicableFees - paidAmount) * 100) / 100)
        },
        configurationError: ''
    };
}

module.exports = {
    normalizeReRegistrationConfig,
    generateReRegistrationPeriods,
    buildLiveFeePeriodSchedule,
};