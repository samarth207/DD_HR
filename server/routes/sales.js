const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { sendMail } = require('../utils/mailer');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

async function getEmployeeById(db, employeeId) {
    if (!employeeId) return null;
    return db.collection('employees').findOne({ id: parseInt(employeeId) });
}

async function sendTargetSetNotification({ employee, month, salesTarget, revenueTarget, previousSalesTarget, previousRevenueTarget }) {
    if (!employee || !employee.email) return;
    const fullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
    const monthLabel = typeof month === 'string' ? month : String(month || '');
    const subject = 'Monthly Target Assigned | DegreeDrishti HR';

    const text = [
        `Hi ${fullName},`,
        '',
        `Your monthly target has been set for ${monthLabel}.`,
        `Sales target: ${salesTarget ?? 0}`,
        '',
        `Previous sales target: ${previousSalesTarget ?? 0}`,
        '',
        'Please plan your month accordingly.',
        '',
        'Regards,',
        'DegreeDrishti HR'
    ].join('\n');

    const html = `<p>Hi ${fullName},</p><p>Your monthly target has been set for <strong>${monthLabel}</strong>.</p><ul><li><strong>Sales target:</strong> ${salesTarget ?? 0}</li></ul><p><strong>Previous sales target:</strong> ${previousSalesTarget ?? 0}</p><p>Please plan your month accordingly.</p><p>Regards,<br/>DegreeDrishti HR</p>`;

    await sendMail({ to: employee.email, subject, text, html });
}

// Get all sales data
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const salesData = await db.collection('sales').find({}).toArray();
        
        // Convert array to nested object structure for compatibility
        const formatted = {};
        salesData.forEach(record => {
            if (!formatted[record.month]) {
                formatted[record.month] = {};
            }
            formatted[record.month][record.employeeId] = {
                salesTarget: record.salesTarget,
                salesAchieved: record.salesAchieved,
                revenueTarget: record.revenueTarget,
                revenueAchieved: record.revenueAchieved
            };
        });
        
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get sales data by month
router.get('/month/:month', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const salesData = await db.collection('sales').find({ 
            month: req.params.month 
        }).toArray();
        res.json(salesData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update or create sales record
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, employeeId, data } = req.body;
        const normalizedEmployeeId = parseInt(employeeId);
        const existing = await db.collection('sales').findOne({ month, employeeId: normalizedEmployeeId });

        const nextSalesTarget = data && Object.prototype.hasOwnProperty.call(data, 'salesTarget')
            ? parseInt(data.salesTarget) || 0
            : (existing?.salesTarget || 0);
        const nextRevenueTarget = data && Object.prototype.hasOwnProperty.call(data, 'revenueTarget')
            ? parseFloat(data.revenueTarget) || 0
            : (existing?.revenueTarget || 0);
        const prevSalesTarget = parseInt(existing?.salesTarget) || 0;
        const prevRevenueTarget = parseFloat(existing?.revenueTarget) || 0;

        const targetMentioned = data && (
            Object.prototype.hasOwnProperty.call(data, 'salesTarget') ||
            Object.prototype.hasOwnProperty.call(data, 'revenueTarget')
        );
        const targetsChanged = nextSalesTarget !== prevSalesTarget || nextRevenueTarget !== prevRevenueTarget;
        
        await db.collection('sales').updateOne(
            { month, employeeId: normalizedEmployeeId },
            { 
                $set: { 
                    month, 
                    employeeId: normalizedEmployeeId,
                    ...data,
                    updatedAt: new Date()
                } 
            },
            { upsert: true }
        );

        if (targetMentioned && targetsChanged) {
            const employee = await getEmployeeById(db, normalizedEmployeeId);
            await sendTargetSetNotification({
                employee,
                month,
                salesTarget: nextSalesTarget,
                revenueTarget: nextRevenueTarget,
                previousSalesTarget: prevSalesTarget,
                previousRevenueTarget: prevRevenueTarget
            });
        }
        
        res.json({ success: true, message: 'Sales data saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
