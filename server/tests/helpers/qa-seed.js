function uniqueInt(base = 200000) {
    return base + Math.floor(Math.random() * 100000);
}

function buildEmployee(overrides = {}) {
    const id = overrides.id || uniqueInt();
    return {
        id,
        firstName: overrides.firstName || 'QA',
        lastName: overrides.lastName || `Emp${id}`,
        email: overrides.email || `qa.${id}@example.test`,
        phone: overrides.phone || `98${String(id).padStart(8, '0').slice(-8)}`,
        department: overrides.department || 'Sales',
        position: overrides.position || 'Executive',
        salary: overrides.salary != null ? overrides.salary : 30000,
        hireDate: overrides.hireDate || '2026-05-12',
        status: overrides.status || 'Active',
        isOnProbation: !!overrides.isOnProbation,
        leaveBalance: overrides.leaveBalance || { paidLeave: 12 }
    };
}

function buildRealisticSeedData() {
    const salesEmployee = buildEmployee({
        id: 2001,
        firstName: 'Aarav',
        department: 'Sales',
        salary: 30000,
        hireDate: '2026-05-12',
        leaveBalance: { paidLeave: 10 }
    });

    const probationEmployee = buildEmployee({
        id: 2002,
        firstName: 'Mira',
        department: 'Operations',
        salary: 28000,
        isOnProbation: true,
        leaveBalance: { paidLeave: 8 }
    });

    const engineeringEmployee = buildEmployee({
        id: 2003,
        firstName: 'Rohan',
        department: 'Engineering',
        salary: 45000,
        leaveBalance: { paidLeave: 15 }
    });

    const employees = [salesEmployee, probationEmployee, engineeringEmployee];

    const leaves = [
        {
            id: 51001,
            employeeId: salesEmployee.id,
            leaveType: 'Unpaid Leave',
            startDate: '2026-06-20',
            endDate: '2026-06-20',
            status: 'approved',
            reason: 'Personal',
            halfDay: false,
            sandwichDays: 0,
            paidSandwichDays: 0
        },
        {
            id: 51002,
            employeeId: engineeringEmployee.id,
            leaveType: 'Paid Leave',
            startDate: '2026-06-10',
            endDate: '2026-06-10',
            status: 'approved',
            reason: 'Medical',
            halfDay: false,
            sandwichDays: 0,
            paidSandwichDays: 0
        }
    ];

    const attendance = [
        {
            date: '2026-06-14',
            records: {
                [String(salesEmployee.id)]: { status: 'Present', time: '10:05' },
                [String(probationEmployee.id)]: { status: 'Present', time: '09:02' }
            }
        },
        {
            date: '2026-06-15',
            records: {
                [String(salesEmployee.id)]: { status: 'Present', time: '10:02' },
                [String(probationEmployee.id)]: { status: 'Present', time: '09:00' }
            }
        },
        {
            date: '2026-06-16',
            records: {
                [String(salesEmployee.id)]: { status: 'Present', time: '10:10' },
                [String(probationEmployee.id)]: { status: 'Absent', time: null }
            }
        }
    ];

    const dailyBonuses = [
        {
            id: 61001,
            employeeId: salesEmployee.id,
            date: '2026-06-05',
            amount: 1000,
            reason: 'Daily sales target'
        }
    ];

    const monthlyIncentives = [
        {
            key: `2026-06_${salesEmployee.id}`,
            paid: true,
            paidDate: '2026-06-30T00:00:00.000Z',
            amount: 2000
        }
    ];

    const salaryAdvances = [
        {
            id: 71001,
            employeeId: salesEmployee.id,
            date: '2026-05-18',
            amount: 1500,
            status: 'Outstanding',
            repaid: false
        }
    ];

    const appSettings = {
        _id: 'attendanceSettings',
        officeStartTime: '09:00',
        lateThresholdMins: 10,
        lateDaysHalfDay: 3
    };

    return {
        employees,
        leaves,
        attendance,
        dailyBonuses,
        monthlyIncentives,
        salaryAdvances,
        appSettings,
        month: 6,
        year: 2026,
        monthKey: '2026-06',
        references: {
            salesEmployeeId: salesEmployee.id,
            probationEmployeeId: probationEmployee.id,
            engineeringEmployeeId: engineeringEmployee.id
        }
    };
}

async function seedRealisticData(db, seed) {
    await db.collection('employees').insertMany(seed.employees);
    await db.collection('leaves').insertMany(seed.leaves);
    await db.collection('attendance').insertMany(seed.attendance);
    await db.collection('daily_bonuses').insertMany(seed.dailyBonuses);
    await db.collection('monthly_incentives').insertMany(seed.monthlyIncentives);
    await db.collection('salary_advances').insertMany(seed.salaryAdvances);
    await db.collection('appSettings').updateOne({ _id: 'attendanceSettings' }, { $set: seed.appSettings }, { upsert: true });
}

module.exports = {
    buildEmployee,
    buildRealisticSeedData,
    seedRealisticData
};
