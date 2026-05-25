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

    loadAttendanceSettings();
    updateSettingsSummary();

    await Promise.all([loadEmployees(), loadLeaves()]);

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

function isWorkFromHomeLeave(leave) {
    return String(leave?.leaveType || '').trim().toLowerCase() === 'work from home';
}

// ─── Settings ──────────────────────────────────────────────────────────────

function loadAttendanceSettings() {
    const saved = localStorage.getItem('attendanceSettings');
    if (saved) {
        try { attendanceSettings = { ...attendanceSettings, ...JSON.parse(saved) }; } catch (e) {}
    }
    document.getElementById('officeStartTime').value   = attendanceSettings.officeStartTime;
    document.getElementById('lateThresholdMins').value = attendanceSettings.lateThresholdMins;
    document.getElementById('lateDaysHalfDay').value   = attendanceSettings.lateDaysHalfDay;
}

function saveAttendanceSettings() {
    attendanceSettings.officeStartTime   = document.getElementById('officeStartTime').value;
    attendanceSettings.lateThresholdMins = parseInt(document.getElementById('lateThresholdMins').value) || 10;
    attendanceSettings.lateDaysHalfDay   = parseInt(document.getElementById('lateDaysHalfDay').value) || 3;
    localStorage.setItem('attendanceSettings', JSON.stringify(attendanceSettings));
    updateSettingsSummary();
    renderAttendanceTable();
}

function updateSettingsSummary() {
    const el = document.getElementById('settingsSummaryText');
    if (!el) return;
    el.innerHTML = `If an employee is late more than <strong>${attendanceSettings.lateDaysHalfDay}</strong> times in a month by more than <strong>${attendanceSettings.lateThresholdMins}</strong> minutes after <strong>${formatTime12h(attendanceSettings.officeStartTime)}</strong>, it counts as a half day deduction.`;
}

function toggleSettings() {
    const body = document.getElementById('settingsBody');
    const chevron = document.getElementById('settingsChevron');
    body.classList.toggle('open');
    chevron.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
}

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

// ─── Late / Half-day accounting ────────────────────────────────────────────

function countLateInMonth(employeeId, monthStr) {
    let count = 0;
    Object.keys(attendanceData).forEach(dateKey => {
        if (!dateKey.startsWith(monthStr)) return;
        const rec = (attendanceData[dateKey] || {})[employeeId];
        if (rec && rec.time && isLate(rec.time)) count++;
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
    const employees = getEmployees().filter(e => e.status === 'Active');
    const monthStr = getMonthStr(currentDate);
    const dayRecs = attendanceData[currentDate] || {};

    if (employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No active employees found</td></tr>';
        updateStats([], dayRecs, monthStr);
        return;
    }

    tbody.innerHTML = employees.map((emp, idx) => {
        const leave = getLeaveForDate(emp.id, currentDate);
        const wfh = getWorkFromHomeForDate(emp.id, currentDate);
        const rec = dayRecs[emp.id] || {};

        let status;
        if (leave) {
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

        // Half-day badge
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

        // Time cell
        const timeCell = leave
            ? `<span style="font-size:12px;color:#718096;">${leave.leaveType}</span>`
            : (wfh
                ? `<span style="font-size:12px;color:#2563eb;">Work From Home</span>`
                : (rec.time ? formatTime12h(rec.time) : '—'));

        // Action cell
        let actionCell;
        if (leave) {
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
        if (getLeaveForDate(emp.id, currentDate)) { onLeave++; }
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
    const employees = getEmployees().filter(e => e.status === 'Active');
    const dayRecs = attendanceData[currentDate] || {};
    const monthStr = getMonthStr(currentDate);

    const dateObj = new Date(currentDate + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const onTime = [], late = [], onLeave = [], wfh = [], absent = [];

    employees.forEach(emp => {
        const leaveRec = getLeaveForDate(emp.id, currentDate);
        if (leaveRec) { onLeave.push({ emp, leaveType: leaveRec.leaveType }); return; }
        const wfhRec = getWorkFromHomeForDate(emp.id, currentDate);
        if (wfhRec) { wfh.push({ emp }); return; }

        const rec = dayRecs[emp.id] || {};
        if (rec.time) {
            const minsLate = minutesAfterOffice(rec.time);
            if (isLate(rec.time)) late.push({ emp, time: rec.time, minsLate });
            else onTime.push({ emp, time: rec.time });
        } else {
            absent.push({ emp });
        }
    });

    let msg = `📋 *Attendance Report — ${dateDisplay}*\n`;
    msg += `🏢 Office Time: ${formatTime12h(attendanceSettings.officeStartTime)}  |  Grace: ${attendanceSettings.lateThresholdMins} min\n\n`;

    if (onTime.length > 0) {
        msg += `✅ *On Time (${onTime.length}):*\n`;
        onTime.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName} — ${formatTime12h(r.time)}\n`; });
        msg += '\n';
    }
    if (late.length > 0) {
        msg += `⏰ *Late (${late.length}):*\n`;
        late.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName} — ${formatTime12h(r.time)} (${r.minsLate} min late)\n`; });
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
        absent.forEach(r => { msg += `  • ${r.emp.firstName} ${r.emp.lastName}\n`; });
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
