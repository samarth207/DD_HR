const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');
const { ObjectId } = require('mongodb');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// ─── Company Expenses Management ───────────────────────────────────────────

// GET /api/expenses - list all expenses with filters
router.get('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { category, month, year, startDate, endDate, status } = req.query;
        const filter = {};

        if (category) filter.category = category;
        if (status) filter.status = status;

        // Date filtering
        if (startDate && endDate) {
            filter.date = { $gte: startDate, $lte: endDate };
        } else if (month) {
            filter.month = month; // YYYY-MM format
        } else if (year) {
            filter.month = { $regex: `^${year}-` };
        }

        const expenses = await db.collection('expenses')
            .find(filter)
            .sort({ date: -1, createdAt: -1 })
            .toArray();

        // Calculate totals
        const totalAmount = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const paidAmount = expenses
            .filter(exp => exp.status === 'paid')
            .reduce((sum, exp) => sum + (exp.amount || 0), 0);
        const pendingAmount = expenses
            .filter(exp => exp.status === 'pending')
            .reduce((sum, exp) => sum + (exp.amount || 0), 0);

        res.json({
            expenses,
            summary: {
                totalAmount,
                paidAmount,
                pendingAmount,
                totalCount: expenses.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/expenses/categories - get all expense categories
router.get('/categories', async (req, res) => {
    const categories = [
        { id: 'office_rent', name: 'Office Rent', icon: 'fa-building' },
        { id: 'electricity', name: 'Electricity', icon: 'fa-bolt' },
        { id: 'office_boy', name: 'Office Boy', icon: 'fa-user-tie' },
        { id: 'tissues', name: 'Tissues', icon: 'fa-toilet-paper' },
        { id: 'water_bottles', name: 'Water Bottles', icon: 'fa-bottle-water' },
        { id: 'wifi', name: 'WiFi', icon: 'fa-wifi' },
        { id: 'cctv', name: 'CCTV', icon: 'fa-video' },
        { id: 'leads_ads', name: 'Leads (Ads)', icon: 'fa-bullhorn' },
        { id: 'websites', name: 'Websites', icon: 'fa-globe' },
        { id: 'chai_wala', name: 'Chai Wala', icon: 'fa-mug-hot' },
        { id: 'office_laptops', name: 'Office Laptops', icon: 'fa-laptop' },
        { id: 'office_outings', name: 'Office Outings', icon: 'fa-users' },
        { id: 'crm', name: 'CRM', icon: 'fa-chart-line' },
        { id: 'misc', name: 'Miscellaneous', icon: 'fa-ellipsis-h' }
    ];
    res.json(categories);
});

// GET /api/expenses/:id - get single expense by ID
router.get('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid expense ID' });

        const expense = await db.collection('expenses').findOne({ _id: new ObjectId(id) });
        if (!expense) return res.status(404).json({ error: 'Expense not found' });

        res.json(expense);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/expenses - create new expense
router.post('/', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { category, amount, date, description, paymentMethod, receiptUrl, status } = req.body;

        if (!category || !amount || !date) {
            return res.status(400).json({ error: 'category, amount, and date are required' });
        }

        const expenseDate = new Date(date);
        const month = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;

        const expense = {
            category: String(category).trim(),
            amount: parseFloat(amount) || 0,
            date: String(date).trim(),
            month,
            description: String(description || '').trim(),
            paymentMethod: String(paymentMethod || 'cash').trim(),
            receiptUrl: String(receiptUrl || '').trim(),
            status: String(status || 'pending').trim(),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('expenses').insertOne(expense);
        res.status(201).json({ success: true, id: result.insertedId, expense });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/expenses/:id - update expense
router.put('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid expense ID' });

        const { category, amount, date, description, paymentMethod, receiptUrl, status } = req.body;

        const updateData = { updatedAt: new Date() };
        if (category !== undefined) updateData.category = String(category).trim();
        if (amount !== undefined) updateData.amount = parseFloat(amount) || 0;
        if (date !== undefined) {
            updateData.date = String(date).trim();
            const expenseDate = new Date(date);
            updateData.month = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
        }
        if (description !== undefined) updateData.description = String(description || '').trim();
        if (paymentMethod !== undefined) updateData.paymentMethod = String(paymentMethod || 'cash').trim();
        if (receiptUrl !== undefined) updateData.receiptUrl = String(receiptUrl || '').trim();
        if (status !== undefined) updateData.status = String(status || 'pending').trim();

        const result = await db.collection('expenses').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: 'Expense not found' });

        res.json({ success: true, modifiedCount: result.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/expenses/:id - delete expense
router.delete('/:id', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid expense ID' });

        const result = await db.collection('expenses').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Expense not found' });

        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/expenses/summary/by-category - get expense summary by category
router.get('/summary/by-category', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, startDate, endDate } = req.query;

        const matchStage = {};
        if (startDate && endDate) {
            matchStage.date = { $gte: startDate, $lte: endDate };
        } else if (month) {
            matchStage.month = month;
        } else if (year) {
            matchStage.month = { $regex: `^${year}-` };
        }

        const pipeline = [
            ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 },
                    paidAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
                    },
                    pendingAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
                    }
                }
            },
            { $sort: { totalAmount: -1 } }
        ];

        const summary = await db.collection('expenses').aggregate(pipeline).toArray();
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/expenses/summary/by-month - get monthly expense summary
router.get('/summary/by-month', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { year } = req.query;

        const matchStage = year ? { month: { $regex: `^${year}-` } } : {};

        const pipeline = [
            ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
            {
                $group: {
                    _id: '$month',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 },
                    paidAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
                    },
                    pendingAmount: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
                    }
                }
            },
            { $sort: { _id: -1 } }
        ];

        const summary = await db.collection('expenses').aggregate(pipeline).toArray();
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
