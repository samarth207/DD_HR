// Leave Management Functions
let currentStatusFilter = 'all';
let deleteLeaveId = null;
const WORK_FROM_HOME_TYPE = 'Work From Home';

function toggleHalfDaySession() {
    const isChecked = document.getElementById('halfDayCheck')?.checked || false;
    const sessionRow = document.getElementById('halfDaySessionRow');
    const endDateEl = document.getElementById('endDate');
    if (sessionRow) sessionRow.style.display = isChecked ? 'block' : 'none';
    if (endDateEl) {
        endDateEl.disabled = isChecked;
        if (isChecked) {
            const startDate = document.getElementById('startDate')?.value;
            if (startDate) endDateEl.value = startDate;
        }
    }
    if (typeof calculateLeaveDays === 'function') calculateLeaveDays();
    if (typeof showEmployeeLeaveBalance === 'function') showEmployeeLeaveBalance();
}

// Note: getLeaves() and saveLeaves() are already defined in script.js
// No localStorage functions needed here

// Initialize leave management page
document.addEventListener('DOMContentLoaded', async function() {
    // Load data from DB first, then render
    await Promise.all([loadEmployees(), loadLeaves()]);
    loadEmployeeOptions();
    // Default month filter to current month
    const monthFilterEl = document.getElementById('monthFilter');
    if (monthFilterEl) monthFilterEl.value = String(new Date().getMonth());
    filterLeaves();
    updateLeaveStats();
    
    // Add Escape key listener for closing modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
            const leaveModal = document.getElementById('leaveModal');
            const detailsModal = document.getElementById('leaveDetailsModal');
            const deleteModal = document.getElementById('deleteLeaveModal');
            
            if (leaveModal && leaveModal.style.display === 'flex') {
                closeLeaveModal();
            }
            if (detailsModal && detailsModal.style.display === 'flex') {
                closeDetailsModal();
            }
            if (deleteModal && deleteModal.style.display === 'flex') {
                closeDeleteLeaveModal();
            }
        }
    });
});

