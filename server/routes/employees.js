const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };
const MAX_SHORT_EMPLOYEE_ID = 2000;

// Document types list
const DOCUMENT_TYPES = [
    { key: 'marksheet_10th', label: '10th Marksheet' },
    { key: 'marksheet_12th', label: '12th Marksheet' },
    { key: 'salary_slips', label: 'Salary Slips / Salary Certificate' },
    { key: 'relieving_letter', label: 'Relieving Letter' },
    { key: 'cv_resume', label: 'CV / Resume' },
    { key: 'passport_photos', label: 'Passport-size Photographs' },
    { key: 'age_proof', label: 'Proof of Age' },
    { key: 'address_proof', label: 'Proof of Address' },
    { key: 'pan_card', label: 'PAN Card Copy' },
    { key: 'bank_passbook', label: 'Bank Passbook Copy' }
];

// Multer storage config — files saved to uploads/employee-{id}/
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const employeeId = req.params.id;
        const dir = path.join(__dirname, '..', 'uploads', `employee-${employeeId}`);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const docType = req.body.docType || 'document';
        const ext = path.extname(file.originalname);
        cb(null, `${docType}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only PDF, image, and Word documents are allowed'));
    }
});

async function allocateNextEmployeeId(db) {
    const rows = await db.collection('employees').find({}, { projection: { id: 1 } }).toArray();
    const ids = rows
        .map(r => parseInt(r.id, 10))
        .filter(id => Number.isInteger(id) && id >= 1);
    // Always use max + 1 — never reuse a deleted employee's ID
    const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    if (nextId > MAX_SHORT_EMPLOYEE_ID) return null;
    return nextId;
}

// Get all employees
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const employees = await db.collection('employees').find({}).toArray();
        res.json(employees);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get document types list
router.get('/document-types', (req, res) => {
    res.json(DOCUMENT_TYPES);
});

// Get employee by ID
router.get('/:id', async (req, res) => {
    try {
        const db = getDB();
        const employee = await db.collection('employees').findOne({ id: parseInt(req.params.id) });
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json(employee);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/employees/:id/salary-till-date
// Calculates the pro-rated salary from the start of the current month (or joining date
// if the employee joined this month) up to today, including bonus/incentive adjustments.
router.get('/:id/salary-till-date', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);
        const employee = await db.collection('employees').findOne({ id: employeeId });
        if (!employee) return res.status(404).json({ error: 'Employee not found' });

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const year = today.getFullYear();
        const month = today.getMonth();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0); monthEnd.setHours(23, 59, 59, 999);

        const gross = parseFloat(employee.salary) || 0;
        const dailyRate = gross / daysInMonth;

        // Determine effective start: joining date if hired this month, else 1st
        let effectiveStart = monthStart;
        let joiningNote = null;
        if (employee.hireDate) {
            const hd = new Date(employee.hireDate + 'T00:00:00');
            if (hd.getFullYear() === year && hd.getMonth() === month) {
                effectiveStart = hd;
                joiningNote = employee.hireDate;
            }
        }

        const daysWorked = Math.floor((today - effectiveStart) / 86400000) + 1;
        const proRatedGross = Math.round(dailyRate * daysWorked * 100) / 100;

        // Unpaid leaves in the period
        const unpaidLeaveTypes = new Set(['Unpaid Leave', 'Maternity Leave', 'Paternity Leave']);
        const leaves = await db.collection('leaves').find({
            employeeId,
            status: 'approved',
            leaveType: { $in: [...unpaidLeaveTypes] }
        }).toArray();

        let unpaidDays = 0;
        for (const leave of leaves) {
            const ls = new Date(leave.startDate + 'T00:00:00');
            const le = new Date(leave.endDate + 'T00:00:00');
            const os = ls < effectiveStart ? effectiveStart : ls;
            const oe = le > today ? today : le;
            if (os <= oe) {
                if (leave.halfDay) unpaidDays += 0.5;
                else {
                    unpaidDays += Math.floor((oe - os) / 86400000) + 1;
                    // Sandwich Sundays on this leave are also unpaid (they follow Monday's type)
                    unpaidDays += leave.sandwichDays || 0;
                }
            }
        }
        const unpaidDeduction = Math.round(unpaidDays * dailyRate * 100) / 100;

        // Monthly incentive (if paid)
        let incentive = 0;
        const monthKey = `${monthStr}_${employeeId}`;
        const incData = await db.collection('monthly_incentives').findOne({ key: monthKey });
        if (incData && incData.paid) incentive = parseFloat(incData.amount) || 0;

        // Daily bonuses this month up to today
        const bonuses = await db.collection('daily_bonuses').find({
            employeeId,
            date: { $gte: `${monthStr}-01`, $lte: today.toISOString().split('T')[0] }
        }).toArray();
        const bonusTotal = bonuses.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);

        const netPayable = Math.max(0, proRatedGross - unpaidDeduction + incentive + bonusTotal);

        res.json({
            employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            grossSalary: gross,
            dailyRate: Math.round(dailyRate * 100) / 100,
            daysInMonth,
            daysWorked,
            joiningDate: joiningNote,
            proRatedGross,
            unpaidDays,
            unpaidDeduction,
            incentive,
            bonusTotal,
            netPayable,
            asOfDate: today.toISOString().split('T')[0],
            month: monthStr
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get documents for an employee
router.get('/:id/documents', async (req, res) => {
    try {
        const db = getDB();
        const employee = await db.collection('employees').findOne({ id: parseInt(req.params.id) });
        if (!employee) return res.status(404).json({ error: 'Employee not found' });
        res.json({ documents: employee.documents || {} });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload a document for an employee
router.post('/:id/documents', upload.single('file'), async (req, res) => {
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);
        const docType = req.body.docType;

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!docType) return res.status(400).json({ error: 'docType is required' });

        const validTypes = DOCUMENT_TYPES.map(d => d.key);
        if (!validTypes.includes(docType)) return res.status(400).json({ error: 'Invalid document type' });

        const fileUrl = `/uploads/employee-${employeeId}/${req.file.filename}`;
        const docInfo = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            url: fileUrl,
            uploadedAt: new Date().toISOString(),
            size: req.file.size
        };

        const result = await db.collection('employees').updateOne(
            { id: employeeId },
            { $set: { [`documents.${docType}`]: docInfo } }
        );
        if (result.matchedCount === 0) {
            const orphanPath = path.join(__dirname, '..', 'uploads', `employee-${employeeId}`, req.file.filename);
            if (fs.existsSync(orphanPath)) fs.unlinkSync(orphanPath);
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ success: true, document: docInfo });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a document for an employee
router.delete('/:id/documents/:docType', async (req, res) => {
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);
        const docType = req.params.docType;
        const validTypes = DOCUMENT_TYPES.map(d => d.key);
        if (!validTypes.includes(docType)) return res.status(400).json({ error: 'Invalid document type' });

        const employee = await db.collection('employees').findOne({ id: employeeId });
        if (!employee) return res.status(404).json({ error: 'Employee not found' });

        const doc = (employee.documents || {})[docType];
        if (doc) {
            const filePath = path.join(__dirname, '..', 'uploads', `employee-${employeeId}`, doc.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        await db.collection('employees').updateOne(
            { id: employeeId },
            { $unset: { [`documents.${docType}`]: '' } }
        );

        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new employee
router.post('/', async (req, res) => {
    try {
        const db = getDB();
        const employee = req.body;

        let requestedId = parseInt(employee.id, 10);
        if (!Number.isInteger(requestedId) || requestedId < 1 || requestedId > MAX_SHORT_EMPLOYEE_ID) {
            requestedId = await allocateNextEmployeeId(db);
            if (!requestedId) {
                return res.status(400).json({ error: `Employee ID limit reached (${MAX_SHORT_EMPLOYEE_ID})` });
            }
        }
        employee.id = requestedId;
        
        // Check if email already exists
        const existing = await db.collection('employees').findOne({ email: employee.email });
        if (existing) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        const existingId = await db.collection('employees').findOne({ id: employee.id });
        if (existingId) {
            return res.status(400).json({ error: `Employee ID ${employee.id} already exists` });
        }

        // Set initial password = phone number (hashed)
        if (employee.phone) {
            const salt = crypto.randomBytes(32).toString('hex');
            const hash = crypto.scryptSync(employee.phone.trim(), salt, 64).toString('hex');
            employee.passwordHash = hash;
            employee.passwordSalt = salt;
        }
        
        const result = await db.collection('employees').insertOne(employee);
        res.status(201).json({ success: true, employee });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update employee
router.put('/:id', async (req, res) => {
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);
        const updates = { ...req.body };
        
        // Remove _id from updates as it's immutable in MongoDB
        delete updates._id;
        
        // If email is being updated, check it doesn't already exist for another employee
        if (updates.email) {
            const existing = await db.collection('employees').findOne({ 
                email: updates.email,
                id: { $ne: employeeId }  // Exclude current employee
            });
            if (existing) {
                return res.status(400).json({ error: 'Email already exists' });
            }
        }
        
        const result = await db.collection('employees').updateOne(
            { id: employeeId },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        res.json({ success: true, message: 'Employee updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete employee + cascade-delete all related data
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);

        const existing = await db.collection('employees').findOne({ id: employeeId });
        if (!existing) return res.status(404).json({ error: 'Employee not found' });

        // Cascade deletes — run in parallel for speed
        await Promise.all([
            // Employee record
            db.collection('employees').deleteOne({ id: employeeId }),
            // Leave requests
            db.collection('leaves').deleteMany({ employeeId }),
            // Daily bonuses
            db.collection('daily_bonuses').deleteMany({ employeeId }),
            // Salary advances
            db.collection('salary_advances').deleteMany({ employeeId }),
            // Salary payments (dedicated collection)
            db.collection('salary_payments').deleteMany({ employeeId }),
            // Monthly incentives — key is "${month}_${employeeId}"
            db.collection('monthly_incentives').deleteMany({
                key: { $regex: `_${employeeId}$` }
            }),
            // Salary payments inside incentives collection (same key format)
            db.collection('salary_payments').deleteMany({
                key: { $regex: `_${employeeId}$` }
            }),
            // Admission records
            db.collection('admissions').deleteMany({ employeeId }),
            // Sales aggregates
            db.collection('sales').deleteMany({ employeeId }),
        ]);

        // Remove uploaded documents folder
        const uploadsDir = require('path').join(__dirname, '..', 'uploads', `employee-${employeeId}`);
        try {
            require('fs').rmSync(uploadsDir, { recursive: true, force: true });
        } catch (_) { /* non-critical */ }

        res.json({ success: true, message: 'Employee and all related data deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
