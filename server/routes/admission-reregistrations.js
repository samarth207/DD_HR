const express = require('express');
const { getDB, isDBConnected } = require('../db');
const { buildLiveFeePeriodSchedule } = require('../utils/admission-reregistration');
const {
    AdmissionAccessError,
    getAccessibleAdmission,
    isManagementRole
} = require('../utils/admission-access');

const router = express.Router();
const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

function roundCurrency(value) {
    return Math.round(Number(value) * 100) / 100;
}

function getPeriodSummary(schedule) {
    const periods = Array.isArray(schedule?.periods) ? schedule.periods : [];
    const applicable = periods.filter((period) => period.applicable);
    const paid = applicable.filter((period) => period.status === 'paid');
    return {
        periodCount: periods.length,
        applicablePeriodCount: applicable.length,
        notApplicablePeriodCount: periods.length - applicable.length,
        paidPeriodCount: paid.length,
        pendingPeriodCount: applicable.length - paid.length,
        applicableFees: roundCurrency(applicable.reduce((sum, period) => sum + Number(period.applicableFee || 0), 0)),
        paidAmount: roundCurrency(paid.reduce((sum, period) => sum + Number(period.paidAmount || 0), 0)),
        outstandingAmount: roundCurrency(applicable.filter((period) => period.status !== 'paid')
            .reduce((sum, period) => sum + Number(period.applicableFee || 0), 0))
    };
}

async function getAdmissionFeeSchedule(db, admission) {
    const liveFeeSchedule = buildLiveFeePeriodSchedule(admission);
    const hasLiveInstallments = Array.isArray(admission?.feeManagement?.installments)
        && admission.feeManagement.installments.length > 0;
    if (hasLiveInstallments) {
        return {
            admissionId: admission._id,
            courseId: admission.courseId || null,
            courseName: admission.course || '',
            courseConfigSnapshot: admission.courseReRegistrationSnapshot || {},
            source: 'feeManagement',
            reRegistrationType: liveFeeSchedule.reRegistrationType,
            configurationError: liveFeeSchedule.configurationError,
            periods: liveFeeSchedule.periods,
            summary: liveFeeSchedule.summary
        };
    }

    const legacySchedule = await db.collection('admissionReRegistrations').findOne({ admissionId: admission._id });
    if (legacySchedule) {
        return {
            ...legacySchedule,
            source: 'legacySchedule',
            summary: getPeriodSummary(legacySchedule)
        };
    }

    return {
        admissionId: admission._id,
        courseId: admission.courseId || null,
        courseName: admission.course || '',
        source: 'feeManagement',
        reRegistrationType: liveFeeSchedule.reRegistrationType,
        configurationError: liveFeeSchedule.configurationError,
        periods: liveFeeSchedule.periods,
        summary: liveFeeSchedule.summary || {
            periodCount: 0,
            applicablePeriodCount: 0,
            notApplicablePeriodCount: 0,
            paidPeriodCount: 0,
            pendingPeriodCount: 0,
            applicableFees: 0,
            paidAmount: 0,
            outstandingAmount: 0
        }
    };
}

function sendError(res, error) {
    const status = error.statusCode || (error.code === 11000 ? 409 : 500);
    const message = error.code === 11000 ? 'Duplicate payment reference or idempotency key' : error.message;
    res.status(status).json({ error: message });
}

router.get('/:admissionId/re-registration-periods', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const admission = await getAccessibleAdmission(db, req.params.admissionId, req);
        const schedule = await getAdmissionFeeSchedule(db, admission);
        res.json({
            data: schedule.periods || [],
            reRegistrationType: schedule.reRegistrationType || null,
            configurationError: schedule.configurationError || '',
            source: schedule.source
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/:admissionId/re-registration-periods/generate', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const admission = await getAccessibleAdmission(db, req.params.admissionId, req);
        const schedule = await getAdmissionFeeSchedule(db, admission);
        res.json({ success: true, data: schedule, summary: schedule.summary });
    } catch (error) {
        sendError(res, error);
    }
});

router.get('/:admissionId/re-registration-summary', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const admission = await getAccessibleAdmission(db, req.params.admissionId, req);
        const schedule = await getAdmissionFeeSchedule(db, admission);
        res.json({
            summary: schedule.summary,
            periods: schedule.periods || [],
            reRegistrationType: schedule.reRegistrationType || null,
            configurationError: schedule.configurationError || '',
            source: schedule.source
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/:admissionId/re-registration-periods/:periodId/payments', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    return res.status(410).json({ error: 'Period payment status is derived from the admission Live Fee Calculation. Update the admission fee installments through the existing fee workflow.' });
});

router.post('/:admissionId/re-registration-periods/:periodId/payments/:paymentId/verify', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    if (!isManagementRole(req)) return res.status(403).json({ error: 'Forbidden' });
    return res.status(410).json({ error: 'Period payment verification is handled through the existing admission Live Fee Calculation workflow.' });
});

module.exports = router;
module.exports.getPeriodSummary = getPeriodSummary;
module.exports.getAdmissionFeeSchedule = getAdmissionFeeSchedule;