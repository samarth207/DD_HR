const { ObjectId } = require('mongodb');
const { normalizeAdmissionYear, normalizeAdmissionDrive } = require('../routes/admissions');
const { buildLiveFeePeriodSchedule } = require('./admission-reregistration');
const { AdmissionAccessError, getEmployeeScope, isManagementRole } = require('./admission-access');

const PAYMENT_FILTERS = new Set(['all', 'paid', 'unpaid', 'pending', 'failed', 'na']);
const ADMISSION_STATUSES = new Set(['all', 'approved', 'pending', 'rejected']);
const REREGISTRATION_TYPES = new Set(['all', 'yearly', 'semester-wise']);

function roundCurrency(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
}

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new AdmissionAccessError(400, `Value must be an integer between 1 and ${maximum}`);
    }
    return parsed;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readDashboardFilters(req) {
    const query = req.query || {};
    const requestedEmployeeId = query.employeeId;
    const employeeId = getEmployeeScope(req, requestedEmployeeId);
    let year;
    try {
        year = normalizeAdmissionYear(query.admissionYear ?? query.admission_year, true);
    } catch (error) {
        throw new AdmissionAccessError(400, error.message);
    }
    const driveValue = query.admissionDrive ?? query.admission_drive;
    let drive = '';
    if (driveValue !== undefined && driveValue !== '') {
        try {
            drive = normalizeAdmissionDrive(driveValue);
        } catch (error) {
            throw new AdmissionAccessError(400, error.message);
        }
    }

    let courseId = null;
    if (query.courseId) {
        if (!ObjectId.isValid(query.courseId)) throw new AdmissionAccessError(400, 'Invalid courseId');
        courseId = new ObjectId(query.courseId);
    }

    const paymentStatus = String(query.paymentStatus || 'all').trim().toLowerCase();
    if (!PAYMENT_FILTERS.has(paymentStatus)) throw new AdmissionAccessError(400, 'Invalid paymentStatus');
    const admissionStatus = String(query.admissionStatus || 'all').trim().toLowerCase();
    if (!ADMISSION_STATUSES.has(admissionStatus)) throw new AdmissionAccessError(400, 'Invalid admissionStatus');
    const reRegistrationType = String(query.reRegistrationType || 'all').trim().toLowerCase();
    if (!REREGISTRATION_TYPES.has(reRegistrationType)) throw new AdmissionAccessError(400, 'Invalid reRegistrationType');

    const search = String(query.search || '').trim().slice(0, 100);
    return {
        year,
        drive,
        employeeId,
        courseId,
        paymentStatus,
        admissionStatus,
        reRegistrationType,
        search: search ? new RegExp(escapeRegex(search), 'i') : null,
        page: parsePositiveInteger(query.page, 1),
        limit: parsePositiveInteger(query.limit, 25, 100)
    };
}

function buildAdmissionQuery(filters) {
    const query = { admissionYear: filters.year };
    if (filters.drive) query.admissionDrive = filters.drive;
    if (filters.employeeId !== null) query.employeeId = filters.employeeId;
    if (filters.courseId) query.courseId = filters.courseId;
    if (filters.search) {
        const expression = filters.search.source;
        query.$or = [
            { customerName: { $regex: expression, $options: 'i' } },
            { customerPhone: { $regex: expression, $options: 'i' } },
            { customerEmail: { $regex: expression, $options: 'i' } },
            { course: { $regex: expression, $options: 'i' } },
            { universityName: { $regex: expression, $options: 'i' } }
        ];
    }
    return query;
}

function normalizeDashboardPeriod(period) {
    const applicable = period.applicable === true && period.status !== 'na';
    const applicableFee = applicable ? roundCurrency(period.applicableFee) : 0;
    if (period.source === 'live-fee-management') {
        const paid = applicable && period.status === 'paid' && roundCurrency(period.paidAmount) === applicableFee;
        return {
            ...period,
            applicable,
            applicableFee,
            paidAmount: paid ? applicableFee : 0,
            status: !applicable ? 'na' : paid ? 'paid' : 'unpaid',
            paymentAttempts: []
        };
    }
    const attempts = Array.isArray(period.paymentAttempts) ? period.paymentAttempts : [];
    const validSuccess = attempts.find((attempt) => (
        String(attempt.status || '').toLowerCase() === 'succeeded'
        && roundCurrency(attempt.amount) === applicableFee
    ));
    const paid = applicable
        && period.status === 'paid'
        && roundCurrency(period.paidAmount) === applicableFee
        && Boolean(validSuccess);
    const pendingAttempt = attempts.find((attempt) => String(attempt.status || '').toLowerCase() === 'pending');
    const failedAttempt = [...attempts].reverse().find((attempt) => String(attempt.status || '').toLowerCase() === 'failed');
    const status = !applicable
        ? 'na'
        : paid
            ? 'paid'
            : pendingAttempt
                ? 'pending'
                : failedAttempt
                    ? 'failed'
                    : 'unpaid';

    return {
        ...period,
        applicable,
        applicableFee,
        paidAmount: paid ? applicableFee : 0,
        status,
        paymentAttempts: attempts
    };
}

