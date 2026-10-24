const PDFDocument = require('pdfkit');
const path = require('path');

const COMPANY = {
    name: 'DegreeDrishti',
    address: 'Plot No- D22, Sector 3, Noida 201301',
    email: 'Email: hr@degreedrishti.com'
};

function moneyInPaise(value, label) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error(`Payslip ${label} is missing or invalid. Contact HR to reconcile the saved payroll.`);
    }
    const result = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(result)) throw new Error(`Payslip ${label} is too large`);
    return result;
}

function integerInWords(value) {
    const small = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
        'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
    if (value < 20) return small[value];
    if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${small[value % 10]}` : ''}`;
    for (const [divisor, unit] of [[10000000, 'CRORE'], [100000, 'LAKH'], [1000, 'THOUSAND'], [100, 'HUNDRED']]) {
        if (value >= divisor) {
            return `${integerInWords(Math.floor(value / divisor))} ${unit}${value % divisor ? ` ${integerInWords(value % divisor)}` : ''}`;
        }
    }
}

function amountInWords(paise) {
    return `${integerInWords(Math.floor(paise / 100))}${paise % 100 ? ` AND ${integerInWords(paise % 100)} PAISE` : ''} ONLY`;
}

function employeeDetails(employee) {
    return {
        id: employee.id,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        department: employee.department || '',
        position: employee.position || employee.designation || '',
        gender: employee.gender || '',
        dateOfBirth: employee.dateOfBirth || '',
        pan: employee.pan || '',
        location: employee.location || '',
        unit: employee.unit || ''
    };
}

function buildPayslipModel(employee, breakup, month, year) {
    const details = breakup.payslipEmployee || employeeDetails(employee);
    const gross = moneyInPaise(breakup.grossSalary, 'gross salary');
    const effective = moneyInPaise(breakup.effectiveGross ?? breakup.grossSalary, 'effective gross');
    const net = moneyInPaise(breakup.netSalary, 'net salary');
    const payrollDeductions = moneyInPaise(breakup.totalDeductions, 'deductions');
    const earnings = [];
    const deductions = [];
    const components = breakup.salaryComponents;
    if (components) {
        for (const [label, key] of [['Basic Salary', 'basicSalary'], ['House Rent Allowance', 'houseRentAllowance'], ['Special Allowance', 'specialAllowance']]) {
            earnings.push({ label, amount: moneyInPaise(components[key]?.monthly, label) });
        }
        if (earnings.reduce((sum, row) => sum + row.amount, 0) !== gross) {
            throw new Error('Saved salary components do not match gross salary. Contact HR to reconcile the paid record.');
        }
    } else {
        earnings.push({ label: 'Gross Salary', amount: gross });
    }
    for (const [label, key] of [['Monthly Incentive', 'monthlyIncentive'], ['Daily Bonuses', 'dailyBonusTotal']]) {
        const amount = moneyInPaise(breakup[key] ?? 0, label);
        if (amount > 0) earnings.push({ label, amount });
    }
    if (effective > gross) earnings.push({ label: 'Joining-month Adjustment', amount: effective - gross });
    if (gross > effective) deductions.push({ label: 'Joining-month Proration', amount: gross - effective });
    const lopDays = breakup.lopDays;
    const hasLopDays = typeof lopDays === 'number' && Number.isFinite(lopDays) && lopDays >= 0;
    const leave = moneyInPaise(breakup.unpaidLeaveDeduction ?? 0, 'leave deduction');
    const late = moneyInPaise(breakup.lateAttendanceDeduction ?? 0, 'late deduction');
    const lop = breakup.lopDeduction != null ? moneyInPaise(breakup.lopDeduction, 'LOP deduction') : leave + late;
    if (breakup.lopDeduction != null && breakup.unpaidLeaveDeduction != null && breakup.lateAttendanceDeduction != null &&
        lop !== leave + late) {
        throw new Error('Saved LOP does not match leave and late deductions. Contact HR to reconcile the paid record.');
    }
    if (lop > payrollDeductions) throw new Error('Saved LOP deductions exceed total deductions. Contact HR.');
    if (lop > 0 || hasLopDays) {
        deductions.push({ label: `Loss of Pay / LWP${hasLopDays ? ` (${lopDays.toFixed(2)} Days)` : ''}`, amount: lop });
    }
    if (payrollDeductions > lop) deductions.push({ label: 'Other Deductions', amount: payrollDeductions - lop });
    const totalEarnings = earnings.reduce((sum, row) => sum + row.amount, 0);
    const totalDeductions = deductions.reduce((sum, row) => sum + row.amount, 0);
    if (Math.max(0, totalEarnings - totalDeductions) !== net ||
        (breakup.totalEarnings != null && moneyInPaise(breakup.totalEarnings, 'total earnings') !== totalEarnings - Math.max(0, gross - effective))) {
        throw new Error('Saved earnings, deductions and net pay do not reconcile. Contact HR before downloading this payslip.');
    }
    const dailyRate = Number(breakup.dailyRate);
    const payableDays = hasLopDays && dailyRate > 0 ? Math.max(0, effective / 100 / dailyRate - lopDays).toFixed(2) : '-';
    return {
        employee: details, month, year,
        monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        earnings, deductions, totalEarnings, totalDeductions, net,
        netWords: amountInWords(net), payableDays, lwp: hasLopDays ? lopDays.toFixed(2) : '-',
        notes: [
            ...(hasLopDays && dailyRate > 0 ? ['Payable days use the existing 30-day payroll basis; LWP includes unpaid leave and late-attendance half days.'] : []),
            ...(!components ? ['Component breakup was not recorded for this paid period; saved gross salary is shown without an estimated split.'] : []),
            ...(!breakup.payslipEmployee ? ['Employee details reflect the current profile; payment amounts are from the saved payroll record.'] : []),
            ...(totalDeductions > totalEarnings ? ['Net pay is floored at zero.'] : [])
        ]
    };
}

