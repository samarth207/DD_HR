const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

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

        await db.collection('employees').updateOne(
            { id: employeeId },
            { $set: { [`documents.${docType}`]: docInfo } }
        );

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
        
        // Check if email already exists
        const existing = await db.collection('employees').findOne({ email: employee.email });
        if (existing) {
            return res.status(400).json({ error: 'Email already exists' });
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

// Delete employee
router.delete('/:id', async (req, res) => {
    try {
        const db = getDB();
        const employeeId = parseInt(req.params.id);
        
        const result = await db.collection('employees').deleteOne({ id: employeeId });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        res.json({ success: true, message: 'Employee deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
