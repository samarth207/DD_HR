const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { ObjectId } = require('mongodb');
const { sendMail } = require('../utils/mailer');
const {
    normalizeAdmissionFeeManagement,
    buildLegacyFeeManagement,
    normalizeAdmissionType
} = require('../utils/admission-fee-management');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const EDITABLE_FIELDS = ['customerName', 'customerPhone', 'customerEmail', 'alternateCustomerPhone', 'alternateCustomerEmail', 'course', 'universityName', 'admissionDate', 'admissionType', 'revenue'];

async function getEmployeeById(db, employeeId) {
    if (!employeeId) return null;
    return db.collection('employees').findOne({ id: parseInt(employeeId) });
}

async function sendSalesApprovedNotification(admission, employee) {
    if (!employee || !employee.email) return;
    const fullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
    const subject = 'Sales Record Approved | DegreeDrishti HR';
    const text = `Hi ${fullName},\n\nYour sales record has been approved.\n\nStudent: ${admission.customerName}\nUniversity: ${admission.universityName}\nRevenue: ₹${parseFloat(admission.revenue || 0).toFixed(2)}\n\nThank you for your effort.\n\nRegards,\nDegreeDrishti HR`;
    const html = `<p>Hi ${fullName},</p><p>Your sales record has been approved.</p><ul><li><strong>Student:</strong> ${admission.customerName}</li><li><strong>University:</strong> ${admission.universityName}</li><li><strong>Revenue:</strong> ₹${parseFloat(admission.revenue || 0).toFixed(2)}</li></ul><p>Thank you for your effort.</p><p>Regards,<br/>DegreeDrishti HR</p>`;
    await sendMail({ to: employee.email, subject, text, html });
}

function getAdmissionStatus(admission) {
    const status = typeof admission?.status === 'string' ? admission.status.trim().toLowerCase() : '';
    return status || 'approved';
}

function shouldIncrementSalesForApprovalTransition(previousStatus, nextStatus) {
    return previousStatus === 'pending' && nextStatus === 'approved';
}

function unwrapFindOneAndUpdateResult(result) {
    if (!result) return null;
    if (result.value && typeof result.value === 'object') return result.value;
    return result;
}

function normalizeEditableAdmissionFields(payload = {}) {
    return {
        customerName: payload.customerName ? String(payload.customerName).trim() : '',
        customerPhone: payload.customerPhone ? String(payload.customerPhone).trim() : '',
        customerEmail: payload.customerEmail ? String(payload.customerEmail).trim() : '',
        alternateCustomerPhone: payload.alternateCustomerPhone ? String(payload.alternateCustomerPhone).trim() : '',
        alternateCustomerEmail: payload.alternateCustomerEmail ? String(payload.alternateCustomerEmail).trim() : '',
        course: payload.course ? String(payload.course).trim() : '',
        universityName: payload.universityName ? String(payload.universityName).trim() : '',
        admissionDate: payload.admissionDate ? String(payload.admissionDate) : '',
        admissionType: payload.admissionType ? String(payload.admissionType) : '',
        revenue: parseFloat(payload.revenue) || 0
    };
}