function formatAmount(paise) {
    return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '-';
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
}

function createPayslipPdf(model) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true,
            info: { Title: `Payslip - ${model.employee.name} - ${model.monthLabel}`, Author: COMPANY.name } });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('error', reject);
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        try {
            const left = 40, width = doc.page.width - 80, right = left + width, middle = left + width * 0.485;
            const navy = '#0D3560', paleBlue = '#DCE6F1';
            function text(value, x, y, w, size = 8, font = 'Helvetica', align = 'left', height = 16) {
                const content = String(value ?? '').trim() || '-';
                doc.font(font).fontSize(size);
                while (size > 5 && doc.heightOfString(content, { width: w, lineGap: 0 }) > height) {
                    size -= 0.25;
                    doc.fontSize(size);
                }
                if (doc.heightOfString(content, { width: w, lineGap: 0 }) > height) {
                    throw new Error('Employee details are too long for the payslip format. Ask HR to shorten the profile fields.');
                }
                doc.text(content, x, y, { width: w, height, align, lineGap: 0 });
            }
            function line(x1, y1, x2, y2) {
                doc.strokeColor(navy).lineWidth(0.8).moveTo(x1, y1).lineTo(x2, y2).stroke();
            }
            doc.image(path.join(__dirname, '..', '..', 'assets', 'payslip-logo.png'), left, 51, { width: 190, height: 69 });
            doc.fillColor(navy);
            text(COMPANY.name, right - 220, 50, 220, 14, 'Helvetica-Bold', 'right', 20);
            doc.fillColor('black');
            text(COMPANY.address, right - 240, 71, 240, 8, 'Helvetica', 'right');
            text(COMPANY.email, right - 240, 82, 240, 8, 'Helvetica', 'right');
            text(`Pay Slip for the month of ${model.monthLabel}`, left, 137, width, 10, 'Helvetica-Bold', 'center');
            text('All amounts are in INR', left, 150, width, 7.5, 'Helvetica', 'center');

            const infoTop = 170, infoHeight = 130;
            doc.strokeColor(navy).lineWidth(0.8).rect(left, infoTop, width, infoHeight).stroke();
            line(middle, infoTop, middle, infoTop + infoHeight);
            const detailRows = [
                ['Emp Code', model.employee.id], ['Emp Name', model.employee.name],
                ['Department', model.employee.department], ['Designation', model.employee.position],
                ['Gender', model.employee.gender], ['DOB', formatDate(model.employee.dateOfBirth)],
                ['Payable Days', model.payableDays], ['LWP', model.lwp], ['Arrear Days', '-']
            ];
            detailRows.forEach(([label, value], index) => {
                const y = infoTop + 7 + index * 13.5;
                text(label, left + 8, y, 90, 8, 'Helvetica-Bold', 'left', 13);
                text(`: ${String(value ?? '').trim() || '-'}`, left + 103, y, middle - left - 111, 8, 'Helvetica', 'left', 13);
            });
            [['Location', model.employee.location], ['PAN', model.employee.pan], ['Unit', model.employee.unit]].forEach(([label, value], index) => {
                const y = infoTop + 7 + index * 13.5;
                text(label, middle + 8, y, 75, 8, 'Helvetica-Bold');
                text(`: ${value || '-'}`, middle + 88, y, right - middle - 96, 8);
            });
            const tableTop = infoTop + infoHeight;
            doc.rect(left, tableTop, width, 20).fill(navy);
            doc.fillColor('white');
            text('Earnings', left, tableTop + 5, middle - left, 9, 'Helvetica-Bold', 'center');
            text('Deductions', middle, tableTop + 5, right - middle, 9, 'Helvetica-Bold', 'center');
            doc.rect(left, tableTop + 20, width, 20).fill(paleBlue);
            doc.fillColor('black');
            text('Description', left + 8, tableTop + 26, 150, 8, 'Helvetica-Bold');
            text('Monthly', middle - 78, tableTop + 26, 70, 8, 'Helvetica-Bold', 'right');
            text('Description', middle + 8, tableTop + 26, 150, 8, 'Helvetica-Bold');
            text('Amount', right - 78, tableTop + 26, 70, 8, 'Helvetica-Bold', 'right');
            const rowCount = Math.max(3, model.earnings.length, model.deductions.length);
            for (const [rows, x, end] of [[model.earnings, left, middle], [model.deductions, middle, right]]) {
                rows.forEach((row, index) => {
                    const y = tableTop + 48 + index * 24;
                    text(row.label, x + 8, y, end - x - 94, 8.5, 'Helvetica', 'left', 22);
                    text(formatAmount(row.amount), end - 82, y, 74, 8.5, 'Helvetica', 'right', 22);
                });
            }
            const totalTop = tableTop + 40 + rowCount * 24;
            line(left, totalTop, right, totalTop);
            text('GROSS EARNINGS', left + 8, totalTop + 6, 150, 8.5, 'Helvetica-Bold');
            text(formatAmount(model.totalEarnings), middle - 82, totalTop + 6, 74, 8.5, 'Helvetica-Bold', 'right');
            text('TOTAL DEDUCTIONS', middle + 8, totalTop + 6, 150, 8.5, 'Helvetica-Bold');
            text(formatAmount(model.totalDeductions), right - 82, totalTop + 6, 74, 8.5, 'Helvetica-Bold', 'right');
            line(left, totalTop + 20, right, totalTop + 20);
            const netTop = totalTop + 20;
            doc.rect(left, netTop, width, 26).fill(paleBlue);
            doc.fillColor('black');
            text(`Net Pay : ${formatAmount(model.net)} (${model.netWords})`, left + 8, netTop + 6, width - 16, 9, 'Helvetica-Bold', 'center', 18);
            doc.strokeColor(navy).lineWidth(0.8).rect(left, tableTop, width, netTop + 26 - tableTop).stroke();
            line(middle, tableTop + 40, middle, totalTop + 20);
            text('Disclaimer: This is a system generated payslip, does not require any signature.', left, netTop + 36, width, 7, 'Helvetica-Oblique');
            if (model.notes.length) text(model.notes.join('\n'), left, netTop + 53, width, 7, 'Helvetica', 'left', 60);
            if (doc.bufferedPageRange().count !== 1) throw new Error('Payslip exceeded the single-page format');
            doc.end();
        } catch (error) {
            doc.destroy();
            reject(error);
        }
    });
}

function payslipFilename(model) {
    const name = model.employee.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || `Employee_${model.employee.id}`;
    const monthName = new Date(Date.UTC(model.year, model.month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    return `Payslip_${name}_${monthName}_${model.year}.pdf`;
}

module.exports = { buildPayslipModel, createPayslipPdf, employeeDetails, amountInWords, payslipFilename };
