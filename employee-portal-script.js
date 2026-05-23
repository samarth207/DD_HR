/* employee-portal-script.js */
'use strict';

requireEmployee(); // redirect to login.html if not authenticated

const API = API_BASE_URL;
const auth = JSON.parse(localStorage.getItem('hrPortalAuth') || '{}');
const EMP_ID = auth.employeeId;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmt(date) {
    if (!date) return '\u2014';
    const d = new Date(date + (date.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtRupees(n) {
    n = parseFloat(n) || 0;
    return '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function dayName(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });
}
function calcDays(start, end) {
    const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
}
function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function statusBadge(s) {
    const map = {
        approved: 'badge-green', rejected: 'badge-red',
        pending: 'badge-amber', cancelled: 'badge-gray'
    };
    return `<span class="badge ${map[s] || 'badge-gray'}">${s}</span>`;
}

async function apiFetch(path, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const r = await fetch(`${API}${path}`, opts);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
}

function notify(sectionId, msg, type = 'success') {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.innerHTML = `<div class="notify-bar notify-${type}"><i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>${msg}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
}

// â”€â”€ Tab navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function showTab(name) {
    document.querySelectorAll('.tab-section').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const section = document.getElementById('section-' + name);
    if (section) { section.classList.add('active'); section.style.display = 'block'; }
    document.getElementById('tab-' + name).classList.add('active');
    if (name === 'calendar')   renderCalendar();
    if (name === 'sales')      loadMySales();
    if (name === 'advances')   loadMyAdvances();
    if (name === 'salary')     loadSalaryBreakup();
    if (name === 'attendance') loadMyAttendance();
}

// â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadProfile() {
    try {
        const me = await apiFetch('/auth/me', {
            headers: { Authorization: `Bearer ${auth.token}` }
        });
        const initials = (me.name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
        document.getElementById('avatarInitials').textContent = initials;
        document.getElementById('topbarName').textContent = me.name || '';
        document.getElementById('topbarRole').textContent = `${me.position || ''} \u00B7 ${me.department || ''}`;
        return me;
    } catch { return {}; }
}

// â”€â”€ Overview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadOverview() {
    try {
        const [empData, leavesData] = await Promise.all([
            apiFetch(`/employees/${EMP_ID}`),
            apiFetch('/leaves')
        ]);
        const myLeaves = (leavesData.leaves || leavesData || []).filter(l => l.employeeId === EMP_ID);
        const pending  = myLeaves.filter(l => l.status === 'pending').length;

        // Leave balance
        const bal = (empData.leaveBalance || {}).paidLeave ?? 12;
        document.getElementById('kpiLeave').textContent = `${bal} days`;
        document.getElementById('kpiPending').textContent = pending;

        // Outstanding advance
        const advData = await apiFetch('/incentives/data').catch(() => ({ salaryAdvances: [] }));
        const advances = (advData.salaryAdvances || []).filter(a => a.employeeId === EMP_ID);
        const outstanding = advances.filter(a => !a.repaid).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        document.getElementById('kpiAdvance').textContent = fmtRupees(outstanding);

        // Net salary (gross minus outstanding advance)
        const gross = parseFloat(empData.salary) || 0;
        const net   = Math.max(0, gross - outstanding);
        document.getElementById('kpiSalary').textContent = fmtRupees(net);

        // Recent leaves table
        const recent = [...myLeaves].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).slice(0, 5);
        const tbody = document.getElementById('recentLeavesBody');
        if (!recent.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data"><i class="fas fa-calendar"></i><br>No leave requests yet</td></tr>';
        } else {
            tbody.innerHTML = recent.map(l => `
                <tr>
                    <td>${l.leaveType || 'â€”'}</td>
                    <td>${fmt(l.startDate)}</td>
                    <td>${fmt(l.endDate)}</td>
                    <td>${calcDays(l.startDate, l.endDate)}</td>
                    <td>${statusBadge(l.status)}</td>
                </tr>`).join('');
        }
    } catch (e) {
        console.error('Overview error', e);
    }
}

// â”€â”€ Leaves â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function calcLeaveDays() {
    const s = document.getElementById('leaveStart').value;
    const e = document.getElementById('leaveEnd').value;
    const info = document.getElementById('leaveDayInfo');
    if (s && e) {
        const d = calcDays(s, e);
        if (d <= 0) { info.textContent = 'End date must be after start date.'; return; }
        info.innerHTML = `<strong>${d}</strong> day${d !== 1 ? 's' : ''} selected`;
    } else {
        info.textContent = '';
    }
}

function updateLeaveBalance() { /* balance is static label */ }

async function submitLeave(event) {
    event.preventDefault();
    const type  = document.getElementById('leaveType').value;
    const start = document.getElementById('leaveStart').value;
    const end   = document.getElementById('leaveEnd').value;
    const reason = document.getElementById('leaveReason').value;

    if (calcDays(start, end) <= 0) { notify('leaveNotify', 'End date must be on or after start date.', 'error'); return; }

    // Overlap check â€” cannot apply on a date that has an existing non-rejected leave
    try {
        const leavesData = await apiFetch('/leaves');
        const myLeaves = (leavesData.leaves || leavesData || []).filter(l => l.employeeId === EMP_ID && l.status !== 'rejected');
        const newStart = new Date(start + 'T00:00:00');
        const newEnd   = new Date(end   + 'T00:00:00');
        const overlap = myLeaves.find(l => {
            const ls = new Date(l.startDate + 'T00:00:00');
            const le = new Date(l.endDate   + 'T00:00:00');
            return newStart <= le && newEnd >= ls;
        });
        if (overlap) {
            notify('leaveNotify', `You already have a ${overlap.status} leave request that overlaps with these dates.`, 'error');
            return;
        }
    } catch { /* non-critical */ }

    const btn = document.getElementById('submitLeaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Submittingâ€¦';

    try {
        const emp = await apiFetch(`/employees/${EMP_ID}`);
        const leaveData = {
            id: Date.now(),
            employeeId: EMP_ID,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            leaveType: type,
            startDate: start,
            endDate: end,
            reason,
            status: 'pending',
            appliedDate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        await apiFetch('/leaves', { method: 'POST', body: JSON.stringify(leaveData) });
        notify('leaveNotify', 'Leave request submitted successfully!');
        document.getElementById('leaveForm').reset();
        document.getElementById('leaveDayInfo').textContent = '';
        loadLeaveHistory();
        loadOverview();
    } catch (e) {
        notify('leaveNotify', e.message || 'Failed to submit leave request.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Request';
    }
}

async function loadLeaveHistory() {
    const tbody = document.getElementById('leaveHistoryBody');
    try {
        const leavesData = await apiFetch('/leaves');
        const myLeaves = (leavesData.leaves || leavesData || [])
            .filter(l => l.employeeId === EMP_ID)
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

        if (!myLeaves.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data"><i class="fas fa-calendar"></i><br>No leave requests yet</td></tr>';
            return;
        }
        tbody.innerHTML = myLeaves.map(l => `
            <tr>
                <td>${l.leaveType || 'â€”'}</td>
                <td>${fmt(l.startDate)}</td>
                <td>${fmt(l.endDate)}</td>
                <td>${calcDays(l.startDate, l.endDate)}</td>
                <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason || 'â€”'}</td>
                <td>${statusBadge(l.status)}</td>
            </tr>`).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">Failed to load leave history</td></tr>';
    }
}

// â”€â”€ Calendar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
let holidays  = [];
let myLeaves  = [];

async function loadCalendarData() {
    try {
        const hRes = await apiFetch('/holidays');
        holidays = hRes.holidays || hRes || [];
    } catch { holidays = []; }
    try {
        const lRes = await apiFetch('/leaves');
        myLeaves = (lRes.leaves || lRes || []).filter(l => l.employeeId === EMP_ID && l.status !== 'rejected');
    } catch { myLeaves = []; }
}

function renderCalendar() {
    const label = document.getElementById('calMonthLabel');
    label.textContent = new Date(calYear, calMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    // Build holiday set for this month
    const holidaySet = {};
    holidays.forEach(h => {
        const d = new Date(h.date + 'T00:00:00');
        if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
            holidaySet[d.getDate()] = h.name || 'Holiday';
        }
    });

    // Build my-leave set
    const leaveSet = new Set();
    myLeaves.forEach(l => {
        const s = new Date(l.startDate + 'T00:00:00');
        const e = new Date(l.endDate   + 'T00:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            if (d.getFullYear() === calYear && d.getMonth() === calMonth) leaveSet.add(d.getDate());
        }
    });

    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('');

    // Empty cells before 1st
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
        const thisDate = new Date(calYear, calMonth, day); thisDate.setHours(0,0,0,0);
        const dow = thisDate.getDay();
        let cls = 'cal-day';
        if (thisDate.getTime() === today.getTime()) cls += ' today';
        if (holidaySet[day]) cls += ' holiday';
        else if (leaveSet.has(day)) cls += ' my-leave';
        else if (dow === 0) cls += ' sunday';

        const title = holidaySet[day] ? holidaySet[day] : (leaveSet.has(day) ? 'My Leave' : '');
        html += `<div class="${cls}" title="${title}">${day}</div>`;
    }

    document.getElementById('calGrid').innerHTML = html;

    // Upcoming holidays table
    const now = new Date(); now.setHours(0,0,0,0);
    const upcoming = holidays
        .filter(h => new Date(h.date + 'T00:00:00') >= now)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 8);

    const htbody = document.getElementById('upcomingHolidaysBody');
    htbody.innerHTML = upcoming.length
        ? upcoming.map(h => `
            <tr>
                <td style="font-weight:600;">${h.name}</td>
                <td>${fmt(h.date)}</td>
                <td>${dayName(h.date)}</td>
                <td><span class="badge badge-amber">${h.type || 'Public'}</span></td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="no-data"><i class="fas fa-check-circle"></i><br>No upcoming holidays</td></tr>';
}

function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }

// â”€â”€ Sales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function initSalesMonths() {
    const sel = document.getElementById('salesMonthFilter');
    sel.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        sel.appendChild(opt);
    }
}

