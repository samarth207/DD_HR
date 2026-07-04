const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { sendMail } = require('../utils/mailer');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

const UNPAID_LEAVE_TYPES = new Set(['Unpaid Leave', 'Maternity Leave', 'Paternity Leave']);

function formatRupees(value) {
    return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMonthKey(month, year) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function parseDateOnly(dateStr) {
    if (!dateStr) return null;
    const date = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getCycleDayFromHireDate(hireDate) {
    const hd = parseDateOnly(hireDate);
    if (!hd) return null;
    return Math.min(hd.getDate(), 28);
}

function getSalaryCycleRange(month, year, hireDate) {
    const cycleDay = getCycleDayFromHireDate(hireDate);
    if (!cycleDay) {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end, cycleDay: null };
    }
    const start = new Date(year, month - 2, cycleDay);
    const end = new Date(year, month - 1, cycleDay);
    end.setHours(23, 59, 59, 999);
    return { start, end, cycleDay };
}

function isLateEntry(time, settings) {
    if (!time || !settings?.officeStartTime) return false;
    const [officeHour, officeMinute] = String(settings.officeStartTime).split(':').map(Number);
    const [entryHour, entryMinute] = String(time).split(':').map(Number);
    return ((entryHour * 60 + entryMinute) - (officeHour * 60 + officeMinute)) > (Number(settings.lateThresholdMins) || 0);
}

async function getAttendanceSettings(db) {
    const doc = await db.collection('appSettings').findOne({ _id: 'attendanceSettings' });
    return doc || { officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 };
}

async function getAttendanceDocsForMonths(db, months) {
    if (!months.length) return [];
    return db.collection('attendance').find({
        $or: months.map(month => ({ date: { $regex: `^${month}` } }))
    }).sort({ date: 1 }).toArray();
}

async function getSalaryBreakup(db, employee, record) {
    const month = parseInt(record.month, 10);
    const year = parseInt(record.year, 10);
    const monthKey = getMonthKey(month, year);
    const prevMonthKey = month === 1
        ? `${year - 1}-12`
        : `${year}-${String(month - 1).padStart(2, '0')}`;

    const [monthlyRecords, dailyBonuses, salaryAdvances, legacySalaryPayments] = await Promise.all([
        db.collection('monthly_incentives').find({}).toArray(),
        db.collection('daily_bonuses').find({}).toArray(),
        db.collection('salary_advances').find({}).toArray(),
        db.collection('salary_payments').find({}).toArray()
    ]);

    const salaryPaymentsMap = {};
    legacySalaryPayments.forEach(item => {
        if (item?.key) {
            salaryPaymentsMap[item.key] = {
                paid: item.paid,
                paidDate: item.paidDate,
                grossSalary: item.grossSalary,
                deductions: item.deductions,
                netSalary: item.netSalary
            };
        }
    });

    const payKey = `${monthKey}_${employee.id}`;
    const payRecord = salaryPaymentsMap[payKey] || null;
    const grossSalary = payRecord?.grossSalary ? parseFloat(payRecord.grossSalary) : (parseFloat(employee.salary) || 0);
    const dailyRate = grossSalary / 30;

    const cycle = getSalaryCycleRange(month, year, employee.hireDate);
    const monthStart = cycle.start;
    const monthEnd = cycle.end;

    let effectiveGross = grossSalary;
    let joiningDays = 0;
    if (employee.hireDate) {
        const hireDate = new Date(`${employee.hireDate}T00:00:00`);
        if (hireDate > monthStart && hireDate <= monthEnd) {
            joiningDays = Math.floor((monthEnd - hireDate) / 86400000) + 1;
            effectiveGross = Math.round(dailyRate * joiningDays * 100) / 100;
        }
    }

    const leaves = await db.collection('leaves').find({
        employeeId: employee.id,
        status: 'approved',
        leaveType: { $in: [...UNPAID_LEAVE_TYPES] }
    }).toArray();

    let unpaidLeaveDays = 0;
    for (const leave of leaves) {
        const ls = parseDateOnly(leave.startDate);
        const le = parseDateOnly(leave.endDate);
        if (!ls || !le) continue;
        const os = ls < monthStart ? monthStart : ls;
        const oe = le > monthEnd ? monthEnd : le;
        if (os <= oe) {
            if (leave.halfDay === true || leave.leaveType === 'Half Day') {
                unpaidLeaveDays += 0.5;
            } else {
                unpaidLeaveDays += Math.floor((oe - os) / 86400000) + 1;
                unpaidLeaveDays += leave.sandwichDays || 0;
            }
        }
    }
    const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate * 100) / 100;

    const attendanceSettings = await getAttendanceSettings(db);
    const attendanceDocs = await getAttendanceDocsForMonths(db, [monthKey, prevMonthKey]);
    const hasFullDayLeaveOnDate = (dateStr) => leaves.some(leave => {
        const sameEmployee = leave.employeeId === employee.id || leave.employeeId === String(employee.id);
        const approved = leave.status === 'approved';
        const inRange = dateStr >= leave.startDate && dateStr <= leave.endDate;
        const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
        return sameEmployee && approved && inRange && !isHalfDay;
    });
    let lateCount = 0;
    for (const doc of attendanceDocs) {
        const docDate = new Date(`${doc.date}T00:00:00`);
        if (Number.isNaN(docDate.getTime()) || docDate < monthStart || docDate > monthEnd) continue;
        if (hasFullDayLeaveOnDate(doc.date || '')) continue;
        const rec = (doc.records || {})[employee.id] || (doc.records || {})[String(employee.id)];
        if (rec && rec.time && isLateEntry(rec.time, attendanceSettings)) lateCount++;
    }
    const lateDays = Math.floor(lateCount / (Number(attendanceSettings.lateDaysHalfDay) || 3)) * 0.5;
    const lateAttendanceDeduction = Math.round(lateDays * dailyRate * 100) / 100;

    const monthlyRecord = monthlyRecords.find(item => item?.key === payKey);
    const monthlyIncentive = monthlyRecord && monthlyRecord.paid ? (parseFloat(monthlyRecord.amount) || 0) : 0;

    const visibleDailyBonuses = dailyBonuses
        .filter(bonus => (bonus.employeeId === employee.id || bonus.employeeId === String(employee.id)) && typeof bonus.date === 'string' && bonus.date.startsWith(monthKey))
        .filter(bonus => {
            const todayStr = new Date().toISOString().split('T')[0];
            const currentMonth = getMonthKey(new Date().getMonth() + 1, new Date().getFullYear());
            return monthKey === currentMonth ? bonus.date <= todayStr : true;
        });
    const dailyBonusTotal = visibleDailyBonuses.reduce((sum, bonus) => sum + (parseFloat(bonus.amount) || 0), 0);

    const outstandingAdvances = salaryAdvances.filter(advance => {
        if (!(advance.employeeId === employee.id || advance.employeeId === String(employee.id))) return false;
        if (advance.status === 'Repaid' || advance.repaid) return false;
        if (!advance.date) return true;
        const advanceMonth = advance.date.substring(0, 7);
        const alreadyDeducted = Object.entries(salaryPaymentsMap).some(([key, val]) => {
            if (!val?.paid) return false;
            const payMonth = key.substring(0, 7);
            const payEmp = key.substring(key.indexOf('_') + 1);
            return String(payEmp) === String(employee.id) && payMonth >= advanceMonth && payMonth < monthKey;
        });
        return !alreadyDeducted;
    });
    const advanceDeduction = outstandingAdvances.reduce((sum, advance) => sum + (parseFloat(advance.amount) || 0), 0);

    const totalEarnings = effectiveGross + monthlyIncentive + dailyBonusTotal;
    const totalDeductions = advanceDeduction + unpaidLeaveDeduction + lateAttendanceDeduction;
    const netSalary = Math.max(0, totalEarnings - totalDeductions);

    return {
        payKey,
        monthKey,
        grossSalary,
        dailyRate,
        joiningDays,
        effectiveGross,
        unpaidLeaveDays,
        unpaidLeaveDeduction,
        lateCount,
        lateDays,
        lateAttendanceDeduction,
        monthlyIncentive,
        dailyBonusTotal,
        advanceDeduction,
        totalEarnings,
        totalDeductions,
        netSalary,
        paidAt: record.paidAt,
        payRecord
    };
}

