// Leave Management Functions
let currentStatusFilter = 'all';
let deleteLeaveId = null;

// LocalStorage Functions for Leaves
function getLeaves() {
    const leaves = localStorage.getItem('hrLeaves');
    return leaves ? JSON.parse(leaves) : [];
}

function saveLeaves(leaves) {
    localStorage.setItem('hrLeaves', JSON.stringify(leaves));
}

// Initialize leave management page
document.addEventListener('DOMContentLoaded', function() {
    loadEmployeeOptions();
    loadLeaves();
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
    employees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.firstName} ${emp.lastName} - ${emp.department}`;
        select.appendChild(option);
    });
}

function loadLeaves() {
    const leaves = getLeaves();
    displayLeaves(leaves);
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
        tbody.innerHTML = '<tr><td colspan="8" class="no-data">No leave requests found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(leave => {
        const employee = employees.find(e => e.id === leave.employeeId);
        const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        const days = calculateDays(leave.startDate, leave.endDate);
        
        return `
            <tr>
                <td>${employeeName}</td>
                <td>${leave.leaveType}</td>
                <td>${formatDateShort(leave.startDate)}</td>
                <td>${formatDateShort(leave.endDate)}</td>
                <td>${days} day${days !== 1 ? 's' : ''}</td>
                <td>${truncateText(leave.reason || 'N/A', 30)}</td>
                <td><span class="status-badge ${leave.status}">${capitalize(leave.status)}</span></td>
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
        totalDays += calculateDays(leave.startDate, leave.endDate);
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
    if (typeFilter) {
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
    document.getElementById('leaveModal').classList.add('show');
}

function editLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    
    if (!leave) return;
    
    document.getElementById('leaveModalTitle').textContent = 'Edit Leave Request';
    document.getElementById('leaveId').value = leave.id;
    document.getElementById('employeeSelect').value = leave.employeeId;
    document.getElementById('leaveType').value = leave.leaveType;
    document.getElementById('leaveStatus').value = leave.status;
    document.getElementById('startDate').value = leave.startDate;
    document.getElementById('endDate').value = leave.endDate;
    document.getElementById('leaveReason').value = leave.reason || '';
    
    calculateLeaveDays();
    document.getElementById('leaveModal').classList.add('show');
}

function saveLeaveRequest(event) {
    event.preventDefault();
    
    const id = document.getElementById('leaveId').value;
    const employeeId = parseInt(document.getElementById('employeeSelect').value);
    const employees = getEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    // Check if any date in range is a holiday
    let current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        if (typeof isHoliday === 'function' && isHoliday(dateStr)) {
            const holiday = getHolidayByDate(dateStr);
            showNotification(`Cannot apply for leave on ${holiday.name} (${formatDateShort(dateStr)})`, 'error');
            return;
        }
        current.setDate(current.getDate() + 1);
    }
    
    const leave = {
        id: id ? parseInt(id) : Date.now(),
        employeeId: employeeId,
        leaveType: document.getElementById('leaveType').value,
        status: document.getElementById('leaveStatus').value,
        startDate: startDate,
        endDate: endDate,
        reason: document.getElementById('leaveReason').value,
        appliedDate: id ? (getLeaves().find(l => l.id === parseInt(id))?.appliedDate || new Date().toISOString()) : new Date().toISOString()
    };
    
    const leaves = getLeaves();
    const days = calculateDays(leave.startDate, leave.endDate);
    
    // Deduct from employee leave balance when approved
    if (leave.status === 'approved' && employee) {
        const leaveBalance = employee.leaveBalance || { annualLeave: 20, sickLeave: 10, personalLeave: 5 };
        
        // Check if editing existing leave
        let previousDays = 0;
        if (id) {
            const existingLeave = leaves.find(l => l.id === parseInt(id));
            if (existingLeave && existingLeave.status === 'approved') {
                previousDays = calculateDays(existingLeave.startDate, existingLeave.endDate);
            }
        }
        
        // Restore previous days if editing
        if (previousDays > 0) {
            const previousType = leaves.find(l => l.id === parseInt(id))?.leaveType;
            if (previousType === 'Annual Leave') leaveBalance.annualLeave += previousDays;
            else if (previousType === 'Sick Leave') leaveBalance.sickLeave += previousDays;
            else if (previousType === 'Personal Leave') leaveBalance.personalLeave += previousDays;
        }
        
        // Deduct new days
        if (leave.leaveType === 'Annual Leave') {
            if (leaveBalance.annualLeave < days) {
                showNotification(`Insufficient annual leave balance! Available: ${leaveBalance.annualLeave} days`, 'error');
                return;
            }
            leaveBalance.annualLeave -= days;
        } else if (leave.leaveType === 'Sick Leave') {
            if (leaveBalance.sickLeave < days) {
                showNotification(`Insufficient sick leave balance! Available: ${leaveBalance.sickLeave} days`, 'error');
                return;
            }
            leaveBalance.sickLeave -= days;
        } else if (leave.leaveType === 'Personal Leave') {
            if (leaveBalance.personalLeave < days) {
                showNotification(`Insufficient personal leave balance! Available: ${leaveBalance.personalLeave} days`, 'error');
                return;
            }
            leaveBalance.personalLeave -= days;
        }
        
        // Update employee leave balance
        employee.leaveBalance = leaveBalance;
        saveEmployees(employees);
    }
    
    if (id) {
        const index = leaves.findIndex(l => l.id === parseInt(id));
        leaves[index] = leave;
        addLog('edit', `Updated leave request for ${employee.firstName} ${employee.lastName}`);
        showNotification('Leave request updated successfully!', 'success');
    } else {
        leaves.push(leave);
        addLog('add', `Created leave request for ${employee.firstName} ${employee.lastName}`);
        showNotification('Leave request created successfully!', 'success');
    }
    
    saveLeaves(leaves);
    loadLeaves();
    updateLeaveStats();
    closeLeaveModal();
}

