const express = require('express');
const { ObjectId } = require('mongodb');
const XLSX = require('xlsx');
const { getDB, isDBConnected } = require('../db');
const { normalizeAdmissionYear, normalizeAdmissionDrive } = require('./admissions');
const { AdmissionAccessError, getEmployeeScope } = require('../utils/admission-access');
const { buildAllocationDashboard } = require('../utils/admission-dashboard');

const router = express.Router();
const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const REPORT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const MAX_EXPORT_RECORDS = 10000;

function buildReportMatch(req) {
    const query = req.query || {};
    const match = {};
    const requestedEmployeeId = query.employeeId;
    const employeeId = getEmployeeScope(req, requestedEmployeeId);
    if (employeeId !== null) match.employeeId = employeeId;

    const year = query.admissionYear ?? query.admission_year;
    const drive = query.admissionDrive ?? query.admission_drive;
    if (year !== undefined) match.admissionYear = normalizeAdmissionYear(year);
    if (drive !== undefined) match.admissionDrive = normalizeAdmissionDrive(drive);
    if (query.courseId) {
        if (!ObjectId.isValid(query.courseId)) throw new AdmissionAccessError(400, 'Invalid courseId');
        match.courseId = new ObjectId(query.courseId);
    }
    if (query.status) {
        const status = String(query.status).trim().toLowerCase();
        if (!REPORT_STATUSES.has(status)) throw new AdmissionAccessError(400, 'Invalid admission status');
        match.status = status;
    }
    return match;
}

function reportGroupId(groupBy) {
    if (groupBy === 'year') return '$admissionYear';
    if (groupBy === 'drive') return '$admissionDrive';
    if (groupBy === 'course') return { courseId: { $ifNull: ['$courseId', '$course'] }, course: '$course' };
    if (groupBy === 'employee') return '$employeeId';
    return { admissionYear: { $ifNull: ['$admissionYear', null] }, admissionDrive: { $ifNull: ['$admissionDrive', null] } };
}

function cleanSpreadsheetText(value) {
    const text = String(value ?? '');
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cleanSpreadsheetValue(value) {
    return typeof value === 'string' ? cleanSpreadsheetText(value) : value;
}

async function getAggregates(db, match, groupBy) {
    const [totals] = await db.collection('admissions').aggregate([
        { $match: match },
        { $group: {
            _id: null,
            admissionCount: { $sum: 1 },
            creditedRevenue: { $sum: { $ifNull: ['$revenue', 0] } }
        } }
    ]).toArray();
    const groups = await db.collection('admissions').aggregate([
        { $match: match },
        { $group: {
            _id: reportGroupId(groupBy),
            admissionCount: { $sum: 1 },
            creditedRevenue: { $sum: { $ifNull: ['$revenue', 0] } }
        } },
        { $sort: { admissionCount: -1 } }
    ]).toArray();
    return {
        totals: {
            admissionCount: totals?.admissionCount || 0,
            creditedRevenue: Math.round((totals?.creditedRevenue || 0) * 100) / 100
        },
        groups: groups.map((row) => ({
            group: row._id,
            admissionCount: row.admissionCount,
            creditedRevenue: Math.round(row.creditedRevenue * 100) / 100
        }))
    };
}

router.get('/aggregates', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const groupBy = String(req.query.groupBy || 'year-drive').toLowerCase();
        if (!['year', 'drive', 'year-drive', 'course', 'employee'].includes(groupBy)) {
            return res.status(400).json({ error: 'groupBy must be year, drive, year-drive, course, or employee' });
        }
        const match = buildReportMatch(req);
        const result = await getAggregates(getDB(), match, groupBy);
        res.json({ ...result, groupBy, filters: match });
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message });
    }
});

router.get('/dashboard', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const dashboard = await buildAllocationDashboard(getDB(), req);
        res.json(dashboard);
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get('/export.xlsx', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const match = buildReportMatch(req);
        const records = await getDB().collection('admissions')
            .find(match)
            .sort({ admissionYear: -1, admissionDrive: 1, admissionDate: -1 })
            .limit(MAX_EXPORT_RECORDS + 1)
            .toArray();
        if (records.length > MAX_EXPORT_RECORDS) {
            return res.status(413).json({ error: `Export exceeds ${MAX_EXPORT_RECORDS} admissions. Narrow the filters and retry.` });
        }
        const rows = records.map((record) => ({
            Admission: String(record._id),
            Year: cleanSpreadsheetValue(record.admissionYear ?? 'Unallocated'),
            Drive: cleanSpreadsheetText(record.admissionDrive || 'Unallocated'),
            Status: cleanSpreadsheetText(record.status || 'approved'),
            EmployeeId: cleanSpreadsheetValue(record.employeeId ?? ''),
            Course: cleanSpreadsheetText(record.course || ''),
            University: cleanSpreadsheetText(record.universityName || ''),
            AdmissionDate: cleanSpreadsheetText(record.admissionDate || ''),
            CreditedRevenue: Number(record.revenue) || 0
        }));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Admissions');
        const output = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="admissions-report.xlsx"');
        res.send(output);
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message });
    }
});

module.exports = router;
module.exports.buildReportMatch = buildReportMatch;
module.exports.getAggregates = getAggregates;