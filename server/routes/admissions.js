const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { ObjectId } = require('mongodb');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const EDITABLE_FIELDS = ['customerName', 'customerPhone', 'customerEmail', 'universityName', 'admissionDate', 'admissionType', 'revenue'];

function getAdmissionStatus(admission) {
    const status = typeof admission?.status === 'string' ? admission.status.trim().toLowerCase() : '';
    return status || 'approved';
}

function normalizeEditableAdmissionFields(payload = {}) {
    return {
        customerName: payload.customerName ? String(payload.customerName).trim() : '',
        customerPhone: payload.customerPhone ? String(payload.customerPhone).trim() : '',
        customerEmail: payload.customerEmail ? String(payload.customerEmail).trim() : '',
        universityName: payload.universityName ? String(payload.universityName).trim() : '',
        admissionDate: payload.admissionDate ? String(payload.admissionDate) : '',
        admissionType: payload.admissionType ? String(payload.admissionType) : '',
        revenue: parseFloat(payload.revenue) || 0
    };
}

function getAdmissionEditSummary(previous, next) {
    const labels = {
        customerName: 'Customer Name',
        customerPhone: 'Phone',
        customerEmail: 'Email',
        universityName: 'University',
        admissionDate: 'Admission Date',
        admissionType: 'Admission Type',
        revenue: 'Revenue'
    };
    return EDITABLE_FIELDS
        .filter(field => String(previous[field] ?? '') !== String(next[field] ?? ''))
        .map(field => labels[field]);
}

