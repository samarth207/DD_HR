// Holidays Management Functions
let deleteHolidayId = null;

// LocalStorage Functions for Holidays
function getHolidays() {
    const holidays = localStorage.getItem('hrHolidays');
    return holidays ? JSON.parse(holidays) : [];
}

function saveHolidays(holidays) {
    localStorage.setItem('hrHolidays', JSON.stringify(holidays));
}

// Initialize holidays page elements only if on holidays page
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('holidaysGrid')) {
        loadHolidays();
        updateHolidayStats();
        
        // Add Escape key listener for closing modals
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' || event.key === 'Esc') {
                const holidayModal = document.getElementById('holidayModal');
                const deleteModal = document.getElementById('deleteHolidayModal');
                
                if (holidayModal && holidayModal.style.display === 'flex') {
                    closeHolidayModal();
                }
                if (deleteModal && deleteModal.style.display === 'flex') {
                    closeDeleteHolidayModal();
                }
            }
        });
    }
});

function loadHolidays() {
    const holidays = getHolidays();
    displayHolidays(holidays);
}

function displayHolidays(holidays) {
    const grid = document.getElementById('holidaysGrid');
    
    if (holidays.length === 0) {
        grid.innerHTML = '<p class="no-data" style="grid-column: 1/-1; text-align: center; padding: 40px;">No holidays configured</p>';
        return;
    }
    
    // Sort holidays by date
    const sortedHolidays = holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    grid.innerHTML = sortedHolidays.map(holiday => {
        const date = new Date(holiday.date);
        const isPast = date < new Date();
        const typeClass = holiday.type.toLowerCase().replace(/\s+/g, '-');
        
        return `
            <div class="holiday-card">
                ${holiday.recurring ? '<span class="holiday-recurring-badge"><i class="fas fa-sync-alt"></i> Yearly</span>' : ''}
                <div class="holiday-card-header">
                    <div>
                        <div class="holiday-card-title">
                            <i class="fas ${getHolidayIcon(holiday.type)}"></i>
                            ${holiday.name}
                        </div>
                        <div class="holiday-card-date">
                            <i class="fas fa-calendar"></i>
                            ${formatDateLong(holiday.date)}
                        </div>
                    </div>
                </div>
                <span class="holiday-card-type ${typeClass}">${holiday.type}</span>
                ${holiday.description ? `<p class="holiday-card-description">${holiday.description}</p>` : ''}
                <div class="holiday-card-actions">
                    <button class="icon-btn edit" onclick="editHoliday(${holiday.id})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn delete" onclick="deleteHoliday(${holiday.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function updateHolidayStats() {
    const holidays = getHolidays();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Total holidays
    document.getElementById('totalHolidays').textContent = holidays.length;
    
    // Upcoming this year
    const currentYear = now.getFullYear();
    const upcomingThisYear = holidays.filter(h => {
        const holidayDate = new Date(h.date);
        return holidayDate.getFullYear() === currentYear && holidayDate >= now;
    }).length;
    document.getElementById('upcomingHolidays').textContent = upcomingThisYear;
    
    // Next holiday
    const upcomingHolidays = holidays.filter(h => new Date(h.date) >= now)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (upcomingHolidays.length > 0) {
        const nextHoliday = upcomingHolidays[0];
        const nextDate = new Date(nextHoliday.date);
        const daysUntil = Math.ceil((nextDate - now) / (1000 * 60 * 60 * 24));
        document.getElementById('nextHoliday').textContent = daysUntil === 0 ? 'Today!' : `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
    } else {
        document.getElementById('nextHoliday').textContent = 'None';
    }
}

function openAddHolidayModal() {
    document.getElementById('holidayModalTitle').textContent = 'Add Holiday';
    document.getElementById('holidayForm').reset();
    document.getElementById('holidayId').value = '';
    document.getElementById('recurringYearly').checked = true;
    document.getElementById('holidayModal').classList.add('show');
}

function editHoliday(id) {
    const holidays = getHolidays();
    const holiday = holidays.find(h => h.id === id);
    
    if (!holiday) return;
    
    document.getElementById('holidayModalTitle').textContent = 'Edit Holiday';
    document.getElementById('holidayId').value = holiday.id;
    document.getElementById('holidayName').value = holiday.name;
    document.getElementById('holidayDate').value = holiday.date;
    document.getElementById('holidayType').value = holiday.type;
    document.getElementById('holidayDescription').value = holiday.description || '';
    document.getElementById('recurringYearly').checked = holiday.recurring;
    
    document.getElementById('holidayModal').classList.add('show');
}

function saveHoliday(event) {
    event.preventDefault();
    
    const id = document.getElementById('holidayId').value;
    const holiday = {
        id: id ? parseInt(id) : Date.now(),
        name: document.getElementById('holidayName').value,
        date: document.getElementById('holidayDate').value,
        type: document.getElementById('holidayType').value,
        description: document.getElementById('holidayDescription').value,
        recurring: document.getElementById('recurringYearly').checked
    };
    
    const holidays = getHolidays();
    
    if (id) {
        const index = holidays.findIndex(h => h.id === parseInt(id));
        holidays[index] = holiday;
        addLog('edit', `Updated holiday: ${holiday.name}`);
        showNotification('Holiday updated successfully!', 'success');
    } else {
        holidays.push(holiday);
        addLog('add', `Added holiday: ${holiday.name}`);
        showNotification('Holiday added successfully!', 'success');
    }
    
    saveHolidays(holidays);
    loadHolidays();
    updateHolidayStats();
    closeHolidayModal();
}

function deleteHoliday(id) {
    deleteHolidayId = id;
    document.getElementById('deleteHolidayModal').classList.add('show');
}

function confirmDeleteHoliday() {
    if (!deleteHolidayId) return;
    
    const holidays = getHolidays();
    const holiday = holidays.find(h => h.id === deleteHolidayId);
    const filtered = holidays.filter(h => h.id !== deleteHolidayId);
    
    saveHolidays(filtered);
    addLog('delete', `Deleted holiday: ${holiday.name}`);
    showNotification('Holiday deleted successfully!', 'success');
    
    loadHolidays();
    updateHolidayStats();
    closeDeleteHolidayModal();
}

function closeHolidayModal() {
    document.getElementById('holidayModal').classList.remove('show');
}

function closeDeleteHolidayModal() {
    document.getElementById('deleteHolidayModal').classList.remove('show');
    deleteHolidayId = null;
}

// Check if a date is a holiday
function isHoliday(dateString) {
    const holidays = getHolidays();
    const checkDate = new Date(dateString + 'T00:00:00');
    checkDate.setHours(0, 0, 0, 0);
    
    return holidays.some(holiday => {
        const holidayDate = new Date(holiday.date + 'T00:00:00');
        holidayDate.setHours(0, 0, 0, 0);
        return holidayDate.getTime() === checkDate.getTime();
    });
}

// Get holiday for a specific date
function getHolidayByDate(dateString) {
    const holidays = getHolidays();
    const checkDate = new Date(dateString + 'T00:00:00');
    checkDate.setHours(0, 0, 0, 0);
    
    return holidays.find(holiday => {
        const holidayDate = new Date(holiday.date + 'T00:00:00');
        holidayDate.setHours(0, 0, 0, 0);
        return holidayDate.getTime() === checkDate.getTime();
    });
}

// Utility Functions
function getHolidayIcon(type) {
    const icons = {
        'Public Holiday': 'fa-calendar-day',
        'Religious': 'fa-pray',
        'National': 'fa-flag',
        'Festival': 'fa-star',
        'Company': 'fa-building'
    };
    return icons[type] || 'fa-gift';
}

function formatDateLong(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Export functions for use in other pages
window.getHolidays = getHolidays;
window.isHoliday = isHoliday;
window.getHolidayByDate = getHolidayByDate;

// Close modal when clicking outside
window.onclick = function(event) {
    const holidayModal = document.getElementById('holidayModal');
    const deleteModal = document.getElementById('deleteHolidayModal');
    
    if (event.target === holidayModal) {
        closeHolidayModal();
    }
    if (event.target === deleteModal) {
        closeDeleteHolidayModal();
    }
}
