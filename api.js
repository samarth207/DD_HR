// API Configuration loaded from config.js

// Helper function for API calls
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        
        if (!response.ok) {
            const error = await response.json();
            const err = new Error(error.error || 'API request failed');
            // Preserve all fields from the error response (e.g. probation: true)
            Object.assign(err, error);
            throw err;
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showNotification('Error: ' + error.message, 'error');
        throw error;
    }
}

// Employees API
async function getEmployeesFromDB() {
    return await apiCall('/employees');
}

async function saveEmployeeToDB(employee) {
    if (employee._id) {
        // Update existing
        await apiCall(`/employees/${employee.id}`, 'PUT', employee);
    } else {
        // Create new
        await apiCall('/employees', 'POST', employee);
    }
}

async function deleteEmployeeFromDB(employeeId) {
    await apiCall(`/employees/${employeeId}`, 'DELETE');
}

// Leaves API
async function getLeavesFromDB() {
    return await apiCall('/leaves');
}

async function saveLeaveToDTO(leave) {
    if (leave._id) {
        await apiCall(`/leaves/${leave.id}`, 'PUT', leave);
    } else {
        await apiCall('/leaves', 'POST', leave);
    }
}

async function deleteLeaveFromDB(leaveId) {
    await apiCall(`/leaves/${leaveId}`, 'DELETE');
}

// Holidays API
async function getHolidaysFromDB() {
    return await apiCall('/holidays');
}

async function saveHolidayToDB(holiday) {
    if (holiday._id) {
        await apiCall(`/holidays/${holiday.id}`, 'PUT', holiday);
    } else {
        await apiCall('/holidays', 'POST', holiday);
    }
}

async function deleteHolidayFromDB(holidayId) {
    await apiCall(`/holidays/${holidayId}`, 'DELETE');
}

// Sales API
async function getSalesDataFromDB() {
    return await apiCall('/sales');
}

async function saveSalesDataToDB(month, employeeId, data) {
    await apiCall('/sales', 'POST', { month, employeeId, data });
}

// Incentives API
async function getIncentiveConfigFromDB() {
    return await apiCall('/incentives/config');
}

async function saveIncentiveConfigToDB(config) {
    await apiCall('/incentives/config', 'POST', config);
}

async function getIncentiveDataFromDB() {
    return await apiCall('/incentives/data');
}

async function saveMonthlyIncentiveToDB(key, data) {
    await apiCall('/incentives/monthly', 'POST', { key, data });
}

async function saveDailyBonusToDB(bonus) {
    await apiCall('/incentives/daily', 'POST', bonus);
}

async function saveSalaryAdvanceToDB(advance) {
    await apiCall('/incentives/advance', 'POST', advance);
}

async function updateSalaryAdvanceInDB(advanceId, data) {
    await apiCall(`/incentives/advance/${advanceId}`, 'PUT', data);
}

async function saveSalaryPaymentToDB(key, data) {
    await apiCall('/incentives/salary-payment', 'POST', { key, data });
}

// Logs API
async function getLogsFromDB() {
    return await apiCall('/logs');
}

async function addLogToDB(type, action) {
    const log = {
        type,
        action,
        timestamp: new Date().toISOString()
    };
    await apiCall('/logs', 'POST', log);
}

async function clearLogsInDB() {
    await apiCall('/logs', 'DELETE');
}

// Account API
async function getAccountFromDB() {
    return await apiCall('/account');
}

async function saveAccountToDB(account) {
    await apiCall('/account', 'PUT', account);
}

// Check if server is running
async function checkServerConnection() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Initialize: Check server connection on page load
document.addEventListener('DOMContentLoaded', async function() {
    const isConnected = await checkServerConnection();
    if (!isConnected) {
        showNotification('Warning: Unable to connect to database server. Please start the server.', 'error');
        console.error('Database server is not running. Start it with: cd server && npm install && npm start');
    }
});
