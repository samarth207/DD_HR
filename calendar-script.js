// Leave Calendar Functions
let currentCalendarDate = new Date();
const WORK_FROM_HOME_TYPE = 'Work From Home';

function isWorkFromHomeLeave(leave) {
    return String(leave?.leaveType || '').trim().toLowerCase() === 'work from home';
}

// Initialize calendar page
document.addEventListener('DOMContentLoaded', async function() {
    // Populate caches from DB before rendering
    await Promise.all([loadEmployees(), loadLeaves()]);
    await renderCalendar();
    loadTodayLeaves();
    loadUpcomingLeaves();
    
    // Add Escape key listener for closing modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
            const dayModal = document.getElementById('dayDetailsModal');
            
            if (dayModal && dayModal.style.display === 'flex') {
                closeDayModal();
            }
        }
    });
});

async function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    // Update month/year display
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('currentMonthYear').textContent = `${monthNames[month]} ${year}`;
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    // Get leaves for this month
    const leaves = getLeaves().filter(l => !isWorkFromHomeLeave(l));
    const employees = getEmployees();
    
    const calendarGrid = document.getElementById('calendarGrid');
    calendarGrid.innerHTML = '';
    
    // Add previous month's days
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        const dayCell = await createDayCell(day, 'prev-month', year, month - 1, leaves, employees);
        calendarGrid.appendChild(dayCell);
    }
    
    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = await createDayCell(day, 'current-month', year, month, leaves, employees);
        calendarGrid.appendChild(dayCell);
    }
    
    // Add next month's days to fill the grid
    const totalCells = calendarGrid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const dayCell = await createDayCell(day, 'next-month', year, month + 1, leaves, employees);
        calendarGrid.appendChild(dayCell);
    }
}

async function createDayCell(day, monthClass, year, month, leaves, employees) {
    const cell = document.createElement('div');
    cell.className = `calendar-day ${monthClass}`;
    
    // Create cellDate in local time to match leave dates
    const cellDate = new Date(year, month, day, 0, 0, 0, 0);
    cellDate.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate.getTime() === today.getTime() && monthClass === 'current-month') {
        cell.classList.add('today');
    }
    
    // Day number
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);
    
    // Check if this day is a holiday
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (typeof isHoliday === 'function' && await isHoliday(dateStr)) {
        const holiday = await getHolidayByDate(dateStr);
        if (holiday) {
            const holidayBadge = document.createElement('div');
            holidayBadge.className = 'holiday-marker';
            holidayBadge.textContent = '🎉 ' + holiday.name;
            holidayBadge.title = holiday.name;
            cell.appendChild(holidayBadge);
        }
    }
    
    // Find leaves for this day
    const dayLeaves = leaves.filter(leave => {
        const startDate = new Date(leave.startDate + 'T00:00:00');
        const endDate = new Date(leave.endDate + 'T00:00:00');
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        return cellDate >= startDate && cellDate <= endDate;
    });
    
    if (dayLeaves.length > 0) {
        const leavesContainer = document.createElement('div');
        leavesContainer.className = 'day-leaves';
        
        // Show up to 3 leaves, then "+X more"
        const displayLeaves = dayLeaves.slice(0, 3);
        displayLeaves.forEach(leave => {
            const employee = employees.find(e => e.id === leave.employeeId);
            const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
            
            const leaveItem = document.createElement('div');
            leaveItem.className = `leave-item ${leave.status}`;
            leaveItem.textContent = employeeName.split(' ')[0]; // First name only
            leaveItem.title = `${employeeName} - ${leave.leaveType} (${leave.status})`;
            leavesContainer.appendChild(leaveItem);
        });
        
        if (dayLeaves.length > 3) {
            const moreItem = document.createElement('div');
            moreItem.className = 'leave-item more';
            moreItem.textContent = `+${dayLeaves.length - 3} more`;
            leavesContainer.appendChild(moreItem);
        }
        
        cell.appendChild(leavesContainer);
    }
    
    // Click handler to show day details
    if (monthClass === 'current-month') {
        cell.addEventListener('click', () => showDayDetails(cellDate, dayLeaves, employees));
    }
    
    return cell;
}

