function salaryForMonth(employee, monthKey) {
    const history = employee.salaryHistory || [];
    const applicable = history.filter(entry => entry.effectiveDate.slice(0, 7) <= monthKey)
        .sort((first, second) => second.effectiveDate.localeCompare(first.effectiveDate));
    return Number(applicable[0]?.salary ?? employee.salary) || 0;
}

function buildSalaryChange(employee, updates, actor) {
    const salary = Number(updates.salary);
    if (!Number.isFinite(salary) || salary < 0) throw new Error('Salary must be a non-negative number');
    if (!updates.salaryEffectiveDate && salary === salaryForMonth(employee, new Date().toISOString().slice(0, 7))) return null;
    const effectiveDate = updates.salaryEffectiveDate;
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(effectiveDate || '')) {
        throw new Error('Salary changes require a month-start effective date');
    }
    const history = [...(employee.salaryHistory || [])];
    if (!history.length) {
        history.push({ effectiveDate: '0001-01-01', salary: Number(employee.salary) || 0, initial: true });
    }
    const lastChange = history.filter(entry => !entry.initial).at(-1);
    if (lastChange && effectiveDate <= lastChange.effectiveDate) {
        throw new Error('Effective date must be after the last salary change');
    }
    if (employee.hireDate && effectiveDate.slice(0, 7) < employee.hireDate.slice(0, 7)) {
        throw new Error('Salary change cannot precede the joining month');
    }
    const previousSalary = Number(lastChange?.salary ?? employee.salary) || 0;
    if (salary === previousSalary) {
        throw new Error('New salary must differ from the previous effective or scheduled salary. No salary change was saved.');
    }
    history.push({
        effectiveDate,
        previousSalary,
        salary,
        department: updates.department ?? employee.department ?? '',
        previousPosition: employee.position || '',
        position: updates.position ?? employee.position ?? '',
        reason: String(updates.salaryChangeReason || '').trim().slice(0, 500),
        recordedAt: new Date().toISOString(),
        recordedBy: actor?.username || actor?.email || actor?.role || 'Management'
    });
    return history;
}

function withCurrentSalary(employee) {
    if (!employee) return employee;
    return { ...employee, salary: salaryForMonth(employee, new Date().toISOString().slice(0, 7)) };
}

module.exports = { salaryForMonth, buildSalaryChange, withCurrentSalary };