async function loadMySales() {
    const month = document.getElementById('salesMonthFilter').value;
    const tbody = document.getElementById('salesHistoryBody');
    const kpiDiv = document.getElementById('salesKPIs');
    tbody.innerHTML = '<tr><td colspan="6" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const [data, config, allSalesData, admissions] = await Promise.all([
            apiFetch('/incentives/data'),
            apiFetch('/incentives/config').catch(() => ({})),
            apiFetch('/sales').catch(() => ({})),
            apiFetch(`/admissions?employeeId=${EMP_ID}&month=${month}`).catch(() => [])
        ]);
        const allBonuses   = (data.dailyBonuses || []).filter(b => b.employeeId === EMP_ID || b.employeeId === String(EMP_ID));
        const monthBonuses = allBonuses.filter(b => (b.date || '').startsWith(month));

        const totalBonuses    = monthBonuses.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
        // Use admissions count if available, else fall back to daily bonuses count
        const admList = Array.isArray(admissions) ? admissions : [];
        const totalAdmissions = admList.length || monthBonuses.reduce((s, b) => s + (parseInt(b.salesCount) || 0), 0);

        // Monthly sales/revenue target from sales tracking
        const empSales      = (allSalesData[month] || {})[EMP_ID] || (allSalesData[month] || {})[String(EMP_ID)] || {};
        const salesTarget   = empSales.salesTarget    || 0;
        const salesAchieved = empSales.salesAchieved  || 0;
        const revTarget     = empSales.revenueTarget  || 0;
        const revAchieved   = empSales.revenueAchieved || 0;

        // Monthly incentive for this employee
        const monthlyKey       = `${month}_${EMP_ID}`;
        const monthlyInc       = (data.monthlyIncentives || {})[monthlyKey];
        const monthlyIncAmount = monthlyInc ? (parseFloat(monthlyInc.amount) || 0) : 0;
        const monthlyIncPaid   = monthlyInc?.paid || false;

        kpiDiv.innerHTML = `
            <div class="kpi"><div class="kpi-label">This Month Bonus</div><div class="kpi-value" style="color:var(--green);">${fmtRupees(totalBonuses)}</div><div class="kpi-sub">Daily bonuses earned</div></div>
            <div class="kpi"><div class="kpi-label">Total Admissions</div><div class="kpi-value">${totalAdmissions}</div><div class="kpi-sub">This month</div></div>
            ${revAchieved > 0 ? `<div class="kpi"><div class="kpi-label">Revenue This Month</div><div class="kpi-value" style="color:var(--primary);">${fmtRupees(revAchieved)}</div><div class="kpi-sub">${revTarget > 0 ? `of ${fmtRupees(revTarget)} target` : 'Achieved'}</div></div>` : ''}
            ${monthlyIncAmount > 0 ? `<div class="kpi"><div class="kpi-label">Monthly Incentive</div><div class="kpi-value" style="color:var(--amber);">${fmtRupees(monthlyIncAmount)}</div><div class="kpi-sub">${monthlyIncPaid ? '<span class="badge badge-green" style="font-size:10px;">Paid</span>' : '<span class="badge badge-amber" style="font-size:10px;">Pending</span>'}</div></div>` : ''}`;

        // Build target card
        const courseRewards = config.courseRewards || {};
        const slabs         = config.slabs         || {};

        // Achievement % for target bar
        let achievePct = 0, targetLabel = '', targetValue = '', achievedValue = '';
        if (salesTarget > 0) {
            achievePct    = Math.min(Math.round((salesAchieved / salesTarget) * 100), 200);
            targetLabel   = 'Admissions Target';
            targetValue   = `${salesTarget} admissions`;
            achievedValue = `${salesAchieved} achieved`;
        } else if (revTarget > 0) {
            achievePct    = Math.min(Math.round((revAchieved / revTarget) * 100), 200);
            targetLabel   = 'Revenue Target';
            targetValue   = fmtRupees(revTarget);
            achievedValue = `${fmtRupees(revAchieved)} achieved`;
        }
        const barColor = achievePct >= 200 ? '#16a34a' : achievePct >= 150 ? '#059669' : achievePct >= 100 ? '#2563eb' : achievePct >= 50 ? '#d97706' : '#dc2626';

        // Build slab rows
        const slabThresholds = [100, 150, 200];
        const slabRows = slabThresholds
            .filter(t => slabs[t] !== undefined)
            .map(t => `<tr><td><span class="badge badge-${t >= 200 ? 'green' : t >= 150 ? 'amber' : 'blue'}">${t}%+</span></td><td style="font-weight:700;">${slabs[t]}% of revenue</td></tr>`)
            .join('');

        const targetCard = document.getElementById('salesTargetCard');
        const targetInfo = document.getElementById('salesTargetInfo');
        if (targetCard) {
            targetCard.style.display = '';
            targetInfo.innerHTML = `
                <div class="info-grid">
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-bullseye" style="margin-right:5px;color:var(--primary);"></i>Monthly Target</div>
                        ${(salesTarget > 0 || revTarget > 0) ? `
                        <div style="font-size:20px;font-weight:800;color:var(--primary);margin-bottom:4px;">${targetValue}</div>
                        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${achievedValue}</div>
                        <div style="background:var(--border);border-radius:6px;height:8px;overflow:hidden;margin-bottom:6px;">
                            <div style="height:100%;width:${Math.min(achievePct,100)}%;background:${barColor};border-radius:6px;transition:width .4s;"></div>
                        </div>
                        <div style="font-size:12px;font-weight:700;color:${barColor};">${achievePct}% achieved</div>
                        ` : `<div style="font-size:13px;color:var(--muted);">No target set for this month</div>`}
                    </div>
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-coins" style="margin-right:5px;color:var(--primary);"></i>Revenue This Month</div>
                        <div style="font-size:22px;font-weight:800;color:var(--primary);margin-bottom:4px;">${fmtRupees(revAchieved)}</div>
                        ${revTarget > 0 ? `<div style="font-size:12px;color:var(--muted);">Target: ${fmtRupees(revTarget)}</div>` : '<div style="font-size:12px;color:var(--muted);">No revenue target set</div>'}
                    </div>
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-graduation-cap" style="margin-right:5px;color:var(--primary);"></i>Today's Per Admission Earnings</div>
                        <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">One-Time Course</span> <strong style="color:#16a34a;">${fmtRupees(courseRewards.onetime || 0)}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Annual Course</span>   <strong style="color:#16a34a;">${fmtRupees(courseRewards.annual   || 0)}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Semester Course</span> <strong style="color:#16a34a;">${fmtRupees(courseRewards.semester || 0)}</strong></div>
                        </div>
                    </div>
                    <div class="info-block info-block-wide">
                        <div class="info-block-title"><i class="fas fa-trophy" style="margin-right:5px;color:var(--primary);"></i>Monthly Incentive Slabs</div>
                        <div style="overflow-x:auto;">
                            <table class="mini-table">
                                <thead><tr><th>Achievement</th><th>Incentive</th></tr></thead>
                                <tbody>${slabRows || '<tr><td colspan="2" style="color:var(--muted);text-align:center;">No slabs configured</td></tr>'}</tbody>
                            </table>
                        </div>
                        <div style="font-size:11px;color:var(--muted);margin-top:8px;"><i class="fas fa-info-circle"></i> Incentive % is applied on monthly revenue achieved. Eligible when â‰¥ 100% of target is met.</div>
                    </div>
                    ${monthlyIncAmount > 0 ? `
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-star" style="margin-right:5px;color:var(--amber);"></i>This Month's Incentive</div>
                        <div style="font-size:22px;font-weight:800;color:#d97706;margin-bottom:4px;">${fmtRupees(monthlyIncAmount)}</div>
                        <div>${monthlyIncPaid ? '<span class="badge badge-green"><i class="fas fa-check"></i> Credited</span>' : '<span class="badge badge-amber"><i class="fas fa-clock"></i> Pending</span>'}</div>
                    </div>` : ''}
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-calendar-check" style="margin-right:5px;color:var(--primary);"></i>This Month Summary</div>
                        <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Total admissions</span> <strong>${totalAdmissions}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Daily bonuses earned</span> <strong style="color:#16a34a;">${fmtRupees(totalBonuses)}</strong></div>
                        </div>
                    </div>
                </div>`;
        }

        // Render admission records table
        if (!admList.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data"><i class="fas fa-graduation-cap"></i><br>No admissions recorded for this month</td></tr>';
            return;
        }

        const typeLabel = { 'one-time': 'One-Time', 'semester': 'Semester', 'annual': 'Annual' };
        const typeBadge = { 'one-time': 'badge-blue', 'semester': 'badge-amber', 'annual': 'badge-green' };

        tbody.innerHTML = admList
            .sort((a, b) => new Date(b.admissionDate) - new Date(a.admissionDate))
            .map(a => `<tr>
                <td>${fmt(a.admissionDate)}</td>
                <td style="font-weight:600;">${a.customerName || 'â€”'}</td>
                <td style="color:var(--muted);font-size:12px;">${a.customerPhone || 'â€”'}</td>
                <td style="color:var(--muted);font-size:12px;">${a.customerEmail || 'â€”'}</td>
                <td><span class="badge ${typeBadge[a.admissionType] || 'badge-blue'}" style="font-size:11px;">${typeLabel[a.admissionType] || a.admissionType || 'â€”'}</span></td>
                <td style="color:var(--green);font-weight:700;">${fmtRupees(a.revenue || 0)}</td>
            </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">Failed to load sales data</td></tr>';
    }
}
// â”€â”€ Advances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadMyAdvances() {
    const tbody = document.getElementById('advancesBody');
    const summary = document.getElementById('advancesSummary');
    tbody.innerHTML = '<tr><td colspan="5" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const data = await apiFetch('/incentives/data');
        const advances = (data.salaryAdvances || [])
            .filter(a => a.employeeId === EMP_ID)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const total      = advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        const outstanding = advances.filter(a => !a.repaid).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

        summary.innerHTML = `
            <div style="display:flex;gap:14px;flex-wrap:wrap;">
                <div class="kpi" style="min-width:160px;">
                    <div class="kpi-label">Total Taken</div>
                    <div class="kpi-value">${fmtRupees(total)}</div>
                </div>
                <div class="kpi" style="min-width:160px;">
                    <div class="kpi-label">Outstanding</div>
                    <div class="kpi-value" style="color:var(--red);">${fmtRupees(outstanding)}</div>
                    <div class="kpi-sub">Will be deducted from salary</div>
                </div>
            </div>`;

        if (!advances.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data"><i class="fas fa-hand-holding-usd"></i><br>No advances taken</td></tr>';
            return;
        }

        tbody.innerHTML = advances.map(a => `
            <tr>
                <td>${fmt(a.date)}</td>
                <td style="font-weight:700;">${fmtRupees(a.amount)}</td>
                <td>${a.reason || 'â€”'}</td>
                <td><span class="badge ${a.repaid ? 'badge-green' : 'badge-red'}">${a.repaid ? 'Repaid' : 'Outstanding'}</span></td>
                <td>${a.repaid ? fmt(a.repaidDate) : 'â€”'}</td>
            </tr>`).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Failed to load advance data</td></tr>';
    }
}

// â”€â”€ Salary Breakup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function initSalaryMonths() {
    const sel = document.getElementById('salaryMonthFilter');
    sel.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        sel.appendChild(opt);
    }
}

async function loadSalaryBreakup() {
    const month   = document.getElementById('salaryMonthFilter').value;
    const content = document.getElementById('salaryBreakupContent');
    content.innerHTML = '<div class="no-data"><div class="spinner"></div></div>';

    try {
        loadAttSettings();
        const [empData, incData, leavesRaw, attDocs] = await Promise.all([
            apiFetch(`/employees/${EMP_ID}`),
            apiFetch('/incentives/data'),
            apiFetch('/leaves'),
            apiFetch(`/attendance/month/${month}`).catch(() => [])
        ]);

        const gross     = parseFloat(empData.salary) || 0;
        const dailyRate = gross / 30;

        // â”€â”€ Unpaid leave deduction (policy: 1 paid leave/month; rest unpaid) â”€â”€
        const [yr, mo]  = month.split('-').map(Number);
        const monthStart = new Date(yr, mo - 1, 1);
        const monthEnd   = new Date(yr, mo, 0); monthEnd.setHours(23, 59, 59, 999);
        const myLeaves   = (leavesRaw.leaves || leavesRaw || [])
            .filter(l => (l.employeeId === EMP_ID || l.employeeId === String(EMP_ID)) && l.status === 'approved');
        let totalLeaveDays = 0;
        for (const leave of myLeaves) {
            const ls = new Date(leave.startDate + 'T00:00:00');
            const le = new Date(leave.endDate   + 'T00:00:00');
            const os = ls < monthStart ? monthStart : ls;
            const oe = le > monthEnd   ? monthEnd   : le;
            if (os <= oe) totalLeaveDays += Math.round((oe - os) / 86400000) + 1;
        }
        const unpaidLeaveDays      = Math.max(0, totalLeaveDays - 1);
        const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate * 100) / 100;

        // â”€â”€ Late half-day attendance deduction â”€â”€
        let lateCount = 0;
        (attDocs || []).forEach(doc => {
            const rec = (doc.records || {})[EMP_ID] || (doc.records || {})[String(EMP_ID)];
            if (rec && rec.time && isLateEntry(rec.time)) lateCount++;
        });
        const halfDayAttDays      = Math.floor(lateCount / attSettings.lateDaysHalfDay) * 0.5;
        const halfDayAttDeduction = Math.round(halfDayAttDays * dailyRate * 100) / 100;

        // â”€â”€ Outstanding salary advances â”€â”€
        const advances = (incData.salaryAdvances || []).filter(a =>
            (a.employeeId === EMP_ID || a.employeeId === String(EMP_ID)) &&
            (a.status === 'Outstanding' || (!a.repaid && a.status !== 'Repaid'))
        );
        const advanceDeduction = advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

        // â”€â”€ Monthly incentive (Sales dept) â”€â”€
        let incentive = 0;
        const monthKey2 = `${month}_${EMP_ID}`;
        const monthlyRec = (incData.monthlyIncentives || {})[monthKey2];
        if (monthlyRec && monthlyRec.paid) incentive = parseFloat(monthlyRec.amount) || 0;

        // â”€â”€ Daily bonuses this month â”€â”€
        const bonusTotal = (incData.dailyBonuses || [])
            .filter(b => (b.employeeId === EMP_ID || b.employeeId === String(EMP_ID)) && (b.date || '').startsWith(month))
            .reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);

        const totalEarnings   = gross + incentive + bonusTotal;
        const totalDeductions = advanceDeduction + unpaidLeaveDeduction + halfDayAttDeduction;
        const net = Math.max(0, totalEarnings - totalDeductions);

        const payKey = `${month}_${EMP_ID}`;
        const isPaid = (incData.salaryPayments || {})[payKey]?.paid || false;

        const salaryDayInfo = empData.salaryDay
            ? `<div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><i class="fas fa-calendar-check"></i> Salary credit day: <strong>${empData.salaryDay}</strong> of each month</div>`
            : '';

        const paidBadge = isPaid
            ? `<div style="text-align:center;margin-bottom:16px;"><span class="badge badge-green"><i class="fas fa-check-circle"></i> Salary Credited</span></div>`
            : `<div style="text-align:center;margin-bottom:16px;"><span class="badge badge-amber"><i class="fas fa-clock"></i> Pending Credit</span></div>`;

        content.innerHTML = `
            ${paidBadge}
            ${salaryDayInfo}
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-plus-circle" style="color:var(--green);margin-right:6px;"></i>Gross Salary</span>
                <span class="amount">${fmtRupees(gross)}</span>
            </div>
            ${incentive > 0 ? `
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-star" style="color:var(--amber);margin-right:6px;"></i>Monthly Incentive</span>
                <span class="amount">${fmtRupees(incentive)}</span>
            </div>` : ''}
            ${bonusTotal > 0 ? `
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-gift" style="color:var(--green);margin-right:6px;"></i>Daily Bonuses</span>
                <span class="amount">${fmtRupees(bonusTotal)}</span>
            </div>` : ''}
            ${unpaidLeaveDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-calendar-times" style="color:var(--red);margin-right:6px;"></i>Unpaid Leave (${unpaidLeaveDays}d Ã— u{20B9}${Math.round(dailyRate)})</span>
                <span class="amount">- ${fmtRupees(unpaidLeaveDeduction)}</span>
            </div>` : ''}
            ${halfDayAttDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-adjust" style="color:var(--amber);margin-right:6px;"></i>Late Half Days (${halfDayAttDays}d Ã— u{20B9}${Math.round(dailyRate)})</span>
                <span class="amount">- ${fmtRupees(halfDayAttDeduction)}</span>
            </div>` : ''}
            ${advanceDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-minus-circle" style="color:var(--red);margin-right:6px;"></i>Outstanding Advance</span>
                <span class="amount">- ${fmtRupees(advanceDeduction)}</span>
            </div>` : ''}
            <div style="border-top:2px solid var(--border);margin:8px 0;"></div>
            <div class="salary-row net">
                <span class="label" style="color:var(--text);font-weight:700;">Net Payable</span>
                <span class="amount">${fmtRupees(net)}</span>
            </div>
            ${unpaidLeaveDays > 0 || halfDayAttDays > 0 ? `
            <div style="margin-top:14px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:12px;color:#c2410c;line-height:1.7;">
                <i class="fas fa-info-circle"></i>
                ${unpaidLeaveDays > 0 ? `<strong>Unpaid leave:</strong> ${unpaidLeaveDays} day${unpaidLeaveDays !== 1 ? 's' : ''} above the 1-day paid allowance Ã— u{20B9}${Math.round(dailyRate)}/day<br>` : ''}
                ${halfDayAttDays > 0 ? `<strong>Late attendance:</strong> ${lateCount} late day${lateCount !== 1 ? 's' : ''} â†’ ${halfDayAttDays} half-day deduction${halfDayAttDays !== 0.5 ? 's' : ''} Ã— u{20B9}${Math.round(dailyRate)}/day` : ''}
            </div>` : ''}`;
    } catch (e) {
        content.innerHTML = `<div class="no-data">Failed to load salary breakup</div>`;
    }
}