// GET /api/admissions?employeeId=X&month=YYYY-MM
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const query = {};
        if (req.query.employeeId) query.employeeId = parseInt(req.query.employeeId);
        if (req.query.month)      query.month = req.query.month;
        if (req.query.status)     query.status = req.query.status;
        const records = await db.collection('admissions').find(query).sort({ admissionDate: -1 }).toArray();
        res.json(records.map(record => ({ ...record, status: getAdmissionStatus(record) })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admissions - Add one admission record and update sales aggregate
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const {
            employeeId,
            month,
            customerName,
            customerPhone,
            customerEmail,
            admissionDate,
            admissionType,
            revenue,
            universityName,
            status,
            submittedBy
        } = req.body;

        if (!employeeId || !month || !customerName || !admissionDate || !admissionType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const normalizedStatus = (status === 'approved' || status === 'rejected') ? status : 'pending';

        // Insert the individual admission record
        const admission = {
            employeeId: parseInt(employeeId),
            month,
            customerName: String(customerName).trim(),
            customerPhone: customerPhone ? String(customerPhone).trim() : '',
            customerEmail: customerEmail ? String(customerEmail).trim() : '',
            universityName: universityName ? String(universityName).trim() : '',
            admissionDate,
            admissionType,
            revenue: parseFloat(revenue) || 0,
            status: normalizedStatus,
            submittedBy: submittedBy || 'admin',
            createdAt: new Date(),
            approvedAt: normalizedStatus === 'approved' ? new Date() : null
        };

        await db.collection('admissions').insertOne(admission);

        // Update sales aggregate only for approved admissions.
        if (normalizedStatus === 'approved') {
            await db.collection('sales').updateOne(
                { month, employeeId: parseInt(employeeId) },
                {
                    $inc: {
                        salesAchieved: 1,
                        revenueAchieved: parseFloat(revenue) || 0
                    },
                    $setOnInsert: {
                        salesTarget: 0,
                        revenueTarget: 0,
                        updatedAt: new Date()
                    },
                    $set: { updatedAt: new Date() }
                },
                { upsert: true }
            );
        }

        res.json({
            success: true,
            message: normalizedStatus === 'approved'
                ? 'Admission recorded'
                : 'Admission submitted for approval'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/admissions/:id/status - approve/reject an admission
router.put('/:id/status', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const id = req.params.id;
        const nextStatus = String(req.body?.status || '').toLowerCase();
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });
        if (!['approved', 'rejected'].includes(nextStatus)) {
            return res.status(400).json({ error: 'Invalid status. Use approved or rejected.' });
        }

        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(id) });
        if (!admission) return res.status(404).json({ error: 'Admission not found' });

        const previousStatus = getAdmissionStatus(admission);
        if (previousStatus === nextStatus) {
            return res.json({ success: true, message: `Admission already ${nextStatus}` });
        }

        // If moving from non-approved to approved, increment aggregate once.
        if (previousStatus !== 'approved' && nextStatus === 'approved') {
            await db.collection('sales').updateOne(
                { month: admission.month, employeeId: admission.employeeId },
                {
                    $inc: {
                        salesAchieved: 1,
                        revenueAchieved: parseFloat(admission.revenue) || 0
                    },
                    $setOnInsert: {
                        salesTarget: 0,
                        revenueTarget: 0
                    },
                    $set: { updatedAt: new Date() }
                },
                { upsert: true }
            );
        }

        // If moving from approved to rejected, rollback aggregate.
        if (previousStatus === 'approved' && nextStatus !== 'approved') {
            await db.collection('sales').updateOne(
                { month: admission.month, employeeId: admission.employeeId },
                {
                    $inc: {
                        salesAchieved: -1,
                        revenueAchieved: -(parseFloat(admission.revenue) || 0)
                    },
                    $set: { updatedAt: new Date() }
                }
            );
        }

        const reviewNote = req.body?.reviewNote ? String(req.body.reviewNote).trim() : '';

        await db.collection('admissions').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: nextStatus,
                    approvedAt: nextStatus === 'approved' ? new Date() : null,
                    reviewedAt: new Date(),
                    reviewNote,
                    reviewOutcome: nextStatus === 'rejected' ? 'rejected' : 'reviewed'
                }
            }
        );

        res.json({ success: true, message: `Admission ${nextStatus}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/admissions/:id - edit lead details and keep employee-visible review trail
router.put('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });

        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(id) });
        if (!admission) return res.status(404).json({ error: 'Admission not found' });

        const nextFields = normalizeEditableAdmissionFields(req.body);
        if (!nextFields.customerName || !nextFields.admissionDate || !nextFields.admissionType) {
            return res.status(400).json({ error: 'Customer name, admission date and admission type are required' });
        }

        const editSummary = getAdmissionEditSummary(admission, nextFields);
        const reviewNote = req.body?.reviewNote ? String(req.body.reviewNote).trim() : '';

        if (!editSummary.length && !reviewNote) {
            return res.json({ success: true, message: 'No admission changes detected' });
        }

        const updatedDoc = {
            ...nextFields,
            updatedAt: new Date(),
            adminEditedAt: new Date(),
            reviewNote,
            reviewOutcome: 'edited',
            editSummary
        };

        await db.collection('admissions').updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedDoc }
        );

        if ((admission.status || 'pending') === 'approved') {
            const revenueDelta = nextFields.revenue - (parseFloat(admission.revenue) || 0);
            if (revenueDelta !== 0) {
                await db.collection('sales').updateOne(
                    { month: admission.month, employeeId: admission.employeeId },
                    {
                        $inc: { revenueAchieved: revenueDelta },
                        $set: { updatedAt: new Date() }
                    }
                );
            }
        }

        res.json({ success: true, message: editSummary.length ? 'Admission details updated' : 'Review note saved', editSummary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admissions/:id
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });

        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(id) });
        if (!admission) return res.status(404).json({ error: 'Admission not found' });

        await db.collection('admissions').deleteOne({ _id: new ObjectId(id) });

        // Decrement aggregate only if this admission had been approved.
        if (getAdmissionStatus(admission) === 'approved') {
            await db.collection('sales').updateOne(
                { month: admission.month, employeeId: admission.employeeId },
                {
                    $inc: {
                        salesAchieved: -1,
                        revenueAchieved: -(parseFloat(admission.revenue) || 0)
                    },
                    $set: { updatedAt: new Date() }
                }
            );
        }

        res.json({ success: true, message: 'Admission deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
