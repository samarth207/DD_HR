const { round2 } = require('../helpers/utils');

function uniqueEmail(prefix) {
    return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.test`;
}

function buildEmployee(overrides = {}) {
    const now = Date.now();
    return {
        firstName: 'Auto',
        lastName: `User${Math.floor(Math.random() * 1000)}`,
        email: uniqueEmail('employee'),
        phone: `90000${String(now).slice(-5)}`,
        department: 'Sales',
        position: 'Sales Executive',
        salary: 30000,
        hireDate: '2026-05-12',
        isOnProbation: false,
        leaveBalance: { paidLeave: 12 },
        ...overrides
    };
}

function buildLeave(overrides = {}) {
    return {
        id: Number(String(Date.now()).slice(-6)),
        employeeId: null,
        leaveType: 'Paid Leave',
        startDate: '2026-06-16',
        endDate: '2026-06-16',
        status: 'approved',
        reason: 'automation test',
        halfDay: false,
        ...overrides
    };
}

function buildHoliday(overrides = {}) {
    return {
        id: Number(String(Date.now()).slice(-6)),
        date: '2026-06-15',
        name: 'Automation Holiday',
        ...overrides
    };
}

function buildSales(overrides = {}) {
    return {
        month: '2026-06',
        employeeId: null,
        data: {
            salesTarget: 20,
            salesAchieved: 18,
            revenueTarget: 400000,
            revenueAchieved: 380000
        },
        ...overrides
    };
}

function calculateExpectedSalary({
    monthlySalary,
    unpaidLeaveDays = 0,
    lateCount = 0,
    lateDaysHalfDay = 3,
    monthlyIncentive = 0,
    dailyBonus = 0,
    advanceDeduction = 0
}) {
    const dailyRate = monthlySalary / 30;
    const lateHalfDays = Math.floor(lateCount / lateDaysHalfDay) * 0.5;
    const unpaidDeduction = unpaidLeaveDays * dailyRate;
    const lateDeduction = lateHalfDays * dailyRate;

    const totalEarnings = monthlySalary + monthlyIncentive + dailyBonus;
    const totalDeductions = unpaidDeduction + lateDeduction + advanceDeduction;

    return {
        dailyRate: round2(dailyRate),
        unpaidDeduction: round2(unpaidDeduction),
        lateDeduction: round2(lateDeduction),
        netSalary: round2(Math.max(0, totalEarnings - totalDeductions))
    };
}

module.exports = {
    buildEmployee,
    buildLeave,
    buildHoliday,
    buildSales,
    calculateExpectedSalary
};
