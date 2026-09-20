const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { ObjectId } = require('mongodb');
const { sendMail } = require('../utils/mailer');
const { buildIncentiveEmail } = require('../utils/emailTemplates');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// ─── Incentive Payment Management ───────────────────────────────────────────

// GET /api/incentives/payments - list all incentive payment records
router.get('/payments', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { status, employeeId, month } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (employeeId) filter.employeeId = parseInt(employeeId);
        if (month) filter.incentiveMonth = month;
        const records = await db.collection('incentive_payments').find(filter).sort({ createdAt: -1 }).toArray();
        res.json(records);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/incentives/payments - create a new incentive payment record
router.post('/payments', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { employeeId, employeeName, admissionCount, incentiveAmount, incentiveMonth, remarks } = req.body;
        if (!employeeId || !incentiveAmount) {
            return res.status(400).json({ error: 'employeeId and incentiveAmount are required' });
        }
        const record = {
            employeeId: parseInt(employeeId),
            employeeName: String(employeeName || '').trim(),
            admissionCount: parseInt(admissionCount) || 0,
            incentiveAmount: parseFloat(incentiveAmount) || 0,
            incentiveMonth: String(incentiveMonth || '').trim(),
            remarks: String(remarks || '').trim(),
            status: 'pending',
            paymentDate: null,
            paidBy: null,
            createdAt: new Date()
        };
        const result = await db.collection('incentive_payments').insertOne(record);
        res.status(201).json({ success: true, id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/incentives/payments/:id/mark-paid - mark incentive as paid and send email
router.put('/payments/:id/mark-paid', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid record ID' });

        const record = await db.collection('incentive_payments').findOne({ _id: new ObjectId(id) });
        if (!record) return res.status(404).json({ error: 'Incentive payment record not found' });
        if (record.status === 'paid') return res.status(409).json({ error: 'Incentive already marked as paid' });

        const { paidBy = 'Admin', remarks } = req.body;
        const paymentDate = new Date();

        await db.collection('incentive_payments').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: 'paid',
                    paymentDate,
                    paidBy: String(paidBy).trim(),
                    remarks: remarks !== undefined ? String(remarks).trim() : record.remarks,
                    updatedAt: paymentDate
                }
            }
        );

        // Send congratulatory email
        const employee = await db.collection('employees').findOne({ id: record.employeeId });
        const empEmail = employee?.email || employee?.companyEmail;
        const empName = record.employeeName ||
            (employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : `Employee ${record.employeeId}`);

        let emailStatus = 'not_sent';
        let emailError = null;

        if (empEmail) {
            const formattedDate = paymentDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
            const formattedAmount = `₹${Number(record.incentiveAmount).toLocaleString('en-IN')}`;
            const subject = 'Congratulations! 🎉 Your Incentive Has Been Credited';
            const html = buildIncentiveEmail({ name: empName, amount: formattedAmount, date: formattedDate });
            const text = `Hi ${empName},\n\nCongratulations! 🎉\n\nYour performance incentive has been successfully processed and marked as paid.\n\n💰 Incentive Amount: ${formattedAmount}\n📅 Payment Date: ${formattedDate}\n\nYour dedication and hard work have made a valuable contribution to the company's success. Thank you for your outstanding efforts.\n\nBest Regards,\nHR Team\nDegreeDrishti`;

            const sent = await sendMail({ to: empEmail, subject, text, html });
            emailStatus = sent ? 'sent' : 'failed';
            if (!sent) emailError = 'SMTP delivery failed';
        } else {
            emailStatus = 'skipped';
            emailError = 'No email address found for employee';
        }

        // Log the email attempt
        await db.collection('email_logs').insertOne({
            employeeId: record.employeeId,
            employeeName: empName,
            to: empEmail || null,
            subject: 'Congratulations! 🎉 Your Incentive Has Been Credited',
            type: 'incentive_paid',
            status: emailStatus,
            error: emailError,
            retryCount: 0,
            sentAt: new Date(),
            incentivePaymentId: new ObjectId(id)
        });

        res.json({ success: true, emailStatus, emailError });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/incentives/payments/:id - delete a pending incentive record
router.delete('/payments/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid record ID' });
        const record = await db.collection('incentive_payments').findOne({ _id: new ObjectId(id) });
        if (!record) return res.status(404).json({ error: 'Record not found' });
        if (record.status === 'paid') return res.status(409).json({ error: 'Cannot delete a paid record' });
        await db.collection('incentive_payments').deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/incentives/email-logs - get email history
router.get('/email-logs', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const logs = await db.collection('email_logs').find({ type: 'incentive_paid' }).sort({ sentAt: -1 }).limit(200).toArray();
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get incentive configuration
router.get('/config', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const config = await db.collection('incentive_config').findOne({});
        
        if (!config) {
            // Return default config
            const defaultConfig = {
                slabs: { 100: 3, 150: 4, 200: 7 },
                courseRewards: { onetime: 1000, annual: 500, semester: 300 },
                dailyTarget: { salesCount: 2, bonusAmount: 1000 }
            };
            res.json(defaultConfig);
        } else {
            res.json(config);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save incentive configuration
router.post('/config', async (req, res) => {
    try {
        const db = getDB();
        const config = req.body;
        
        await db.collection('incentive_config').updateOne(
            {},
            { $set: config },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Configuration saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all incentive data
router.get('/data', async (req, res) => {
    try {
        const db = getDB();
        
        const monthlyIncentives = await db.collection('monthly_incentives').find({}).toArray();
        const dailyBonuses = await db.collection('daily_bonuses').find({}).sort({ date: -1 }).toArray();
        const salaryAdvances = await db.collection('salary_advances').find({}).sort({ date: -1 }).toArray();
        const salaryPayments = await db.collection('salary_payments').find({}).toArray();
        
        // Format monthly incentives
        const formattedMonthly = {};
        monthlyIncentives.forEach(item => {
            formattedMonthly[item.key] = {
                paid: item.paid,
                paidDate: item.paidDate,
                amount: item.amount
            };
        });
        
        // Format salary payments
        const formattedPayments = {};
        salaryPayments.forEach(item => {
            formattedPayments[item.key] = {
                paid: item.paid,
                paidDate: item.paidDate,
                grossSalary: item.grossSalary,
                deductions: item.deductions,
                netSalary: item.netSalary
            };
        });
        
        res.json({
            monthlyIncentives: formattedMonthly,
            dailyBonuses,
            salaryAdvances,
            salaryPayments: formattedPayments
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save monthly incentive payment
router.post('/monthly', async (req, res) => {
    try {
        const db = getDB();
        const { key, data } = req.body;
        
        await db.collection('monthly_incentives').updateOne(
            { key },
            { $set: { key, ...data, updatedAt: new Date() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Monthly incentive saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add daily bonus
router.post('/daily', async (req, res) => {
    try {
        const db = getDB();
        const bonus = req.body;
        
        await db.collection('daily_bonuses').insertOne(bonus);
        res.status(201).json({ success: true, bonus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add salary advance
router.post('/advance', async (req, res) => {
    try {
        const db = getDB();
        const input = req.body || {};
        const advance = {
            ...input,
            status: 'Outstanding',
            // Advances are always settled by salary adjustment in this system.
            repaid: false,
            repaidDate: null,
            adjustedInSalary: false,
            adjustedMonth: null,
            updatedAt: new Date()
        };
        
        await db.collection('salary_advances').insertOne(advance);
        res.status(201).json({ success: true, advance });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update salary advance status
router.put('/advance/:id', async (req, res) => {
    try {
        const db = getDB();
        const advanceId = parseInt(req.params.id);
        const updates = { ...(req.body || {}) };

        // Enforce salary-adjustment-only lifecycle for advances.
        if (updates.adjustedInSalary === true) {
            updates.status = 'Adjusted in Salary';
            updates.repaid = true;
            if (!updates.repaidDate) updates.repaidDate = new Date().toISOString();
        }
        if (updates.status && String(updates.status).toLowerCase() === 'repaid') {
            delete updates.status;
        }
        updates.updatedAt = new Date();
        
        const result = await db.collection('salary_advances').updateOne(
            { id: advanceId },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Advance not found' });
        }
        
        res.json({ success: true, message: 'Advance updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete salary advance
router.delete('/advance/:id', async (req, res) => {
    try {
        const db = getDB();
        const advanceId = parseInt(req.params.id);
        
        // First check if the advance exists and if it's already adjusted in salary
        const advance = await db.collection('salary_advances').findOne({ id: advanceId });
        
        if (!advance) {
            return res.status(404).json({ error: 'Advance not found' });
        }
        
        // Prevent deletion if already adjusted in salary
        if (advance.adjustedInSalary === true || advance.repaid === true) {
            return res.status(409).json({ error: 'Cannot delete advance that has already been adjusted in salary' });
        }
        
        await db.collection('salary_advances').deleteOne({ id: advanceId });
        
        res.json({ success: true, message: 'Advance deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save salary payment
router.post('/salary-payment', async (req, res) => {
    try {
        const db = getDB();
        const { key, data } = req.body;
        
        await db.collection('salary_payments').updateOne(
            { key },
            { $set: { key, ...data, updatedAt: new Date() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'Salary payment saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