function loadEmployeeOptions() {
    const employees = getEmployees();
    const select = document.getElementById('employeeSelect');
    select.innerHTML = '<option value="">Select Employee</option>';
    if (!employees || employees.length === 0) {
        select.innerHTML = '<option value="">No employees found</option>';
        return;
    }
    employees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.firstName} ${emp.lastName} - ${emp.department}`;
        select.appendChild(option);
    });
    select.addEventListener('change', showEmployeeLeaveBalance);

    // Re-calculate projected balance when these fields change
    ['leaveType', 'leaveStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', showEmployeeLeaveBalance);
    });
}

function showEmployeeLeaveBalance() {
    const employeeId = parseInt(document.getElementById('employeeSelect').value);
    const balanceBox = document.getElementById('employeeLeaveBalance');
    if (!balanceBox) return;

    if (!employeeId) {
        balanceBox.style.display = 'none';
        return;
    }

    const employees = getEmployees();
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) { balanceBox.style.display = 'none'; return; }

    const bal = emp.leaveBalance || { paidLeave: 12 };
    const paidLeave = bal.paidLeave ?? bal.annualLeave ?? 12;

    // Calculate projected balance based on current form values
    const leaveType = document.getElementById('leaveType')?.value;
    const status = document.getElementById('leaveStatus')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const leaveId = document.getElementById('leaveId')?.value;

    const isPaidType = leaveType === 'Paid Leave';
    const isWorkFromHomeType = leaveType === WORK_FROM_HOME_TYPE;
    const isApproved = status === 'approved';
    const isHalfDayChecked = document.getElementById('halfDayCheck')?.checked || false;
    const daysInForm = (startDate && endDate) ? calculateDays(startDate, endDate, isHalfDayChecked) : 0;

    // For edits, get the old approved days so we don't double-count
    let oldApprovedDays = 0;
    if (leaveId && isPaidType) {
        const existing = getLeaves().find(l => l.id === parseInt(leaveId));
        if (existing && existing.status === 'approved' && (existing.leaveType === 'Paid Leave' || existing.leaveType === 'Half Day')) {
            oldApprovedDays = calculateDays(existing.startDate, existing.endDate, existing.halfDay || existing.leaveType === 'Half Day');
        }
    }

    let projectedLeave = paidLeave;
    if (isPaidType && isApproved && daysInForm > 0) {
        projectedLeave = Math.round((paidLeave + oldApprovedDays - daysInForm) * 10) / 10;
    }

    const balanceChanged = isPaidType && isApproved && daysInForm > 0 && projectedLeave !== paidLeave;
    const projectedColor = projectedLeave < 0 ? '#c53030' : (projectedLeave < 3 ? '#c05621' : '#065f46');
    const projectedBg = projectedLeave < 0 ? '#fed7d7' : (projectedLeave < 3 ? '#feebc8' : '#d1fae5');

    // Probation notice
    const probationNotice = emp.isOnProbation
        ? `<div style="width:100%;margin-top:8px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px;"><i class="fas fa-user-clock"></i><strong>On Probation</strong> — Paid leave is blocked for this employee. Only unpaid leave / WFH is allowed.</div>`
        : '';

    balanceBox.style.display = 'flex';
    balanceBox.innerHTML = `
        <span style="font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.5px;margin-right:8px;">Leave Balance:</span>
        <span class="bal-chip paid">Paid Leave: <strong>${paidLeave}</strong>${balanceChanged ? ` <span style="color:#718096;font-weight:400;">→</span> <strong style="color:${projectedColor};">${projectedLeave}</strong>` : ''}</span>
        <span class="bal-chip unpaid">Unpaid Leave: <strong>Unlimited</strong></span>
        ${isWorkFromHomeType ? '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">WFH does not deduct leave</span>' : ''}
        ${projectedLeave < 0 ? '<span style="color:#c53030;font-size:11px;font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Insufficient balance</span>' : ''}
        ${probationNotice}
    `;
}

function renderLeaves() {
    filterLeaves();
}

function displayLeaves(leaves) {
    const tbody = document.getElementById('leaveTableBody');
    const employees = getEmployees();
    
    // Apply status filter
    let filtered = leaves;
    if (currentStatusFilter !== 'all') {
        filtered = leaves.filter(l => l.status === currentStatusFilter);
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="no-data">No leave requests found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(leave => {
        const employee = employees.find(e => e.id === leave.employeeId);
        const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
        const rawDays = calculateDays(leave.startDate, leave.endDate, isHalfDay);
        const sandwichDays = leave.sandwichDays || 0;
        const totalDays = rawDays + sandwichDays;

        // Probation badge — only show on pending leaves (approved/rejected were already
        // processed at the time they were submitted, before probation may have been set)
        const probationBadge = (employee?.isOnProbation && leave.status === 'pending')
            ? `<span style="display:inline-flex;align-items:center;gap:3px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:10px;font-size:10px;font-weight:700;padding:2px 6px;margin-left:5px;"><i class="fas fa-user-clock"></i>PROB.</span>`
            : '';
        
        // Determine pay type from selected leave type
        let payTypeBadge = '<span style="color:#a0aec0;font-size:12px;">-</span>';
        if (leave.leaveType === WORK_FROM_HOME_TYPE) {
            payTypeBadge = '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">WFH</span>';
        } else if (leave.status === 'approved') {
                const isPaid = leave.leaveType === 'Paid Leave' || leave.leaveType === 'Half Day';
                payTypeBadge = isPaid
                    ? '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">Paid</span>'
                    : '<span style="background:#fed7d7;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">Unpaid</span>';
        }

        // Half-day session label
        let halfDayBadge = '';
        if (isHalfDay) {
            const session = leave.halfDaySession || '';
            halfDayBadge = `<span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:6px;font-size:11px;font-weight:600;margin-left:4px;">&#189; ${session}</span>`;
        }

        // Sandwich badge
        const sandwichBadge = sandwichDays > 0
            ? `<span style="background:#fde8ff;color:#7c3aed;padding:1px 6px;border-radius:6px;font-size:11px;font-weight:600;margin-left:4px;" title="Sandwich rule: Sunday between Sat &amp; Mon leave counted"><i class="fas fa-sandwich"></i>+${sandwichDays}d sandwich</span>`
            : '';
        
        return `
            <tr>
                <td>${employeeName}${probationBadge}</td>
                <td>${leave.leaveType}${halfDayBadge}</td>
                <td>${formatDateShort(leave.startDate)}</td>
                <td>${formatDateShort(leave.endDate)}</td>
                <td>${totalDays} day${totalDays !== 1 ? 's' : ''}${sandwichBadge}</td>
                <td>${truncateText(leave.reason || 'N/A', 30)}</td>
                <td><span class="status-badge ${leave.status}">${capitalize(leave.status)}</span></td>
                <td>${payTypeBadge}</td>
                <td class="actions">
                    <button class="icon-btn" onclick="viewLeaveDetails(${leave.id})" title="View Details" style="background-color: #e0e7ff; color: #4338ca;">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="icon-btn edit" onclick="editLeave(${leave.id})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${leave.status === 'pending' ? `
                        <button class="icon-btn" onclick="approveLeave(${leave.id})" title="Approve" style="background-color: #d1fae5; color: #065f46;">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="icon-btn" onclick="rejectLeave(${leave.id})" title="Reject" style="background-color: #fed7d7; color: #991b1b;">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    <button class="icon-btn delete" onclick="deleteLeave(${leave.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateLeaveStats() {
    const leaves = getLeaves();
    
    const pending = leaves.filter(l => l.status === 'pending').length;
    const approved = leaves.filter(l => l.status === 'approved').length;
    const rejected = leaves.filter(l => l.status === 'rejected').length;
    
    // Calculate total days this month
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const thisMonthLeaves = leaves.filter(l => {
        const startDate = new Date(l.startDate);
        const endDate = new Date(l.endDate);
        return (startDate >= firstDayOfMonth && startDate <= lastDayOfMonth) ||
               (endDate >= firstDayOfMonth && endDate <= lastDayOfMonth) ||
               (startDate <= firstDayOfMonth && endDate >= lastDayOfMonth);
    });
    
    let totalDays = 0;
    thisMonthLeaves.forEach(leave => {
        if (leave.leaveType !== WORK_FROM_HOME_TYPE) {
            totalDays += calculateDays(leave.startDate, leave.endDate, leave.halfDay || leave.leaveType === 'Half Day');
        }
    });
    
    document.getElementById('pendingLeaves').textContent = pending;
    document.getElementById('approvedLeaves').textContent = approved;
    document.getElementById('rejectedLeaves').textContent = rejected;
    document.getElementById('totalLeaveDays').textContent = totalDays;
}