// â”€â”€ Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let attSettings = { officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 };

function loadAttSettings() {
    const saved = localStorage.getItem('attendanceSettings');
    if (saved) { try { attSettings = { ...attSettings, ...JSON.parse(saved) }; } catch(e) {} }
}

function fmt12h(t) {
    if (!t) return 'â€”';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function isLateEntry(t) {
    const [oh, om] = attSettings.officeStartTime.split(':').map(Number);
    const [eh, em] = t.split(':').map(Number);
    return (eh * 60 + em) - (oh * 60 + om) > attSettings.lateThresholdMins;
}

function minsLate(t) {
    const [oh, om] = attSettings.officeStartTime.split(':').map(Number);
    const [eh, em] = t.split(':').map(Number);
    return (eh * 60 + em) - (oh * 60 + om);
}

function initAttendanceMonths() {
    const sel = document.getElementById('attendanceMonthFilter');
    if (!sel) return;
    sel.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = monthKey(d);
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        sel.appendChild(opt);
    }
}

async function loadMyAttendance() {
    loadAttSettings();
    const month     = document.getElementById('attendanceMonthFilter').value;
    const tbody     = document.getElementById('attendanceBody');
    const statsDiv  = document.getElementById('attendanceStats');
    const policyBox = document.getElementById('attendancePolicyInfo');

    policyBox.innerHTML = `<i class="fas fa-info-circle"></i><span>Office start: <strong>${fmt12h(attSettings.officeStartTime)}</strong> &nbsp;&middot;&nbsp; Late threshold: <strong>${attSettings.lateThresholdMins} min</strong> &nbsp;&middot;&nbsp; Every <strong>${attSettings.lateDaysHalfDay}</strong> late days = <strong>0.5 day</strong> deducted from leave balance</span>`;
    tbody.innerHTML = '<tr><td colspan="5" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const [docs, leavesData] = await Promise.all([
            apiFetch(`/attendance/month/${month}`),
            apiFetch('/leaves')
        ]);

        const attMap = {};
        docs.forEach(doc => {
            const rec = (doc.records || {})[EMP_ID] || (doc.records || {})[String(EMP_ID)];
            if (rec) attMap[doc.date] = rec;
        });

        const myLeaves = (leavesData.leaves || leavesData || [])
            .filter(l => (l.employeeId === EMP_ID || l.employeeId === String(EMP_ID)) && l.status === 'approved');

        const [yr, mo] = month.split('-').map(Number);
        const daysInMonth = new Date(yr, mo, 0).getDate();
        const today = new Date(); today.setHours(0,0,0,0);

        let presentDays = 0, lateDays = 0, absentDays = 0, lateCount = 0;
        const rows = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr  = `${month}-${String(d).padStart(2,'0')}`;
            const thisDate = new Date(dateStr + 'T00:00:00');
            if (thisDate > today) continue;
            if (thisDate.getDay() === 0) continue; // skip Sundays

            const dayLabel = thisDate.toLocaleDateString('en-IN', { weekday: 'short' });
            const rec      = attMap[dateStr];
            const onLeave  = myLeaves.find(l => dateStr >= l.startDate && dateStr <= l.endDate);

            let statusHtml, entryTime = '\u2014', lateBy = '\u2014';

            if (onLeave) {
                statusHtml = '<span class="badge badge-purple">On Leave</span>';
            } else if (rec && rec.time) {
                const late = isLateEntry(rec.time);
                entryTime  = fmt12h(rec.time);
                if (late) {
                    const mins = minsLate(rec.time);
                    lateBy     = `${mins} min`;
                    statusHtml = '<span class="badge badge-amber">Late</span>';
                    lateDays++; lateCount++;
                } else {
                    statusHtml = '<span class="badge badge-green">Present</span>';
                    presentDays++;
                }
            } else if (rec && rec.status === 'absent') {
                statusHtml = '<span class="badge badge-red">Absent</span>';
                absentDays++;
            } else {
                statusHtml = '<span class="badge badge-gray">No Record</span>';
            }
            rows.push({ dateStr, dayLabel, entryTime, statusHtml, lateBy });
        }

        const halfDays = Math.floor(lateCount / attSettings.lateDaysHalfDay);
        statsDiv.innerHTML = `
            <div class="kpi-grid" style="margin-bottom:0;">
                <div class="kpi"><div class="kpi-label">Present</div><div class="kpi-value" style="color:#16a34a;">${presentDays}</div><div class="kpi-sub">On time</div></div>
                <div class="kpi"><div class="kpi-label">Late</div><div class="kpi-value" style="color:#d97706;">${lateDays}</div><div class="kpi-sub">Arrived late</div></div>
                <div class="kpi"><div class="kpi-label">Absent</div><div class="kpi-value" style="color:#dc2626;">${absentDays}</div><div class="kpi-sub">Days absent</div></div>
                <div class="kpi"><div class="kpi-label">Half Day Deductions</div><div class="kpi-value" style="color:#7c3aed;">${halfDays}</div><div class="kpi-sub">From leave balance</div></div>
            </div>`;

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data"><i class="fas fa-calendar"></i><br>No records for this month</td></tr>';
            return;
        }
        tbody.innerHTML = rows.reverse().map(r => `
            <tr>
                <td><strong>${fmt(r.dateStr)}</strong></td>
                <td>${r.dayLabel}</td>
                <td>${r.entryTime}</td>
                <td>${r.statusHtml}</td>
                <td>${r.lateBy !== '\u2014' ? `<span style="color:#d97706;font-weight:600;">${r.lateBy}</span>` : '\u2014'}</td>
            </tr>`).join('');
    } catch(e) {
        console.error('Attendance load error:', e);
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Failed to load attendance</td></tr>';
    }
}

