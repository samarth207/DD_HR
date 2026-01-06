// API Configuration
const API_BASE_URL = 'http://localhost:3000/api';
let cachedEmployees = null;
let cachedLeaves = null;
let cachedLogs = null;

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
            throw new Error(error.error || 'API request failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        // Fallback to localStorage if API fails
        console.warn('Falling back to localStorage');
        return null;
    }
}

// Database Functions (with localStorage fallback)
function getEmployees() {
    // Return cached data immediately, then fetch from DB
    if (cachedEmployees) {
        return cachedEmployees;
    }
    
    // Fallback to localStorage for immediate return
    const localData = localStorage.getItem('hrEmployees');
    return localData ? JSON.parse(localData) : [];
}

async function loadEmployees() {
    try {
        const employees = await apiCall('/employees');
        if (employees) {
            cachedEmployees = employees;
            return employees;
        }
    } catch (error) {
        console.error('Failed to load employees from DB');
    }
    return getEmployees();
}

function saveEmployees(employees) {
    cachedEmployees = employees;
    // Save to both localStorage (backup) and DB
    localStorage.setItem('hrEmployees', JSON.stringify(employees));
}

async function saveEmployeeToDB(employee) {
    try {
        if (employee._id) {
            await apiCall(`/employees/${employee.id}`, 'PUT', employee);
        } else {
            await apiCall('/employees', 'POST', employee);
        }
        await loadEmployees(); // Refresh cache
    } catch (error) {
        console.error('Failed to save employee to DB');
    }
}

function getLeaves() {
    if (cachedLeaves) {
        return cachedLeaves;
    }
    const localData = localStorage.getItem('hrLeaves');
    return localData ? JSON.parse(localData) : [];
}

async function loadLeaves() {
    try {
        const leaves = await apiCall('/leaves');
        if (leaves) {
            cachedLeaves = leaves;
            return leaves;
        }
    } catch (error) {
        console.error('Failed to load leaves from DB');
    }
    return getLeaves();
}

function saveLeaves(leaves) {
    cachedLeaves = leaves;
    localStorage.setItem('hrLeaves', JSON.stringify(leaves));
}

function getLogs() {
    if (cachedLogs) {
        return cachedLogs;
    }
    const localData = localStorage.getItem('hrLogs');
    return localData ? JSON.parse(localData) : [];
}

async function loadLogs() {
    try {
        const logs = await apiCall('/logs');
        if (logs) {
            cachedLogs = logs;
            return logs;
        }
    } catch (error) {
        console.error('Failed to load logs from DB');
    }
    return getLogs();
}

function saveLogs(logs) {
    cachedLogs = logs;
    localStorage.setItem('hrLogs', JSON.stringify(logs));
}

function addLog(type, action) {
    const log = {
        type: type,
        action: action,
        timestamp: new Date().toISOString()
    };
    
    // Add to API
    apiCall('/logs', 'POST', log).catch(error => {
        console.error('Failed to save log to DB');
    });
    
    // Also update cache
    const logs = getLogs();
    logs.push(log);
    saveLogs(logs);
}

// Check server connection on load
async function checkServerConnection() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
            console.log('✅ Connected to MongoDB server');
            // Load initial data from DB
            await Promise.all([loadEmployees(), loadLeaves(), loadLogs()]);
            return true;
        }
    } catch (error) {
        console.warn('⚠️ MongoDB server not running, using localStorage fallback');
    }
    return false;
}

// Initialize connection
checkServerConnection();

// Date Formatting
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

// Notification System
function showNotification(message, type = 'success') {
    // Remove existing notification if any
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    notification.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Export functions for use in HTML files
window.getEmployees = getEmployees;
window.saveEmployees = saveEmployees;
window.loadEmployees = loadEmployees;
window.saveEmployeeToDB = saveEmployeeToDB;
window.getLeaves = getLeaves;
window.saveLeaves = saveLeaves;
window.loadLeaves = loadLeaves;
window.getLogs = getLogs;
window.saveLogs = saveLogs;
window.loadLogs = loadLogs;
window.addLog = addLog;
window.formatDate = formatDate;
window.showNotification = showNotification;
window.processMonthlyLeaveAccrual = processMonthlyLeaveAccrual;
window.checkServerConnection = checkServerConnection;

// Monthly Leave Accrual System
function getLastAccrualDate() {
    const date = localStorage.getItem('hrLastAccrualDate');
    return date ? new Date(date) : null;
}

function setLastAccrualDate(date) {
    localStorage.setItem('hrLastAccrualDate', date.toISOString());
}

function processMonthlyLeaveAccrual() {
    const lastAccrual = getLastAccrualDate();
    const now = new Date();
    
    // If first time or it's a new month since last accrual
    if (!lastAccrual || (now.getFullYear() > lastAccrual.getFullYear() || 
        (now.getFullYear() === lastAccrual.getFullYear() && now.getMonth() > lastAccrual.getMonth()))) {
        
        const employees = getEmployees();
        let accrualApplied = false;
        
        employees.forEach(employee => {
            if (!employee.leaveBalance) {
                employee.leaveBalance = {
                    annualLeave: 20,
                    sickLeave: 10,
                    personalLeave: 5
                };
            }
            
            // Add 1 day to each leave type
            employee.leaveBalance.annualLeave += 1;
            employee.leaveBalance.sickLeave += 1;
            employee.leaveBalance.personalLeave += 1;
            
            accrualApplied = true;
        });
        
        if (accrualApplied) {
            saveEmployees(employees);
            setLastAccrualDate(now);
            addLog('system', `Monthly leave accrual applied: +1 day to all leave types for all employees`);
        }
    }
}

// Run accrual check on page load
processMonthlyLeaveAccrual();
