function salaryEntryForMonth(employee, monthKey) {
    const history = employee.salaryHistory || [];
    const applicable = history.filter(entry => entry.effectiveDate.slice(0, 7) <= monthKey)
        .sort((first, second) => second.effectiveDate.localeCompare(first.effectiveDate));
    return applicable[0];
}

function salaryForMonth(employee, monthKey) {
    return Number(salaryEntryForMonth(employee, monthKey)?.salary ?? employee.salary) || 0;
}

function hasSalaryBreakupForMonth(employee, monthKey) {
    const entry = salaryEntryForMonth(employee, monthKey);
    return (entry ? entry.salaryBreakupEnabled : employee.salaryBreakupEnabled) === true;
}

function buildSalaryChange(employee, updates, actor) {
    const salary = Number(updates.salary);
    if (!Number.isFinite(salary) || salary < 0) throw new Error('Salary must be a non-negative number');
    const currentMonth = new Date().toISOString().slice(0, 7);
    const enablingBreakup = updates.salaryBreakupEnabled === true && !hasSalaryBreakupForMonth(employee, currentMonth);
    if (!updates.salaryEffectiveDate && salary === salaryForMonth(employee, currentMonth) && !enablingBreakup) return null;
    const effectiveDate = updates.salaryEffectiveDate;
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(effectiveDate || '')) {
        throw new Error('Salary changes require a month-start effective date');
    }
    const history = [...(employee.salaryHistory || [])];
    if (!history.length) {
        history.push({ effectiveDate: '0001-01-01', salary: Number(employee.salary) || 0, initial: true, salaryBreakupEnabled: employee.salaryBreakupEnabled === true });
    }
    const lastChange = history.filter(entry => !entry.initial).at(-1);
    if (lastChange && effectiveDate <= lastChange.effectiveDate) {
        throw new Error('Effective date must be after the last salary change');
    }
    if (employee.hireDate && effectiveDate.slice(0, 7) < employee.hireDate.slice(0, 7)) {
        throw new Error('Salary change cannot precede the joining month');
    }
    const previousSalary = Number(lastChange?.salary ?? employee.salary) || 0;
    const salaryBreakupEnabled = updates.salaryBreakupEnabled === true ||
        (lastChange ? lastChange.salaryBreakupEnabled === true : employee.salaryBreakupEnabled === true);
    const recordingBreakup = salaryBreakupEnabled && !(lastChange ? lastChange.salaryBreakupEnabled : employee.salaryBreakupEnabled);
    if (salary === previousSalary && !recordingBreakup) {
        throw new Error('New salary must differ from the previous effective or scheduled salary. No salary change was saved.');
    }
    history.push({
        effectiveDate,
        previousSalary,
        salary,
        salaryBreakupEnabled,
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
    const monthKey = new Date().toISOString().slice(0, 7);
    return { ...employee, salary: salaryForMonth(employee, monthKey), salaryBreakupEnabled: hasSalaryBreakupForMonth(employee, monthKey) };
}

module.exports = { salaryForMonth, hasSalaryBreakupForMonth, buildSalaryChange, withCurrentSalary };