// ── Security / Change Password ──────────────────────────────────────────────

function togglePortalPwd(id, btn) {
    const inp  = document.getElementById(id);
    const icon = btn.querySelector('i');
    if (inp.type === 'password') { inp.type = 'text';     icon.className = 'fas fa-eye-slash'; }
    else                         { inp.type = 'password'; icon.className = 'fas fa-eye'; }
}

async function changeEmployeePassword() {
    const currentPwd = document.getElementById('pwdCurrent').value.trim();
    const newPwd     = document.getElementById('pwdNew').value.trim();
    const confirmPwd = document.getElementById('pwdConfirm').value.trim();
    const msgEl      = document.getElementById('pwdChangeMsg');
    const btn        = document.getElementById('pwdChangeBtn');

    const showMsg = (text, ok) => {
        msgEl.textContent = text;
        msgEl.style.display = 'block';
        msgEl.style.background = ok ? '#d1fae5' : '#fee2e2';
        msgEl.style.color      = ok ? '#065f46' : '#991b1b';
        msgEl.style.border     = `1px solid ${ok ? '#6ee7b7' : '#fca5a5'}`;
    };

    if (!currentPwd || !newPwd || !confirmPwd) return showMsg('Please fill in all fields.', false);
    if (newPwd.length < 6)                     return showMsg('New password must be at least 6 characters.', false);
    if (newPwd !== confirmPwd)                 return showMsg('New passwords do not match.', false);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating\u2026';

    try {
        const res = await apiFetch('/auth/change-employee-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
            body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd })
        });
        if (res && res.success) {
            showMsg('\u2713 Password changed successfully!', true);
            document.getElementById('pwdCurrent').value = '';
            document.getElementById('pwdNew').value     = '';
            document.getElementById('pwdConfirm').value = '';
        } else {
            showMsg(res?.error || 'Failed to change password.', false);
        }
    } catch (e) {
        showMsg(e?.message || 'Server error. Please try again.', false);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock"></i> Update Password';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadProfile();
    initSalesMonths();
    initSalaryMonths();
    initAttendanceMonths();
    await loadCalendarData();
    loadOverview();
    loadLeaveHistory();
});
