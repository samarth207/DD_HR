(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SalaryBreakupUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function calculate(monthlyCTC) {
        if ((typeof monthlyCTC !== 'number' && typeof monthlyCTC !== 'string') ||
            String(monthlyCTC).trim() === '' || !Number.isFinite(Number(monthlyCTC)) || Number(monthlyCTC) < 0) {
            throw new Error('Monthly CTC must be a non-negative number');
        }
        const paise = Math.round(Number(monthlyCTC) * 100);
        if (!Number.isSafeInteger(paise * 12)) throw new Error('Monthly CTC is too large');
        if (Math.abs(Number(monthlyCTC) * 100 - paise) > 0.0001) {
            throw new Error('Monthly CTC must have at most two decimal places');
        }
        const basic = Math.round(paise * 0.5);
        const hra = Math.round(paise * 0.2);
        // Assign the rounding remainder to Special Allowance so components equal CTC exactly.
        const special = paise - basic - hra;
        const amounts = { basicSalary: basic, houseRentAllowance: hra, specialAllowance: special, subTotal: paise, ctc: paise };
        return Object.fromEntries(Object.entries(amounts).map(([key, value]) =>
            [key, { monthly: value / 100, yearly: value * 12 / 100 }]));
    }

    function rows(components) {
        return [
            ['Basic Salary (50%)', components.basicSalary],
            ['House Rent Allowance (20%)', components.houseRentAllowance],
            ['Special Allowance (30%)', components.specialAllowance],
            ['Sub Total / Gross Salary', components.subTotal],
            ['CTC', components.ctc]
        ];
    }

    function renderTable(components, formatAmount) {
        if (!components) return '<p style="font-size:12px;">Salary components have not been recorded for this period.</p>';
        return `<div style="overflow-x:auto;margin:12px 0;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;">
                <caption style="text-align:left;padding:8px 0;font-weight:600;">Full-month salary structure (before proration and deductions)</caption>
                <thead><tr><th scope="col" style="text-align:left;padding:8px;">Component</th><th scope="col" style="text-align:right;padding:8px;">Monthly (INR)</th><th scope="col" style="text-align:right;padding:8px;">Yearly (INR)</th></tr></thead>
                <tbody>${rows(components).map(([label, amount]) => `<tr style="border-top:1px solid #cbd5e1;"><th scope="row" style="text-align:left;padding:8px;font-weight:500;">${label}</th><td style="text-align:right;padding:8px;">${formatAmount(amount.monthly)}</td><td style="text-align:right;padding:8px;">${formatAmount(amount.yearly)}</td></tr>`).join('')}</tbody>
            </table></div>`;
    }

    return { calculate, rows, renderTable };
});
