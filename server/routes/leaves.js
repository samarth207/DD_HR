const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const DEFAULT_PAID_LEAVE = 12;
const UNPAID_LEAVE_TYPES = new Set(['Unpaid Leave', 'Maternity Leave', 'Paternity Leave', 'Work From Home']);

function parseDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calculateDays(startDate, endDate, isHalfDay) {
    if (isHalfDay) return 0.5;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return 0;
    const diffTime = end.getTime() - start.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// Returns sandwich Sunday info for a leave being submitted or updated.
// Attribution rule: sandwich Sundays are ONLY owned by the MONDAY leave, never by Saturday.
// For each Monday within the new leave's date range, if Saturday 2 days before is a leave day
// and Sunday 1 day before is NOT a leave day → that Sunday is a sandwich day.
// Returns { total, paidSandwich } where paidSandwich counts Sundays whose Monday is a paid type.
async function getSandwichInfo(db, employeeId, newStartStr, newEndStr, newLeaveType, excludeLeaveId) {
    const ns = parseDate(newStartStr), ne = parseDate(newEndStr);
    if (!ns || !ne) return { total: 0, paidSandwich: 0 };

    const query = { employeeId, status: { $ne: 'rejected' } };
    if (excludeLeaveId) query.id = { $ne: excludeLeaveId };
    const otherLeaves = await db.collection('leaves').find(query).toArray();

    // Build dateStr -> leaveType map from existing leaves
    const existingMap = {};
    for (const l of otherLeaves) {
        const ls = parseDate(l.startDate), le = parseDate(l.endDate);
        if (!ls || !le) continue;
        for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
            existingMap[toDateStr(d)] = l.leaveType;
        }
    }

    // Build map for the new leave dates
    const newDatesMap = {};
    for (let d = new Date(ns); d <= ne; d.setDate(d.getDate() + 1)) {
        newDatesMap[toDateStr(d)] = newLeaveType;
    }

    // Combined map for checking whether Sunday is already a leave day
    const combinedMap = { ...existingMap, ...newDatesMap };

    // Only Mondays within the NEW leave's range can trigger a sandwich.
    // Saturday can never own sandwich days — this prevents double-counting.
    let total = 0, paidSandwich = 0;
    for (const dateStr of Object.keys(newDatesMap)) {
        const d = new Date(dateStr + 'T00:00:00');
        if (d.getDay() === 1) { // Monday
            const sat = new Date(d); sat.setDate(sat.getDate() - 2);
            const sun = new Date(d); sun.setDate(sun.getDate() - 1);
            const satStr = toDateStr(sat), sunStr = toDateStr(sun);
            // Saturday must be a leave day, Sunday must NOT be a leave day
            if (combinedMap[satStr] && !combinedMap[sunStr]) {
                total++;
                // Sandwich Sunday type follows Monday's leave type
                if (!UNPAID_LEAVE_TYPES.has(newLeaveType)) {
                    paidSandwich++;
                }
            }
        }
    }

    return { total, paidSandwich };
}

// Returns true if the employee is currently marked as on probation
async function checkProbation(db, employeeId) {
    const emp = await db.collection('employees').findOne({ id: employeeId });
    if (!emp) return false;
    return emp.isOnProbation === true;
}

function isApprovedPaidLeave(leave) {
    return leave?.status === 'approved' && !UNPAID_LEAVE_TYPES.has(leave?.leaveType);
}

function getPaidLeaveBalance(employee) {
    const leaveBalance = employee.leaveBalance || {};
    if (leaveBalance.paidLeave !== undefined && leaveBalance.paidLeave !== null) {
        return parseFloat(leaveBalance.paidLeave) || 0;
    }
    const legacyTotal = (leaveBalance.annualLeave || 0) + (leaveBalance.sickLeave || 0) + (leaveBalance.personalLeave || 0);
    return legacyTotal || DEFAULT_PAID_LEAVE;
}

