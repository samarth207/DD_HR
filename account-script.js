// Account Management Functions

// Initialize account page
document.addEventListener('DOMContentLoaded', function() {
    loadAccountDetails();
    updateSystemInfo();
    updateLastLogin();
    
    // Add Escape key listener for closing modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
            const personalModal = document.getElementById('editPersonalModal');
            const passwordModal = document.getElementById('changePasswordModal');
            const clearModal = document.getElementById('clearDataModal');
            
            if (personalModal && personalModal.style.display === 'flex') {
                closeEditPersonalModal();
            }
            if (passwordModal && passwordModal.style.display === 'flex') {
                closePasswordModal();
            }
            if (clearModal && clearModal.style.display === 'flex') {
                closeClearDataModal();
            }
        }
    });
});

function loadAccountDetails() {
    const accountData = getAccountData();
    
    document.getElementById('profileName').textContent = accountData.name;
    document.getElementById('profileRole').textContent = accountData.role;
    document.getElementById('accountName').textContent = accountData.name;
    document.getElementById('accountEmail').textContent = accountData.email;
    document.getElementById('accountPhone').textContent = accountData.phone;
    document.getElementById('accountDepartment').textContent = accountData.department;
    document.getElementById('accountPosition').textContent = accountData.position;
    document.getElementById('accountEmployeeId').textContent = accountData.employeeId;
    
    // Load settings
    document.getElementById('twoFactorToggle').checked = accountData.twoFactorEnabled || false;
    document.getElementById('emailNotifToggle').checked = accountData.emailNotifications !== false;
}

function getAccountData() {
    const defaultData = {
        name: 'HR Administrator',
        role: 'System Administrator',
        email: 'hr.admin@company.com',
        phone: '(555) 000-0000',
        department: 'Human Resources',
        position: 'HR Manager',
        employeeId: 'HR-001',
        twoFactorEnabled: false,
        emailNotifications: true,
        memberSince: '2024-01-01'
    };
    
    const saved = localStorage.getItem('hrAccount');
    return saved ? JSON.parse(saved) : defaultData;
}

function saveAccountData(data) {
    localStorage.setItem('hrAccount', JSON.stringify(data));
}

function updateSystemInfo() {
    const employees = getEmployees();
    const leaves = getLeaves();
    const logs = getLogs();
    
    document.getElementById('totalEmployeesCount').textContent = employees.length;
    document.getElementById('totalLeavesCount').textContent = leaves.length;
    document.getElementById('totalLogsCount').textContent = logs.length;
    
    // Calculate storage size
    const storageSize = calculateStorageSize();
    document.getElementById('dataStorage').textContent = storageSize;
}

function calculateStorageSize() {
    let total = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            total += localStorage[key].length + key.length;
        }
    }
    const kb = (total / 1024).toFixed(2);
    return `${kb} KB`;
}

function updateLastLogin() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    document.getElementById('lastLoginTime').textContent = `Today at ${timeString}`;
}

function editPersonalInfo() {
    const accountData = getAccountData();
    
    document.getElementById('editName').value = accountData.name;
    document.getElementById('editEmail').value = accountData.email;
    document.getElementById('editPhone').value = accountData.phone;
    document.getElementById('editDepartment').value = accountData.department;
    document.getElementById('editPosition').value = accountData.position;
    
    document.getElementById('editPersonalModal').classList.add('show');
}

function savePersonalInfo(event) {
    event.preventDefault();
    
    const accountData = getAccountData();
    accountData.name = document.getElementById('editName').value;
    accountData.email = document.getElementById('editEmail').value;
    accountData.phone = document.getElementById('editPhone').value;
    accountData.department = document.getElementById('editDepartment').value;
    accountData.position = document.getElementById('editPosition').value;
    
    saveAccountData(accountData);
    loadAccountDetails();
    closeEditPersonalModal();
    
    addLog('edit', 'Updated account personal information');
    showNotification('Personal information updated successfully!', 'success');
}

function changePassword() {
    document.getElementById('changePasswordModal').classList.add('show');
}

function savePassword(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (newPassword !== confirmPassword) {
        showNotification('Passwords do not match!', 'error');
        return;
    }
    
    if (newPassword.length < 8) {
        showNotification('Password must be at least 8 characters!', 'error');
        return;
    }
    
    // In a real application, you would verify the current password and update it securely
    addLog('edit', 'Changed account password');
    showNotification('Password updated successfully!', 'success');
    closePasswordModal();
    document.getElementById('passwordForm').reset();
}

function toggleTwoFactor() {
    const enabled = document.getElementById('twoFactorToggle').checked;
    const accountData = getAccountData();
    accountData.twoFactorEnabled = enabled;
    saveAccountData(accountData);
    
    const status = enabled ? 'enabled' : 'disabled';
    addLog('edit', `Two-factor authentication ${status}`);
    showNotification(`Two-factor authentication ${status}!`, 'success');
}

function toggleEmailNotif() {
    const enabled = document.getElementById('emailNotifToggle').checked;
    const accountData = getAccountData();
    accountData.emailNotifications = enabled;
    saveAccountData(accountData);
    
    const status = enabled ? 'enabled' : 'disabled';
    addLog('edit', `Email notifications ${status}`);
    showNotification(`Email notifications ${status}!`, 'success');
}

function clearAllData() {
    document.getElementById('clearDataModal').classList.add('show');
}

function confirmClearAllData() {
    const confirmText = document.getElementById('confirmDeleteText').value;
    
    if (confirmText !== 'DELETE') {
        showNotification('Please type DELETE to confirm', 'error');
        return;
    }
    
    // Clear all data
    localStorage.removeItem('hrEmployees');
    localStorage.removeItem('hrLeaves');
    localStorage.removeItem('hrLogs');
    
    addLog('delete', 'Cleared all system data');
    
    closeClearDataModal();
    showNotification('All data cleared successfully!', 'success');
    
    setTimeout(() => {
        updateSystemInfo();
    }, 500);
}

function exportAllData() {
    const allData = {
        employees: getEmployees(),
        leaves: getLeaves(),
        logs: getLogs(),
        account: getAccountData(),
        exportDate: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hr_portal_backup_' + new Date().toISOString().split('T')[0] + '.json';
    link.click();
    URL.revokeObjectURL(url);
    
    addLog('export', 'Exported complete system backup');
    showNotification('System data exported successfully!', 'success');
}

function closeEditPersonalModal() {
    document.getElementById('editPersonalModal').classList.remove('show');
}

function closePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('show');
}

function closeClearDataModal() {
    document.getElementById('clearDataModal').classList.remove('show');
    document.getElementById('confirmDeleteText').value = '';
}

// Close modals when clicking outside
window.onclick = function(event) {
    const editModal = document.getElementById('editPersonalModal');
    const passwordModal = document.getElementById('changePasswordModal');
    const clearModal = document.getElementById('clearDataModal');
    
    if (event.target === editModal) {
        closeEditPersonalModal();
    }
    if (event.target === passwordModal) {
        closePasswordModal();
    }
    if (event.target === clearModal) {
        closeClearDataModal();
    }
}
