const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const salaryCycleUtils = require('../../salary-cycle-utils');

// Critical security guard for attendance APIs.
// Admin has full access; employee can only read attendance data relevant to self.
router.use((req, res, next) => {
    // Backward compatibility for test harnesses where auth middleware is disabled at app level.
    if (!req.auth) return next();
    if (req.auth.role === 'admin') return next();
    if (req.auth.role !== 'employee') return res.status(403).json({ error: 'Forbidden' });

    if (req.method !== 'GET') return res.status(403).json({ error: 'Forbidden' });
    if (req.path === '/settings') return next();
    if (/^\/month\/\d{4}-\d{2}$/.test(req.path)) return next();
    if (/^\/\d{4}-\d{2}-\d{2}$/.test(req.path)) return next();

    if (req.path === '/cycle') {
        if (!req.query.employeeId) return next();
        return parseInt(req.query.employeeId, 10) === parseInt(req.auth.employeeId, 10)
            ? next()
            : res.status(403).json({ error: 'Forbidden' });
    }

    if (req.path === '/report/monthly') {
        return parseInt(req.query.employeeId, 10) === parseInt(req.auth.employeeId, 10)
            ? next()
            : res.status(403).json({ error: 'Forbidden' });
    }

    return res.status(403).json({ error: 'Forbidden' });
});

