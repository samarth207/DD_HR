// ─── Attendance Management ────────────────────────────────────────────────

let attendanceSettings = {
    officeStartTime: '09:00',
    lateThresholdMins: 10,
    lateDaysHalfDay: 3
};

let currentDate = '';
// attendanceData: { 'YYYY-MM-DD': { [employeeId]: { time: '09:05' | null, status: 'present'|'late'|'absent' } } }
let attendanceData = {};
const WORK_FROM_HOME_TYPE = 'Work From Home';

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const today = formatDateKey(new Date());
    document.getElementById('attendanceDate').value = today;
    currentDate = today;

    const monthInput = document.getElementById('monthPicker');
    if (monthInput) monthInput.value = today.substring(0, 7);

    await loadAttendanceSettings();
    updateSettingsSummary();

    await Promise.all([loadEmployees(), loadLeaves()]);
    populateMonthlyEmployeeSelect();

    // Load records for the current month from API so late-count is accurate
    await loadMonthAttendanceFromAPI(today.substring(0, 7));

    renderAttendanceTable();
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDateKey(date) {
    const d = (typeof date === 'string') ? new Date(date + 'T00:00:00') : date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime12h(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function minutesAfterOffice(entryTime) {
    const [oh, om] = attendanceSettings.officeStartTime.split(':').map(Number);
    const [eh, em] = entryTime.split(':').map(Number);
    return (eh * 60 + em) - (oh * 60 + om);
}

function isLate(entryTime) {
    return minutesAfterOffice(entryTime) > attendanceSettings.lateThresholdMins;
}

function getMonthStr(dateStr) { return dateStr.substring(0, 7); }

function getEmployeeJoinDate(employee) {
    return employee?.hireDate || employee?.joinDate || employee?.joiningDate || employee?.dateOfJoining || '';
}

function isEmployeeCycleMonthEndDate(employee, dateStr) {
    const joinDate = getEmployeeJoinDate(employee);
    if (!joinDate || dateStr < joinDate) return false;

    const joinDay = parseInt(joinDate.substring(8, 10), 10);
    const [year, month] = dateStr.split('-').map(Number);
    const daysInThisMonth = new Date(year, month, 0).getDate();
    const cycleDay = Math.min(joinDay, daysInThisMonth);

    return parseInt(dateStr.substring(8, 10), 10) === cycleDay;
}

function isJoinedByDate(employee, dateStr) {
    const joinDate = getEmployeeJoinDate(employee);
    if (!joinDate) return true;
    return dateStr >= joinDate;
}

function isWorkFromHomeLeave(leave) {
    return String(leave?.leaveType || '').trim().toLowerCase() === 'work from home';
}

// ─── Settings ──────────────────────────────────────────────────────────────

async function loadAttendanceSettings() {
    // Admin: localStorage is the source of truth (admin sets it here).
    // Server is only a fallback if localStorage is empty (e.g. first ever load).
    const saved = localStorage.getItem('attendanceSettings');
    if (saved) {
        try { attendanceSettings = { ...attendanceSettings, ...JSON.parse(saved) }; }
        catch (_) {}
    } else {
        // No local settings yet — try to pull from server
        try {
            const res = await fetch(`${API_BASE_URL}/attendance/settings`);
            if (res.ok) {
                const data = await res.json();
                attendanceSettings = { ...attendanceSettings, ...data };
            }
        } catch (e) { /* keep defaults */ }
    }
    document.getElementById('officeStartTime').value   = attendanceSettings.officeStartTime;
    document.getElementById('lateThresholdMins').value = attendanceSettings.lateThresholdMins;
    document.getElementById('lateDaysHalfDay').value   = attendanceSettings.lateDaysHalfDay;
}

async function saveAttendanceSettings() {
    attendanceSettings.officeStartTime   = document.getElementById('officeStartTime').value;
    attendanceSettings.lateThresholdMins = parseInt(document.getElementById('lateThresholdMins').value) || 10;
    attendanceSettings.lateDaysHalfDay   = parseInt(document.getElementById('lateDaysHalfDay').value) || 3;
    localStorage.setItem('attendanceSettings', JSON.stringify(attendanceSettings));
    // Persist to server so all portals (including employee) pick up the change
    try {
        await fetch(`${API_BASE_URL}/attendance/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(attendanceSettings)
        });
    } catch (e) { console.warn('Could not save attendance settings to server:', e); }
    updateSettingsSummary();
    renderAttendanceTable();
}

function updateSettingsSummary() {
    const el = document.getElementById('settingsSummaryText');
    if (!el) return;
    el.innerHTML = `If an employee is late more than <strong>${attendanceSettings.lateDaysHalfDay}</strong> times in a month by more than <strong>${attendanceSettings.lateThresholdMins}</strong> minutes after <strong>${formatTime12h(attendanceSettings.officeStartTime)}</strong>, it counts as a half day deduction.`;
}

function openLatePolicyPopup() {
    const popup = document.getElementById('latePolicyPopup');
    if (popup) popup.classList.add('open');
}

function closeLatePolicyPopup() {
    const popup = document.getElementById('latePolicyPopup');
    if (popup) popup.classList.remove('open');
}

function openMonthlyAttendancePopup() {
    const popup = document.getElementById('monthlyAttendancePopup');
    if (popup) popup.classList.add('open');
}

function closeMonthlyAttendancePopup() {
    const popup = document.getElementById('monthlyAttendancePopup');
    if (popup) popup.classList.remove('open');
}

function closePopupOnBackdrop(event, popupId) {
    if (event.target.id !== popupId) return;
    const popup = document.getElementById(popupId);
    if (popup) popup.classList.remove('open');
}

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const latePolicyPopup = document.getElementById('latePolicyPopup');
    const monthlyAttendancePopup = document.getElementById('monthlyAttendancePopup');

    if (latePolicyPopup?.classList.contains('open')) {
        latePolicyPopup.classList.remove('open');
        return;
    }

    if (monthlyAttendancePopup?.classList.contains('open')) {
        monthlyAttendancePopup.classList.remove('open');
    }
});

// ─── Data Load / Save ─────────────────────────────────────────────────────

async function loadMonthAttendanceFromAPI(monthStr) {
    try {
        const res = await fetch(`${API_BASE_URL}/attendance/month/${monthStr}`);
        if (res.ok) {
            const docs = await res.json();
            if (Array.isArray(docs)) {
                docs.forEach(doc => {
                    if (doc.date && doc.records) {
                        attendanceData[doc.date] = doc.records;
                    }
                });
            }
        }
    } catch (e) { /* offline — fall back to localStorage */ }

    // Also merge any locally stored data for this month
    Object.keys(localStorage)
        .filter(k => k.startsWith('attendance_' + monthStr))
        .forEach(k => {
            const date = k.replace('attendance_', '');
            if (!attendanceData[date]) {
                try { attendanceData[date] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
            }
        });
}

async function loadAttendanceForDate() {
    currentDate = document.getElementById('attendanceDate').value;
    if (!currentDate) return;

    const monthStr = getMonthStr(currentDate);

    // Load full month for late-count accuracy
    await loadMonthAttendanceFromAPI(monthStr);

    renderAttendanceTable();
}

function persistDayRecord() {
    const dayRec = attendanceData[currentDate] || {};
    localStorage.setItem(`attendance_${currentDate}`, JSON.stringify(dayRec));
    fetch(`${API_BASE_URL}/attendance/${currentDate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dayRec)
    }).catch(() => {});
}

// ─── Leave helpers ─────────────────────────────────────────────────────────

function getLeaveForDate(employeeId, dateStr) {
    const leaves = getLeaves();
    return leaves.find(l =>
        l.employeeId === employeeId &&
        l.status === 'approved' &&
        !isWorkFromHomeLeave(l) &&
        dateStr >= l.startDate &&
        dateStr <= l.endDate
    ) || null;
}

function getWorkFromHomeForDate(employeeId, dateStr) {
    const leaves = getLeaves();
    return leaves.find(l =>
        l.employeeId === employeeId &&
        l.status === 'approved' &&
        isWorkFromHomeLeave(l) &&
        dateStr >= l.startDate &&
        dateStr <= l.endDate
    ) || null;
}

// ─── Single employee monthly view ─────────────────────────────────────────

function populateMonthlyEmployeeSelect() {
    const select = document.getElementById('monthEmployeeSelect');
    if (!select) return;

    const previous = select.value;
    const employees = getEmployees()
        .slice()
        .sort((a, b) => (`${a.firstName} ${a.lastName}`).localeCompare(`${b.firstName} ${b.lastName}`));

    select.innerHTML = '<option value="">Select Employee</option>' + employees.map(emp =>
        `<option value="${emp.id}">${emp.firstName} ${emp.lastName}${emp.status !== 'Active' ? ' (Inactive)' : ''}</option>`
    ).join('');

    if (previous && employees.some(emp => String(emp.id) === String(previous))) {
        select.value = previous;
    }
}

function getDaysInMonth(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const days = [];
    for (let d = first.getDate(); d <= last.getDate(); d++) {
        days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return days;
}

function classifyEmployeeStatusForDate(employee, employeeId, dateStr, dayRecord) {
    const leave = getLeaveForDate(employeeId, dateStr);
    const isHalfDayLeave = leave && leave.halfDay === true;
    const wfh = getWorkFromHomeForDate(employeeId, dateStr);

    if (leave && !isHalfDayLeave) {
        return {
            status: 'on-leave',
            label: 'On Leave',
            timeText: '—',
            lateByText: '—',
            notes: leave.leaveType || 'Approved Leave'
        };
    }

    if (wfh) {
        return {
            status: 'wfh',
            label: 'WFH',
            timeText: dayRecord?.time ? formatTime12h(dayRecord.time) : '—',
            lateByText: dayRecord?.time && isLate(dayRecord.time) ? `${minutesAfterOffice(dayRecord.time)} min` : '—',
            notes: WORK_FROM_HOME_TYPE
        };
    }

    if (dayRecord?.time) {
        const late = isLate(dayRecord.time);
        const note = isHalfDayLeave
            ? `Half Day Leave (${leave.halfDaySession === 'Second Half' ? 'Second Half' : 'First Half'})`
            : '—';
        return {
            status: late ? 'late' : 'present',
            label: late ? 'Late' : 'Present',
            timeText: formatTime12h(dayRecord.time),
            lateByText: late ? `${minutesAfterOffice(dayRecord.time)} min` : '—',
            notes: note
        };
    }

    if (isHalfDayLeave) {
        return {
            status: 'absent',
            label: 'Absent',
            timeText: '—',
            lateByText: '—',
            notes: `Half Day Leave (${leave.halfDaySession === 'Second Half' ? 'Second Half' : 'First Half'})`
        };
    }

    return {
        status: 'absent',
        label: 'Absent',
        timeText: '—',
        lateByText: '—',
        notes: '—'
    };
}

async function loadSingleEmployeeMonthAttendance() {
    const employeeSelect = document.getElementById('monthEmployeeSelect');
    const monthInput = document.getElementById('monthPicker');

    if (!employeeSelect || !monthInput) return;

    const employeeId = Number(employeeSelect.value);
    const monthStr = monthInput.value;

    if (!employeeId || !monthStr) {
        showNotification('Please select an employee and month', 'warning');
        return;
    }

    const employee = getEmployees().find(e => e.id === employeeId);
    if (!employee) {
        showNotification('Employee not found', 'error');
        return;
    }

    await loadMonthAttendanceFromAPI(monthStr);
    renderSingleEmployeeMonthAttendance(employee, monthStr);
}

function clearSingleEmployeeMonthAttendance() {
    const employeeSelect = document.getElementById('monthEmployeeSelect');
    const monthInput = document.getElementById('monthPicker');
    const body = document.getElementById('monthAttendanceBody');
    const stats = document.getElementById('monthAttendanceStats');

    if (employeeSelect) employeeSelect.value = '';
    if (monthInput) monthInput.value = formatDateKey(new Date()).substring(0, 7);
    if (stats) stats.style.display = 'none';
    if (body) {
        body.innerHTML = '<tr><td colspan="6" class="emp-month-empty">Select employee and month to view attendance</td></tr>';
    }
}

function renderSingleEmployeeMonthAttendance(employee, monthStr) {
    const body = document.getElementById('monthAttendanceBody');
    const stats = document.getElementById('monthAttendanceStats');
    if (!body || !stats) return;

    const rows = [];
    const monthDays = getDaysInMonth(monthStr);
    const today = formatDateKey(new Date());

    let statWorking = 0;
    let statPresent = 0;
    let statLate = 0;
    let statLeave = 0;
    let statWfh = 0;
    let statAbsent = 0;
    const joinDate = getEmployeeJoinDate(employee);
    monthDays.forEach(dateStr => {
        if (!isJoinedByDate(employee, dateStr)) return;

        const isJoinDate = Boolean(joinDate) && dateStr === joinDate;
        const isCycleMonthEnd = isEmployeeCycleMonthEndDate(employee, dateStr);
        const isRecurringMonthEnd = isCycleMonthEnd && !isJoinDate;
        const isFutureDate = dateStr > today;
        if (isFutureDate && !isJoinDate && !isRecurringMonthEnd) return;

        const dateObj = new Date(dateStr + 'T00:00:00');
        const dayName = dateObj.toLocaleDateString('en-IN', { weekday: 'short' });
        const dateText = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const rowClasses = [
            isJoinDate ? 'emp-month-join-row' : '',
            isRecurringMonthEnd ? 'emp-month-cycle-end-row' : ''
        ].filter(Boolean).join(' ');

        if (isFutureDate && (isJoinDate || isRecurringMonthEnd)) {
            const specialNotes = [];
            if (isJoinDate) specialNotes.push('<span class="emp-month-note-join">Joining date</span>');
            if (isRecurringMonthEnd) specialNotes.push('<span class="emp-month-note-cycle-end">Month-end day</span>');
            rows.push(`
            <tr class="${rowClasses}">
                <td>
                    ${dateText}
                    ${isJoinDate ? '<span class="emp-month-join-tag"><i class="fas fa-flag"></i> Joined</span>' : ''}
                    ${isRecurringMonthEnd ? '<span class="emp-month-cycle-end-tag"><i class="fas fa-calendar-check"></i> Month End</span>' : ''}
                </td>
                <td>${dayName}</td>
                <td><span class="att-badge upcoming"><i class="fas fa-hourglass-half"></i> Upcoming</span></td>
                <td>—</td>
                <td>—</td>
                <td>${specialNotes.join('')}</td>
            </tr>
        `);
            return;
        }

        const dayRecord = (attendanceData[dateStr] || {})[employee.id] || null;
        const statusInfo = classifyEmployeeStatusForDate(employee, employee.id, dateStr, dayRecord);

        if (statusInfo.status === 'on-leave') statLeave++;
        else if (statusInfo.status === 'wfh') { statWfh++; statWorking++; }
        else if (statusInfo.status === 'present') { statPresent++; statWorking++; }
        else if (statusInfo.status === 'late') { statLate++; statWorking++; }
        else statAbsent++;

        const statusClass = statusInfo.status === 'wfh' ? 'on-leave' : statusInfo.status;
        const specialNotes = [];
        if (isJoinDate) specialNotes.push('<span class="emp-month-note-join">Joining date</span>');
        if (isRecurringMonthEnd) specialNotes.push('<span class="emp-month-note-cycle-end">Month-end day</span>');
        rows.push(`
            <tr class="${rowClasses}">
                <td>
                    ${dateText}
                    ${isJoinDate ? '<span class="emp-month-join-tag"><i class="fas fa-flag"></i> Joined</span>' : ''}
                    ${isRecurringMonthEnd ? '<span class="emp-month-cycle-end-tag"><i class="fas fa-calendar-check"></i> Month End</span>' : ''}
                </td>
                <td>${dayName}</td>
                <td><span class="att-badge ${statusClass}">${statusInfo.label}</span></td>
                <td>${statusInfo.timeText}</td>
                <td>${statusInfo.lateByText}</td>
                <td>${statusInfo.notes}${specialNotes.join('')}</td>
            </tr>
        `);
    });

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="emp-month-empty">No attendance rows for selected month</td></tr>';
        stats.style.display = 'none';
        return;
    }

    body.innerHTML = rows.join('');

    document.getElementById('mStatWorking').textContent = statWorking;
    document.getElementById('mStatPresent').textContent = statPresent;
    document.getElementById('mStatLate').textContent = statLate;
    document.getElementById('mStatLeave').textContent = statLeave;
    document.getElementById('mStatWfh').textContent = statWfh;
    document.getElementById('mStatAbsent').textContent = statAbsent;
    stats.style.display = 'grid';
}

// ─── Late / Half-day accounting ────────────────────────────────────────────

function countLateInMonth(employeeId, monthStr) {
    const employee = getEmployees().find(e => e.id === employeeId);
    let count = 0;
    Object.keys(attendanceData).forEach(dateKey => {
        if (!dateKey.startsWith(monthStr)) return;
        if (employee && !isJoinedByDate(employee, dateKey)) return;
        const rec = (attendanceData[dateKey] || {})[employeeId];
        if (rec && rec.time && isLate(rec.time)) {
            // Skip full-day leave dates. Half-day leave still allows attendance and can be counted.
            const leaveOnDate = getLeaveForDate(employeeId, dateKey);
            if (leaveOnDate && leaveOnDate.halfDay !== true) return;
            count++;
        }
    });
    return count;
}

function halfDaysAccumulated(employeeId, monthStr) {
    return Math.floor(countLateInMonth(employeeId, monthStr) / attendanceSettings.lateDaysHalfDay);
}

// ─── Auto-deduct half days from leave balance ─────────────────────────────

async function applyHalfDayDeductions(employeeId, monthStr) {
    const currentHalfDays = halfDaysAccumulated(employeeId, monthStr);
    const storageKey = `halfDayDeducted_${employeeId}_${monthStr}`;
    const prevApplied = parseFloat(localStorage.getItem(storageKey) || '0');
    const diff = currentHalfDays - prevApplied;

    if (diff === 0) return;

    const employees = getEmployees();
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;

    // Ensure leaveBalance structure
    if (!emp.leaveBalance) emp.leaveBalance = { paidLeave: 20 };
    if (emp.leaveBalance.paidLeave === undefined) {
        emp.leaveBalance.paidLeave = (emp.leaveBalance.annualLeave || 0) +
            (emp.leaveBalance.sickLeave || 0) + (emp.leaveBalance.personalLeave || 0) || 20;
    }

    const deductionDays = diff * 0.5;
    emp.leaveBalance.paidLeave = Math.max(0, parseFloat((emp.leaveBalance.paidLeave - deductionDays).toFixed(1)));

    try {
        await saveEmployeeToDB(emp);
        localStorage.setItem(storageKey, currentHalfDays);
        if (diff > 0) {
            showNotification(
                `${emp.firstName} ${emp.lastName}: ${diff} half day${diff > 1 ? 's' : ''} deducted (${deductionDays}d from leave balance)`,
                'warning'
            );
        }
    } catch (e) {
        console.error('Failed to apply half-day deduction', e);
    }
}

// ─── Render ────────────────────────────────────────────────────────────────

function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceTableBody');
    const employees = getEmployees().filter(e => e.status === 'Active' && isJoinedByDate(e, currentDate));
    const monthStr = getMonthStr(currentDate);
    const dayRecs = attendanceData[currentDate] || {};

    if (employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No active employees found</td></tr>';
        updateStats([], dayRecs, monthStr);
        return;
    }

    tbody.innerHTML = employees.map((emp, idx) => {
        const leave = getLeaveForDate(emp.id, currentDate);
        const isHalfDayLeave = leave && leave.halfDay === true;
        const wfh = getWorkFromHomeForDate(emp.id, currentDate);
        const rec = dayRecs[emp.id] || {};

        let status;
        if (leave && !isHalfDayLeave) {
            status = 'on-leave';
        } else if (wfh) {
            status = 'wfh';
        } else if (rec.time) {
            status = isLate(rec.time) ? 'late' : 'present';
        } else {
            status = rec.status || 'absent';
        }

        // Late details
        let lateBadge = '—';
        let lateWarning = '';
        if (rec.time && isLate(rec.time)) {
            const rawLate = minutesAfterOffice(rec.time);
            lateBadge = `<span style="color:#b45309;font-weight:600;">${rawLate} min</span>`;
            const lateThisMonth = countLateInMonth(emp.id, monthStr);
            const nextHalfIn = attendanceSettings.lateDaysHalfDay - (lateThisMonth % attendanceSettings.lateDaysHalfDay);
            if (nextHalfIn === 1) {
                lateWarning = `<div class="late-warn"><i class="fas fa-exclamation-triangle"></i> 1 more late = half day!</div>`;
            }
        }

        // Half-day leave badge (from leave request, not late attendance)
        const session = isHalfDayLeave ? (leave.halfDaySession === 'Second Half' ? 'PM' : 'AM') : '';
        const halfDayLeaveBadge = isHalfDayLeave
            ? `<span class="att-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;margin-left:4px;font-size:11px;padding:2px 7px;border-radius:4px;"><i class="fas fa-adjust"></i> ½ ${session} Leave</span>`
            : '';

        // Late-accumulation half-day badge
        const hd = halfDaysAccumulated(emp.id, monthStr);
        const hdBadge = hd > 0
            ? `<span class="att-badge half-day" style="margin-left:4px;"><i class="fas fa-adjust"></i> ${hd} Half Day${hd > 1 ? 's' : ''}</span>`
            : '';

        // Status badge
        const badgeMap = {
            present: `<i class="fas fa-check"></i> Present`,
            late:     `<i class="fas fa-clock"></i> Late`,
            absent:   `<i class="fas fa-times"></i> Absent`,
            'on-leave': `<i class="fas fa-umbrella-beach"></i> On Leave`,
            wfh: `<i class="fas fa-house-laptop"></i> WFH`
        };

        // Time cell — half-day leave employees can still clock in
        const timeCell = (leave && !isHalfDayLeave)
            ? `<span style="font-size:12px;color:#718096;">${leave.leaveType}</span>`
            : (wfh
                ? `<span style="font-size:12px;color:#2563eb;">Work From Home</span>`
                : (rec.time ? formatTime12h(rec.time) : '—'));

        // Action cell — half-day leave employees can still mark attendance
        let actionCell;
        if (leave && !isHalfDayLeave) {
            actionCell = `<span style="font-size:12px;color:#718096;font-style:italic;">On Leave</span>`;
        } else if (wfh) {
            actionCell = `<span style="font-size:12px;color:#2563eb;font-style:italic;">WFH</span>`;
        } else {
            actionCell = `<div class="time-wrap">
                <input type="time" value="${rec.time || ''}" onchange="setEntryTime(${emp.id}, this.value)" title="Set entry time">
                <button class="btn-mark now" onclick="markNow(${emp.id})" title="Mark present at current time">
                    <i class="fas fa-clock"></i> Now
                </button>
                ${rec.time
                    ? `<button class="btn-mark clear" onclick="clearEntry(${emp.id})" title="Clear">Clear</button>`
                    : `<button class="btn-mark absent" onclick="markAbsent(${emp.id})">Absent</button>`
                }
            </div>`;
        }

        return `<tr>
            <td style="color:#a0aec0;">${idx + 1}</td>
            <td><strong>${emp.firstName} ${emp.lastName}</strong></td>
            <td><span style="font-size:12px;color:#718096;">${emp.department}</span></td>
            <td>
                <span class="att-badge ${status}">${badgeMap[status]}</span>
                ${halfDayLeaveBadge}
                ${hdBadge}
            </td>
            <td>${timeCell}</td>
            <td>${lateBadge}${lateWarning}</td>
            <td>${actionCell}</td>
        </tr>`;
    }).join('');

    updateStats(employees, dayRecs, monthStr);
}

function updateStats(employees, dayRecs, monthStr) {
    let present = 0, late = 0, onLeave = 0, wfh = 0, absent = 0, halfDayTotal = 0;
    employees.forEach(emp => {
        const leaveRec = getLeaveForDate(emp.id, currentDate);
        const isHalfDayLeave = leaveRec && leaveRec.halfDay === true;
        if (leaveRec && !isHalfDayLeave) { onLeave++; }
        else if (getWorkFromHomeForDate(emp.id, currentDate)) { wfh++; }
        else {
            const rec = dayRecs[emp.id] || {};
            if (rec.time) { if (isLate(rec.time)) late++; else present++; }
            else absent++;
        }
        halfDayTotal += halfDaysAccumulated(emp.id, monthStr);
    });
    document.getElementById('statPresent').textContent = present;
    document.getElementById('statLate').textContent    = late;
    document.getElementById('statOnLeave').textContent = onLeave + wfh;
    document.getElementById('statAbsent').textContent  = absent;
    document.getElementById('statHalfDay').textContent = halfDayTotal;
}

// ─── Mark actions ──────────────────────────────────────────────────────────

function markNow(employeeId) {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setEntryTime(employeeId, time);
}

function markAbsent(employeeId) {
    if (!attendanceData[currentDate]) attendanceData[currentDate] = {};
    attendanceData[currentDate][employeeId] = { time: null, status: 'absent' };
    persistDayRecord();
    renderAttendanceTable();
    applyHalfDayDeductions(employeeId, getMonthStr(currentDate));
}

function clearEntry(employeeId) {
    if (attendanceData[currentDate]) {
        delete attendanceData[currentDate][employeeId];
        persistDayRecord();
        renderAttendanceTable();
        applyHalfDayDeductions(employeeId, getMonthStr(currentDate));
    }
}

function setEntryTime(employeeId, time) {
    if (!attendanceData[currentDate]) attendanceData[currentDate] = {};
    if (!time) { clearEntry(employeeId); return; }
    const status = isLate(time) ? 'late' : 'present';
    attendanceData[currentDate][employeeId] = { time, status };
    persistDayRecord();
    renderAttendanceTable();
    applyHalfDayDeductions(employeeId, getMonthStr(currentDate));
}

// ─── Message generation ────────────────────────────────────────────────────

function generateMessage() {
    const employees = getEmployees().filter(e => e.status === 'Active' && isJoinedByDate(e, currentDate));
    const dayRecs = attendanceData[currentDate] || {};
    const monthStr = getMonthStr(currentDate);

    const dateObj = new Date(currentDate + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const onTime = [], late = [], onLeave = [], wfh = [], absent = [];

    employees.forEach(emp => {
        const leaveRec = getLeaveForDate(emp.id, currentDate);
        const isHalfDayLeave = leaveRec && leaveRec.halfDay === true;
        if (leaveRec && !isHalfDayLeave) { onLeave.push({ emp, leaveType: leaveRec.leaveType }); return; }
        const wfhRec = getWorkFromHomeForDate(emp.id, currentDate);
        if (wfhRec) { wfh.push({ emp }); return; }

        const halfDayNote = isHalfDayLeave
            ? ` [½ ${leaveRec.halfDaySession === 'Second Half' ? 'PM' : 'AM'} Leave]`
            : '';
        const rec = dayRecs[emp.id] || {};
        if (rec.time) {
            const minsLate = minutesAfterOffice(rec.time);
            if (isLate(rec.time)) late.push({ emp, time: rec.time, minsLate, halfDayNote });
            else onTime.push({ emp, time: rec.time, halfDayNote });
        } else {
            absent.push({ emp, halfDayNote });
        }
    });

    let msg = `📋 *Attendance Report — ${dateDisplay}*\n`;
    msg += `🏢 Office Time: ${formatTime12h(attendanceSettings.officeStartTime)}  |  Grace: ${attendanceSettings.lateThresholdMins} min\n\n`;

    if (onTime.length > 0) {
        msg += `✅ *On Time (${onTime.length}):*\n`;
        onTime.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName} — ${formatTime12h(r.time)}${r.halfDayNote || ''}\n`; });
        msg += '\n';
    }
    if (late.length > 0) {
        msg += `⏰ *Late (${late.length}):*\n`;
        late.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName} — ${formatTime12h(r.time)} (${r.minsLate} min late)${r.halfDayNote || ''}\n`; });
        msg += '\n';
    }
    if (onLeave.length > 0) {
        msg += `🏖️ *On Leave (${onLeave.length}):*\n`;
        onLeave.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName} — ${r.leaveType}\n`; });
        msg += '\n';
    }
    if (wfh.length > 0) {
        msg += `🏠 *Work From Home (${wfh.length}):*\n`;
        wfh.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName}\n`; });
        msg += '\n';
    }
    if (absent.length > 0) {
        msg += `❌ *Absent (${absent.length}):*\n`;
        absent.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName}${r.halfDayNote || ''}\n`; });
        msg += '\n';
    }

    msg += `📊 Total: ${onTime.length + late.length + wfh.length} Working | ${onLeave.length} On Leave | ${absent.length} Absent`;

    document.getElementById('attendanceMessage').value = msg;

    // Half-day alerts
    const alertsDiv = document.getElementById('halfDayAlerts');
    const hdAlerts = [];
    employees.forEach(emp => {
        const hd = halfDaysAccumulated(emp.id, monthStr);
        const lateCount = countLateInMonth(emp.id, monthStr);
        if (hd > 0) hdAlerts.push({ emp, hd, lateCount });
    });
    alertsDiv.innerHTML = hdAlerts.map(r =>
        `<div class="half-day-alert">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>${r.emp.firstName} ${r.emp.lastName}</strong>
            has accumulated <strong>${r.hd} half day${r.hd > 1 ? 's' : ''}</strong> this month
            (late ${r.lateCount} times)
        </div>`
    ).join('');
}

function copyMessage() {
    const ta = document.getElementById('attendanceMessage');
    if (!ta.value.trim()) generateMessage();

    navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.getElementById('copyBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.cssText = 'background:#d1fae5;color:#065f46;';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.cssText = '';
        }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        ta.select();
        document.execCommand('copy');
        showNotification('Copied to clipboard!', 'success');
    });
}
