const path = require('path');
const XLSX = require('xlsx');
const { connectDB, getDB, closeDB } = require('../db');

function normalizeType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (['otp', 'one-time', 'one time', 'onetime'].includes(raw)) return 'one-time';
    if (raw.includes('semester')) return 'semester';
    if (raw.includes('annual') || raw.includes('year')) return 'annual';
    return raw;
}

function normalizeNumberString(value) {
    const str = String(value ?? '').trim();
    return str.replace(/[^0-9]/g, '');
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

    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
        const first = parseInt(slash[1], 10);
        const second = parseInt(slash[2], 10);
        const third = parseInt(slash[3], 10);
        const year = third < 100 ? 2000 + third : third;
        const day = first > 12 ? first : second;
        const month = first > 12 ? second : first;
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
    }

    return '';
}

function normalizeRowKeys(row) {
    const out = {};
    for (const [key, value] of Object.entries(row || {})) {
        out[String(key).trim().toLowerCase()] = value;
    }
    return out;
}

function canonicalKey(key) {
    return String(key || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function normalizeRowWithAliases(row) {
    const out = {};
    for (const [rawKey, value] of Object.entries(row || {})) {
        const k = String(rawKey || '').trim().toLowerCase();
        const c = canonicalKey(rawKey);
        out[k] = value;
        if (c) out[c] = value;
    }
    return out;
}

function pick(row, keys) {
    for (const key of keys) {
        if (row[key] !== undefined) return row[key];
    }
    return '';
}

async function resolveEmployee(db) {
    const exact = await db.collection('employees').findOne(
        { firstName: /amogh/i, lastName: /shukla/i },
        { projection: { id: 1, firstName: 1, lastName: 1, email: 1 } }
    );
    if (exact) return exact;

    const matches = await db.collection('employees').find(
        { $or: [{ firstName: /amogh/i }, { lastName: /amogh/i }, { lastName: /shukla/i }, { email: /amogh/i }] },
        { projection: { id: 1, firstName: 1, lastName: 1, email: 1 } }
    ).toArray();

    if (matches.length === 1) return matches[0];

    throw new Error(`Could not uniquely resolve employee for Amogh Shukla. Matches found: ${JSON.stringify(matches)}`);
}

async function main() {
    const workbookPath = process.argv[2]
        ? path.resolve(process.cwd(), process.argv[2])
        : path.resolve(__dirname, '..', '..', 'CRM sheet data ipload .xlsx');
    const requestedSheet = (process.argv[3] || 'Amogh').trim().toLowerCase();

    const workbook = XLSX.readFile(workbookPath);
    const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === requestedSheet)
        || workbook.SheetNames.find((name) => name.trim().toLowerCase().includes(requestedSheet));

    if (!sheetName) {
        throw new Error(`Sheet not found for '${requestedSheet}'. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

    if (!rawRows.length) {
        throw new Error(`No rows found in sheet '${sheetName}'.`);
    }

    await connectDB();
    const db = getDB();
    if (!db) throw new Error('Database not connected.');

    const employee = await resolveEmployee(db);
    if (!employee || !employee.id) {
        throw new Error('Resolved employee missing id.');
    }

    const admissions = db.collection('admissions');
    const sales = db.collection('sales');

    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    const skippedReasons = [];
    const monthlyAgg = new Map();

    for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = normalizeRowWithAliases(rawRows[i]);

        const counsellor = String(pick(row, ['counsellor', 'counsellor name', 'counsellorname']) || '').trim();
        if (counsellor && !/amogh/i.test(counsellor)) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: `Counsellor mismatch: '${counsellor}'` });
            continue;
        }

        const customerName = String(pick(row, ['student name', 'studentname', 'student', 'customer name', 'customername']) || '').trim();
        const customerPhone = normalizeNumberString(pick(row, ['mobile no', 'mobileno', 'mobile', 'phone number', 'phonenumber', 'phone']));
        const alternateCustomerPhone = normalizeNumberString(pick(row, ['alternate no', 'alternateno', 'alternate number', 'alternatenumber', 'alternate mobile', 'alternatemobile', 'alt mobile', 'altmobile']));
        const customerEmail = String(pick(row, ['email id', 'emailid', 'email']) || '').trim();
        const alternateCustomerEmail = String(pick(row, ['alternate email', 'alternateemail', 'alt email', 'altemail']) || '').trim();
        const universityName = String(pick(row, ['university', 'university / institute', 'universityinstitute', 'institute']) || '').trim();
        const course = String(pick(row, ['course']) || '').trim();
        const admissionDate = parseDateToISO(pick(row, ['admission date', 'admissiondate']));
        const admissionType = normalizeType(pick(row, ['type', 'admission type', 'admissiontype'])) || 'one-time';
        const revenue = parseRevenue(pick(row, ['revenue', 'amount']));

        if (!customerName || !admissionDate) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: 'Missing required student name/admission date' });
            continue;
        }

        const month = admissionDate.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) {
            skipped++;
            skippedReasons.push({ row: rowNum, reason: `Invalid month from date '${admissionDate}'` });
            continue;
        }

        const admissionDoc = {
            employeeId: employee.id,
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
            status: 'approved',
            submittedBy: 'admin-import',
            createdAt: new Date(),
            approvedAt: new Date()
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

        const agg = monthlyAgg.get(month) || { count: 0, revenue: 0 };
        agg.count += 1;
        agg.revenue += revenue;
        monthlyAgg.set(month, agg);
    }

    for (const [month, agg] of monthlyAgg.entries()) {
        await sales.updateOne(
            { month, employeeId: employee.id },
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
        workbookPath,
        sheetName,
        employee: {
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email || ''
        },
        totals: {
            sourceRows: rawRows.length,
            inserted,
            duplicates,
            skipped
        },
        salesMonthsUpdated: Array.from(monthlyAgg.entries()).map(([month, agg]) => ({ month, admissionsAdded: agg.count, revenueAdded: agg.revenue })),
        skippedReasons: skippedReasons.slice(0, 20)
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