function filterByStatus(status) {
    currentStatusFilter = status;
    
    // Update active tab
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    filterLeaves();
}

function filterLeaves() {
    const searchTerm = document.getElementById('searchLeave').value.toLowerCase();
    const typeFilter = document.getElementById('leaveTypeFilter').value;
    const monthFilter = document.getElementById('monthFilter').value;
    
    let leaves = getLeaves();
    const employees = getEmployees();
    
    // Filter by status
    if (currentStatusFilter !== 'all') {
        leaves = leaves.filter(l => l.status === currentStatusFilter);
    }
    
    // Filter by search term
    if (searchTerm) {
        leaves = leaves.filter(leave => {
            const employee = employees.find(e => e.id === leave.employeeId);
            const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.toLowerCase() : '';
            return employeeName.includes(searchTerm);
        });
    }
    
    // Filter by leave type
    if (typeFilter === 'Half Day') {
        leaves = leaves.filter(l => l.halfDay === true || l.leaveType === 'Half Day');
    } else if (typeFilter) {
        leaves = leaves.filter(l => l.leaveType === typeFilter);
    }
    
    // Filter by month
    if (monthFilter) {
        const targetMonth = parseInt(monthFilter);
        leaves = leaves.filter(l => {
            const startDate = new Date(l.startDate);
            const endDate = new Date(l.endDate);
            return startDate.getMonth() === targetMonth || endDate.getMonth() === targetMonth;
        });
    }
    
    displayLeaves(leaves);
}

