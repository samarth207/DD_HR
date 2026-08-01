const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { ObjectId } = require('mongodb');
const { sendMail } = require('../utils/mailer');

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
            const html = buildIncentiveEmailHtml({ name: empName, amount: formattedAmount, date: formattedDate });
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

function buildIncentiveEmailHtml({ name, amount, date }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Incentive Credited</title>
<style>
  body{margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.10);}
  .header{background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:40px 32px;text-align:center;}
  .header h1{color:#fff;font-size:28px;font-weight:800;margin:0 0 8px;}
  .header p{color:rgba(255,255,255,.85);font-size:15px;margin:0;}
  .badge{display:inline-block;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.4);border-radius:50px;padding:6px 20px;color:#fff;font-weight:700;font-size:14px;margin-bottom:16px;}
  .body{padding:36px 32px;}
  .greeting{font-size:18px;font-weight:700;color:#111827;margin-bottom:8px;}
  .msg{font-size:14px;color:#4b5563;line-height:1.7;margin-bottom:28px;}
  .card{background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border:2px solid #6ee7b7;border-radius:14px;padding:24px 28px;margin-bottom:28px;}
  .card-row{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
  .card-row:last-child{margin-bottom:0;}
  .card-icon{font-size:24px;}
  .card-label{font-size:12px;color:#065f46;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
  .card-value{font-size:20px;font-weight:800;color:#064e3b;}
  .msg2{font-size:14px;color:#4b5563;line-height:1.7;margin-bottom:28px;}
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;}
  .footer p{font-size:12px;color:#9ca3af;margin:4px 0;}
  .footer strong{color:#374151;}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="badge">🎉 Incentive Credited</div>
    <h1>Congratulations!</h1>
    <p>Your performance incentive has been successfully processed.</p>
  </div>
  <div class="body">
    <div class="greeting">Hi ${name},</div>
    <p class="msg">We're delighted to inform you that your performance incentive has been successfully processed and marked as paid. Your dedication, commitment, and hard work have made a valuable contribution to the company's success.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Incentive Amount</div><div class="card-value">${amount}</div></div></div>
      <div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Payment Date</div><div class="card-value">${date}</div></div></div>
    </div>
    <p class="msg2">Thank you for your outstanding efforts and continued excellence. Keep up the amazing work — we look forward to celebrating many more achievements with you!</p>
    <p class="msg2" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>
  </div>
  <div class="footer">
    <p><strong>DegreeDrishti HR Portal</strong></p>
    <p>This is an automated message. Please do not reply to this email.</p>
    <p style="margin-top:8px;font-size:11px;">© ${new Date().getFullYear()} DegreeDrishti. All rights reserved.</p>
  </div>
</div>
</body></html>`;
}

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