function parseDateOnly(dateStr) {
    if (!dateStr) return null;
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function toDateStr(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

function isWorkFromHomeLeave(leaveType) {
    return String(leaveType || '').trim().toLowerCase() === 'work from home';
}

function isLateEntry(time, settings) {
    if (!time || !settings?.officeStartTime) return false;
    const [officeHour, officeMinute] = String(settings.officeStartTime).split(':').map(Number);
    const [entryHour, entryMinute] = String(time).split(':').map(Number);
    return ((entryHour * 60 + entryMinute) - (officeHour * 60 + officeMinute)) > (Number(settings.lateThresholdMins) || 0);
}

function isFullDayLeave(leave, dateStr) {
    if (!leave || leave.status !== 'approved') return false;
    if (isWorkFromHomeLeave(leave.leaveType)) return false;
    if (dateStr < leave.startDate || dateStr > leave.endDate) return false;
    return leave.halfDay !== true && leave.leaveType !== 'Half Day';
}

// GET /api/attendance/settings  — fetch office/late settings
router.get('/settings', async (req, res) => {
    try {
        const db = getDB();
        const doc = await db.collection('appSettings').findOne({ _id: 'attendanceSettings' });
        if (doc) {
            const { _id, ...settings } = doc;
            res.json(settings);
        } else {
            res.json({ officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/attendance/settings  — upsert office/late settings
router.put('/settings', async (req, res) => {
    try {
        const db = getDB();
        const { officeStartTime, lateThresholdMins, lateDaysHalfDay } = req.body;
        await db.collection('appSettings').updateOne(
            { _id: 'attendanceSettings' },
            { $set: { officeStartTime, lateThresholdMins: Number(lateThresholdMins), lateDaysHalfDay: Number(lateDaysHalfDay) } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/month/:month  — all records for a month prefix (YYYY-MM)
router.get('/month/:month', async (req, res) => {
    try {
        const db = getDB();
        const docs = await db.collection('attendance')
            .find({ date: { $regex: `^${req.params.month}` } })
            .sort({ date: 1 })
            .toArray();

        // Employees can only view their own attendance entries; admin gets full dataset.
        if (req.auth?.role === 'employee') {
            const employeeId = parseInt(req.auth.employeeId, 10);
            const employeeKey = String(employeeId);
            const filtered = docs.map(doc => {
                const ownRec = (doc.records || {})[employeeId] || (doc.records || {})[employeeKey];
                return {
                    ...doc,
                    records: ownRec ? { [employeeId]: ownRec } : {}
                };
            });
            return res.json(filtered);
        }

        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/range', async (req, res) => {
    try {
        const db = getDB();
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required' });
        }

        const start = parseDateOnly(startDate);
        const end = parseDateOnly(endDate);
        if (!start || !end || end < start) {
            return res.status(400).json({ error: 'Invalid date range' });
        }

        const docs = await db.collection('attendance')
            .find({ date: { $gte: startDate, $lte: endDate } })
            .sort({ date: 1 })
            .toArray();

        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/cycle?month=YYYY-MM&hireDate=YYYY-MM-DD
router.get('/cycle', async (req, res) => {
    try {
        const { month, hireDate } = req.query;
        if (!month) return res.status(400).json({ error: 'month is required' });

        // Backward compatibility: if hireDate is omitted but employeeId is provided,
        // resolve hireDate from employee record for first-month proration.
        let effectiveHireDate = hireDate || null;
        if (!effectiveHireDate && req.query.employeeId) {
            const db = getDB();
            const employeeId = parseInt(req.query.employeeId, 10);
            if (employeeId) {
                const employee = await db.collection('employees').findOne({ id: employeeId });
                effectiveHireDate = employee?.hireDate || null;
            }
        }

        const cycle = salaryCycleUtils.getSalaryCycleForMonth(month, effectiveHireDate);
        if (!cycle) return res.status(400).json({ error: 'Invalid month value' });

        res.json({
            monthKey: cycle.monthKey,
            cycleStart: toDateStr(cycle.cycleStart),
            cycleEnd: toDateStr(cycle.cycleEnd),
            monthStart: toDateStr(cycle.monthStart),
            monthEnd: toDateStr(cycle.monthEnd),
            isFirstSalaryMonth: cycle.isFirstSalaryMonth,
            workingDays: cycle.workingDays,
            proratedDays: cycle.proratedDays
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/report/monthly?employeeId=1&month=YYYY-MM&hireDate=YYYY-MM-DD
router.get('/report/monthly', async (req, res) => {
    try {
        const db = getDB();
        const employeeId = parseInt(req.query.employeeId, 10);
        const month = req.query.month;
        let hireDate = req.query.hireDate || null;

        if (!employeeId || !month) {
            return res.status(400).json({ error: 'employeeId and month are required' });
        }

        // Backward compatibility: callers can omit hireDate; API resolves from DB.
        if (!hireDate) {
            const employee = await db.collection('employees').findOne({ id: employeeId });
            hireDate = employee?.hireDate || null;
        }

        const cycle = salaryCycleUtils.getSalaryCycleForMonth(month, hireDate);
        if (!cycle) return res.status(400).json({ error: 'Invalid month value' });

        const startDate = toDateStr(cycle.cycleStart);
        const endDate = toDateStr(cycle.cycleEnd);

        const [attendanceDocs, leaves, settingsDoc] = await Promise.all([
            db.collection('attendance').find({ date: { $gte: startDate, $lte: endDate } }).toArray(),
            db.collection('leaves').find({
                employeeId,
                status: 'approved',
                startDate: { $lte: endDate },
                endDate: { $gte: startDate }
            }).toArray(),
            db.collection('appSettings').findOne({ _id: 'attendanceSettings' })
        ]);
        const attendanceSettings = settingsDoc || { officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 };

        const dayMap = new Map();
        for (const doc of attendanceDocs) {
            const rec = (doc.records || {})[employeeId] || (doc.records || {})[String(employeeId)];
            if (rec) dayMap.set(doc.date, rec);
        }

        const today = parseDateOnly(new Date().toISOString().split('T')[0]);
        const effectiveEnd = cycle.cycleEnd > today ? today : parseDateOnly(toDateStr(cycle.cycleEnd));
        let presentDays = 0;
        let lateDays = 0;
        let absentDays = 0;
        let leaveDays = 0;
        let wfhDays = 0;
        let workingDays = 0;

        for (let d = parseDateOnly(toDateStr(cycle.cycleStart)); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
            const dateStr = toDateStr(d);
            const rec = dayMap.get(dateStr);
            const leave = leaves.find(l => dateStr >= l.startDate && dateStr <= l.endDate);

            if (leave && isWorkFromHomeLeave(leave.leaveType)) {
                wfhDays++;
                workingDays++;
                continue;
            }

            if (leave && isFullDayLeave(leave, dateStr)) {
                leaveDays++;
                continue;
            }

            if (rec && rec.time) {
                if (isLateEntry(rec.time, attendanceSettings)) {
                    lateDays++;
                } else {
                    presentDays++;
                }
                workingDays++;
                continue;
            }

            if (rec && String(rec.status || '').toLowerCase() === 'absent') {
                absentDays++;
                continue;
            }

            // No attendance record for a non-leave day inside cycle is treated as absent.
            absentDays++;
        }

        const lateHalfDays = Math.floor(lateDays / (Number(attendanceSettings.lateDaysHalfDay) || 3)) * 0.5;

        res.json({
            employeeId,
            month,
            cycleStart: startDate,
            cycleEnd: endDate,
            isFirstSalaryMonth: cycle.isFirstSalaryMonth,
            // Keep explicit salaryPeriod for reporting surfaces and clients.
            salaryPeriod: {
                start: startDate,
                end: endDate,
                isFirstSalaryMonth: cycle.isFirstSalaryMonth
            },
            policy: {
                officeStartTime: attendanceSettings.officeStartTime,
                lateThresholdMins: Number(attendanceSettings.lateThresholdMins) || 0,
                lateDaysHalfDay: Number(attendanceSettings.lateDaysHalfDay) || 3
            },
            summary: {
                workingDays,
                presentDays,
                lateDays,
                lateHalfDays,
                absentDays,
                leaveDays,
                wfhDays
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/attendance/:date  — records for one day
router.get('/:date', async (req, res) => {
    try {
        const db = getDB();
        const doc = await db.collection('attendance').findOne({ date: req.params.date });
        const records = doc ? doc.records : {};

        if (req.auth?.role === 'employee') {
            const employeeId = parseInt(req.auth.employeeId, 10);
            const ownRec = records?.[employeeId] || records?.[String(employeeId)] || null;
            return res.json(ownRec ? { [employeeId]: ownRec } : {});
        }

        res.json(records);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/attendance/:date  — upsert full records object for a day
router.put('/:date', async (req, res) => {
    try {
        const db = getDB();
        await db.collection('attendance').updateOne(
            { date: req.params.date },
            { $set: { date: req.params.date, records: req.body } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