function showDayDetails(date, dayLeaves, employees) {
    const dateStr = date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    document.getElementById('dayDetailsTitle').textContent = dateStr;
    
    const content = document.getElementById('dayDetailsContent');
    
    if (dayLeaves.length === 0) {
        content.innerHTML = '<p class="no-data">No leaves on this day</p>';
    } else {
        let html = '<div class="day-leave-details">';
        dayLeaves.forEach(leave => {
            const employee = employees.find(e => e.id === leave.employeeId);
            const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
            const dept = employee ? employee.department : 'N/A';
            
            html += `
                <div class="day-leave-card ${leave.status}">
                    <div class="leave-card-header">
                        <div>
                            <h4>${employeeName}</h4>
                            <p>${dept} - ${employee?.position || 'N/A'}</p>
                        </div>
                        <span class="status-badge ${leave.status}">${capitalize(leave.status)}</span>
                    </div>
                    <div class="leave-card-body">
                        <div class="leave-info-item">
                            <i class="fas fa-briefcase"></i>
                            <span>${leave.leaveType}</span>
                        </div>
                        <div class="leave-info-item">
                            <i class="fas fa-calendar"></i>
                            <span>${formatDateShort(leave.startDate)} - ${formatDateShort(leave.endDate)}</span>
                        </div>
                        ${leave.reason ? `
                        <div class="leave-info-item">
                            <i class="fas fa-comment"></i>
                            <span>${leave.reason}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        content.innerHTML = html;
    }
    
    document.getElementById('dayDetailsModal').classList.add('show');
}

function closeDayDetailsModal() {
    document.getElementById('dayDetailsModal').classList.remove('show');
}

async function previousMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    await renderCalendar();
}

async function nextMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    await renderCalendar();
}

async function goToToday() {
    currentCalendarDate = new Date();
    await renderCalendar();
    loadTodayLeaves();
}

function loadTodayLeaves() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const leaves = getLeaves().filter(l => !isWorkFromHomeLeave(l));
    const employees = getEmployees();
    
    const todayLeaves = leaves.filter(leave => {
        const startDate = new Date(leave.startDate + 'T00:00:00');
        const endDate = new Date(leave.endDate + 'T00:00:00');
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        return today >= startDate && today <= endDate && leave.status === 'approved';
    });
    
    const container = document.getElementById('todayLeaveList');
    
    if (todayLeaves.length === 0) {
        container.innerHTML = '<p class="no-data">No employees on leave today</p>';
        return;
    }
    
    container.innerHTML = todayLeaves.map(leave => {
        const employee = employees.find(e => e.id === leave.employeeId);
        const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        const dept = employee?.department || 'N/A';
        
        return `
            <div class="leave-card">
                <div class="leave-card-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="leave-card-info">
                    <h4>${employeeName}</h4>
                    <p>${dept} - ${leave.leaveType}</p>
                </div>
                <div class="leave-card-dates">
                    <small>${formatDateShort(leave.startDate)} - ${formatDateShort(leave.endDate)}</small>
                </div>
            </div>
        `;
    }).join('');
}

function loadUpcomingLeaves() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    
    const leaves = getLeaves().filter(l => !isWorkFromHomeLeave(l));
    const employees = getEmployees();
    
    const upcomingLeaves = leaves.filter(leave => {
        const startDate = new Date(leave.startDate + 'T00:00:00');
        startDate.setHours(0, 0, 0, 0);
        return startDate > today && startDate <= sevenDaysLater && leave.status === 'approved';
    }).sort((a, b) => new Date(a.startDate + 'T00:00:00') - new Date(b.startDate + 'T00:00:00'));
    
    const container = document.getElementById('upcomingLeavesList');
    
    if (upcomingLeaves.length === 0) {
        container.innerHTML = '<p class="no-data">No upcoming leaves</p>';
        return;
    }
    
    container.innerHTML = upcomingLeaves.map(leave => {
        const employee = employees.find(e => e.id === leave.employeeId);
        const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        const dept = employee?.department || 'N/A';
        const days = calculateDays(leave.startDate, leave.endDate);
        
        return `
            <div class="leave-card">
                <div class="leave-card-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="leave-card-info">
                    <h4>${employeeName}</h4>
                    <p>${dept} - ${leave.leaveType}</p>
                </div>
                <div class="leave-card-dates">
                    <strong>${formatDateShort(leave.startDate)}</strong>
                    <small>${days} day${days !== 1 ? 's' : ''}</small>
                </div>
            </div>
        `;
    }).join('');
}

function downloadCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const monthName = currentCalendarDate.toLocaleDateString('en-US', { month: 'long' });
    
    const leaves = getLeaves().filter(l => !isWorkFromHomeLeave(l));
    const employees = getEmployees();
    
    // Filter leaves for current month
    const monthLeaves = leaves.filter(leave => {
        const startDate = new Date(leave.startDate + 'T00:00:00');
        const endDate = new Date(leave.endDate + 'T00:00:00');
        return (startDate.getFullYear() === year && startDate.getMonth() === month) ||
               (endDate.getFullYear() === year && endDate.getMonth() === month);
    });
    
    const calendarData = {
        month: monthName,
        year: year,
        leaves: monthLeaves.map(leave => {
            const employee = employees.find(e => e.id === leave.employeeId);
            return {
                employee: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown',
                department: employee?.department || 'N/A',
                leaveType: leave.leaveType,
                startDate: leave.startDate,
                endDate: leave.endDate,
                status: leave.status,
                reason: leave.reason
            };
        })
    };
    
    const dataStr = JSON.stringify(calendarData, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leave_calendar_${monthName}_${year}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showNotification('Calendar exported successfully!', 'success');
}

// Utility functions
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDateShort(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

function calculateDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('dayDetailsModal');
    if (event.target === modal) {
        closeDayDetailsModal();
    }
}