// Returns the salary-cycle window that contains dateStr, anchored on cycleDay (hire-date day).
function getCycleWindowForDate(dateStr, cycleDay) {
    const d = parseDate(dateStr);
    if (!d || !cycleDay) return null;
    const year = d.getFullYear(), month = d.getMonth(), day = d.getDate();
    let start, end;
    if (day >= cycleDay) {
        start = new Date(year, month, cycleDay);
        end   = new Date(year, month + 1, cycleDay - 1);
    } else {
        start = new Date(year, month - 1, cycleDay);
        end   = new Date(year, month, cycleDay - 1);
    }
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

// Enforces the 1-paid-leave-per-cycle rule.
// excludeLeaveId – set to the current leave id when updating so self is not counted.
async function checkOnePaidLeavePerCycle(db, employeeId, leaveStartDate, excludeLeaveId) {
    const employee = await db.collection('employees').findOne({ id: employeeId });
    if (!employee || !employee.hireDate) return { ok: true };
    const hireDay = Math.min(new Date(employee.hireDate + 'T00:00:00').getDate(), 28);
    const cycle = getCycleWindowForDate(leaveStartDate, hireDay);
    if (!cycle) return { ok: true };
    const cycleStartStr = toDateStr(cycle.start);
    const cycleEndStr   = toDateStr(cycle.end);
    const query = {
        employeeId,
        status: { $ne: 'rejected' },
        leaveType: { $nin: Array.from(UNPAID_LEAVE_TYPES) },
        startDate: { $lte: cycleEndStr },
        endDate:   { $gte: cycleStartStr }
    };
    if (excludeLeaveId) query.id = { $ne: excludeLeaveId };
    const existing = await db.collection('leaves').findOne(query);
    if (existing) {
        return {
            ok: false,
            message: `Only 1 paid leave is allowed per salary cycle (${cycleStartStr} to ${cycleEndStr}). A paid leave already exists from ${existing.startDate} to ${existing.endDate} in this cycle.`,
            paidLeaveLimit: true
        };
    }
    return { ok: true };
}

async function enforceNoHolidayInRange(db, startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) {
        return { ok: false, message: 'Invalid start or end date' };
    }
    if (end < start) {
        return { ok: false, message: 'End date cannot be before start date' };
    }

    const dates = [];
    const current = new Date(start);
    while (current <= end) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        dates.push(dateStr);
        current.setDate(current.getDate() + 1);
    }

    const holiday = await db.collection('holidays').findOne({ date: { $in: dates } });
    if (holiday) {
        return {
            ok: false,
            message: `Cannot apply leave on holiday: ${holiday.name || holiday.date} (${holiday.date})`
        };
    }

    return { ok: true };
}

async function applyLeaveBalanceDelta(db, employeeId, deltaDays) {
    if (!deltaDays) return { ok: true };

    const employee = await db.collection('employees').findOne({ id: employeeId });
    if (!employee) {
        return { ok: false, status: 404, message: 'Employee not found' };
    }

    const currentPaidLeave = getPaidLeaveBalance(employee);
    const newPaidLeave = Math.round((currentPaidLeave + deltaDays) * 10) / 10;

    if (newPaidLeave < 0) {
        return {
            ok: false,
            status: 400,
            message: `Insufficient paid leave balance. Available: ${currentPaidLeave} day(s)`
        };
    }

    const updatedLeaveBalance = { ...(employee.leaveBalance || {}), paidLeave: newPaidLeave };
    await db.collection('employees').updateOne(
        { id: employeeId },
        { $set: { leaveBalance: updatedLeaveBalance } }
    );

    return { ok: true };
}

// Get all leaves
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const leaves = await db.collection('leaves').find({}).sort({ startDate: -1 }).toArray();
        res.json(leaves);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get leaves by employee ID
