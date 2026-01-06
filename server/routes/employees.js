const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

// Get all employees
router.get('/', async (req, res) => {
    try {
        const db = getDB();
        const employees = await db.collection('employees').find({}).toArray();
        res.json(employees);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        const updates = req.body;
        
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