async function resolveCourseSnapshot(db, payload = {}) {
    const courseIdRaw = String(payload.courseId || '').trim();
    const universityIdRaw = String(payload.universityId || '').trim();
    const courseDuration = payload.courseDuration;
    const courseTotalFees = payload.courseTotalFees;
    let courseUniversityId = null;

    if (!courseIdRaw && !universityIdRaw && courseDuration === undefined && courseTotalFees === undefined) {
        return null;
    }

    const snapshot = {};

    if (courseIdRaw) {
        if (!ObjectId.isValid(courseIdRaw)) throw new Error('Invalid courseId');
        const courseDoc = await db.collection('courses').findOne({
            _id: new ObjectId(courseIdRaw),
            isDeleted: { $ne: true },
            isActive: true
        });
        if (!courseDoc) throw new Error('Active course not found for courseId');

        snapshot.courseId = courseDoc._id;
        snapshot.course = courseDoc.name;
        snapshot.universityId = courseDoc.universityId;
        snapshot.universityName = courseDoc.universityName;
        snapshot.courseDuration = courseDoc.duration;
        snapshot.courseTotalFees = courseDoc.totalFees;
        courseUniversityId = courseDoc.universityId;
    }

    if (universityIdRaw) {
        if (!ObjectId.isValid(universityIdRaw)) throw new Error('Invalid universityId');
        const universityDoc = await db.collection('universities').findOne({
            _id: new ObjectId(universityIdRaw),
            isDeleted: { $ne: true },
            isActive: true
        });
        if (!universityDoc) throw new Error('Active university not found for universityId');

        snapshot.universityId = universityDoc._id;
        snapshot.universityName = universityDoc.name;
    }

    if (courseUniversityId && snapshot.universityId && String(courseUniversityId) !== String(snapshot.universityId)) {
        throw new Error('courseId does not belong to universityId');
    }

    if (courseDuration !== undefined) {
        const durationNum = Number(courseDuration);
        if (!Number.isFinite(durationNum) || durationNum <= 0) throw new Error('courseDuration must be a positive number');
        snapshot.courseDuration = Math.round(durationNum * 100) / 100;
    }

    if (courseTotalFees !== undefined) {
        const totalFeesNum = Number(courseTotalFees);
        if (!Number.isFinite(totalFeesNum) || totalFeesNum < 0) throw new Error('courseTotalFees must be a non-negative number');
        snapshot.courseTotalFees = Math.round(totalFeesNum * 100) / 100;
    }

    return snapshot;
}

function resolveFeeManagementForCreate(payload, admission) {
    const feePayload = payload?.feeManagement && typeof payload.feeManagement === 'object'
        ? payload.feeManagement
        : {};

    const admissionType = normalizeAdmissionType(
        feePayload.admissionType || payload?.admissionType || admission.admissionType
    ) || 'one-time';

    const duration = feePayload.duration
        ?? payload?.duration
        ?? admission.courseDuration
        ?? admission.duration
        ?? 1;

    const totalFees = feePayload.totalFees
        ?? feePayload.actualFees
        ?? payload?.fees
        ?? payload?.totalFees
        ?? admission.courseTotalFees
        ?? admission.totalFees
        ?? admission.fees
        ?? admission.revenue;

    const discountType = feePayload.discountType || payload?.discountType;
    const discountPercent = feePayload.discountPercent ?? payload?.discountPercent;
    const installmentDiscounts = feePayload.installmentDiscounts ?? payload?.installmentDiscounts;
    const installments = Array.isArray(feePayload.installments) ? feePayload.installments : undefined;

    const normalized = normalizeAdmissionFeeManagement({
        admissionType,
        duration,
        totalFees,
        discountType,
        discountPercent,
        installmentDiscounts,
        installments
    }, {
        admissionType,
        duration,
        totalFees,
        revenue: admission.revenue
    });

    if (!payload?.feeManagement) {
        normalized.legacyMigration = {
            ...normalized.legacyMigration,
            migratedFromRevenueOnly: false,
            requiresReview: false,
            migratedAt: null
        };
    }

    return normalized;
}