async function getEmployeeById(db, employeeId) {
    if (!employeeId) return null;
    return db.collection('employees').findOne({ id: parseInt(employeeId) });
}

async function sendSalaryPaidNotification(record, employee, breakup) {
    if (!employee || !employee.email) return;
    const fullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
    const monthLabel = new Date(parseInt(record.year, 10), parseInt(record.month, 10) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const subject = 'Salary Credited | DegreeDrishti HR';
    const text = [
        `Hi ${fullName},`,
        '',
        `Your salary for ${monthLabel} has been credited.`,
        '',
        `Employee ID: ${employee.id}`,
        `Department: ${employee.department || '—'}`,
        `Designation: ${employee.position || employee.designation || '—'}`,
        '',
        `Gross Salary: ${formatRupees(breakup.grossSalary)}`,
        `Daily Rate: ${formatRupees(breakup.dailyRate)} / day`,
        `Pro-rated Gross: ${formatRupees(breakup.effectiveGross)}`,
        `Monthly Incentive: ${formatRupees(breakup.monthlyIncentive)}`,
        `Daily Bonuses: ${formatRupees(breakup.dailyBonusTotal)}`,
        `Unpaid Leave Deduction: -${formatRupees(breakup.unpaidLeaveDeduction)}`,
        `Late Attendance Deduction: -${formatRupees(breakup.lateAttendanceDeduction)}`,
        `Outstanding Advance Deduction: -${formatRupees(breakup.advanceDeduction)}`,
        `Total Deductions: -${formatRupees(breakup.totalDeductions)}`,
        `Net Salary: ${formatRupees(breakup.netSalary)}`,
        '',
        `Paid At: ${new Date(record.paidAt).toLocaleString()}`,
        '',
        'Regards,',
        'DegreeDrishti HR'
    ].join('\n');

    const row = (label, value, isDeduction = false) => `<tr><td style="padding:8px 0;color:#475569;">${label}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:${isDeduction ? '#b91c1c' : '#0f172a'};">${isDeduction && !String(value).startsWith('-') ? `- ${value}` : value}</td></tr>`;
    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6;">
            <div style="max-width:720px;margin:0 auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#fff;">
                <div style="background:linear-gradient(135deg,#111827,#1f2937);color:#fff;padding:24px 28px;">
                    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">DegreeDrishti HR</div>
                    <div style="font-size:24px;font-weight:700;margin-top:6px;">Salary Credit Confirmation</div>
                    <div style="font-size:14px;color:#cbd5e1;margin-top:4px;">${monthLabel}</div>
                </div>
                <div style="padding:28px;">
                    <p style="margin:0 0 18px;">Hi ${fullName},</p>
                    <p style="margin:0 0 18px;color:#334155;">Your salary for <strong>${monthLabel}</strong> has been credited. The complete breakup is below.</p>
                    <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        ${row('Employee ID', employee.id)}
                        ${row('Department', employee.department || '—')}
                        ${row('Designation', employee.position || employee.designation || '—')}
                        <tr><td colspan="2" style="padding:10px 0;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
                        ${row('Gross Salary', formatRupees(breakup.grossSalary))}
                        ${row('Daily Rate', `${formatRupees(breakup.dailyRate)} / day`)}
                        ${breakup.joiningDays > 0 ? row('Pro-rated Gross', formatRupees(breakup.effectiveGross)) : ''}
                        ${row('Monthly Incentive', formatRupees(breakup.monthlyIncentive))}
                        ${row('Daily Bonuses', formatRupees(breakup.dailyBonusTotal))}
                        <tr><td colspan="2" style="padding:10px 0;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
                        ${row('Unpaid Leave Deduction', formatRupees(breakup.unpaidLeaveDeduction), true)}
                        ${row('Late Attendance Deduction', formatRupees(breakup.lateAttendanceDeduction), true)}
                        ${row('Outstanding Advance Deduction', formatRupees(breakup.advanceDeduction), true)}
                        ${row('Total Deductions', formatRupees(breakup.totalDeductions), true)}
                        <tr><td colspan="2" style="padding:10px 0;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
                        <tr>
                            <td style="padding:8px 0;font-size:16px;font-weight:700;color:#0f172a;">Net Salary</td>
                            <td style="padding:8px 0;text-align:right;font-size:18px;font-weight:800;color:#059669;">${formatRupees(breakup.netSalary)}</td>
                        </tr>
                    </table>
                    <div style="margin-top:18px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;color:#475569;">
                        <div><strong>Paid At:</strong> ${new Date(record.paidAt).toLocaleString()}</div>
                        <div><strong>Working Days:</strong> ${breakup.joiningDays > 0 ? `${breakup.joiningDays} joined-days` : 'full month'}</div>
                        <div><strong>Leave Deductions:</strong> ${breakup.unpaidLeaveDays} day(s)</div>
                        <div><strong>Late Attendance:</strong> ${breakup.lateCount} late day(s)</div>
                    </div>
                    <p style="margin:18px 0 0;color:#334155;">Regards,<br/>DegreeDrishti HR</p>
                </div>
            </div>
        </div>`;
    await sendMail({ to: employee.email, subject, text, html });
}

// GET /api/salary-payments?month=5&year=2026
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const filter = {};
        if (req.query.month) filter.month = parseInt(req.query.month);
        if (req.query.year)  filter.year  = parseInt(req.query.year);
        const records = await db.collection('salaryPayments').find(filter).toArray();
        res.json(records);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/salary-payments  — mark salary as paid
// Body: { employeeId, month, year }
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { employeeId, month, year } = req.body;
        if (!employeeId || !month || !year) {
            return res.status(400).json({ error: 'employeeId, month and year are required' });
        }
        const record = {
            employeeId: parseInt(employeeId),
            month: parseInt(month),
            year:  parseInt(year),
            paidAt: new Date().toISOString()
        };
        // Upsert so repeated marks are idempotent
        await db.collection('salaryPayments').updateOne(
            { employeeId: record.employeeId, month: record.month, year: record.year },
            { $set: record },
            { upsert: true }
        );

        const employee = await getEmployeeById(db, record.employeeId);
        if (employee) {
            const breakup = await getSalaryBreakup(db, employee, record);
            await sendSalaryPaidNotification(record, employee, breakup);
        }

        res.status(201).json({ success: true, record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/salary-payments  — unmark (undo paid)
// Body: { employeeId, month, year }
router.delete('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { employeeId, month, year } = req.body;
        await db.collection('salaryPayments').deleteOne({
            employeeId: parseInt(employeeId),
            month: parseInt(month),
            year:  parseInt(year)
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
