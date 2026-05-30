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

function calculateDays(startDate, endDate, isHalfDay) {
    if (isHalfDay) return 0.5;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return 0;
    const diffTime = end.getTime() - start.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
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

        if (isApprovedPaidLeave(leave)) {
            const days = calculateDays(leave.startDate, leave.endDate, leave.halfDay === true || leave.leaveType === 'Half Day');
            const balanceResult = await applyLeaveBalanceDelta(db, leave.employeeId, -days);
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

        const oldEmployeeId = parseInt(existingLeave.employeeId);
        const newEmployeeId = parseInt(nextLeave.employeeId);
        const oldPaidApprovedDays = isApprovedPaidLeave(existingLeave) ? calculateDays(existingLeave.startDate, existingLeave.endDate, existingLeave.halfDay === true || existingLeave.leaveType === 'Half Day') : 0;
        const newPaidApprovedDays = isApprovedPaidLeave(nextLeave) ? calculateDays(nextLeave.startDate, nextLeave.endDate, nextLeave.halfDay === true || nextLeave.leaveType === 'Half Day') : 0;

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
            const days = calculateDays(leave.startDate, leave.endDate);
            await applyLeaveBalanceDelta(db, parseInt(leave.employeeId), days);
        }

        const result = await db.collection('leaves').deleteOne({ id: leaveId });

        res.json({ success: true, message: 'Leave deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