function openLeaveModal() {
    document.getElementById('leaveModalTitle').textContent = 'New Leave Request';
    document.getElementById('leaveForm').reset();
    document.getElementById('leaveId').value = '';
    document.getElementById('leaveDuration').textContent = '0 days';
    const halfDayCheck = document.getElementById('halfDayCheck');
    if (halfDayCheck) halfDayCheck.checked = false;
    const sessionRow = document.getElementById('halfDaySessionRow');
    if (sessionRow) sessionRow.style.display = 'none';
    const endDateEl = document.getElementById('endDate');
    if (endDateEl) endDateEl.disabled = false;
    const balanceBox = document.getElementById('employeeLeaveBalance');
    if (balanceBox) balanceBox.style.display = 'none';
    document.getElementById('leaveModal').classList.add('show');
}

function editLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    
    if (!leave) return;
    
    document.getElementById('leaveModalTitle').textContent = 'Edit Leave Request';
    document.getElementById('leaveId').value = leave.id;
    document.getElementById('employeeSelect').value = leave.employeeId;
    showEmployeeLeaveBalance();
    // For old records that stored leaveType='Half Day', map to 'Paid Leave'
    document.getElementById('leaveType').value = (leave.leaveType === 'Half Day') ? 'Paid Leave' : leave.leaveType;
    document.getElementById('leaveStatus').value = leave.status;
    document.getElementById('startDate').value = leave.startDate;
    document.getElementById('endDate').value = leave.endDate;
    document.getElementById('leaveReason').value = leave.reason || '';
    // Restore half-day state
    const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
    const halfDayCheck = document.getElementById('halfDayCheck');
    if (halfDayCheck) {
        halfDayCheck.checked = isHalfDay;
        const sessionRow = document.getElementById('halfDaySessionRow');
        if (sessionRow) sessionRow.style.display = isHalfDay ? 'block' : 'none';
        const endDateEl = document.getElementById('endDate');
        if (endDateEl) endDateEl.disabled = isHalfDay;
        if (isHalfDay && leave.halfDaySession) {
            const sessionEl = document.getElementById('halfDaySession');
            if (sessionEl) sessionEl.value = leave.halfDaySession;
        }
    }
    
    calculateLeaveDays();
    document.getElementById('leaveModal').classList.add('show');
}