function resolveFeeManagementForEdit(payload, nextFields, existingAdmission) {
    if (payload?.feeManagement && typeof payload.feeManagement === 'object') {
        const existingInstallments = Array.isArray(existingAdmission?.feeManagement?.installments)
            ? existingAdmission.feeManagement.installments
            : undefined;

        const shouldLockPaidInstallments = getAdmissionStatus(existingAdmission) === 'approved';

        const incomingInstallments = Array.isArray(payload.feeManagement.installments)
            ? payload.feeManagement.installments
            : existingInstallments;

        const lockedInstallments = shouldLockPaidInstallments && Array.isArray(existingInstallments) && Array.isArray(incomingInstallments)
            ? existingInstallments.map((previousInstallment, index) => {
                const incomingInstallment = incomingInstallments[index];
                const previousStatus = String(previousInstallment?.status || '').toLowerCase();
                const incomingStatus = String(incomingInstallment?.status || '').toLowerCase();
                
                // Only lock if previous was paid AND incoming is not explicitly changing to pending
                if (previousStatus === 'paid' && incomingStatus !== 'pending') {
                    return previousInstallment;
                }
                return incomingInstallment || previousInstallment;
            })
            : incomingInstallments;

        const feePayload = {
            ...payload.feeManagement,
            installments: lockedInstallments
        };

        return normalizeAdmissionFeeManagement(feePayload, {
            admissionType: nextFields.admissionType,
            revenue: nextFields.revenue,
            duration: existingAdmission?.courseDuration || existingAdmission?.duration || existingAdmission?.feeManagement?.duration,
            totalFees: existingAdmission?.courseTotalFees || existingAdmission?.totalFees || existingAdmission?.feeManagement?.summary?.actualFees,
            installments: existingInstallments,
            respectExplicitDiscount: Array.isArray(payload.feeManagement.installments)
        });
    }

    const existingFeeManagement = existingAdmission?.feeManagement;
    if (!existingFeeManagement) {
        return buildLegacyFeeManagement({
            ...existingAdmission,
            admissionType: nextFields.admissionType,
            revenue: nextFields.revenue
        });
    }

    if (existingFeeManagement?.legacyMigration?.migratedFromRevenueOnly) {
        return buildLegacyFeeManagement({
            ...existingAdmission,
            admissionType: nextFields.admissionType,
            revenue: nextFields.revenue
        });
    }

    const admissionTypeChanged = normalizeAdmissionType(existingAdmission?.admissionType) !== normalizeAdmissionType(nextFields.admissionType);
    const revenueChanged = roundToCurrency(existingAdmission?.revenue) !== roundToCurrency(nextFields.revenue);

    if (admissionTypeChanged || revenueChanged) {
        const existingInstallments = Array.isArray(existingFeeManagement.installments)
            ? existingFeeManagement.installments
            : undefined;

        return normalizeAdmissionFeeManagement({
            ...existingFeeManagement,
            admissionType: normalizeAdmissionType(nextFields.admissionType),
            totalFees: existingAdmission?.courseTotalFees ?? nextFields.revenue,
            installments: existingInstallments
        }, {
            admissionType: normalizeAdmissionType(nextFields.admissionType),
            totalFees: existingAdmission?.courseTotalFees ?? nextFields.revenue,
            revenue: nextFields.revenue,
            duration: existingAdmission?.courseDuration || existingAdmission?.duration || existingFeeManagement?.duration,
            installments: existingInstallments
        });
    }

    return existingFeeManagement;
}

function roundToCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
}

function isManagementRole(req) {
    if (!req?.auth) return true;
    return req.auth.role === 'admin' || req.auth.role === 'hr';
}