function paymentFilterMatches(period, selectedStatus) {
    if (selectedStatus === 'all') return true;
    if (selectedStatus === 'unpaid') return period.status === 'unpaid' || period.status === 'failed';
    return period.status === selectedStatus;
}

function createMoneySummary() {
    return { applicableFees: 0, paidAmount: 0, pendingAmount: 0 };
}

function addRowMoney(summary, row) {
    summary.applicableFees += row.summary.applicableFees;
    summary.paidAmount += row.summary.paidAmount;
    summary.pendingAmount += row.summary.pendingAmount;
}

function addPeriodTotals(target, periods) {
    for (const period of periods) {
        const sequence = Number(period.periodNumber);
        if (!Number.isInteger(sequence) || sequence < 1) continue;
        const key = String(sequence);
        if (!target[key]) {
            target[key] = {
                periodNumber: sequence,
                label: period.periodLabel,
                applicableFees: 0,
                paidAmount: 0,
                pendingAmount: 0,
                applicableCount: 0,
                paidCount: 0,
                naCount: 0
            };
        }
        const total = target[key];
        total.label = total.label || period.periodLabel;
        if (!period.applicable || period.status === 'na') {
            total.naCount += 1;
            continue;
        }
        total.applicableCount += 1;
        total.applicableFees += period.applicableFee;
        if (period.status === 'paid') {
            total.paidCount += 1;
            total.paidAmount += period.paidAmount;
        } else {
            total.pendingAmount += period.applicableFee;
        }
    }
}

function fillMissingPeriodsAsNA(periodTotals, configuredAdmissionCount, periodType) {
    const existingPeriods = Object.values(periodTotals);
    const maxPeriodNumber = existingPeriods.reduce((maximum, period) => Math.max(maximum, period.periodNumber), 0);
    for (let periodNumber = 1; periodNumber <= maxPeriodNumber; periodNumber += 1) {
        const key = String(periodNumber);
        if (!periodTotals[key]) {
            periodTotals[key] = {
                periodNumber,
                label: periodType === 'yearly' ? `Year ${periodNumber}` : `Semester ${periodNumber}`,
                applicableFees: 0,
                paidAmount: 0,
                pendingAmount: 0,
                applicableCount: 0,
                paidCount: 0,
                naCount: 0
            };
        }
        const period = periodTotals[key];
        const representedAdmissions = period.applicableCount + period.naCount;
        period.naCount += Math.max(0, configuredAdmissionCount - representedAdmissions);
    }
}

function finalizePeriodTotals(periodTotals) {
    return Object.values(periodTotals)
        .sort((left, right) => left.periodNumber - right.periodNumber)
        .map((period) => ({
            ...period,
            applicableFees: roundCurrency(period.applicableFees),
            paidAmount: roundCurrency(period.paidAmount),
            pendingAmount: roundCurrency(period.pendingAmount)
        }));
}

function matchesSearch(admission, search) {
    if (!search) return true;
    return [
        admission.customerName,
        admission.customerPhone,
        admission.customerEmail,
        admission.course,
        admission.universityName
    ].some((value) => search.test(String(value || '')));
}

function matchesAdmissionStatus(admission, desiredStatus) {
    if (desiredStatus === 'all') return true;
    const status = String(admission.status || 'approved').trim().toLowerCase();
    return status === desiredStatus;
}

function calculateAdmissionSummary(periods) {
    const applicable = periods.filter((period) => period.applicable && period.status !== 'na');
    const applicableFees = roundCurrency(applicable.reduce((sum, period) => sum + period.applicableFee, 0));
    const paidAmount = roundCurrency(applicable.reduce((sum, period) => sum + period.paidAmount, 0));
    return {
        applicablePeriodCount: applicable.length,
        notApplicablePeriodCount: periods.length - applicable.length,
        applicableFees,
        paidAmount,
        pendingAmount: roundCurrency(Math.max(0, applicableFees - paidAmount))
    };
}