async function saveLeaveRequest(event) {
    event.preventDefault();
    
    const id = document.getElementById('leaveId').value;
    const employeeId = parseInt(document.getElementById('employeeSelect').value);
    const employees = getEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    // Check if any date in range is a holiday
    let current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    
    while (current <= end) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
        if (typeof isHoliday === 'function' && await isHoliday(dateStr)) {
            const holiday = await getHolidayByDate(dateStr);
            showNotification(`Cannot apply for leave on ${holiday?.name || 'a holiday'} (${formatDateShort(dateStr)})`, 'error');
            return;
        }
        current.setDate(current.getDate() + 1);
    }

    // Check for overlapping leaves for the same employee
    const currentLeaveId = id ? parseInt(id) : -1;
    const newStart = new Date(startDate + 'T00:00:00');
    const newEnd   = new Date(endDate + 'T00:00:00');
    const overlapping = getLeaves().find(l =>
        l.employeeId === employeeId &&
        l.id !== currentLeaveId &&
        l.status !== 'rejected' &&
        new Date(l.startDate + 'T00:00:00') <= newEnd &&
        new Date(l.endDate + 'T00:00:00')   >= newStart
    );
    if (overlapping) {
        showNotification(
            `Employee already has a leave from ${formatDateShort(overlapping.startDate)} to ${formatDateShort(overlapping.endDate)}.`,
            'error'
        );
        return;
    }

    const isHalfDay = document.getElementById('halfDayCheck')?.checked || false;
    const halfDaySession = isHalfDay ? (document.getElementById('halfDaySession')?.value || 'First Half') : null;

    if (isHalfDay && startDate !== endDate) {
        showNotification('Half day leave must be on a single day (start and end date must match).', 'error');
        return;
    }

    const leave = {
        id: id ? parseInt(id) : Date.now(),
        employeeId: employeeId,
        leaveType: document.getElementById('leaveType').value,
        halfDay: isHalfDay,
        halfDaySession: halfDaySession,
        status: document.getElementById('leaveStatus').value,
        startDate: startDate,
        endDate: endDate,
        reason: document.getElementById('leaveReason').value,
        appliedDate: id ? (getLeaves().find(l => l.id === parseInt(id))?.appliedDate || new Date().toISOString()) : new Date().toISOString()
    };

    try {
        if (id) {
            await apiCall(`/leaves/${leave.id}`, 'PUT', leave);
            addLog('edit', `Updated leave request for ${employee.firstName} ${employee.lastName}`);
            showNotification('Leave request updated successfully!', 'success');
        } else {
            await apiCall('/leaves', 'POST', leave);
            addLog('add', `Created leave request for ${employee.firstName} ${employee.lastName}`);
            showNotification('Leave request created successfully!', 'success');
        }
    } catch (err) {
        if (err && err.probation) {
            showNotification('This employee is on probation. Only Unpaid Leave or Work From Home is allowed.', 'error');
        } else {
            showNotification('Failed to save leave request. Please try again.', 'error');
        }
        return;
    }

    // Refresh cache from DB then re-render
    await Promise.all([loadLeaves(), loadEmployees()]);
    renderLeaves();
    updateLeaveStats();
    closeLeaveModal();
}

async function calculateLeaveDays() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (startDate && endDate) {
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        
        if (end < start) {
            document.getElementById('leaveDuration').textContent = 'Invalid date range';
            document.getElementById('leaveDuration').style.color = 'red';
            return;
        }
        
        // Check if any date in range is a holiday
        let current = new Date(start);
        let holidayDates = [];
        
        while (current <= end) {
            const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
            if (typeof isHoliday === 'function' && await isHoliday(dateStr)) {
                const holiday = await getHolidayByDate(dateStr);
                holidayDates.push(holiday?.name || 'Holiday');
            }
            current.setDate(current.getDate() + 1);
        }
        
        if (holidayDates.length > 0) {
            document.getElementById('leaveDuration').innerHTML = `
                <span style="color: red;">
                    <i class="fas fa-exclamation-triangle"></i> 
                    Contains holiday(s): ${holidayDates.join(', ')}
                </span>
            `;
            return;
        }
        
        const isHalfDay = document.getElementById('halfDayCheck')?.checked || false;
        const days = calculateDays(startDate, endDate, isHalfDay);
        document.getElementById('leaveDuration').textContent = `${days} day${days !== 1 ? 's' : ''}`;
        document.getElementById('leaveDuration').style.color = '';
    }
    // Refresh projected balance whenever dates change
    showEmployeeLeaveBalance();
}

