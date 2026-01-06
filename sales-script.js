// API Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// Sales Data Management Functions
let cachedSalesData = null;

async function getSalesData() {
    try {
        const response = await fetch(`${API_BASE_URL}/sales`);
        if (!response.ok) throw new Error('Failed to fetch sales data');
        const data = await response.json();
        cachedSalesData = data;
        return data;
    } catch (error) {
        console.error('Error fetching sales data:', error);
        // Fallback to localStorage if server is unavailable
        const localData = localStorage.getItem('hrSalesData');
        return localData ? JSON.parse(localData) : {};
    }
}

async function saveSalesData(data) {
    try {
        // Save each employee's sales data individually
        const savePromises = [];
        
        for (const month in data) {
            for (const employeeId in data[month]) {
                const payload = {
                    month: month,
                    employeeId: parseInt(employeeId),
                    data: data[month][employeeId]
                };
                
                const promise = fetch(`${API_BASE_URL}/sales`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                
                savePromises.push(promise);
            }
        }
        
        await Promise.all(savePromises);
        
        cachedSalesData = data;
        // Also save to localStorage as backup
        localStorage.setItem('hrSalesData', JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Error saving sales data:', error);
        // Fallback to localStorage if server is unavailable
        localStorage.setItem('hrSalesData', JSON.stringify(data));
        return false;
    }
}

// Get current month key (e.g., "2026-01")
function getCurrentMonthKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Format month for display
function formatMonth(monthKey) {
    const [year, month] = monthKey.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

// Initialize month selector
function initializeMonthSelector() {
    const select = document.getElementById('monthSelect');
    const currentDate = new Date();
    
    // Generate last 12 months and next 3 months
    for (let i = -12; i <= 3; i++) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = formatMonth(monthKey);
        
        if (monthKey === getCurrentMonthKey()) {
            option.selected = true;
        }
        
        select.appendChild(option);
    }
}

// Get sales employees
async function getSalesEmployees() {
    // Make sure we load fresh data from MongoDB
    const employees = await loadEmployees();
    return employees.filter(emp => emp.department === 'Sales' && emp.status === 'Active');
}

// Load sales data for selected month
async function loadSalesData() {
    const monthSelect = document.getElementById('monthSelect');
    const selectedMonth = monthSelect.value;
    const salesData = await getSalesData();
    const monthData = salesData[selectedMonth] || {};
    
    const salesEmployees = await getSalesEmployees();
    
    if (salesEmployees.length === 0) {
        document.getElementById('salesTeamContainer').innerHTML = `
            <div class="no-sales-members">
                <i class="fas fa-user-tie"></i>
                <h3>No Active Sales Team Members</h3>
                <p>Add employees to the Sales department to start tracking their performance.</p>
            </div>
        `;
        updateOverallStats([], {});
        return;
    }
    
    // Calculate overall stats
    let totalSalesTarget = 0;
    let totalSalesAchieved = 0;
    let totalRevenueTarget = 0;
    let totalRevenueAchieved = 0;
    
    // Render sales team members
    const container = document.getElementById('salesTeamContainer');
    container.innerHTML = '';
    
    salesEmployees.forEach(employee => {
        const empData = monthData[employee.id] || {
            salesTarget: 0,
            revenueTarget: 0,
            salesAchieved: 0,
            revenueAchieved: 0
        };
        
        totalSalesTarget += empData.salesTarget || 0;
        totalSalesAchieved += empData.salesAchieved || 0;
        totalRevenueTarget += empData.revenueTarget || 0;
        totalRevenueAchieved += empData.revenueAchieved || 0;
        
        const salesPercentage = empData.salesTarget > 0 ? 
            Math.round((empData.salesAchieved / empData.salesTarget) * 100) : 0;
        const revenuePercentage = empData.revenueTarget > 0 ? 
            Math.round((empData.revenueAchieved / empData.revenueTarget) * 100) : 0;
        
        const salesProgressClass = salesPercentage >= 100 ? 'high' : salesPercentage >= 50 ? '' : 'low';
        const revenueProgressClass = revenuePercentage >= 100 ? 'high' : revenuePercentage >= 50 ? '' : 'low';
        
        const card = document.createElement('div');
        card.className = 'sales-member-card';
        card.innerHTML = `
            <div class="sales-member-header">
                <div class="member-info">
                    <h3>${employee.firstName} ${employee.lastName}</h3>
                    <p>${employee.position}</p>
                </div>
                <div class="member-actions">
                    <button class="btn-icon primary" onclick="openTargetModal(${employee.id}, '${selectedMonth}')">
                        <i class="fas fa-bullseye"></i> Set Target
                    </button>
                    <button class="btn-icon success" onclick="openSalesModal(${employee.id}, '${selectedMonth}')">
                        <i class="fas fa-plus"></i> Record Sales
                    </button>
                </div>
            </div>
            
            <div class="sales-stats">
                <div class="stat-box">
                    <label>Sales Achieved</label>
                    <div class="value">${empData.salesAchieved || 0}</div>
                    <div class="target">Target: ${empData.salesTarget || 0} sales</div>
                    <div class="progress-bar-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${salesProgressClass}" style="width: ${Math.min(salesPercentage, 100)}%"></div>
                        </div>
                    </div>
                </div>
                
                <div class="stat-box">
                    <label>Revenue Achieved</label>
                    <div class="value">$${(empData.revenueAchieved || 0).toLocaleString()}</div>
                    <div class="target">Target: $${(empData.revenueTarget || 0).toLocaleString()}</div>
                    <div class="progress-bar-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${revenueProgressClass}" style="width: ${Math.min(revenuePercentage, 100)}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    // Update overall stats
    updateOverallStats({
        totalSalesTarget,
        totalSalesAchieved,
        totalRevenueTarget,
        totalRevenueAchieved
    });
}

// Update overall statistics
function updateOverallStats(stats) {
    document.getElementById('totalRevenueTarget').textContent = `$${stats.totalRevenueTarget?.toLocaleString() || 0}`;
    document.getElementById('totalRevenueAchieved').textContent = `$${stats.totalRevenueAchieved?.toLocaleString() || 0}`;
    document.getElementById('totalSalesTarget').textContent = stats.totalSalesTarget || 0;
    document.getElementById('totalSalesAchieved').textContent = stats.totalSalesAchieved || 0;
    
    const revenuePercentage = stats.totalRevenueTarget > 0 ? 
        Math.round((stats.totalRevenueAchieved / stats.totalRevenueTarget) * 100) : 0;
    const salesPercentage = stats.totalSalesTarget > 0 ? 
        Math.round((stats.totalSalesAchieved / stats.totalSalesTarget) * 100) : 0;
    
    document.getElementById('revenuePercentage').textContent = `${revenuePercentage}% of target`;
    document.getElementById('salesPercentage').textContent = `${salesPercentage}% of target`;
}

// Open target modal
async function openTargetModal(employeeId, month) {
    const employees = await loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    if (!employee) return;
    
    const salesData = await getSalesData();
    const monthData = salesData[month] || {};
    const empData = monthData[employeeId] || {};
    
    document.getElementById('targetEmployeeName').value = `${employee.firstName} ${employee.lastName}`;
    document.getElementById('targetEmployeeId').value = employeeId;
    document.getElementById('targetMonth').value = month;
    document.getElementById('salesTarget').value = empData.salesTarget || '';
    document.getElementById('revenueTarget').value = empData.revenueTarget || '';
    
    document.getElementById('targetModal').style.display = 'flex';
}

// Close target modal
function closeTargetModal() {
    document.getElementById('targetModal').style.display = 'none';
    document.getElementById('targetForm').reset();
}

// Save target
async function saveTarget(event) {
    event.preventDefault();
    
    const employeeId = parseInt(document.getElementById('targetEmployeeId').value);
    const month = document.getElementById('targetMonth').value;
    const salesTarget = parseInt(document.getElementById('salesTarget').value);
    const revenueTarget = parseFloat(document.getElementById('revenueTarget').value);
    
    const salesData = await getSalesData();
    
    if (!salesData[month]) {
        salesData[month] = {};
    }
    
    if (!salesData[month][employeeId]) {
        salesData[month][employeeId] = {
            salesAchieved: 0,
            revenueAchieved: 0
        };
    }
    
    salesData[month][employeeId].salesTarget = salesTarget;
    salesData[month][employeeId].revenueTarget = revenueTarget;
    
    await saveSalesData(salesData);
    
    const employees = await loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    addLog('sales', `Set sales target for ${employee.firstName} ${employee.lastName} - ${formatMonth(month)}: ${salesTarget} sales, $${revenueTarget.toLocaleString()} revenue`);
    
    showNotification('Sales target set successfully!', 'success');
    closeTargetModal();
    await loadSalesData();
}

// Open sales modal
async function openSalesModal(employeeId, month) {
    const employees = await loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    if (!employee) return;
    
    document.getElementById('salesEmployeeName').value = `${employee.firstName} ${employee.lastName}`;
    document.getElementById('salesEmployeeId').value = employeeId;
    document.getElementById('salesMonth').value = month;
    document.getElementById('salesCount').value = '';
    document.getElementById('revenueAmount').value = '';
    document.getElementById('salesNotes').value = '';
    
    document.getElementById('salesModal').style.display = 'flex';
}

// Close sales modal
function closeSalesModal() {
    document.getElementById('salesModal').style.display = 'none';
    document.getElementById('salesForm').reset();
}

// Record sales
async function recordSales(event) {
    event.preventDefault();
    
    const employeeId = parseInt(document.getElementById('salesEmployeeId').value);
    const month = document.getElementById('salesMonth').value;
    const salesCount = parseInt(document.getElementById('salesCount').value);
    const revenueAmount = parseFloat(document.getElementById('revenueAmount').value);
    const notes = document.getElementById('salesNotes').value;
    
    const salesData = await getSalesData();
    
    if (!salesData[month]) {
        salesData[month] = {};
    }
    
    if (!salesData[month][employeeId]) {
        salesData[month][employeeId] = {
            salesTarget: 0,
            revenueTarget: 0,
            salesAchieved: 0,
            revenueAchieved: 0
        };
    }
    
    salesData[month][employeeId].salesAchieved = (salesData[month][employeeId].salesAchieved || 0) + salesCount;
    salesData[month][employeeId].revenueAchieved = (salesData[month][employeeId].revenueAchieved || 0) + revenueAmount;
    
    await saveSalesData(salesData);
    
    const employees = await loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    const logMessage = `Recorded sales for ${employee.firstName} ${employee.lastName} - ${formatMonth(month)}: ${salesCount} sales, $${revenueAmount.toLocaleString()} revenue${notes ? ' - ' + notes : ''}`;
    addLog('sales', logMessage);
    
    showNotification('Sales recorded successfully!', 'success');
    closeSalesModal();
    await loadSalesData();
}

// Initialize page
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize month selector first
    initializeMonthSelector();
    
    // Wait for server connection to be established
    if (typeof checkServerConnection === 'function') {
        await checkServerConnection();
    }
    
    // Load employees and sales data from MongoDB
    await loadEmployees();
    await loadSalesData();
    
    // Add Escape key listener for closing modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
            // Close target modal if open
            const targetModal = document.getElementById('targetModal');
            if (targetModal && targetModal.style.display === 'flex') {
                closeTargetModal();
            }
            
            // Close sales modal if open
            const salesModal = document.getElementById('salesModal');
            if (salesModal && salesModal.style.display === 'flex') {
                closeSalesModal();
            }
        }
    });
    
    // Click outside modal to close
    const targetModal = document.getElementById('targetModal');
    const salesModal = document.getElementById('salesModal');
    
    if (targetModal) {
        targetModal.addEventListener('click', function(event) {
            if (event.target === targetModal) {
                closeTargetModal();
            }
        });
    }
    
    if (salesModal) {
        salesModal.addEventListener('click', function(event) {
            if (event.target === salesModal) {
                closeSalesModal();
            }
        });
    }
});

// Make functions globally available
window.openTargetModal = openTargetModal;
window.closeTargetModal = closeTargetModal;
window.saveTarget = saveTarget;
window.openSalesModal = openSalesModal;
window.closeSalesModal = closeSalesModal;
window.recordSales = recordSales;
window.loadSalesData = loadSalesData;
