const path = require('path');
const XLSX = require('xlsx');
const { connectDB, getDB, closeDB } = require('../db');

function canonicalKey(key) {
    return String(key || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function normalizeRowWithAliases(row) {
    const out = {};
    for (const [rawKey, value] of Object.entries(row || {})) {
        const key = String(rawKey || '').trim();
        out[key] = value;
        out[key.toLowerCase()] = value;
        const ck = canonicalKey(key);
        if (ck) out[ck] = value;
    }
    return out;
}

function pick(row, keys) {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null) return row[key];
    }
    return '';
}

function normalizeType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'one-time';
    if (['otp', 'one-time', 'one time', 'onetime'].includes(raw)) return 'one-time';
    if (raw.includes('semester')) return 'semester';
    if (raw.includes('annual') || raw.includes('year')) return 'annual';
    return 'one-time';
}

function normalizeStatus(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'approved' || raw === 'rejected' || raw === 'pending') return raw;
    return 'approved';
}

function normalizeNumberString(value) {
    return String(value ?? '').replace(/[^0-9]/g, '');
}

function parseRevenue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0;
}

function excelSerialToISO(serial) {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) return '';
    const y = String(parsed.y).padStart(4, '0');
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseDateToISO(value) {
    if (value === null || value === undefined || value === '') return '';

    if (typeof value === 'number') {
        return excelSerialToISO(value);
    }

    const raw = String(value).trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
    }

    return '';
}

async function main() {
    const csvPath = process.argv[2];
    if (!csvPath) {
        throw new Error('Usage: node scripts/import-admissions-from-csv.js "<path-to-csv>"');
    }

    const absoluteCsvPath = path.resolve(process.cwd(), csvPath);
    const workbook = XLSX.readFile(absoluteCsvPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

    if (!rawRows.length) {
        throw new Error(`No rows found in CSV: ${absoluteCsvPath}`);
    }

    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    const admissions = db.collection('admissions');
    const sales = db.collection('sales');
    const employeeCache = new Map();

    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    const skippedReasons = [];

    // key: employeeId|month, value: { count, revenue }
    const monthlyAgg = new Map();

    for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = normalizeRowWithAliases(rawRows[i]);

        const employeeId = parseInt(String(pick(row, ['employeeid', 'employee id', 'employeeId'])).replace(/[^0-9]/g, ''), 10);
        if (!employeeId || !Number.isFinite(employeeId)) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: 'Missing or invalid employeeId' });
            continue;
        }

        if (!employeeCache.has(employeeId)) {
            const emp = await db.collection('employees').findOne(
                { id: employeeId },
                { projection: { id: 1, firstName: 1, lastName: 1, email: 1 } }
            );
            employeeCache.set(employeeId, emp || null);
        }

        const employee = employeeCache.get(employeeId);
        if (!employee) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: `Employee not found for employeeId ${employeeId}` });
            continue;
        }

        const customerName = String(pick(row, ['customername', 'customer name', 'studentname', 'student name'])).trim();
        const customerPhone = normalizeNumberString(pick(row, ['customerphone', 'customer phone', 'mobileno', 'mobile no', 'phone']));
        const alternateCustomerPhone = normalizeNumberString(pick(row, ['alternatecustomerphone', 'alternate customer phone', 'alternateno', 'alternate no', 'alternate number']));
        const customerEmail = String(pick(row, ['customeremail', 'customer email', 'emailid', 'email id', 'email'])).trim();
        const alternateCustomerEmail = String(pick(row, ['alternatecustomeremail', 'alternate customer email', 'alternateemail', 'alternate email'])).trim();
        const universityName = String(pick(row, ['universityname', 'university name', 'university', 'institute'])).trim();
        const course = String(pick(row, ['course'])).trim();
        const admissionDate = parseDateToISO(pick(row, ['admissiondate', 'admission date']));
        const admissionType = normalizeType(pick(row, ['admissiontype', 'admission type', 'type']));
        const revenue = parseRevenue(pick(row, ['revenue', 'amount']));
        const status = normalizeStatus(pick(row, ['status']));

        if (!customerName || !admissionDate) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: 'Missing required customerName/admissionDate' });
            continue;
        }

        const month = admissionDate.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: `Invalid admissionDate '${admissionDate}'` });
            continue;
        }

        const admissionDoc = {
            employeeId,
            month,
            customerName,
            customerPhone,
            customerEmail,
            alternateCustomerPhone,
            alternateCustomerEmail,
            course,
            universityName,
            admissionDate,
            admissionType,
            revenue,
            status,
            submittedBy: 'admin-import-csv',
            createdAt: new Date(),
            approvedAt: status === 'approved' ? new Date() : null
        };

        const duplicateFilter = {
            employeeId: admissionDoc.employeeId,
            customerName: admissionDoc.customerName,
            admissionDate: admissionDoc.admissionDate,
            admissionType: admissionDoc.admissionType,
            revenue: admissionDoc.revenue,
            universityName: admissionDoc.universityName
        };

        const exists = await admissions.findOne(duplicateFilter, { projection: { _id: 1 } });
        if (exists) {
            duplicates++;
            continue;
        }

        await admissions.insertOne(admissionDoc);
        inserted++;

        if (status === 'approved') {
            const aggKey = `${employeeId}|${month}`;
            const agg = monthlyAgg.get(aggKey) || { employeeId, month, count: 0, revenue: 0 };
            agg.count += 1;
            agg.revenue += revenue;
            monthlyAgg.set(aggKey, agg);
        }
    }

    for (const agg of monthlyAgg.values()) {
        await sales.updateOne(
            { month: agg.month, employeeId: agg.employeeId },
            {
                $inc: {
                    salesAchieved: agg.count,
                    revenueAchieved: agg.revenue
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

    const result = {
        csvPath: absoluteCsvPath,
        sheetName,
        totals: {
            sourceRows: rawRows.length,
            inserted,
            duplicates,
            skipped
        },
        salesUpdates: Array.from(monthlyAgg.values()).map((m) => ({
            employeeId: m.employeeId,
            month: m.month,
            admissionsAdded: m.count,
            revenueAdded: m.revenue
        })),
        skippedReasons: skippedReasons.slice(0, 25)
    };

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB();
    });
