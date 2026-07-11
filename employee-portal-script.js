/* employee-portal-script.js */
'use strict';

requireEmployee(); // redirect to login.html if not authenticated

const API = API_BASE_URL;
const auth = JSON.parse(localStorage.getItem('hrPortalAuth') || '{}');
const EMP_ID = auth.employeeId;
let employeeProfile = {};

function isSalesDepartment(department) {
    return String(department || '').trim().toLowerCase().includes('sales');
}

function applyLeaveTypePolicy(profile = {}) {
    const leaveTypeSelect = document.getElementById('leaveType');
    if (!leaveTypeSelect) return;

    const isSalesEmp = isSalesDepartment(profile.department);
    const wfhOption = Array.from(leaveTypeSelect.options).find(opt => opt.value === 'Work From Home');

    if (isSalesEmp && wfhOption) {
        wfhOption.remove();
    }

    if (isSalesEmp && leaveTypeSelect.value === 'Work From Home') {
        leaveTypeSelect.value = 'Unpaid Leave';
    }

    const probationNoticeText = document.getElementById('probationNoticeText');
    if (probationNoticeText && profile.isOnProbation) {
        probationNoticeText.innerHTML = isSalesEmp
            ? 'During your probation period, <strong>Paid Leave</strong> is not available. You may only apply for <strong>Unpaid Leave</strong>.'
            : 'During your probation period, <strong>Paid Leave</strong> is not available. You may only apply for <strong>Unpaid Leave</strong> or <strong>Work From Home</strong>.';
    }
}

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
function calcDays(start, end, isHalfDay = false) {
    if (isHalfDay) return 0.5;
    const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
}
function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function isBonusVisibleForMonth(dateStr, month) {
    if (!dateStr || !dateStr.startsWith(month)) return false;
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonth = monthKey(new Date());
    // For current month, show only bonuses up to today. Past months show full month.
    return month === currentMonth ? dateStr <= todayStr : true;
}
function parseDateOnly(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
}
function getCycleDayFromHireDate(hireDate) {
    const hd = parseDateOnly(hireDate);
    if (!hd) return null;
    // Keep cycles stable across months; payroll UI supports 1-28 as safe day range.
    return Math.min(hd.getDate(), 28);
}
function getCycleRangeForMonth(month, hireDate) {
    const [yr, mo] = month.split('-').map(Number);
    const cycleDay = getCycleDayFromHireDate(hireDate);
    if (!cycleDay) {
        const start = new Date(yr, mo - 1, 1);
        const end = new Date(yr, mo, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end, cycleDay: null, label: 'Calendar month' };
    }

    const start = new Date(yr, mo - 2, cycleDay);
    const end = new Date(yr, mo - 1, cycleDay);
    end.setHours(23, 59, 59, 999);
    return {
        start,
        end,
        cycleDay,
        label: `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
    };
}
function getEmployeeJoinDate(employee) {
    return employee?.hireDate || employee?.joinDate || employee?.joiningDate || employee?.dateOfJoining || '';
}
function isAdmissionVisibleForEmployee(admission, employee) {
    const joinDateValue = getEmployeeJoinDate(employee);
    if (!joinDateValue) return true;
    const joinDate = parseDateOnly(joinDateValue);
    const admissionDate = parseDateOnly(admission?.admissionDate);
    if (!joinDate || !admissionDate) return true;
    return admissionDate >= joinDate;
}
// Returns the salary-cycle window that contains dateStr anchored on cycleDay (hire-date day).
function getCycleWindowForDate(dateStr, cycleDay) {
    if (!cycleDay) return null;
    const d = parseDateOnly(dateStr);
    if (!d) return null;
    const year = d.getFullYear(), month = d.getMonth(), day = d.getDate();
    let start, end;
    if (day > cycleDay) {
        start = new Date(year, month, cycleDay);
        end   = new Date(year, month + 1, cycleDay);
    } else {
        start = new Date(year, month - 1, cycleDay);
        end   = new Date(year, month, cycleDay);
    }
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function isJoinedByDate(hireDate, dateStr) {
    if (!hireDate) return true;
    const hire = parseDateOnly(hireDate);
    const current = parseDateOnly(dateStr);
    if (!hire || !current) return true;
    return current >= hire;
}
function statusBadge(s) {
    const map = {
        approved: 'badge-green', rejected: 'badge-red',
        pending: 'badge-amber', cancelled: 'badge-gray'
    };
    return `<span class="badge ${map[s] || 'badge-gray'}">${s}</span>`;
}

function getCurrentIncentiveSlab(achievementRate) {
    if (achievementRate >= 200) return 200;
    if (achievementRate >= 150) return 150;
    if (achievementRate >= 100) return 100;
    return 0;
}

function getMonthEndMotivationData(month, salesTarget, salesAchieved) {
    if (!salesTarget || salesAchieved >= salesTarget) return null;
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (month !== currentMonth) return null;

    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - today.getDate();
    if (daysRemaining < 0 || daysRemaining > 5) return null;

    const quotes = [
        'A strong finish can still change the whole month.',
        'You are closer than it feels. One more push this week.',
        'Targets are not over until the month is over. Keep going.',
        'A focused final stretch can make the difference.'
    ];
    const quote = quotes[today.getDate() % quotes.length];
    const remainingTarget = Math.max(0, salesTarget - salesAchieved);
    return {
        daysRemaining,
        remainingTarget,
        quote,
        todayKey: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    };
}

function maybeShowMonthEndMotivationOverlay(month, empName, achievementPct, salesTarget, salesAchieved) {
    const motivation = getMonthEndMotivationData(month, salesTarget, salesAchieved);
    if (!motivation) return;

    const storageKey = `month_end_motivation_${EMP_ID}_${month}_${motivation.todayKey}`;
    if (localStorage.getItem(storageKey) === 'shown') return;

    localStorage.setItem(storageKey, 'shown');
    setTimeout(() => {
        showMonthEndMotivationOverlay(empName, achievementPct, motivation.remainingTarget, motivation.daysRemaining, motivation.quote);
    }, 800);
}

function admissionReviewMeta(admission) {
    const parts = [];
    if (Array.isArray(admission.editSummary) && admission.editSummary.length) {
        parts.push(`Edited by admin: ${admission.editSummary.join(', ')}`);
    }
    if (admission.reviewNote) {
        parts.push(admission.reviewNote);
    }
    if (!parts.length) return '';
    return `<div style="margin-top:6px;font-size:11px;line-height:1.45;color:var(--muted);">${parts.map(p => `<div>${p}</div>`).join('')}</div>`;
}

async function apiFetch(path, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const r = await fetch(`${API}${path}`, opts);
    if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        const err = new Error(errBody.error || r.statusText);
        Object.assign(err, errBody);
        throw err;
    }
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
    if (name === 'salary')     { loadSalaryBreakup(); loadSalaryTillDate(); loadSalaryHistory(); }
    if (name === 'attendance') loadMyAttendance();
    if (name === 'leaves')     loadProbationStatus();
    if (name === 'documents')  loadMyDocuments();
}

function toggleLeavePolicy() {
    const content = document.getElementById('leavePolicyContent');
    const btn = document.getElementById('toggleLeavePolicyBtn');
    if (!content || !btn) return;
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'flex' : 'none';
    btn.textContent = isHidden ? 'Hide Policy' : 'Show Policy';
    btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
}

function openOverviewSection(name) {
    showTab(name);
}

function overviewCardKey(event, targetSection) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openOverviewSection(targetSection);
    }
}

function goToSalesForm() {
    showTab('sales');
    // Allow section to render before scrolling to the form card.
    setTimeout(() => {
        const form = document.getElementById('mySalesForm');
        if (!form) return;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const firstInput = document.getElementById('mySalesCustomerName');
        if (firstInput) firstInput.focus();
    }, 60);
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
        employeeProfile = { ...employeeProfile, ...me };
        applyLeaveTypePolicy(employeeProfile);
        return me;
    } catch { return {}; }
}

// â”€â”€ Overview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadOverview() {
    try {
        const currentMonth = monthKey(new Date());
        const [empData, leavesData, allSalesData, admissions] = await Promise.all([
            apiFetch(`/employees/${EMP_ID}`),
            apiFetch('/leaves'),
            apiFetch('/sales').catch(() => ({})),
            apiFetch(`/admissions?employeeId=${EMP_ID}&month=${currentMonth}`).catch(() => [])
        ]);
        const myLeaves = (leavesData.leaves || leavesData || []).filter(l => l.employeeId === EMP_ID);
        const pending  = myLeaves.filter(l => l.status === 'pending').length;

        document.getElementById('kpiPending').textContent = pending;

        // Outstanding advance
        const advData = await apiFetch('/incentives/data').catch(() => ({ salaryAdvances: [] }));
        const advances = (advData.salaryAdvances || []).filter(a => a.employeeId === EMP_ID);
        const outstanding = advances.filter(a => !a.repaid).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        document.getElementById('kpiAdvance').textContent = fmtRupees(outstanding);

        // This month sales record: achieved/target
        const empSales = (allSalesData[currentMonth] || {})[EMP_ID]
            || (allSalesData[currentMonth] || {})[String(EMP_ID)]
            || {};
        const salesTarget = parseInt(empSales.salesTarget, 10) || 0;
        const admissionsList = Array.isArray(admissions)
            ? admissions.filter(admission => isAdmissionVisibleForEmployee(admission, empData))
            : [];
        const achievedSales = admissionsList.filter(a => (a.status || 'approved') === 'approved').length;

        const salesRecordEl = document.getElementById('kpiSalesRecord');
        const salesSubEl = document.getElementById('kpiSalesSub');
        if (salesRecordEl) {
            salesRecordEl.textContent = salesTarget > 0
                ? `${achievedSales}/${salesTarget}`
                : `${achievedSales}/—`;
        }
        if (salesSubEl) {
            salesSubEl.textContent = salesTarget > 0
                ? 'Approved / Target this month'
                : 'Target not set for this month';
        }

        // Recent leaves table
        const recent = [...myLeaves].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).slice(0, 5);
        const tbody = document.getElementById('recentLeavesBody');
        if (!recent.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data"><i class="fas fa-calendar"></i><br>No leave requests yet</td></tr>';
        } else {
            tbody.innerHTML = recent.map(l => `
                <tr>
                    <td>${l.leaveType || '—'}</td>
                    <td>${fmt(l.startDate)}</td>
                    <td>${fmt(l.endDate)}</td>
                    <td>${calcDays(l.startDate, l.endDate, l.halfDay === true || l.leaveType === 'Half Day')}</td>
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
    // Employees apply one day at a time — end date always mirrors start date.
    const endEl = document.getElementById('leaveEnd');
    if (endEl) endEl.value = s;
    const info = document.getElementById('leaveDayInfo');
    if (s) {
        const isHalf = document.getElementById('halfDayCheckEmp')?.checked || false;
        info.innerHTML = isHalf ? '<strong>0.5</strong> day selected (half day)' : '<strong>1</strong> day selected';
    } else {
        info.textContent = '';
    }
}

function updateLeaveBalance() { /* balance is static label */ }

function toggleHalfDaySessionEmp() {
    const isChecked = document.getElementById('halfDayCheckEmp')?.checked || false;
    const sessionRow = document.getElementById('halfDaySessionRowEmp');
    if (sessionRow) sessionRow.style.display = isChecked ? 'block' : 'none';
    calcLeaveDays();
}

async function submitLeave(event) {
    event.preventDefault();
    const type  = document.getElementById('leaveType').value;
    const start = document.getElementById('leaveStart').value;
    const end   = document.getElementById('leaveEnd').value;
    const reason = document.getElementById('leaveReason').value;
    const isHalfDay = document.getElementById('halfDayCheckEmp')?.checked || false;
    const halfDaySession = isHalfDay ? (document.getElementById('halfDaySessionEmp')?.value || 'First Half') : null;

    if (isSalesDepartment(employeeProfile.department) && type === 'Work From Home') {
        notify('leaveNotify', 'Work From Home is not available for Sales department employees.', 'error');
        return;
    }

    // Employees can only apply for a single day at a time.
    if (!start) { notify('leaveNotify', 'Please select a leave date.', 'error'); return; }
    if (end && end !== start) { notify('leaveNotify', 'Only single-day leave requests are allowed. Please select one day.', 'error'); return; }
    // Ensure end is always in sync with start
    const endEl2 = document.getElementById('leaveEnd');
    if (endEl2) endEl2.value = start;
    const syncedEnd = start;

    // Overlap check — cannot apply on a date that has an existing non-rejected leave
    try {
        const leavesData = await apiFetch('/leaves');
        const myLeaves = (leavesData.leaves || leavesData || []).filter(l => l.employeeId === EMP_ID && l.status !== 'rejected');
        const newStart = new Date(start + 'T00:00:00');
        const newEnd   = new Date(syncedEnd + 'T00:00:00');
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
            halfDay: isHalfDay,
            halfDaySession,
            startDate: start,
            endDate: syncedEnd,
            reason,
            status: 'pending',
            appliedDate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        await apiFetch('/leaves', { method: 'POST', body: JSON.stringify(leaveData) });
        notify('leaveNotify', 'Leave request submitted successfully!');
        document.getElementById('leaveForm').reset();
        const halfDaySessionRow = document.getElementById('halfDaySessionRowEmp');
        if (halfDaySessionRow) halfDaySessionRow.style.display = 'none';
        document.getElementById('leaveDayInfo').textContent = '';
        loadLeaveHistory();
        loadOverview();
    } catch (e) {
        if (e && e.probation) {
            notify('leaveNotify', 'You are currently on probation. Only Unpaid Leave or Work From Home is allowed.', 'error');
        } else if (e && e.paidLeaveLimit) {
            notify('leaveNotify', e.message || 'Only 1 paid leave is allowed per salary cycle.', 'error');
        } else {
            notify('leaveNotify', e.message || 'Failed to submit leave request.', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Request';
    }
}

async function loadProbationStatus() {
    try {
        const emp = await apiFetch(`/employees/${EMP_ID}`);
        employeeProfile = { ...employeeProfile, ...emp };
        applyLeaveTypePolicy(employeeProfile);
        const notice = document.getElementById('probationNotice');
        if (notice) {
            notice.style.display = emp.isOnProbation ? 'flex' : 'none';
        }
    } catch { /* non-critical */ }
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
        tbody.innerHTML = myLeaves.map(l => {
            const isHalfDay = l.halfDay === true || l.leaveType === 'Half Day';
            const rawDays = calcDays(l.startDate, l.endDate, isHalfDay);
            const sandwichDays = l.sandwichDays || 0;
            const totalDays = rawDays + sandwichDays;
            const sandwichBadge = sandwichDays > 0
                ? `<span style="background:#fde8ff;color:#7c3aed;padding:1px 6px;border-radius:6px;font-size:11px;font-weight:600;margin-left:4px;" title="Includes ${sandwichDays} sandwich day(s)">+${sandwichDays}d sandwich</span>`
                : '';
            return `
            <tr>
                <td>${l.leaveType || '—'}</td>
                <td>${fmt(l.startDate)}</td>
                <td>${fmt(l.endDate)}</td>
                <td>${totalDays}${sandwichBadge}</td>
                <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason || '—'}</td>
                <td>${statusBadge(l.status)}</td>
            </tr>`;
        }).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">Failed to load leave history</td></tr>';
    }
}

// ── Documents ───────────────────────────────────────────────────────────────

let myDocumentTypes = [];
let myDocumentsByType = {};

function fmtFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMyDocuments() {
    const grid = document.getElementById('myDocsGrid');
    const summary = document.getElementById('myDocsSummary');
    if (!grid || !summary) return;

    const uploadedCount = myDocumentTypes.filter(t => myDocumentsByType[t.key]).length;
    summary.textContent = `${uploadedCount}/${myDocumentTypes.length} document types uploaded`;

    grid.innerHTML = myDocumentTypes.map(t => {
        const doc = myDocumentsByType[t.key];
        const meta = doc
            ? `Uploaded ${fmt(doc.uploadedAt)} • ${fmtFileSize(doc.size)}${doc.locked ? ' • Locked' : ''}`
            : 'Not uploaded yet';

        return `
            <div class="doc-item">
                <h4>${t.label}</h4>
                <div class="doc-meta">${meta}</div>
                <div class="doc-actions">
                    ${doc ? `<button type="button" class="btn-doc" onclick="window.open('${doc.url}', '_blank')"><i class="fas fa-eye"></i> View</button>` : ''}
                    ${doc && !doc.locked ? `<button type="button" class="btn-doc primary" onclick="openMyDocPicker('${t.key}')">
                        <i class="fas fa-upload"></i> ${doc ? 'Replace' : 'Upload'}
                    </button>` : (!doc ? `<button type="button" class="btn-doc primary" onclick="openMyDocPicker('${t.key}')"><i class="fas fa-upload"></i> Upload</button>` : '')}
                    ${doc && !doc.locked ? `<button type="button" class="btn-doc" style="background:#e0f2fe;border-color:#bae6fd;color:#075985;" onclick="lockMyDocument('${t.key}')"><i class="fas fa-lock"></i> Lock</button>` : ''}
                    ${doc && !doc.locked ? `<button type="button" class="btn-doc danger" onclick="deleteMyDocument('${t.key}')"><i class="fas fa-trash"></i> Delete</button>` : ''}
                    ${doc && doc.locked ? `<span class="badge badge-gray" style="align-self:center;">Locked</span>` : ''}
                </div>
            </div>`;
    }).join('');
}

function openMyDocPicker(docType) {
    const input = document.getElementById('myDocFileInput');
    if (!input) return;
    input.value = '';
    input.dataset.docType = docType;
    input.click();
}

async function uploadMyDocument(file, docType) {
    const form = new FormData();
    form.append('file', file);
    form.append('docType', docType);

    const resp = await fetch(`${API}/employees/${EMP_ID}/documents`, {
        method: 'POST',
        body: form
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const err = new Error(data.error || 'Upload failed');
        Object.assign(err, data);
        throw err;
    }
    return data;
}

async function lockMyDocument(docType) {
    try {
        await apiFetch(`/employees/${EMP_ID}/documents/${docType}/lock`, {
            method: 'PATCH',
            body: JSON.stringify({ locked: true, lockedBy: 'employee' })
        });
        notify('documentsNotify', 'Document locked. Admin must unlock it before changes can be made.');
        await loadMyDocuments();
    } catch (e) {
        notify('documentsNotify', e.message || 'Failed to lock document.', 'error');
    }
}

async function deleteMyDocument(docType) {
    try {
        await apiFetch(`/employees/${EMP_ID}/documents/${docType}`, { method: 'DELETE' });
        notify('documentsNotify', 'Document deleted successfully.');
        await loadMyDocuments();
    } catch (e) {
        notify('documentsNotify', e.message || 'Failed to delete document.', 'error');
    }
}

async function loadMyDocuments() {
    const grid = document.getElementById('myDocsGrid');
    const summary = document.getElementById('myDocsSummary');
    if (!grid || !summary) return;

    grid.innerHTML = '<div class="no-data" style="padding:26px 10px;"><div class="spinner"></div></div>';
    summary.textContent = 'Loading documents...';

    try {
        const [typesRes, docsRes] = await Promise.all([
            apiFetch('/employees/document-types'),
            apiFetch(`/employees/${EMP_ID}/documents`)
        ]);
        myDocumentTypes = Array.isArray(typesRes) ? typesRes : [];
        myDocumentsByType = (docsRes && docsRes.documents) ? docsRes.documents : {};

        if (!myDocumentTypes.length) {
            grid.innerHTML = '<div class="no-data">No document types configured</div>';
            summary.textContent = '';
            return;
        }
        renderMyDocuments();
    } catch (e) {
        grid.innerHTML = '<div class="no-data">Failed to load documents</div>';
        summary.textContent = '';
        notify('documentsNotify', e.message || 'Failed to load documents.', 'error');
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
    tbody.innerHTML = '<tr><td colspan="8" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const [currentEmployee, data, config, allSalesData, admissions] = await Promise.all([
            apiFetch(`/employees/${EMP_ID}`).catch(() => null),
            apiFetch('/incentives/data'),
            apiFetch('/incentives/config').catch(() => ({})),
            apiFetch('/sales').catch(() => ({})),
            apiFetch(`/admissions?employeeId=${EMP_ID}&month=${month}`).catch(() => [])
        ]);
        const allBonuses   = (data.dailyBonuses || []).filter(b => b.employeeId === EMP_ID || b.employeeId === String(EMP_ID));
        const monthBonuses = allBonuses.filter(b => isBonusVisibleForMonth(b.date || '', month));

        const totalBonuses    = monthBonuses.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
        const admList = Array.isArray(admissions)
            ? admissions.filter(admission => isAdmissionVisibleForEmployee(admission, currentEmployee))
            : [];
        const approvedAdmList = admList.filter(a => (a.status || 'approved') === 'approved');
        const approvedAdmissions = approvedAdmList.length;
        const pendingAdmissions = admList.filter(a => (a.status || 'pending') === 'pending').length;
        const totalAdmissions = approvedAdmissions;

        // Monthly sales/revenue target from sales tracking
        const empSales      = (allSalesData[month] || {})[EMP_ID] || (allSalesData[month] || {})[String(EMP_ID)] || {};
        const salesTarget   = empSales.salesTarget    || 0;
        const revTarget     = empSales.revenueTarget  || 0;
        // Source of truth for achieved values is approved admissions list.
        const salesAchieved = approvedAdmissions;
        const revAchieved   = approvedAdmList.reduce((sum, a) => sum + (parseFloat(a.revenue) || 0), 0);

        // Monthly incentive — if already PAID use locked DB amount, else always recalculate live
        const monthlyKey     = `${month}_${EMP_ID}`;
        const monthlyInc     = (data.monthlyIncentives || {})[monthlyKey];
        const monthlyIncPaid = monthlyInc?.paid || false;
        let monthlyIncAmount  = 0;
        if (monthlyIncPaid) {
            // Already paid — use the locked stored amount
            monthlyIncAmount = parseFloat(monthlyInc.amount) || 0;
        } else {
            // Not paid — recalculate live from slabs so deletions/changes are reflected
            let achievementRate = 0;
            if (salesTarget > 0)       achievementRate = salesAchieved / salesTarget * 100;
            else if (revTarget > 0)    achievementRate = revAchieved   / revTarget   * 100;
            if (achievementRate >= 100) {
                const slabs = (config && config.slabs) ? config.slabs : {};
                const pct = achievementRate >= 200 ? (slabs[200] || 0)
                          : achievementRate >= 150 ? (slabs[150] || 0)
                          :                          (slabs[100] || 0);
                monthlyIncAmount = Math.round(revAchieved * pct / 100);
            }
        }

        // Refresh navbar piggy bank whenever sales tab loads
        updatePiggyBank(monthlyIncAmount, monthlyIncPaid);

        kpiDiv.innerHTML = `
            <div class="kpi"><div class="kpi-label">This Month Bonus</div><div class="kpi-value" style="color:var(--green);">${fmtRupees(totalBonuses)}</div><div class="kpi-sub">Daily bonuses earned</div></div>
            <div class="kpi"><div class="kpi-label">Approved Admissions</div><div class="kpi-value">${totalAdmissions}</div><div class="kpi-sub">Counted in targets</div></div>
            ${pendingAdmissions > 0 ? `<div class="kpi"><div class="kpi-label">Pending Review</div><div class="kpi-value" style="color:var(--amber);">${pendingAdmissions}</div><div class="kpi-sub">Waiting for admin approval</div></div>` : ''}
            ${revAchieved > 0 ? `<div class="kpi"><div class="kpi-label">Revenue This Month</div><div class="kpi-value" style="color:var(--primary);">${fmtRupees(revAchieved)}</div><div class="kpi-sub">Achieved</div></div>` : ''}
            ${monthlyIncAmount > 0 ? `<div class="kpi"><div class="kpi-label">Monthly Incentive</div><div class="kpi-value" style="color:var(--amber);">${fmtRupees(monthlyIncAmount)}</div><div class="kpi-sub">${monthlyIncPaid ? '<span class="badge badge-green" style="font-size:10px;">Paid</span>' : '<span class="badge badge-amber" style="font-size:10px;">Pending</span>'}</div></div>` : ''}`;

        // Build target card
        const courseRewards = config.courseRewards || {};
        const slabs         = config.slabs         || {};

        // Achievement % for target bar (admissions only; revenue target removed)
        let achievePct = 0, targetLabel = '', targetValue = '', achievedValue = '';
        if (salesTarget > 0) {
            achievePct    = Math.min(Math.round((salesAchieved / salesTarget) * 100), 200);
            targetLabel   = 'Admissions Target';
            targetValue   = `${salesTarget} admissions`;
            achievedValue = `${salesAchieved} achieved`;
        }
        const barColor = achievePct >= 200 ? '#16a34a' : achievePct >= 150 ? '#059669' : achievePct >= 100 ? '#2563eb' : achievePct >= 50 ? '#d97706' : '#dc2626';

        // Build slab rows
        const slabThresholds = [100, 150, 200];
        const currentSlab = getCurrentIncentiveSlab(achievePct);
        const slabRows = slabThresholds
            .filter(t => slabs[t] !== undefined)
            .map(t => {
                const isCurrent = currentSlab === t;
                return `<tr style="${isCurrent ? 'background:#ecfeff;' : ''}"><td><span class="badge badge-${t >= 200 ? 'green' : t >= 150 ? 'amber' : 'blue'}">${t}%+</span>${isCurrent ? ' <span style="font-size:10px;color:#0f766e;font-weight:700;">Current</span>' : ''}</td><td style="font-weight:700;">${slabs[t]}% of revenue</td></tr>`;
            })
            .join('');
        const slabStatusLabel = currentSlab
            ? `${currentSlab}% slab`
            : (salesTarget > 0 || revTarget > 0 ? 'Below 100% slab' : 'No active slab');
        const monthEndMotivation = '';

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
                    ${revAchieved > 0 ? `
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-coins" style="margin-right:5px;color:var(--primary);"></i>Revenue This Month</div>
                        <div style="font-size:22px;font-weight:800;color:var(--primary);margin-bottom:4px;">${fmtRupees(revAchieved)}</div>
                    </div>` : ''}
                    ${(courseRewards.onetime || courseRewards.annual || courseRewards.semester) ? `
                    <div class="info-block">
                        <div class="info-block-title"><i class="fas fa-graduation-cap" style="margin-right:5px;color:var(--primary);"></i>Today's Per Admission Earnings</div>
                        <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">One-Time Course</span> <strong style="color:#16a34a;">${fmtRupees(courseRewards.onetime || 0)}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Annual Course</span>   <strong style="color:#16a34a;">${fmtRupees(courseRewards.annual   || 0)}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Semester Course</span> <strong style="color:#16a34a;">${fmtRupees(courseRewards.semester || 0)}</strong></div>
                        </div>
                    </div>` : ''}
                    <div class="info-block info-block-wide">
                        <div class="info-block-title"><i class="fas fa-trophy" style="margin-right:5px;color:var(--primary);"></i>Monthly Incentive Slabs</div>
                        <div style="font-size:12px;font-weight:700;color:${currentSlab ? '#0f766e' : '#b45309'};margin-bottom:10px;">Current position: ${slabStatusLabel}</div>
                        <div style="overflow-x:auto;">
                            <table class="mini-table">
                                <thead><tr><th>Achievement</th><th>Incentive</th></tr></thead>
                                <tbody>${slabRows || '<tr><td colspan="2" style="color:var(--muted);text-align:center;">No slabs configured</td></tr>'}</tbody>
                            </table>
                        </div>
                        <div style="font-size:11px;color:var(--muted);margin-top:8px;"><i class="fas fa-info-circle"></i> Incentive % is applied on monthly revenue achieved. Eligible when â‰¥ 100% of target is met.</div>
                        ${monthEndMotivation}
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
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Approved admissions</span> <strong>${totalAdmissions}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Daily bonuses earned</span> <strong style="color:#16a34a;">${fmtRupees(totalBonuses)}</strong></div>
                        </div>
                    </div>
                </div>`;
        }

        // 🎉 Show congratulations after every new admission that keeps/pushes target at/above 100%
        if (achievePct >= 100 && salesTarget > 0) {
            const countKey = `congrats_count_${month}_${EMP_ID}`;
            const lastSeen = parseInt(sessionStorage.getItem(countKey) || '0', 10);
            if (totalAdmissions > lastSeen) {
                sessionStorage.setItem(countKey, String(totalAdmissions));
                const empName = document.getElementById('empName')?.textContent?.trim() || 'Superstar';
                setTimeout(() => showCongratsOverlay(empName, achievePct, monthlyIncAmount), 800);
            }
        } else if (salesTarget > 0) {
            const empName = document.getElementById('empName')?.textContent?.trim() || 'Superstar';
            maybeShowMonthEndMotivationOverlay(month, empName, achievePct, salesTarget, salesAchieved);
        }

        // Render admission records table
        if (!admList.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data"><i class="fas fa-graduation-cap"></i><br>No admissions recorded for this month</td></tr>';
            return;
        }

        const typeLabel = { 'one-time': 'One-Time', 'semester': 'Semester', 'annual': 'Annual' };
        const typeBadge = { 'one-time': 'badge-blue', 'semester': 'badge-amber', 'annual': 'badge-green' };

        tbody.innerHTML = admList
            .sort((a, b) => new Date(b.admissionDate) - new Date(a.admissionDate))
            .map(a => `<tr>
                <td>${fmt(a.admissionDate)}</td>
                <td style="font-weight:600;">${a.customerName || '—'}</td>
                <td style="color:var(--muted);font-size:12px;">${a.customerPhone || '—'}${a.alternateCustomerPhone ? `<br><span style="color:#9ca3af;">Alt: ${a.alternateCustomerPhone}</span>` : ''}</td>
                <td style="color:var(--muted);font-size:12px;">${a.customerEmail || '—'}${a.alternateCustomerEmail ? `<br><span style="color:#9ca3af;">Alt: ${a.alternateCustomerEmail}</span>` : ''}</td>
                <td style="color:var(--muted);font-size:12px;">${a.course || '—'}</td>
                <td><span class="badge ${typeBadge[a.admissionType] || 'badge-blue'}" style="font-size:11px;">${typeLabel[a.admissionType] || a.admissionType || '—'}</span></td>
                <td style="color:var(--muted);font-size:12px;">${a.universityName || '—'}</td>
                <td style="color:var(--green);font-weight:700;">${fmtRupees(a.revenue || 0)}</td>
                <td>${(a.status || 'approved') === 'approved'
                    ? '<span class="badge badge-green" style="font-size:10px;">Approved</span>'
                    : ((a.status || 'pending') === 'rejected'
                        ? '<span class="badge badge-red" style="font-size:10px;">Rejected</span>'
                        : '<span class="badge badge-amber" style="font-size:10px;">Pending Review</span>')}
                    ${admissionReviewMeta(a)}</td>
            </tr>`).join('');
    } catch (e) {
        console.error('Sales load error:', e);
        tbody.innerHTML = '<tr><td colspan="9" class="no-data">Failed to load sales data</td></tr>';
    }
}

async function submitMySalesRecord(event) {
    event.preventDefault();
    const btn = document.getElementById('mySalesSubmitBtn');
    const currentMonth = document.getElementById('salesMonthFilter').value;
    const customerName = document.getElementById('mySalesCustomerName').value.trim();
    const customerPhone = document.getElementById('mySalesCustomerPhone').value.trim();
    const customerEmail = document.getElementById('mySalesCustomerEmail').value.trim();
    const alternateCustomerPhone = document.getElementById('mySalesAlternatePhone').value.trim();
    const alternateCustomerEmail = document.getElementById('mySalesAlternateEmail').value.trim();
    const course = document.getElementById('mySalesCourse').value.trim();
    const admissionDate = document.getElementById('mySalesDate').value;
    const admissionType = document.getElementById('mySalesType').value;
    const revenueRaw = document.getElementById('mySalesRevenue').value;
    const universityName = document.getElementById('mySalesUniversity').value.trim();
    const revenue = parseFloat(String(revenueRaw).replace(/[^0-9.]/g, '')) || 0;

    if (!customerName || !customerPhone || !customerEmail || !alternateCustomerPhone || !alternateCustomerEmail || !course || !admissionDate || !admissionType || !universityName || revenue <= 0) {
        notify('salesNotify', 'Please fill all required fields with valid values.', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
        await apiFetch('/admissions', {
            method: 'POST',
            body: JSON.stringify({
                employeeId: EMP_ID,
                month: currentMonth,
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
                status: 'pending',
                submittedBy: 'employee'
            })
        });

        notify('salesNotify', 'Sales record submitted. Waiting for admin approval.');
        document.getElementById('mySalesForm').reset();
        document.getElementById('mySalesDate').value = new Date().toISOString().split('T')[0];
        await loadMySales();
    } catch (e) {
        notify('salesNotify', e.message || 'Failed to submit sales record.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Approval';
    }
}
// â”€â”€ Advances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadMyAdvances() {
    const tbody = document.getElementById('advancesBody');
    const summary = document.getElementById('advancesSummary');
    tbody.innerHTML = '<tr><td colspan="4" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const data = await apiFetch('/incentives/data');
        const advances = (data.salaryAdvances || [])
            .filter(a => a.employeeId === EMP_ID)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const total      = advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        const outstanding = advances.filter(a => !a.adjustedInSalary).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

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
            tbody.innerHTML = '<tr><td colspan="4" class="no-data"><i class="fas fa-hand-holding-usd"></i><br>No advances taken</td></tr>';
            return;
        }

        tbody.innerHTML = advances.map(a => {
            let statusBadge;
            if (a.adjustedInSalary) {
                const [yr, mo] = (a.adjustedMonth || '').split('-');
                const monthLabel = yr && mo ? new Date(parseInt(yr), parseInt(mo) - 1).toLocaleString('default', { month: 'long', year: 'numeric' }) : '';
                statusBadge = `<span class="badge badge-green">Adjusted in Salary${monthLabel ? ' — ' + monthLabel : ''}</span>`;
            } else {
                statusBadge = '<span class="badge badge-amber">Pending Adjustment</span>';
            }
            return `
            <tr>
                <td>${fmt(a.date)}</td>
                <td style="font-weight:700;">${fmtRupees(a.amount)}</td>
                <td>${a.reason || 'â€"'}</td>
                <td>${statusBadge}</td>
            </tr>`;
        }).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">Failed to load advance data</td></tr>';
    }
}

// â”€â”€ Salary Breakup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let isSalaryBreakupVisible = false;
let isSalaryHistoryVisible = false;
let isSalaryTillDateVisible = false;

function salaryDisplay(amount) {
    return isSalaryBreakupVisible ? fmtRupees(amount) : '••••';
}

function toggleSalaryBreakupVisibility() {
    isSalaryBreakupVisible = !isSalaryBreakupVisible;
    const btn = document.getElementById('salaryVisibilityBtn');
    if (btn) btn.textContent = isSalaryBreakupVisible ? 'Hide Salary' : 'Show Salary';
    loadSalaryBreakup();
}

function toggleSalaryHistoryVisibility() {
    isSalaryHistoryVisible = !isSalaryHistoryVisible;
    const btn = document.getElementById('salaryHistoryVisibilityBtn');
    const content = document.getElementById('salaryHistoryContent');
    if (btn) btn.textContent = isSalaryHistoryVisible ? 'Hide History' : 'Show History';
    if (content) content.style.display = isSalaryHistoryVisible ? 'block' : 'none';
}

function toggleSalaryTillDateVisibility() {
    isSalaryTillDateVisible = !isSalaryTillDateVisible;
    const btn = document.getElementById('salaryTillDateVisibilityBtn');
    const content = document.getElementById('salaryTillDateContent');
    if (btn) btn.textContent = isSalaryTillDateVisible ? 'Hide Salary' : 'Show Salary';
    if (content) content.style.display = isSalaryTillDateVisible ? 'block' : 'none';
}

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
        await loadAttSettings();
        const [py, pm] = month.split('-').map(Number);
        const prevMonthKey = pm === 1
            ? `${py - 1}-12`
            : `${py}-${String(pm - 1).padStart(2, '0')}`;

        const [empData, incData, leavesRaw, attDocs, prevAttDocs] = await Promise.all([
            apiFetch(`/employees/${EMP_ID}`),
            apiFetch('/incentives/data'),
            apiFetch('/leaves'),
            apiFetch(`/attendance/month/${month}`).catch(() => []),
            apiFetch(`/attendance/month/${prevMonthKey}`).catch(() => [])
        ]);

        const payKey = `${month}_${EMP_ID}`;
        const payRecord = (incData.salaryPayments || {})[payKey];

        // Use the salary that was snapshotted at payment time (if available), so a salary
        // hike does NOT retroactively change previous months' breakup display.
        const gross     = (payRecord?.paid && payRecord?.grossSalary)
            ? parseFloat(payRecord.grossSalary)
            : parseFloat(empData.salary) || 0;
        const dailyRate = gross / 30;

        // â"€â"€ Pro-rate if joining inside selected salary cycle â"€â"€
        const cycle = getCycleRangeForMonth(month, empData.hireDate);
        const cycleStart = cycle.start;
        const cycleEnd = cycle.end;
        let effectiveGross = gross;
        let joiningDays = 0;
        if (empData.hireDate) {
            const hd = new Date(empData.hireDate + 'T00:00:00');
            if (hd > cycleStart && hd <= cycleEnd) {
                joiningDays = Math.floor((cycleEnd - hd) / 86400000) + 1;
                effectiveGross = Math.round(dailyRate * joiningDays * 100) / 100;
            }
        }
        // Only 'Unpaid Leave' type deducts from salary. Paid Leave uses leave balance — no salary impact.
        const myAllLeaves = (leavesRaw.leaves || leavesRaw || []);
        const myUnpaidLeaves = myAllLeaves
            .filter(l =>
                (l.employeeId === EMP_ID || l.employeeId === String(EMP_ID)) &&
                l.status === 'approved' &&
                l.leaveType === 'Unpaid Leave'
            );
        const hasFullDayLeaveOnDate = (dateStr) => myAllLeaves.some(l => {
            const isSameEmployee = (l.employeeId === EMP_ID || l.employeeId === String(EMP_ID));
            const isApproved = l.status === 'approved';
            const inRange = dateStr >= l.startDate && dateStr <= l.endDate;
            const isHalfDayLeave = l.halfDay === true || l.leaveType === 'Half Day';
            return isSameEmployee && isApproved && inRange && !isHalfDayLeave;
        });
        let totalLeaveDays = 0;
        for (const leave of myUnpaidLeaves) {
            if (leave.halfDay === true || leave.leaveType === 'Half Day') {
                const ls = new Date(leave.startDate + 'T00:00:00');
                if (ls >= cycleStart && ls <= cycleEnd) totalLeaveDays += 0.5;
            } else {
                const ls = new Date(leave.startDate + 'T00:00:00');
                const le = new Date(leave.endDate   + 'T00:00:00');
                const os = ls < cycleStart ? cycleStart : ls;
                const oe = le > cycleEnd   ? cycleEnd   : le;
                if (os <= oe) {
                    totalLeaveDays += Math.round((oe - os) / 86400000) + 1;
                    // Sandwich Sundays on this leave are also unpaid (they follow Monday's type)
                    totalLeaveDays += leave.sandwichDays || 0;
                }
            }
        }
        const unpaidLeaveDays      = totalLeaveDays;
        const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate * 100) / 100;

        // â”€â”€ Late half-day attendance deduction â”€â”€
        let lateCount = 0;
        const allAttDocs = [...(attDocs || []), ...(prevAttDocs || [])];
        allAttDocs.forEach(doc => {
            const docDate = new Date((doc.date || '') + 'T00:00:00');
            if (Number.isNaN(docDate.getTime()) || docDate < cycleStart || docDate > cycleEnd) return;
            if (hasFullDayLeaveOnDate(doc.date || '')) return;
            const rec = (doc.records || {})[EMP_ID] || (doc.records || {})[String(EMP_ID)];
            if (rec && rec.time && isLateEntry(rec.time)) lateCount++;
        });
        const halfDayAttDays      = Math.floor(lateCount / attSettings.lateDaysHalfDay) * 0.5;
        const halfDayAttDeduction = Math.round(halfDayAttDays * dailyRate * 100) / 100;

        // ── Outstanding salary advances ──
        // Show an advance in month X only if it has NOT already been deducted in an
        // earlier paid salary. Specifically: if a salary payment exists for any month M
        // where advanceMonth <= M < currentViewingMonth, the advance was already settled.
        // This means:
        //   • May breakup  (month="2026-05"): advance taken in May → no paid salary in
        //     range ["2026-05","2026-05") → empty range → advance IS included ✓
        //   • June breakup (month="2026-06"): advance taken in May → paid salary exists
        //     for "2026-05" which is in range ["2026-05","2026-06") → excluded ✓
        const payments = incData.salaryPayments || {};
        const advances = (incData.salaryAdvances || []).filter(a => {
            if (!(a.employeeId === EMP_ID || a.employeeId === String(EMP_ID))) return false;
            if (a.status === 'Repaid' || a.repaid) return false;
            if (a.date) {
                const advMonth = a.date.substring(0, 7); // YYYY-MM
                // Was the advance already deducted in a salary paid before this month?
                const alreadyDeducted = Object.entries(payments).some(([key, val]) => {
                    if (!val.paid) return false;
                    const payMonth = key.substring(0, 7);           // YYYY-MM
                    const payEmp   = key.substring(8);              // employeeId part
                    if (String(payEmp) !== String(EMP_ID)) return false;
                    // Paid salary M falls in [advMonth, currentMonth) → advance was settled
                    return payMonth >= advMonth && payMonth < month;
                });
                if (alreadyDeducted) return false;
            }
            return true;
        });
        const advanceDeduction = advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

        // â”€â”€ Monthly incentive (Sales dept) â”€â”€
        let incentive = 0;
        const monthKey2 = `${month}_${EMP_ID}`;
        const monthlyRec = (incData.monthlyIncentives || {})[monthKey2];
        if (monthlyRec && monthlyRec.paid) incentive = parseFloat(monthlyRec.amount) || 0;

        // â”€â”€ Daily bonuses this month â”€â”€
        const bonusTotal = (incData.dailyBonuses || [])
            .filter(b => (b.employeeId === EMP_ID || b.employeeId === String(EMP_ID)) && isBonusVisibleForMonth(b.date || '', month))
            .reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);

        const totalEarnings   = effectiveGross + incentive + bonusTotal;
        const totalDeductions = advanceDeduction + unpaidLeaveDeduction + halfDayAttDeduction;
        const net = Math.max(0, totalEarnings - totalDeductions);

        const isPaid = payRecord?.paid || false;

        const salaryDayInfo = empData.salaryDay
            ? `<div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><i class="fas fa-calendar-check"></i> Salary credit day: <strong>${empData.salaryDay}</strong> of each month</div>`
            : '';

        const paidBadge = isPaid
            ? `<div style="text-align:center;margin-bottom:16px;"><span class="badge badge-green"><i class="fas fa-check-circle"></i> Salary Credited</span></div>`
            : `<div style="text-align:center;margin-bottom:16px;"><span class="badge badge-amber"><i class="fas fa-clock"></i> Pending Credit</span></div>`;

        content.innerHTML = `
            ${paidBadge}
            ${salaryDayInfo}
            ${cycle.cycleDay ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px;"><i class="fas fa-repeat"></i> Salary cycle: <strong>${cycle.label}</strong></div>` : ''}
            ${joiningDays > 0 ? `
            <div style="margin-bottom:12px;padding:10px 14px;background:#1e3a5f;border-left:4px solid #3b82f6;border-radius:10px;font-size:12px;color:#93c5fd;">
                <i class="fas fa-user-plus"></i> <strong>Joining month:</strong> ${joiningDays} day${joiningDays !== 1 ? 's' : ''} worked x INR ${Math.round(dailyRate)}/day = ${salaryDisplay(effectiveGross)}
            </div>` : ''}
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-plus-circle" style="color:var(--green);margin-right:6px;"></i>${joiningDays > 0 ? `Salary (${joiningDays}d in cycle)` : 'Gross Salary'}</span>
                <span class="amount">${salaryDisplay(effectiveGross)}</span>
            </div>
            ${incentive > 0 ? `
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-star" style="color:var(--amber);margin-right:6px;"></i>Monthly Incentive</span>
                <span class="amount">${salaryDisplay(incentive)}</span>
            </div>` : ''}
            ${bonusTotal > 0 ? `
            <div class="salary-row earning">
                <span class="label"><i class="fas fa-gift" style="color:var(--green);margin-right:6px;"></i>Daily Bonuses</span>
                <span class="amount">${salaryDisplay(bonusTotal)}</span>
            </div>` : ''}
            ${unpaidLeaveDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-calendar-times" style="color:var(--red);margin-right:6px;"></i>Unpaid Leave (${unpaidLeaveDays}d × ₹${Math.round(dailyRate)})</span>
                <span class="amount">- ${salaryDisplay(unpaidLeaveDeduction)}</span>
            </div>` : ''}
            ${halfDayAttDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-adjust" style="color:var(--amber);margin-right:6px;"></i>Late Half Days (${halfDayAttDays}d × ₹${Math.round(dailyRate)})</span>
                <span class="amount">- ${salaryDisplay(halfDayAttDeduction)}</span>
            </div>` : ''}
            ${advanceDeduction > 0 ? `
            <div class="salary-row deduction">
                <span class="label"><i class="fas fa-minus-circle" style="color:var(--red);margin-right:6px;"></i>Outstanding Advance</span>
                <span class="amount">- ${salaryDisplay(advanceDeduction)}</span>
            </div>` : ''}
            <div style="border-top:2px solid var(--border);margin:8px 0;"></div>
            <div class="salary-row net">
                <span class="label" style="color:var(--text);font-weight:700;">Net Payable</span>
                <span class="amount">${salaryDisplay(net)}</span>
            </div>
            ${unpaidLeaveDays > 0 || halfDayAttDays > 0 ? `
            <div style="margin-top:14px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:12px;color:#c2410c;line-height:1.7;">
                <i class="fas fa-info-circle"></i>
                ${unpaidLeaveDays > 0 ? `<strong>Unpaid leave:</strong> ${unpaidLeaveDays} day${unpaidLeaveDays !== 1 ? 's' : ''} × ₹${Math.round(dailyRate)}/day<br>` : ''}
                ${halfDayAttDays > 0 ? `<strong>Late attendance:</strong> ${lateCount} late day${lateCount !== 1 ? 's' : ''} \u2192 ${halfDayAttDays} half-day deduction${halfDayAttDays !== 0.5 ? 's' : ''} \u00d7 \u20b9${Math.round(dailyRate)}/day` : ''}
            </div>` : ''}`;
    } catch (e) {
        content.innerHTML = `<div class="no-data">Failed to load salary breakup</div>`;
    }
}

async function loadSalaryHistory() {
    const container = document.getElementById('salaryHistoryContent');
    if (!container) return;
    try {
        const incData = await apiFetch('/incentives/data');
        const payments = incData.salaryPayments || {};
        const empIdStr = String(EMP_ID);
        const history = Object.entries(payments)
            .filter(([key, val]) => {
                if (!val.paid) return false;
                // key format: YYYY-MM_empId
                const empPart = key.substring(key.indexOf('_') + 1);
                return empPart === empIdStr;
            })
            .map(([key, val]) => ({ month: key.substring(0, 7), ...val }))
            .sort((a, b) => b.month.localeCompare(a.month));

        if (!history.length) {
            container.innerHTML = '<div class="no-data" style="padding:20px 0;"><i class="fas fa-history"></i><br>No salary payments recorded yet</div>';
            return;
        }
        const fmt2 = v => `\u20b9${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border);">
                        <th style="text-align:left;padding:8px 6px;color:var(--muted);font-weight:600;">Month</th>
                        <th style="text-align:right;padding:8px 6px;color:var(--muted);font-weight:600;">Gross</th>
                        <th style="text-align:right;padding:8px 6px;color:var(--muted);font-weight:600;">Deductions</th>
                        <th style="text-align:right;padding:8px 6px;color:var(--muted);font-weight:600;">Net Paid</th>
                        <th style="text-align:center;padding:8px 6px;color:var(--muted);font-weight:600;">Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.map(h => {
                        const [yr, mo] = h.month.split('-').map(Number);
                        const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                        const paidDate = h.paidDate ? new Date(h.paidDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
                        return `<tr style="border-bottom:1px solid var(--border);">
                            <td style="padding:10px 6px;font-weight:600;">${monthLabel}</td>
                            <td style="padding:10px 6px;text-align:right;">${h.grossSalary ? fmt2(h.grossSalary) : '\u2014'}</td>
                            <td style="padding:10px 6px;text-align:right;color:var(--red);">${h.deductions ? '\u2212\u00a0' + fmt2(h.deductions) : '\u2014'}</td>
                            <td style="padding:10px 6px;text-align:right;font-weight:700;color:var(--green);">${h.netSalary ? fmt2(h.netSalary) : '\u2014'}</td>
                            <td style="padding:10px 6px;text-align:center;font-size:12px;color:var(--muted);">${paidDate}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
    } catch {
        container.innerHTML = '<div class="no-data">Failed to load salary history</div>';
    }
}

async function loadSalaryTillDate() {
    const container = document.getElementById('salaryTillDateContent');
    if (!container) return;
    container.innerHTML = '<div class="no-data"><div class="spinner"></div></div>';
    try {
        const d = await apiFetch(`/employees/${EMP_ID}/salary-till-date`);
        const fmt2 = v => `\u20b9${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        container.innerHTML = `
            <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">As of <strong>${d.asOfDate}</strong> \u2014 ${d.daysWorked} of ${d.daysInMonth} days worked this month</div>
            <div class="salary-row"><span class="label">Gross Salary</span><span class="amount">${fmt2(d.grossSalary)}</span></div>
            <div class="salary-row"><span class="label">Daily Rate</span><span class="amount">${fmt2(d.dailyRate)} / day</span></div>
            ${d.joiningDate ? `<div class="salary-row"><span class="label" style="color:var(--muted);">Joining Date (this month)</span><span class="amount">${d.joiningDate}</span></div>` : ''}
            <div class="salary-row"><span class="label">Pro-rated Gross</span><span class="amount">${fmt2(d.proRatedGross)}</span></div>
            ${d.unpaidDays > 0 ? `<div class="salary-row deduction"><span class="label"><i class="fas fa-minus-circle" style="color:var(--red);margin-right:5px;"></i>Unpaid Leave (${d.unpaidDays} days)</span><span class="amount">- ${fmt2(d.unpaidDeduction)}</span></div>` : ''}
            ${d.incentive > 0 ? `<div class="salary-row"><span class="label"><i class="fas fa-plus-circle" style="color:var(--green);margin-right:5px;"></i>Monthly Incentive</span><span class="amount">+ ${fmt2(d.incentive)}</span></div>` : ''}
            ${d.bonusTotal > 0 ? `<div class="salary-row"><span class="label"><i class="fas fa-plus-circle" style="color:var(--green);margin-right:5px;"></i>Daily Bonuses</span><span class="amount">+ ${fmt2(d.bonusTotal)}</span></div>` : ''}
            <div style="border-top:2px solid var(--border);margin:10px 0;"></div>
            <div class="salary-row net"><span class="label" style="font-weight:700;">Net Payable Till Today</span><span class="amount" style="color:var(--green);font-size:18px;font-weight:800;">${fmt2(d.netPayable)}</span></div>`;
    } catch {
        container.innerHTML = '<div class="no-data">Failed to load salary till date</div>';
    }
}

// â”€â”€ Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let attSettings = { officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 };

async function loadAttSettings() {
    // Fetch from server so employee portal always uses the admin-configured office time
    try {
        const data = await apiFetch('/attendance/settings');
        attSettings = { ...attSettings, ...data };
        localStorage.setItem('attendanceSettings', JSON.stringify(attSettings));
    } catch (e) {
        const saved = localStorage.getItem('attendanceSettings');
        if (saved) { try { attSettings = { ...attSettings, ...JSON.parse(saved) }; } catch(_) {} }
    }
}
function fmt12h(t) {
    if (!t) return '—';
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
    await loadAttSettings();
    const month     = document.getElementById('attendanceMonthFilter').value;
    const tbody     = document.getElementById('attendanceBody');
    const statsDiv  = document.getElementById('attendanceStats');
    const policyBox = document.getElementById('attendancePolicyInfo');

    policyBox.innerHTML = `<i class="fas fa-info-circle"></i><span>Office start: <strong>${fmt12h(attSettings.officeStartTime)}</strong> &nbsp;&middot;&nbsp; Late threshold: <strong>${attSettings.lateThresholdMins} min</strong> &nbsp;&middot;&nbsp; Every <strong>${attSettings.lateDaysHalfDay}</strong> late days = <strong>0.5 day</strong> deducted from leave balance</span>`;
    tbody.innerHTML = '<tr><td colspan="5" class="no-data"><div class="spinner"></div></td></tr>';

    try {
        const [docs, leavesData, profile] = await Promise.all([
            apiFetch(`/attendance/month/${month}`),
            apiFetch('/leaves'),
            apiFetch(`/employees/${EMP_ID}`).catch(() => null)
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
            if (!isJoinedByDate(profile?.hireDate, dateStr)) continue;
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
    loadProbationStatus();
    loadSalaryTillDate();
    loadSalaryHistory();
    loadNavIncentive();  // piggy bank widget

    const docsInput = document.getElementById('myDocFileInput');
    if (docsInput) {
        docsInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            const docType = event.target.dataset.docType;
            if (!file || !docType) return;
            try {
                notify('documentsNotify', 'Uploading document...');
                await uploadMyDocument(file, docType);
                notify('documentsNotify', 'Document uploaded successfully.');
                await loadMyDocuments();
            } catch (e) {
                notify('documentsNotify', e.message || 'Failed to upload document.', 'error');
            }
        });
    }

    const salesDateInput = document.getElementById('mySalesDate');
    if (salesDateInput) salesDateInput.value = new Date().toISOString().split('T')[0];
});

window.submitMySalesRecord = submitMySalesRecord;
window.toggleLeavePolicy = toggleLeavePolicy;
window.toggleHalfDaySessionEmp = toggleHalfDaySessionEmp;
window.toggleSalaryBreakupVisibility = toggleSalaryBreakupVisibility;
window.toggleSalaryHistoryVisibility = toggleSalaryHistoryVisibility;
window.openOverviewSection = openOverviewSection;
window.overviewCardKey = overviewCardKey;
window.goToSalesForm = goToSalesForm;
window.openMyDocPicker = openMyDocPicker;
window.lockMyDocument = lockMyDocument;
window.deleteMyDocument = deleteMyDocument;

// ══════════════════════════════════════════════
//  CONGRATULATIONS OVERLAY
// ══════════════════════════════════════════════

// ── Piggy Bank Navbar Widget ──────────────────
async function loadNavIncentive() {
    try {
        const now   = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const [data, config, salesData, admissions] = await Promise.all([
            apiFetch('/incentives/data').catch(() => null),
            apiFetch('/incentives/config').catch(() => ({})),
            apiFetch('/sales').catch(() => ({})),
            apiFetch(`/admissions?employeeId=${EMP_ID}&month=${month}`).catch(() => [])
        ]);
        if (!data) return;

        const monthlyKey = `${month}_${EMP_ID}`;
        const rec        = (data.monthlyIncentives || {})[monthlyKey];
        const paid       = rec?.paid || false;
        let amount       = 0;

        if (paid) {
            // Already paid — use locked stored amount
            amount = parseFloat(rec.amount) || 0;
        } else {
            // Not paid — recalculate live from slabs so deletions are reflected
            const empSales      = (salesData[month] || {})[EMP_ID] || (salesData[month] || {})[String(EMP_ID)] || {};
            const salesTarget   = empSales.salesTarget   || 0;
            const revTarget     = empSales.revenueTarget || 0;
            const approvedAdmissions = (Array.isArray(admissions) ? admissions : [])
                .filter(a => (a.status || 'approved') === 'approved');
            const salesAchieved = approvedAdmissions.length;
            const revAchieved   = approvedAdmissions.reduce((sum, a) => sum + (parseFloat(a.revenue) || 0), 0);
            let achievementRate = 0;
            if (salesTarget > 0)    achievementRate = salesAchieved / salesTarget * 100;
            else if (revTarget > 0) achievementRate = revAchieved   / revTarget   * 100;
            if (achievementRate >= 100) {
                const slabs = (config && config.slabs) ? config.slabs : {};
                const pct = achievementRate >= 200 ? (slabs[200] || 0)
                          : achievementRate >= 150 ? (slabs[150] || 0)
                          :                          (slabs[100] || 0);
                amount = Math.round(revAchieved * pct / 100);
            }
        }

        updatePiggyBank(amount, paid);
    } catch (e) { /* silent — widget just stays in loading state */ }
}

let _piggyCoinsTimer = null;

function updatePiggyBank(amount, paid) {
    const widget = document.getElementById('piggyWidget');
    const amtEl  = document.getElementById('piggyAmt');
    const statEl = document.getElementById('piggyStatus');
    if (!widget || !amtEl) return;

    if (amount > 0) {
        widget.classList.add('piggy-has-amount');
        widget.classList.remove('piggy-zero');
        amtEl.textContent = fmtRupees(amount);
        statEl.innerHTML  = paid
            ? '<span class="piggy-paid-tag" style="background:#dcfce7;color:#16a34a;">&#10003; Paid</span>'
            : '<span class="piggy-paid-tag" style="background:#fef3c7;color:#d97706;">Pending</span>';
        // Coins rain for a few seconds
        if (!_piggyCoinsTimer) {
            let drops = 0;
            _piggyCoinsTimer = setInterval(() => {
                const coin = document.createElement('span');
                coin.className = 'piggy-coin';
                coin.textContent = ['\uD83E\uDE99','\u2728','\uD83D\uDCB0'][Math.floor(Math.random()*3)];
                coin.style.left = (Math.random() * 75 + 8) + '%';
                coin.style.animationDuration = (1 + Math.random() * .8) + 's';
                widget.appendChild(coin);
                setTimeout(() => coin.remove(), 1800);
                if (++drops >= 10) {
                    clearInterval(_piggyCoinsTimer);
                    _piggyCoinsTimer = null;
                }
            }, 300);
        }
    } else {
        widget.classList.remove('piggy-has-amount');
        widget.classList.add('piggy-zero');
        amtEl.textContent = 'Keep going!';
        statEl.innerHTML  = '';
    }
}

let _congratsConfettiTimer = null;

function setCongratsOverlayState({
    ribbon,
    trophy,
    headline,
    subline,
    name,
    pct,
    pctLabelHtml,
    message,
    buttonText,
    barWidth,
    incentiveAmount = 0,
    incentiveLabel = '🎁 Incentive Earned This Month'
}) {
    document.querySelector('#congratsCard .congrats-ribbon').textContent = ribbon;
    document.querySelector('#congratsCard .congrats-trophy').textContent = trophy;
    document.querySelector('#congratsCard .congrats-headline').textContent = headline;
    document.querySelector('#congratsCard .congrats-subline').textContent = subline;
    document.getElementById('congratsName').textContent = name;
    document.getElementById('congratsPct').textContent = pct;
    document.querySelector('#congratsCard .congrats-pct-label').innerHTML = pctLabelHtml;
    document.getElementById('congratsMsg').textContent = message;
    document.querySelector('#congratsCard .congrats-btn').textContent = buttonText;
    document.getElementById('congratsBarFill').style.width = `${Math.max(0, Math.min(barWidth, 100))}%`;

    const incBox = document.getElementById('congratsIncentiveBox');
    if (incentiveAmount > 0) {
        document.querySelector('#congratsIncentiveBox .congrats-incentive-label').textContent = incentiveLabel;
        document.getElementById('congratsIncentiveAmt').textContent = fmtRupees(incentiveAmount);
        incBox.style.display = '';
    } else {
        incBox.style.display = 'none';
    }
}

function buildCongratsStars() {
    const starsBg = document.getElementById('congratsStarsBg');
    starsBg.innerHTML = '';
    for (let i = 0; i < 80; i++) {
        const s = document.createElement('div');
        s.className = 'congrats-star-dot';
        const size = Math.random() * 3 + 1;
        s.style.cssText = `width:${size}px;height:${size}px;top:${Math.random()*100}%;left:${Math.random()*100}%;opacity:${Math.random()*.8+.2};animation-duration:${Math.random()*3+1}s;animation-delay:${Math.random()*2}s;`;
        starsBg.appendChild(s);
    }
}

function openCongratsOverlay({ festive = true } = {}) {
    const overlay = document.getElementById('congratsOverlay');
    if (!overlay) return null;
    buildCongratsStars();
    overlay.style.display = 'flex';

    const canvas = document.getElementById('congratsCanvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    if (!festive) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (_congratsConfettiTimer) { clearInterval(_congratsConfettiTimer); _congratsConfettiTimer = null; }
        return overlay;
    }

    const ctx = canvas.getContext('2d');
    const colors = ['#ff6b6b','#feca57','#48dbfb','#ff9ff3','#54a0ff','#5f27cd','#00d2d3','#ff9f43','#ffd700','#c0392b','#1abc9c'];
    const shapes = ['rect','circle','triangle'];
    const particles = [];

    for (let i = 0; i < 200; i++) {
        particles.push({
            x:   Math.random() * canvas.width,
            y:   Math.random() * canvas.height - canvas.height,
            w:   Math.random() * 12 + 6,
            h:   Math.random() * 7 + 4,
            color:    colors[Math.floor(Math.random() * colors.length)],
            shape:    shapes[Math.floor(Math.random() * shapes.length)],
            vx:  (Math.random() - .5) * 4,
            vy:  Math.random() * 4 + 2,
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - .5) * 12,
            wobble: Math.random() * 2,
            wobbleSpeed: Math.random() * .08 + .04,
            wobbleAngle: Math.random() * Math.PI * 2,
        });
    }

    function drawParticle(p) {
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, 1 - (p.y / canvas.height) * .3));
        if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'triangle') {
            ctx.beginPath();
            ctx.moveTo(0, -p.h / 2);
            ctx.lineTo(p.w / 2, p.h / 2);
            ctx.lineTo(-p.w / 2, p.h / 2);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
    }

    if (_congratsConfettiTimer) clearInterval(_congratsConfettiTimer);
    _congratsConfettiTimer = setInterval(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of particles) {
            p.wobbleAngle += p.wobbleSpeed;
            p.x += p.vx + Math.sin(p.wobbleAngle) * p.wobble;
            p.y += p.vy;
            p.rot += p.rotSpeed;
            if (p.y > canvas.height + 20) {
                p.y = -20;
                p.x = Math.random() * canvas.width;
            }
            drawParticle(p);
        }
    }, 16);

    _launchFireworks(overlay);
    return overlay;
}

function showCongratsOverlay(empName, achievePct, incentiveAmount) {
    const overlay = openCongratsOverlay({ festive: true });
    if (!overlay) return;

    let message;
    if (achievePct >= 200)
        message = 'INCREDIBLE! You\'ve doubled your target — you are unstoppable! 🚀';
    else if (achievePct >= 150)
        message = 'Outstanding! You\'ve gone 50% beyond the target. Pure excellence! 🌟';
    else
        message = 'You\'ve hit 100% and earned your incentive this month. Keep this energy going!';

    setCongratsOverlayState({
        ribbon: '🌟 TARGET ACHIEVED 🌟',
        trophy: '🏆',
        headline: 'CONGRATULATIONS!',
        subline: 'You crushed it this month!',
        name: empName,
        pct: achievePct + '%',
        pctLabelHtml: 'of your<br>target met',
        message,
        buttonText: 'Keep Crushing It! 🎊',
        barWidth: achievePct,
        incentiveAmount
    });

    // Auto-close after 12 seconds
    setTimeout(() => closeCongratsOverlay(), 12000);
}

function showMonthEndMotivationOverlay(empName, achievePct, remainingTarget, daysRemaining, quote) {
    const overlay = openCongratsOverlay({ festive: false });
    if (!overlay) return;

    setCongratsOverlayState({
        ribbon: '⚡ FINAL STRETCH ⚡',
        trophy: '💪',
        headline: 'YOU\'RE CLOSE!',
        subline: `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left this month`,
        name: empName,
        pct: `${Math.max(0, Math.min(Math.round(achievePct), 99))}%`,
        pctLabelHtml: 'of your<br>target done',
        message: `You need ${remainingTarget} more admission${remainingTarget !== 1 ? 's' : ''} to hit target. “${quote}”`,
        buttonText: 'I Got This',
        barWidth: achievePct,
        incentiveAmount: 0
    });
}

function _launchFireworks(container) {
    const bursts = [
        { left: '15%', top: '20%' }, { left: '80%', top: '15%' },
        { left: '10%', top: '70%' }, { left: '85%', top: '75%' },
        { left: '50%', top: '10%' },
    ];
    const fwColors = ['#ffd700','#ff6b6b','#48dbfb','#ff9ff3','#54a0ff','#feca57'];

    bursts.forEach((pos, bi) => {
        setTimeout(() => {
            const burst = document.createElement('div');
            burst.style.cssText = `position:absolute;left:${pos.left};top:${pos.top};pointer-events:none;`;
            container.appendChild(burst);

            for (let i = 0; i < 16; i++) {
                const dot = document.createElement('div');
                dot.className = 'congrats-firework-dot';
                const angle = (i / 16) * Math.PI * 2;
                const dist  = 60 + Math.random() * 60;
                const fx = Math.cos(angle) * dist + 'px';
                const fy = Math.sin(angle) * dist + 'px';
                dot.style.cssText = `background:${fwColors[Math.floor(Math.random()*fwColors.length)]};--fx:${fx};--fy:${fy};animation-duration:${.6+Math.random()*.4}s;animation-delay:${Math.random()*.2}s;`;
                burst.appendChild(dot);
            }

            setTimeout(() => burst.remove(), 1200);
        }, bi * 400 + 300);
    });
}

function closeCongratsOverlay() {
    const overlay = document.getElementById('congratsOverlay');
    if (overlay) {
        overlay.style.animation = 'congratsFadeIn .3s ease reverse forwards';
        setTimeout(() => { overlay.style.display = 'none'; overlay.style.animation = ''; }, 300);
    }
    if (_congratsConfettiTimer) { clearInterval(_congratsConfettiTimer); _congratsConfettiTimer = null; }
}

// Close on backdrop click
document.addEventListener('click', e => {
    const overlay = document.getElementById('congratsOverlay');
    if (e.target === overlay) closeCongratsOverlay();
});