router.get('/employee/:id', async (req, res) => {
    try {
        const db = getDB();
        const leaves = await db.collection('leaves').find({ 
            employeeId: parseInt(req.params.id) 
        }).sort({ startDate: -1 }).toArray();
        res.json(leaves);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new leave
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const leave = { ...req.body };
        leave.employeeId = parseInt(leave.employeeId);

        if (!leave.startDate || !leave.endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const holidayCheck = await enforceNoHolidayInRange(db, leave.startDate, leave.endDate);
        if (!holidayCheck.ok) {
            return res.status(400).json({ error: holidayCheck.message });
        }

        // Probation check — paid leave not allowed during probation
        const isPaidType = !UNPAID_LEAVE_TYPES.has(leave.leaveType);
        if (isPaidType && leave.leaveType !== 'Work From Home') {
            const onProbation = await checkProbation(db, leave.employeeId);
            if (onProbation) {
                return res.status(400).json({
                    error: 'Employee is currently on probation. Paid leave is not allowed during the probation period.',
                    probation: true
                });
            }
        }

        // One paid leave per salary cycle
        if (isPaidType && leave.leaveType !== 'Work From Home' && leave.status !== 'rejected') {
            const cycleCheck = await checkOnePaidLeavePerCycle(db, leave.employeeId, leave.startDate, null);
            if (!cycleCheck.ok) {
                return res.status(400).json({ error: cycleCheck.message, paidLeaveLimit: true });
            }
        }

        // Sandwich leave rule: if Sat+Mon leaves exist, Sunday is counted
        // sandwichDays = total (for display); paidSandwichDays = only those whose Monday is paid (for balance)
        const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
        const sandwichInfo = isHalfDay ? { total: 0, paidSandwich: 0 } : await getSandwichInfo(db, leave.employeeId, leave.startDate, leave.endDate, leave.leaveType, null);
        leave.sandwichDays = sandwichInfo.total;
        leave.paidSandwichDays = sandwichInfo.paidSandwich;

        if (isApprovedPaidLeave(leave)) {
            const rawDays = calculateDays(leave.startDate, leave.endDate, isHalfDay);
            const totalDays = rawDays + sandwichInfo.paidSandwich;
            const balanceResult = await applyLeaveBalanceDelta(db, leave.employeeId, -totalDays);
            if (!balanceResult.ok) {
                return res.status(balanceResult.status || 400).json({ error: balanceResult.message });
            }
        }

        await db.collection('leaves').insertOne(leave);
        res.status(201).json({ success: true, leave });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update leave
router.put('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const leaveId = parseInt(req.params.id);
        const existingLeave = await db.collection('leaves').findOne({ id: leaveId });

        if (!existingLeave) {
            return res.status(404).json({ error: 'Leave not found' });
        }

        const { _id, ...updates } = req.body;
        const nextLeave = { ...existingLeave, ...updates, id: leaveId };
        nextLeave.employeeId = parseInt(nextLeave.employeeId);

        const holidayCheck = await enforceNoHolidayInRange(db, nextLeave.startDate, nextLeave.endDate);
        if (!holidayCheck.ok) {
            return res.status(400).json({ error: holidayCheck.message });
        }

        // Probation check when changing to paid leave or approving
        const newIsPaidType = !UNPAID_LEAVE_TYPES.has(nextLeave.leaveType);
        if (newIsPaidType && nextLeave.leaveType !== 'Work From Home' && isApprovedPaidLeave(nextLeave) && !isApprovedPaidLeave(existingLeave)) {
            const onProbation = await checkProbation(db, parseInt(nextLeave.employeeId));
            if (onProbation) {
                return res.status(400).json({
                    error: 'Employee is currently on probation. Paid leave is not allowed during the probation period.',
                    probation: true
                });
            }
        }

        // One paid leave per salary cycle (skip when rejecting/deleting)
        if (newIsPaidType && nextLeave.leaveType !== 'Work From Home' && nextLeave.status !== 'rejected') {
            const cycleCheck = await checkOnePaidLeavePerCycle(db, nextLeave.employeeId, nextLeave.startDate, leaveId);
            if (!cycleCheck.ok) {
                return res.status(400).json({ error: cycleCheck.message, paidLeaveLimit: true });
            }
        }

        const oldEmployeeId = parseInt(existingLeave.employeeId);
        const newEmployeeId = parseInt(nextLeave.employeeId);

        // Recalculate sandwich days for the updated leave
        const newIsHalfDay = nextLeave.halfDay === true || nextLeave.leaveType === 'Half Day';
        const newSandwichInfo = newIsHalfDay ? { total: 0, paidSandwich: 0 } : await getSandwichInfo(db, newEmployeeId, nextLeave.startDate, nextLeave.endDate, nextLeave.leaveType, leaveId);
        nextLeave.sandwichDays = newSandwichInfo.total;
        nextLeave.paidSandwichDays = newSandwichInfo.paidSandwich;

        const oldIsHalfDay = existingLeave.halfDay === true || existingLeave.leaveType === 'Half Day';
        const oldPaidApprovedDays = isApprovedPaidLeave(existingLeave)
            ? calculateDays(existingLeave.startDate, existingLeave.endDate, oldIsHalfDay) + (existingLeave.paidSandwichDays ?? existingLeave.sandwichDays ?? 0)
            : 0;
        const newPaidApprovedDays = isApprovedPaidLeave(nextLeave)
            ? calculateDays(nextLeave.startDate, nextLeave.endDate, newIsHalfDay) + newSandwichInfo.paidSandwich
            : 0;

        if (oldEmployeeId === newEmployeeId) {
            const delta = oldPaidApprovedDays - newPaidApprovedDays; // positive => refund, negative => deduct
            const balanceResult = await applyLeaveBalanceDelta(db, newEmployeeId, delta);
            if (!balanceResult.ok) {
                return res.status(balanceResult.status || 400).json({ error: balanceResult.message });
            }
        } else {
            // Validate destination employee has enough balance before moving approved paid leave.
            if (newPaidApprovedDays > 0) {
                const validation = await applyLeaveBalanceDelta(db, newEmployeeId, -newPaidApprovedDays);
                if (!validation.ok) {
                    return res.status(validation.status || 400).json({ error: validation.message });
                }
            }
            if (oldPaidApprovedDays > 0) {
                await applyLeaveBalanceDelta(db, oldEmployeeId, oldPaidApprovedDays);
            }
        }

        const result = await db.collection('leaves').updateOne(
            { id: leaveId },
            { $set: nextLeave }
        );

        res.json({ success: true, message: 'Leave updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete leave
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const leaveId = parseInt(req.params.id);
        const leave = await db.collection('leaves').findOne({ id: leaveId });
        if (!leave) {
            return res.status(404).json({ error: 'Leave not found' });
        }

        if (isApprovedPaidLeave(leave)) {
            const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
            // Use paidSandwichDays if available; fall back to sandwichDays for old records
            const sandwichDeducted = leave.paidSandwichDays ?? leave.sandwichDays ?? 0;
            const days = calculateDays(leave.startDate, leave.endDate, isHalfDay) + sandwichDeducted;
            await applyLeaveBalanceDelta(db, parseInt(leave.employeeId), days);
        }

        const result = await db.collection('leaves').deleteOne({ id: leaveId });

        res.json({ success: true, message: 'Leave deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
