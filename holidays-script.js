// Holidays Management Functions
let deleteHolidayId = null;
let cachedHolidays = null;

// API Functions for Holidays
async function getHolidays() {
    if (cachedHolidays) return cachedHolidays;
    try {
        const response = await fetch(`${API_BASE_URL}/holidays`);
        if (!response.ok) throw new Error('Failed to fetch holidays');
        const holidays = await response.json();
        cachedHolidays = holidays;
        return holidays;
    } catch (error) {
        console.error('Error fetching holidays:', error);
        return [];
    }
}

async function saveHolidays(holidays) {
    cachedHolidays = holidays;
    try {
        // Save each holiday individually
        for (const holiday of holidays) {
            if (holiday._id) {
                await fetch(`${API_BASE_URL}/holidays/${holiday.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(holiday)
                });
            } else {
                await fetch(`${API_BASE_URL}/holidays`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(holiday)
                });
            }
        }
    } catch (error) {
        console.error('Error saving holidays:', error);
        throw error;
    }
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

async function loadHolidays() {
    const holidays = await getHolidays();
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

async function updateHolidayStats() {
    const holidays = await getHolidays();
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

async function editHoliday(id) {
    const holidays = await getHolidays();
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

async function saveHoliday(event) {
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
    
    try {
        if (id) {
            await fetch(`${API_BASE_URL}/holidays/${holiday.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(holiday)
            });
            addLog('edit', `Updated holiday: ${holiday.name}`);
            showNotification('Holiday updated successfully!', 'success');
        } else {
            await fetch(`${API_BASE_URL}/holidays`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(holiday)
            });
            addLog('add', `Added holiday: ${holiday.name}`);
            showNotification('Holiday added successfully!', 'success');
        }
    } catch (error) {
        showNotification('Failed to save holiday. Please try again.', 'error');
        return;
    }
    
    cachedHolidays = null;
    await loadHolidays();
    await updateHolidayStats();
    closeHolidayModal();
}

function deleteHoliday(id) {
    deleteHolidayId = id;
    document.getElementById('deleteHolidayModal').classList.add('show');
}

async function confirmDeleteHoliday() {
    if (!deleteHolidayId) return;
    
    const holidays = await getHolidays();
    const holiday = holidays.find(h => h.id === deleteHolidayId);
    
    try {
        const response = await fetch(`${API_BASE_URL}/holidays/${deleteHolidayId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Delete failed');
    } catch (error) {
        showNotification('Failed to delete holiday. Please try again.', 'error');
        return;
    }
    
    addLog('delete', `Deleted holiday: ${holiday?.name}`);
    showNotification('Holiday deleted successfully!', 'success');
    
    cachedHolidays = null;
    await loadHolidays();
    await updateHolidayStats();
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
async function isHoliday(dateString) {
    const holidays = await getHolidays();
    const checkDate = new Date(dateString + 'T00:00:00');
    checkDate.setHours(0, 0, 0, 0);
    
    return holidays.some(holiday => {
        const holidayDate = new Date(holiday.date + 'T00:00:00');
        holidayDate.setHours(0, 0, 0, 0);
        return holidayDate.getTime() === checkDate.getTime();
    });
}

// Get holiday for a specific date
async function getHolidayByDate(dateString) {
    const holidays = await getHolidays();
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