async function getDashboardOptions(db, filters, management) {
    const yearQuery = filters.employeeId === null ? {} : { employeeId: filters.employeeId };
    const distinctValues = async (collectionName, field, match) => {
        const rows = await db.collection(collectionName).aggregate([
            { $match: match },
            { $match: { [field]: { $exists: true, $ne: null } } },
            { $group: { _id: `$${field}` } }
        ]).toArray();
        return rows.map((row) => row._id);
    };
    const years = await distinctValues('admissions', 'admissionYear', yearQuery);
    const optionQuery = { admissionYear: filters.year };
    if (filters.drive) optionQuery.admissionDrive = filters.drive;
    if (filters.employeeId !== null) optionQuery.employeeId = filters.employeeId;
    if (filters.courseId) optionQuery.courseId = filters.courseId;

    const [courseDocs, employeeIds] = await Promise.all([
        db.collection('courses').find({ isDeleted: { $ne: true } })
            .project({ _id: 1, name: 1, reRegistration: 1 })
            .sort({ name: 1 })
            .toArray(),
        management ? distinctValues('admissions', 'employeeId', optionQuery) : Promise.resolve([])
    ]);
    const employees = employeeIds.length
        ? await db.collection('employees').find({ id: { $in: employeeIds } })
            .project({ id: 1, firstName: 1, lastName: 1 })
            .sort({ firstName: 1, lastName: 1 })
            .toArray()
        : [];

    return {
        years: Array.from(new Set([new Date().getFullYear(), ...years.filter(Number.isInteger)]))
            .sort((left, right) => right - left),
        courses: courseDocs.map((course) => ({ courseId: String(course._id), courseName: course.name })),
        employees: employees.map((employee) => ({
            employeeId: employee.id,
            employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
        }))
    };
}