function calculateDays(startDate, endDate, isHalfDay) {
    if (isHalfDay) return 0.5;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

function viewLeaveDetails(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    
    if (!leave) return;
    
    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
    const isHalfDay = leave.halfDay === true || leave.leaveType === 'Half Day';
    const days = calculateDays(leave.startDate, leave.endDate, isHalfDay);
    const sessionLabel = isHalfDay ? ` — Half Day (${leave.halfDaySession || 'unspecified'})` : '';
    
    document.getElementById('detailEmployee').textContent = employeeName;
    document.getElementById('detailType').textContent = leave.leaveType + sessionLabel;
    document.getElementById('detailStartDate').textContent = formatDateShort(leave.startDate);
    document.getElementById('detailEndDate').textContent = formatDateShort(leave.endDate);
    document.getElementById('detailDuration').textContent = `${days} day${days !== 1 ? 's' : ''}${isHalfDay && leave.halfDaySession ? ` (${leave.halfDaySession})` : ''}`;
    document.getElementById('detailStatus').innerHTML = `<span class="status-badge ${leave.status}">${capitalize(leave.status)}</span>`;
    document.getElementById('detailReason').textContent = leave.reason || 'No reason provided';
    document.getElementById('detailAppliedDate').textContent = formatDate(leave.appliedDate);
    
    document.getElementById('leaveDetailsModal').classList.add('show');
}

async function approveLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    if (!leave) return;

    try {
        await apiCall(`/leaves/${id}`, 'PUT', { ...leave, status: 'approved' });
    } catch (err) {
        showNotification('Failed to approve leave. Please try again.', 'error');
        return;
    }

    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    addLog('edit', `Approved leave request for ${employee?.firstName} ${employee?.lastName}`);
    showNotification('Leave request approved!', 'success');

    await Promise.all([loadLeaves(), loadEmployees()]);
    renderLeaves();
    updateLeaveStats();
}

async function rejectLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    if (!leave) return;

    try {
        await apiCall(`/leaves/${id}`, 'PUT', { ...leave, status: 'rejected' });
    } catch (err) {
        showNotification('Failed to reject leave. Please try again.', 'error');
        return;
    }

    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    addLog('edit', `Rejected leave request for ${employee?.firstName} ${employee?.lastName}`);
    showNotification('Leave request rejected!', 'success');

    await Promise.all([loadLeaves(), loadEmployees()]);
    renderLeaves();
    updateLeaveStats();
}

function deleteLeave(id) {
    deleteLeaveId = id;
    document.getElementById('deleteLeaveModal').classList.add('show');
}

async function confirmDeleteLeave() {
    if (!deleteLeaveId) return;
    
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === deleteLeaveId);
    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave?.employeeId);

    try {
        await apiCall(`/leaves/${deleteLeaveId}`, 'DELETE');
    } catch (err) {
        showNotification('Failed to delete leave. Please try again.', 'error');
        return;
    }

    addLog('delete', `Deleted leave request for ${employee?.firstName} ${employee?.lastName}`);
    showNotification('Leave request deleted successfully!', 'success');

    await Promise.all([loadLeaves(), loadEmployees()]);
    renderLeaves();
    updateLeaveStats();
    closeDeleteLeaveModal();
}

function closeLeaveModal() {
    document.getElementById('leaveModal').classList.remove('show');
    const balanceBox = document.getElementById('employeeLeaveBalance');
    if (balanceBox) balanceBox.style.display = 'none';
}

function closeDetailsModal() {
    document.getElementById('leaveDetailsModal').classList.remove('show');
}

function closeDeleteLeaveModal() {
    document.getElementById('deleteLeaveModal').classList.remove('show');
    deleteLeaveId = null;
}

// Utility Functions
function formatDateShort(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Close modals when clicking outside
window.onclick = function(event) {
    const leaveModal = document.getElementById('leaveModal');
    const detailsModal = document.getElementById('leaveDetailsModal');
    const deleteModal = document.getElementById('deleteLeaveModal');
    
    if (event.target === leaveModal) {
        closeLeaveModal();
    }
    if (event.target === detailsModal) {
        closeDetailsModal();
    }
    if (event.target === deleteModal) {
        closeDeleteLeaveModal();
    }
}


