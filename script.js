// API Configuration loaded from config.js
let cachedEmployees = null;
let cachedLeaves = null;
let cachedLogs = null;

// Format number in Indian numbering system (lakhs, crores)
function formatIndianNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    const number = parseFloat(num);
    return number.toLocaleString('en-IN');
}

// Format currency in Indian Rupees
function formatRupees(num) {
    if (num === null || num === undefined || isNaN(num)) return '₹0';
    const number = parseFloat(num);
    return '₹' + number.toLocaleString('en-IN');
}

// Format currency input field with Indian formatting (for text inputs)
function formatCurrencyInput(input) {
    // Remove all non-numeric characters except decimal point
    let value = input.value.replace(/[^0-9.]/g, '');
    
    // Handle multiple decimal points
    const parts = value.split('.');
    if (parts.length > 2) {
        value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Store raw value
    const rawValue = value;
    input.dataset.rawValue = rawValue;
    
    // Format for display
    if (value) {
        const numParts = value.split('.');
        const integerPart = parseInt(numParts[0]) || 0;
        const decimalPart = numParts.length > 1 ? '.' + numParts[1] : '';
        input.value = '₹' + integerPart.toLocaleString('en-IN') + decimalPart;
    }
}

// Get raw value from formatted currency input
function getRawCurrencyValue(input) {
    return parseFloat(input.dataset.rawValue || input.value.replace(/[^0-9.]/g, '')) || 0;
}

// Format number input field with Indian formatting (without ₹ symbol)
function formatNumberInput(input) {
    // Remove all non-numeric characters except decimal point
    let value = input.value.replace(/[^0-9.]/g, '');
    
    // Handle multiple decimal points
    const parts = value.split('.');
    if (parts.length > 2) {
        value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Store raw value
    input.dataset.rawValue = value;
    
    // Format for display
    if (value) {
        const numParts = value.split('.');
        const integerPart = parseInt(numParts[0]) || 0;
        const decimalPart = numParts.length > 1 ? '.' + numParts[1] : '';
        input.value = integerPart.toLocaleString('en-IN') + decimalPart;
    }
}

// Get raw value from formatted number input
function getRawNumberValue(input) {
    return parseFloat(input.dataset.rawValue || input.value.replace(/[^0-9.]/g, '')) || 0;
}

// Initialize currency formatting for an input element
function initCurrencyInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Change to text type to allow formatting
    input.type = 'text';
    input.inputMode = 'numeric';
    
    // Format on input
    input.addEventListener('input', () => formatCurrencyInput(input));
    
    // Format on blur (ensure proper formatting)
    input.addEventListener('blur', () => {
        if (input.value && !input.value.startsWith('₹')) {
            formatCurrencyInput(input);
        }
    });
    
    // Format initial value if present
    if (input.value && !isNaN(parseFloat(input.value))) {
        const val = input.value;
        input.value = val;
        formatCurrencyInput(input);
    }
}

// Initialize number formatting for an input element (without ₹)
function initNumberInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Change to text type to allow formatting
    input.type = 'text';
    input.inputMode = 'numeric';
    
    // Format on input
    input.addEventListener('input', () => formatNumberInput(input));
    
    // Format initial value if present
    if (input.value && !isNaN(parseFloat(input.value))) {
        const val = input.value;
        input.value = val;
        formatNumberInput(input);
    }
}

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
        throw error;
    }
}

// Database Functions (MongoDB only)
function getEmployees() {
    // Return cached data if available
    return cachedEmployees || [];
}

async function loadEmployees() {
    try {
        const employees = await apiCall('/employees');
        if (employees && Array.isArray(employees)) {
            cachedEmployees = employees;
            return employees;
        }
        return [];
    } catch (error) {
        console.error('Failed to load employees from DB:', error);
        return cachedEmployees || [];
    }
}

function saveEmployees(employees) {
    cachedEmployees = employees;
}

async function saveEmployeeToDB(employee) {
    try {
        if (employee.id && employee._id) {
            // Update existing employee
            await apiCall(`/employees/${employee.id}`, 'PUT', employee);
        } else {
            // Create new employee
            await apiCall('/employees', 'POST', employee);
        }
        await loadEmployees(); // Refresh cache
    } catch (error) {
        console.error('Failed to save employee to DB:', error);
        throw error;
    }
}

function getLeaves() {
    return cachedLeaves || [];
}

async function loadLeaves() {
    try {
        const leaves = await apiCall('/leaves');
        if (leaves && Array.isArray(leaves)) {
            cachedLeaves = leaves;
            return leaves;
        }
        return [];
    } catch (error) {
        console.error('Failed to load leaves from DB:', error);
        return cachedLeaves || [];
    }
}

function saveLeaves(leaves) {
    cachedLeaves = leaves;
}

function getLogs() {
    return cachedLogs || [];
}

async function loadLogs() {
    try {
        const logs = await apiCall('/logs');
        if (logs && Array.isArray(logs)) {
            cachedLogs = logs;
            return logs;
        }
        return [];
    } catch (error) {
        console.error('Failed to load logs from DB:', error);
        return cachedLogs || [];
    }
}

function saveLogs(logs) {
    cachedLogs = logs;
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
        console.error('⚠️ MongoDB server not running. Please start the server.');
        alert('Cannot connect to server. Please ensure the backend server is running.');
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

// Monthly Leave Accrual System (MongoDB-based)
async function processMonthlyLeaveAccrual() {
    try {
        // This would be handled by backend cron job or manual trigger
        // For now, this is a placeholder for future implementation
        console.log('Leave accrual should be processed on the backend');
    } catch (error) {
        console.error('Failed to process leave accrual:', error);
    }
}

// Run accrual check on page load
processMonthlyLeaveAccrual();