function getAuthEmployeeId(req) {
    const value = req?.auth?.employeeId;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getFirstInstallmentCreditedRevenue(feeManagement = {}) {
    const firstInstallment = Array.isArray(feeManagement.installments)
        ? feeManagement.installments[0]
        : null;
    const firstInstallmentRevenue = Number(firstInstallment?.calculatedFees);
    if (Number.isFinite(firstInstallmentRevenue)) {
        return Math.max(0, firstInstallmentRevenue);
    }
    return Math.max(0, Number(feeManagement?.summary?.totalFeesPayable) || 0);
}

function getRevenueForAggregate(admission = {}) {
    const raw = admission.revenueCreditLocked
        ? (admission.creditedRevenue ?? admission.revenue)
        : admission.revenue;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getAdmissionEditSummary(previous, next) {
    const labels = {
        customerName: 'Student Name',
        customerPhone: 'Phone',
        customerEmail: 'Email',
        alternateCustomerPhone: 'Alternate Phone',
        alternateCustomerEmail: 'Alternate Email',
        course: 'Course',
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
        if (req?.auth?.role === 'employee') {
            const authEmployeeId = getAuthEmployeeId(req);
            if (!authEmployeeId) return res.status(403).json({ error: 'Forbidden' });

            const requestedEmployeeId = req.query.employeeId ? Number(req.query.employeeId) : authEmployeeId;
            if (Number.isFinite(requestedEmployeeId) && requestedEmployeeId !== authEmployeeId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            query.employeeId = authEmployeeId;
        } else if (req.query.employeeId) {
            query.employeeId = parseInt(req.query.employeeId);
        }
        if (req.query.month)      query.month = req.query.month;
        if (req.query.status)     query.status = req.query.status;
        const records = await db.collection('admissions').find(query).sort({ admissionDate: -1 }).toArray();
        res.json(records.map(record => ({ ...record, status: getAdmissionStatus(record) })));
    } catch (error) {
        const status = /invalid|required|not found|must be|does not belong/i.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// POST /api/admissions - Add one admission record and update sales aggregate
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const isEmployeeRequest = req?.auth?.role === 'employee';
        const authEmployeeId = getAuthEmployeeId(req);

        if (isEmployeeRequest && !authEmployeeId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const {
            employeeId,
            month,
            customerName,
            customerPhone,
            customerEmail,
            alternateCustomerPhone,
            alternateCustomerEmail,
            course,
            admissionDate,
            admissionType,
            revenue,
            universityName,
            status,
            submittedBy,
            feeManagement
        } = req.body;

        if (isEmployeeRequest) {
            const requestedEmployeeId = Number(employeeId);
            if (!Number.isFinite(requestedEmployeeId) || requestedEmployeeId !== authEmployeeId) {
                return res.status(403).json({ error: 'Employees can submit admissions only for themselves' });
            }
            req.body.status = 'pending';
            req.body.submittedBy = 'employee';
        }

        if (!employeeId || !month || !customerName || !admissionDate || !admissionType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const normalizedStatus = (status === 'approved' || status === 'rejected') ? status : 'pending';
        const courseSnapshot = await resolveCourseSnapshot(db, req.body || {});

        // Insert the individual admission record
        const admission = {
            employeeId: parseInt(employeeId),
            month,
            customerName: String(customerName).trim(),
            customerPhone: customerPhone ? String(customerPhone).trim() : '',
            customerEmail: customerEmail ? String(customerEmail).trim() : '',
            alternateCustomerPhone: alternateCustomerPhone ? String(alternateCustomerPhone).trim() : '',
            alternateCustomerEmail: alternateCustomerEmail ? String(alternateCustomerEmail).trim() : '',
            course: course ? String(course).trim() : '',
            universityName: universityName ? String(universityName).trim() : '',
            admissionDate,
            admissionType,
            revenue: parseFloat(revenue) || 0,
            status: normalizedStatus,
            submittedBy: submittedBy || 'admin',
            createdAt: new Date(),
            approvedAt: normalizedStatus === 'approved' ? new Date() : null
        };

        if (courseSnapshot?.courseId) admission.courseId = courseSnapshot.courseId;
        if (courseSnapshot?.universityId) admission.universityId = courseSnapshot.universityId;
        if (courseSnapshot?.course) admission.course = courseSnapshot.course;
        if (courseSnapshot?.universityName) admission.universityName = courseSnapshot.universityName;
        if (courseSnapshot?.courseDuration !== undefined) admission.courseDuration = courseSnapshot.courseDuration;
        if (courseSnapshot?.courseTotalFees !== undefined) admission.courseTotalFees = courseSnapshot.courseTotalFees;

        admission.feeManagement = resolveFeeManagementForCreate(req.body || {}, admission);
        admission.duration = admission.feeManagement.duration;
        admission.totalFees = admission.feeManagement.summary.actualFees;
        admission.fees = admission.feeManagement.summary.actualFees;
        admission.discountType = admission.feeManagement.discountType;

        // Validate that first installment is marked as paid
        const firstInstallment = Array.isArray(admission.feeManagement.installments) 
            ? admission.feeManagement.installments[0] 
            : null;
        if (!firstInstallment || String(firstInstallment.status || '').toLowerCase() !== 'paid') {
            return res.status(400).json({ error: 'First installment must be marked as paid for admission to be created' });
        }

        const creditedRevenue = getFirstInstallmentCreditedRevenue(admission.feeManagement);
        admission.creditedRevenue = creditedRevenue;
        admission.revenueCreditLocked = true;
        admission.revenue = creditedRevenue;

        await db.collection('admissions').insertOne(admission);

        // Update sales aggregate only for approved admissions.
        if (normalizedStatus === 'approved') {
            const revenueForAggregate = getRevenueForAggregate(admission);
            await db.collection('sales').updateOne(
                { month, employeeId: parseInt(employeeId) },
                {
                    $inc: {
                        salesAchieved: 1,
                        revenueAchieved: revenueForAggregate
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

        if (normalizedStatus === 'approved') {
            const employee = await getEmployeeById(db, admission.employeeId);
            await sendSalesApprovedNotification(admission, employee);
        }

        res.json({
            success: true,
            message: normalizedStatus === 'approved'
                ? 'Admission recorded'
                : 'Admission submitted for approval'
        });
    } catch (error) {
        const statusCode = /invalid|required|not found|must be|does not belong|unsupported|exactly|not allowed/i.test(error.message)
            ? 400
            : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// PUT /api/admissions/:id/status - approve/reject an admission
router.put('/:id/status', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    if (!isManagementRole(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const db = getDB();
        const id = req.params.id;
        const nextStatus = String(req.body?.status || '').toLowerCase();
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });
        const admissionId = new ObjectId(id);
        if (!['approved', 'rejected'].includes(nextStatus)) {
            return res.status(400).json({ error: 'Invalid status. Use approved or rejected.' });
        }

        const reviewNote = req.body?.reviewNote ? String(req.body.reviewNote).trim() : '';

        if (nextStatus === 'approved') {
            const transitionResult = await db.collection('admissions').findOneAndUpdate(
                {
                    _id: admissionId,
                    status: { $ne: 'approved' }
                },
                {
                    $set: {
                        status: 'approved',
                        approvedAt: new Date(),
                        reviewedAt: new Date(),
                        reviewNote,
                        reviewOutcome: 'reviewed'
                    }
                },
                { returnDocument: 'before' }
            );

            const previousAdmission = unwrapFindOneAndUpdateResult(transitionResult);
            if (!previousAdmission) {
                const latest = await db.collection('admissions').findOne({ _id: admissionId }, { projection: { status: 1 } });
                if (!latest) return res.status(404).json({ error: 'Admission not found' });
                return res.json({ success: true, message: 'Admission already approved' });
            }

            const previousStatus = getAdmissionStatus(previousAdmission);
            if (shouldIncrementSalesForApprovalTransition(previousStatus, nextStatus)) {
                await db.collection('sales').updateOne(
                    { month: previousAdmission.month, employeeId: previousAdmission.employeeId },
                    {
                        $inc: {
                            salesAchieved: 1,
                            revenueAchieved: getRevenueForAggregate(previousAdmission)
                        },
                        $setOnInsert: {
                            salesTarget: 0,
                            revenueTarget: 0
                        },
                        $set: { updatedAt: new Date() }
                    },
                    { upsert: true }
                );

                const employee = await getEmployeeById(db, previousAdmission.employeeId);
                await sendSalesApprovedNotification(previousAdmission, employee);
            }

            return res.json({ success: true, message: 'Admission approved' });
        }

        const transitionResult = await db.collection('admissions').findOneAndUpdate(
            {
                _id: admissionId,
                status: { $ne: 'rejected' }
            },
            {
                $set: {
                    status: 'rejected',
                    approvedAt: null,
                    reviewedAt: new Date(),
                    reviewNote,
                    reviewOutcome: 'rejected'
                }
            },
            { returnDocument: 'before' }
        );

        const previousAdmission = unwrapFindOneAndUpdateResult(transitionResult);
        if (!previousAdmission) {
            const latest = await db.collection('admissions').findOne({ _id: admissionId }, { projection: { status: 1 } });
            if (!latest) return res.status(404).json({ error: 'Admission not found' });
            return res.json({ success: true, message: 'Admission already rejected' });
        }

        const previousStatus = getAdmissionStatus(previousAdmission);
        if (previousStatus === 'approved') {
            await db.collection('sales').updateOne(
                { month: previousAdmission.month, employeeId: previousAdmission.employeeId },
                {
                    $inc: {
                        salesAchieved: -1,
                        revenueAchieved: -getRevenueForAggregate(previousAdmission)
                    },
                    $set: { updatedAt: new Date() }
                }
            );
        }

        res.json({ success: true, message: 'Admission rejected' });
    } catch (error) {
        const statusCode = /invalid|required|not found|must be|does not belong|unsupported|exactly|not allowed/i.test(error.message)
            ? 400
            : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// PUT /api/admissions/:id - edit lead details and keep employee-visible review trail
router.put('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    if (!isManagementRole(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const db = getDB();
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid admission ID' });

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDuration') || Object.prototype.hasOwnProperty.call(req.body || {}, 'courseTotalFees')) {
            return res.status(400).json({ error: 'courseDuration and courseTotalFees are editable only during admission creation' });
        }

        const admission = await db.collection('admissions').findOne({ _id: new ObjectId(id) });
        if (!admission) return res.status(404).json({ error: 'Admission not found' });

        const nextFields = normalizeEditableAdmissionFields(req.body);
        if (admission.revenueCreditLocked) {
            nextFields.revenue = parseFloat(admission.creditedRevenue ?? admission.revenue) || 0;
        }
        if (!nextFields.customerName || !nextFields.admissionDate || !nextFields.admissionType) {
            return res.status(400).json({ error: 'Student name, admission date and admission type are required' });
        }

        const editSummary = getAdmissionEditSummary(admission, nextFields);
        const reviewNote = req.body?.reviewNote ? String(req.body.reviewNote).trim() : '';

        if (!editSummary.length && !reviewNote && !req.body?.feeManagement) {
            return res.json({ success: true, message: 'No admission changes detected' });
        }

        const updatedDoc = {
            ...nextFields,
            admissionType: normalizeAdmissionType(nextFields.admissionType),
            updatedAt: new Date(),
            adminEditedAt: new Date(),
            reviewNote,
            reviewOutcome: 'edited',
            editSummary
        };

        updatedDoc.feeManagement = resolveFeeManagementForEdit(req.body, updatedDoc, admission);

        if (admission.revenueCreditLocked) {
            const revisedCreditedRevenue = getFirstInstallmentCreditedRevenue(updatedDoc.feeManagement);
            updatedDoc.creditedRevenue = revisedCreditedRevenue;
            updatedDoc.revenue = revisedCreditedRevenue;
            updatedDoc.revenueCreditLocked = true;
        }

        await db.collection('admissions').updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedDoc }
        );

        if ((admission.status || 'pending') === 'approved') {
            const previousRevenueForCredit = getRevenueForAggregate(admission);
            const nextRevenueForCredit = getRevenueForAggregate({
                ...admission,
                ...updatedDoc
            });
            const revenueDelta = nextRevenueForCredit - previousRevenueForCredit;
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
        const statusCode = /invalid|required|not found|must be|does not belong|unsupported|exactly|not allowed/i.test(error.message)
            ? 400
            : 500;
        res.status(statusCode).json({ error: error.message });
    }
});

// DELETE /api/admissions/:id
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    if (!isManagementRole(req)) return res.status(403).json({ error: 'Forbidden' });
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
                        revenueAchieved: -getRevenueForAggregate(admission)
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
module.exports.shouldIncrementSalesForApprovalTransition = shouldIncrementSalesForApprovalTransition;
module.exports.unwrapFindOneAndUpdateResult = unwrapFindOneAndUpdateResult;