function calculateLeaveDays() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (end < start) {
            document.getElementById('leaveDuration').textContent = 'Invalid date range';
            document.getElementById('leaveDuration').style.color = 'red';
            return;
        }
        
        // Check if any date in range is a holiday
        let current = new Date(start);
        let holidayDates = [];
        
        while (current <= end) {
            const dateStr = current.toISOString().split('T')[0];
            if (typeof isHoliday === 'function' && isHoliday(dateStr)) {
                const holiday = getHolidayByDate(dateStr);
                holidayDates.push(holiday.name);
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
        
        const days = calculateDays(startDate, endDate);
        document.getElementById('leaveDuration').textContent = `${days} day${days !== 1 ? 's' : ''}`;
        document.getElementById('leaveDuration').style.color = '';
    }
}

function calculateDays(startDate, endDate) {
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
    const days = calculateDays(leave.startDate, leave.endDate);
    
    document.getElementById('detailEmployee').textContent = employeeName;
    document.getElementById('detailType').textContent = leave.leaveType;
    document.getElementById('detailStartDate').textContent = formatDateShort(leave.startDate);
    document.getElementById('detailEndDate').textContent = formatDateShort(leave.endDate);
    document.getElementById('detailDuration').textContent = `${days} day${days !== 1 ? 's' : ''}`;
    document.getElementById('detailStatus').innerHTML = `<span class="status-badge ${leave.status}">${capitalize(leave.status)}</span>`;
    document.getElementById('detailReason').textContent = leave.reason || 'No reason provided';
    document.getElementById('detailAppliedDate').textContent = formatDate(leave.appliedDate);
    
    document.getElementById('leaveDetailsModal').classList.add('show');
}

function approveLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    
    if (!leave) return;
    
    leave.status = 'approved';
    saveLeaves(leaves);
    
    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    addLog('edit', `Approved leave request for ${employee.firstName} ${employee.lastName}`);
    showNotification('Leave request approved!', 'success');
    
    loadLeaves();
    updateLeaveStats();
}

function rejectLeave(id) {
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === id);
    
    if (!leave) return;
    
    leave.status = 'rejected';
    saveLeaves(leaves);
    
    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    addLog('edit', `Rejected leave request for ${employee.firstName} ${employee.lastName}`);
    showNotification('Leave request rejected!', 'success');
    
    loadLeaves();
    updateLeaveStats();
}

function deleteLeave(id) {
    deleteLeaveId = id;
    document.getElementById('deleteLeaveModal').classList.add('show');
}

function confirmDeleteLeave() {
    if (!deleteLeaveId) return;
    
    const leaves = getLeaves();
    const leave = leaves.find(l => l.id === deleteLeaveId);
    const filtered = leaves.filter(l => l.id !== deleteLeaveId);
    
    const employees = getEmployees();
    const employee = employees.find(e => e.id === leave.employeeId);
    
    saveLeaves(filtered);
    addLog('delete', `Deleted leave request for ${employee.firstName} ${employee.lastName}`);
    showNotification('Leave request deleted successfully!', 'success');
    
    loadLeaves();
    updateLeaveStats();
    closeDeleteLeaveModal();
}

function closeLeaveModal() {
    document.getElementById('leaveModal').classList.remove('show');
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