async function buildAllocationDashboard(db, req) {
    const filters = readDashboardFilters(req);
    const query = buildAdmissionQuery(filters);
    const management = isManagementRole(req);
    const options = await getDashboardOptions(db, filters, management);
    const cursor = db.collection('admissions')
        .find(query)
        .sort({ admissionDate: -1, _id: 1 })
        .batchSize(200);

    const pageRows = [];
    const courseTotals = new Map();
    const driveTotals = new Map([
        ['Drive 1', { admissionCount: 0, ...createMoneySummary() }],
        ['Drive 2', { admissionCount: 0, ...createMoneySummary() }]
    ]);
    const typeTotals = new Map([
        ['yearly', { admissionCount: 0, ...createMoneySummary() }],
        ['semester-wise', { admissionCount: 0, ...createMoneySummary() }]
    ]);
    const semesterTotals = {};
    const yearlyTotals = {};
    const configuredAdmissionCounts = { 'semester-wise': 0, yearly: 0 };
    const summary = {
        admissionCount: 0,
        drive1Count: 0,
        drive2Count: 0,
        reRegistrationAdmissionCount: 0,
        unconfiguredAdmissionCount: 0,
        ...createMoneySummary()
    };
    const skip = (filters.page - 1) * filters.limit;
    while (await cursor.hasNext()) {
        const batch = [];
        while (batch.length < 200 && await cursor.hasNext()) batch.push(await cursor.next());
        if (!batch.length) break;

        const admissionIds = batch.map((admission) => admission._id);
        const employeeIds = Array.from(new Set(batch.map((admission) => admission.employeeId)));
        const [schedules, employees] = await Promise.all([
            db.collection('admissionReRegistrations').find({ admissionId: { $in: admissionIds } }).toArray(),
            db.collection('employees').find({ id: { $in: employeeIds } })
                .project({ id: 1, firstName: 1, lastName: 1 })
                .toArray()
        ]);
        const scheduleMap = new Map(schedules.map((schedule) => [String(schedule.admissionId), schedule]));
        const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

        for (const admission of batch) {
            const employee = employeeMap.get(admission.employeeId) || {};
            const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
                || `Employee ${admission.employeeId}`;
            if (!matchesAdmissionStatus(admission, filters.admissionStatus)) continue;
            if (!matchesSearch(admission, filters.search)) continue;

            const schedule = scheduleMap.get(String(admission._id));
            const snapshot = schedule?.courseConfigSnapshot || admission.courseReRegistrationSnapshot;
            const liveFeeSchedule = buildLiveFeePeriodSchedule(admission);
            const hasLiveInstallments = Array.isArray(admission?.feeManagement?.installments)
                && admission.feeManagement.installments.length > 0;
            let periods = hasLiveInstallments
                ? liveFeeSchedule.periods.map(normalizeDashboardPeriod)
                : (Array.isArray(schedule?.periods) ? schedule.periods.map(normalizeDashboardPeriod) : []);
            const configurationError = hasLiveInstallments
                ? liveFeeSchedule.configurationError
                : (schedule ? '' : 'No saved Live Fee Calculation is available.');
            const type = liveFeeSchedule.reRegistrationType === 'one-time'
                ? ''
                : String(liveFeeSchedule.reRegistrationType || snapshot?.reRegistration?.type || '').trim().toLowerCase();
            if (filters.reRegistrationType !== 'all' && filters.reRegistrationType !== type) continue;
            if (filters.paymentStatus !== 'all' && !periods.some((period) => paymentFilterMatches(period, filters.paymentStatus))) continue;

            const admissionSummary = calculateAdmissionSummary(periods);
            const courseKey = admission.courseId ? String(admission.courseId) : String(admission.course || 'unknown');
            const courseTotal = courseTotals.get(courseKey) || {
                courseId: admission.courseId ? String(admission.courseId) : null,
                courseName: admission.course || 'Unknown course',
                admissionCount: 0,
                ...createMoneySummary()
            };
            courseTotal.admissionCount += 1;
            addRowMoney(courseTotal, { summary: admissionSummary });
            courseTotals.set(courseKey, courseTotal);

            const drive = admission.admissionDrive;
            const driveTotal = driveTotals.get(drive);
            if (driveTotal) {
                driveTotal.admissionCount += 1;
                addRowMoney(driveTotal, { summary: admissionSummary });
                if (drive === 'Drive 1') summary.drive1Count += 1;
                if (drive === 'Drive 2') summary.drive2Count += 1;
            }

            if (typeTotals.has(type)) {
                const typeTotal = typeTotals.get(type);
                typeTotal.admissionCount += 1;
                addRowMoney(typeTotal, { summary: admissionSummary });
            }

            if (periods.length) summary.reRegistrationAdmissionCount += 1;
            else if (liveFeeSchedule.reRegistrationType !== 'one-time') summary.unconfiguredAdmissionCount += 1;
            if (periods.length && Object.prototype.hasOwnProperty.call(configuredAdmissionCounts, type)) {
                configuredAdmissionCounts[type] += 1;
            }

            const row = {
                admissionId: String(admission._id),
                studentName: admission.customerName || '',
                courseId: admission.courseId ? String(admission.courseId) : null,
                courseName: admission.course || '',
                universityName: admission.universityName || '',
                admissionDate: admission.admissionDate || '',
                admissionYear: admission.admissionYear ?? null,
                admissionDrive: admission.admissionDrive || '',
                employeeId: admission.employeeId,
                employeeName,
                admissionStatus: String(admission.status || 'approved').toLowerCase(),
                reRegistrationType: type || null,
                configurationError,
                periods,
                summary: admissionSummary
            };

            summary.admissionCount += 1;
            addRowMoney(summary, { summary: admissionSummary });
            if (summary.admissionCount > skip && pageRows.length < filters.limit) pageRows.push(row);

            const target = type === 'semester-wise' ? semesterTotals : type === 'yearly' ? yearlyTotals : null;
            if (target) addPeriodTotals(target, periods);
        }
    }

    fillMissingPeriodsAsNA(semesterTotals, configuredAdmissionCounts['semester-wise'], 'semester-wise');
    fillMissingPeriodsAsNA(yearlyTotals, configuredAdmissionCounts.yearly, 'yearly');
    summary.applicableFees = roundCurrency(summary.applicableFees);
    summary.paidAmount = roundCurrency(summary.paidAmount);
    summary.pendingAmount = roundCurrency(summary.applicableFees - summary.paidAmount);
    for (const totals of [...driveTotals.values(), ...typeTotals.values(), ...courseTotals.values()]) {
        totals.applicableFees = roundCurrency(totals.applicableFees);
        totals.paidAmount = roundCurrency(totals.paidAmount);
        totals.pendingAmount = roundCurrency(totals.applicableFees - totals.paidAmount);
    }

    const totalPages = Math.max(1, Math.ceil(summary.admissionCount / filters.limit));
    return {
        year: filters.year,
        filters: {
            drive: filters.drive || 'all',
            courseId: filters.courseId ? String(filters.courseId) : 'all',
            employeeId: filters.employeeId,
            reRegistrationType: filters.reRegistrationType,
            paymentStatus: filters.paymentStatus,
            admissionStatus: filters.admissionStatus,
            search: filters.search?.source || ''
        },
        summary,
        byDrive: Array.from(driveTotals, ([drive, totals]) => ({ drive, ...totals })),
        byCourse: Array.from(courseTotals.values()).sort((left, right) => right.admissionCount - left.admissionCount),
        byReRegistrationType: Array.from(typeTotals, ([type, totals]) => ({ type, ...totals })),
        periodTotals: {
            semesterWise: finalizePeriodTotals(semesterTotals),
            yearly: finalizePeriodTotals(yearlyTotals)
        },
        data: pageRows,
        pagination: { page: filters.page, limit: filters.limit, total: summary.admissionCount, totalPages },
        ...options
    };
}

module.exports = {
    buildAllocationDashboard,
    calculateAdmissionSummary,
    normalizeDashboardPeriod,
    readDashboardFilters
};