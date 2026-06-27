// API Configuration loaded from config.js

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
        return cachedSalesData || {};
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
        return true;
    } catch (error) {
        console.error('Error saving sales data:', error);
        throw error;
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
    if (!employees || employees.length === 0) {
        console.warn('No employees loaded from database');
        return [];
    }
    const salesEmployees = employees.filter(emp => {
        const department = emp.department?.toLowerCase() || '';
        const status = emp.status || 'Active';
        return department.includes('sales') && status === 'Active';
    });
    return salesEmployees;
}

// Load sales data for selected month
async function loadSalesData() {
    const monthSelect = document.getElementById('monthSelect');
    const selectedMonth = monthSelect.value;
    const salesData = await getSalesData();
    const monthData = salesData[selectedMonth] || {};
    const allAdmissions = await fetch(`${API_BASE_URL}/admissions?month=${selectedMonth}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []);
    const pendingAdmissions = allAdmissions.filter(a => (a.status || '').toLowerCase() === 'pending');
    const approvedAdmissions = allAdmissions.filter(a => (a.status || 'approved').toLowerCase() === 'approved');
    
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
        const aggregateData = monthData[employee.id] || {
            salesTarget: 0,
            revenueTarget: 0,
            salesAchieved: 0,
            revenueAchieved: 0
        };
        const employeeApprovedAdmissions = approvedAdmissions.filter(a => a.employeeId === employee.id);
        const empData = {
            ...aggregateData,
            salesAchieved: employeeApprovedAdmissions.length,
            revenueAchieved: employeeApprovedAdmissions.reduce((sum, admission) => sum + (parseFloat(admission.revenue) || 0), 0)
        };
        
        totalSalesTarget += empData.salesTarget || 0;
        totalSalesAchieved += empData.salesAchieved || 0;
        totalRevenueAchieved += empData.revenueAchieved || 0;
        
        const salesPercentage = empData.salesTarget > 0 ? 
            Math.round((empData.salesAchieved / empData.salesTarget) * 100) : 0;
        
        const salesProgressClass = salesPercentage >= 100 ? 'high' : salesPercentage >= 50 ? '' : 'low';
        
        const pendingCount = pendingAdmissions.filter(a => a.employeeId === employee.id).length;
        const row = document.createElement('tr');
        row.style.borderTop = '1px solid #f0f4f8';
        row.innerHTML = `
            <td style="padding:10px 14px;vertical-align:middle;">
                <div style="font-weight:600;font-size:13px;color:#1a202c;">${employee.firstName} ${employee.lastName}</div>
                <div style="font-size:11px;color:#718096;">${employee.position}</div>
            </td>
            <td style="padding:10px 14px;vertical-align:middle;min-width:180px;">
                <div style="font-size:12px;color:#4a5568;margin-bottom:4px;">
                    <strong>${empData.salesAchieved || 0}</strong> / ${empData.salesTarget || 0}
                    <span style="color:${salesPercentage >= 100 ? '#059669' : salesPercentage >= 50 ? '#2563eb' : '#dc2626'};font-size:11px;margin-left:6px;">${salesPercentage}%</span>
                </div>
                <div class="progress-bar" style="height:6px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
                    <div class="progress-fill ${salesProgressClass}" style="width:${Math.min(salesPercentage, 100)}%;height:100%;"></div>
                </div>
            </td>
            <td style="padding:10px 14px;vertical-align:middle;min-width:140px;">
                <div style="font-size:14px;font-weight:700;color:#059669;">${formatRupees(empData.revenueAchieved || 0)}</div>
                <div style="font-size:11px;color:#718096;margin-top:2px;">Achieved</div>
            </td>
            <td style="padding:10px 14px;vertical-align:middle;">
                <div style="display:flex;gap:6px;">
                    <button class="btn-icon primary" style="padding:5px 10px;font-size:12px;" onclick="openTargetModal(${employee.id}, '${selectedMonth}')">
                        <i class="fas fa-bullseye"></i> Target
                    </button>
                    <button class="btn-icon success" style="padding:5px 10px;font-size:12px;" onclick="openSalesModal(${employee.id}, '${selectedMonth}')">
                        <i class="fas fa-plus"></i> Record
                    </button>
                    <button class="btn-icon" style="padding:5px 10px;font-size:12px;background:#e0e7ff;color:#3730a3;border:none;border-radius:10px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:5px;" onclick="viewAdmissions(${employee.id}, '${employee.firstName} ${employee.lastName}', '${selectedMonth}')">
                        <i class="fas fa-list"></i> View
                    </button>
                    ${pendingCount > 0 ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700;">${pendingCount} Pending</span>` : ''}
                </div>
            </td>
        `;
        
        container.appendChild(row);
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
    document.getElementById('totalRevenueAchieved').textContent = formatRupees(stats.totalRevenueAchieved || 0);
    document.getElementById('totalSalesTarget').textContent = formatIndianNumber(stats.totalSalesTarget || 0);
    document.getElementById('totalSalesAchieved').textContent = formatIndianNumber(stats.totalSalesAchieved || 0);
    
    const salesPercentage = stats.totalSalesTarget > 0 ? 
        Math.round((stats.totalSalesAchieved / stats.totalSalesTarget) * 100) : 0;
    
    document.getElementById('salesPercentage').textContent = `${salesPercentage}% of target`;
}

// Open target modal
async function openTargetModal(employeeId, month) {
    const employees = await window.loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    if (!employee) return;
    
    const salesData = await getSalesData();
    const monthData = salesData[month] || {};
    const empData = monthData[employeeId] || {};
    
    document.getElementById('targetEmployeeName').value = `${employee.firstName} ${employee.lastName}`;
    document.getElementById('targetEmployeeId').value = employeeId;
    document.getElementById('targetMonth').value = month;
    document.getElementById('salesTarget').value = empData.salesTarget || '';
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
    
    await saveSalesData(salesData);
    
    const employees = await window.loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    addLog('sales', `Set sales target for ${employee.firstName} ${employee.lastName} - ${formatMonth(month)}: ${salesTarget} sales`);
    
    showNotification('Sales target set successfully!', 'success');
    closeTargetModal();
    await loadSalesData();
}

// Open sales modal
async function openSalesModal(employeeId, month) {
    const employees = await window.loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    
    if (!employee) return;
    
    document.getElementById('salesEmployeeName').value = `${employee.firstName} ${employee.lastName}`;
    document.getElementById('salesEmployeeId').value = employeeId;
    document.getElementById('salesMonth').value = month;
    document.getElementById('admCustomerName').value = '';
    document.getElementById('admCustomerPhone').value = '';
    document.getElementById('admCustomerEmail').value = '';
    document.getElementById('admUniversity').value = '';
    document.getElementById('admDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('admType').value = '';
    
    // Setup currency formatting for revenue
    const revenueInput = document.getElementById('admRevenue');
    revenueInput.value = '';
    revenueInput.addEventListener('input', function() {
        formatCurrencyInput(this);
    });
    
    document.getElementById('salesModal').style.display = 'flex';
}

// Close sales modal
function closeSalesModal() {
    document.getElementById('salesModal').style.display = 'none';
    document.getElementById('salesForm').reset();
}

// Record sales (individual admission)
async function recordSales(event) {
    event.preventDefault();
    
    const employeeId = parseInt(document.getElementById('salesEmployeeId').value);
    const month = document.getElementById('salesMonth').value;
    const customerName    = document.getElementById('admCustomerName').value.trim();
    const customerPhone   = document.getElementById('admCustomerPhone').value.trim();
    const customerEmail   = document.getElementById('admCustomerEmail').value.trim();
    const universityName  = document.getElementById('admUniversity').value.trim();
    const admissionDate   = document.getElementById('admDate').value;
    const admissionType   = document.getElementById('admType').value;
    const revenue         = getRawCurrencyValue(document.getElementById('admRevenue'));
    
    const response = await fetch(`${API_BASE_URL}/admissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, month, customerName, customerPhone, customerEmail, universityName, admissionDate, admissionType, revenue, status: 'approved', submittedBy: 'admin' })
    });
    
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showNotification(err.error || 'Failed to record admission', 'error');
        return;
    }
    
    const employees = await window.loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    addLog('sales', `Recorded admission for ${employee.firstName} ${employee.lastName} - ${formatMonth(month)}: ${customerName} (${admissionType}), ${formatRupees(revenue)}`);
    
    // Invalidate cached sales data so the table refreshes
    cachedSalesData = null;
    
    showNotification('Admission recorded successfully!', 'success');
    closeSalesModal();
    await loadSalesData();
}

// View admissions for an employee
let _admCurrentEmployeeId = null;
let _admCurrentEmployeeName = null;
let _admCurrentMonth = null;
let _admCurrentRecords = [];

async function viewAdmissions(employeeId, employeeName, month) {
    _admCurrentEmployeeId = employeeId;
    _admCurrentEmployeeName = employeeName;
    _admCurrentMonth = month;

    const modal = document.getElementById('admissionsListModal');
    const title = document.getElementById('admListEmployeeName');
    const tbody = document.getElementById('admListBody');

    title.textContent = `${employeeName} \u2014 ${formatMonth(month)}`;
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096;">Loading…</td></tr>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`${API_BASE_URL}/admissions?employeeId=${employeeId}&month=${month}`);
        const records = await res.json();
        _admCurrentRecords = Array.isArray(records) ? records : [];

        if (!records.length) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#718096;">No admission records for this month</td></tr>';
            return;
        }

        const typeLabel = { 'one-time': 'One-Time', 'semester': 'Semester', 'annual': 'Annual' };
        const typeColor = { 'one-time': '#3730a3', 'semester': '#92400e', 'annual': '#065f46' };
        const typeBg    = { 'one-time': '#e0e7ff', 'semester': '#fef3c7', 'annual': '#d1fae5' };

        tbody.innerHTML = records
            .sort((a, b) => new Date(b.admissionDate) - new Date(a.admissionDate))
            .map((r, i) => {
                const dt  = r.admissionDate ? new Date(r.admissionDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
                const typeLbl = typeLabel[r.admissionType] || r.admissionType || '\u2014';
                const bg      = typeBg[r.admissionType]    || '#f3f4f6';
                const clr     = typeColor[r.admissionType]  || '#374151';
                const rev     = '\u20B9' + (parseFloat(r.revenue) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
                const rid     = String(r._id);
                const currentStatus = (r.status || 'approved').toLowerCase();
                const statusBadge = currentStatus === 'approved'
                    ? '<span class="badge badge-green" style="font-size:10px;">Approved</span>'
                    : currentStatus === 'rejected'
                        ? '<span class="badge badge-red" style="font-size:10px;">Rejected</span>'
                        : '<span class="badge badge-amber" style="font-size:10px;">Pending</span>';
                const approveBtn = currentStatus === 'pending'
                    ? `<button onclick="approveAdmission('${rid}')" style="background:#dcfce7;color:#166534;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;">
                            <i class=\"fas fa-check\"></i> Approve
                        </button>`
                    : '';
                const rejectBtn = currentStatus !== 'rejected'
                    ? `<button onclick="rejectAdmission('${rid}')" style="background:#fff7ed;color:#c2410c;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;">
                            <i class=\"fas fa-ban\"></i> Reject
                        </button>`
                    : '';
                return `<tr style="border-top:1px solid #f0f4f8;">
                    <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${i + 1}</td>
                    <td style="padding:10px 12px;font-size:13px;">${dt}</td>
                    <td style="padding:10px 12px;font-size:13px;font-weight:600;">${r.customerName || '\u2014'}</td>
                    <td style="padding:10px 12px;font-size:12px;color:#718096;">${r.customerPhone || '\u2014'}<br><span style="color:#a0aec0;">${r.customerEmail || ''}</span></td>
                    <td style="padding:10px 12px;"><span style="background:${bg};color:${clr};font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;">${typeLbl}</span></td>
                    <td style="padding:10px 12px;font-size:12px;color:#4a5568;">${r.universityName || '\u2014'}</td>
                    <td style="padding:10px 12px;font-weight:700;color:#059669;">${rev}</td>
                    <td style="padding:10px 12px;">${statusBadge}</td>
                    <td style="padding:10px 12px;">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button onclick="openEditAdmissionModal('${rid}')" style="background:#e0f2fe;color:#075985;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;">
                                <i class=\"fas fa-pen\"></i> Edit
                            </button>
                            ${approveBtn}
                            ${rejectBtn}
                            <button onclick="deleteAdmission('${rid}')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;">
                                <i class=\"fas fa-trash-alt\"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#dc2626;">Failed to load records</td></tr>';
    }
}

function getAdmissionRecordById(id) {
    return _admCurrentRecords.find(r => String(r._id) === String(id));
}

function openEditAdmissionModal(id) {
    const record = getAdmissionRecordById(id);
    if (!record) {
        showNotification('Admission record not found', 'error');
        return;
    }

    document.getElementById('editAdmissionId').value = id;
    document.getElementById('editAdmissionSubtitle').textContent = `${record.customerName || 'Lead'} • ${_admCurrentEmployeeName || ''}`;
    document.getElementById('editAdmCustomerName').value = record.customerName || '';
    document.getElementById('editAdmCustomerPhone').value = record.customerPhone || '';
    document.getElementById('editAdmCustomerEmail').value = record.customerEmail || '';
    document.getElementById('editAdmDate').value = record.admissionDate || '';
    document.getElementById('editAdmType').value = record.admissionType || 'one-time';
    document.getElementById('editAdmRevenue').value = formatRupees(record.revenue || 0);
    document.getElementById('editAdmUniversity').value = record.universityName || '';
    document.getElementById('editAdmReviewNote').value = record.reviewNote || '';

    const revenueInput = document.getElementById('editAdmRevenue');
    revenueInput.oninput = function() { formatCurrencyInput(this); };

    document.getElementById('editAdmissionModal').style.display = 'flex';
}

function closeEditAdmissionModal() {
    document.getElementById('editAdmissionModal').style.display = 'none';
    document.getElementById('editAdmissionForm').reset();
}

async function saveAdmissionEdits(event) {
    event.preventDefault();
    const id = document.getElementById('editAdmissionId').value;
    const payload = {
        customerName: document.getElementById('editAdmCustomerName').value.trim(),
        customerPhone: document.getElementById('editAdmCustomerPhone').value.trim(),
        customerEmail: document.getElementById('editAdmCustomerEmail').value.trim(),
        admissionDate: document.getElementById('editAdmDate').value,
        admissionType: document.getElementById('editAdmType').value,
        revenue: getRawCurrencyValue(document.getElementById('editAdmRevenue')),
        universityName: document.getElementById('editAdmUniversity').value.trim(),
        reviewNote: document.getElementById('editAdmReviewNote').value.trim()
    };

    try {
        const res = await fetch(`${API_BASE_URL}/admissions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.error || 'Failed to update admission', 'error');
            return;
        }

        cachedSalesData = null;
        showNotification('Lead details updated successfully', 'success');
        closeEditAdmissionModal();
        await viewAdmissions(_admCurrentEmployeeId, _admCurrentEmployeeName, _admCurrentMonth);
        await loadSalesData();
    } catch (e) {
        showNotification('Failed to update admission', 'error');
    }
}

async function deleteAdmission(id) {
    if (!confirm('Delete this admission? This will also reduce the employee\'s sales count and revenue.')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/admissions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.error || 'Failed to delete admission', 'error');
            return;
        }
        cachedSalesData = null;
        showNotification('Admission deleted', 'success');
        await viewAdmissions(_admCurrentEmployeeId, _admCurrentEmployeeName, _admCurrentMonth);
        await loadSalesData();
    } catch (e) {
        showNotification('Failed to delete admission', 'error');
    }
}

async function approveAdmission(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/admissions/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'approved' })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.error || 'Failed to approve admission', 'error');
            return;
        }
        cachedSalesData = null;
        showNotification('Admission approved successfully', 'success');
        await viewAdmissions(_admCurrentEmployeeId, _admCurrentEmployeeName, _admCurrentMonth);
        await loadSalesData();
    } catch (e) {
        showNotification('Failed to approve admission', 'error');
    }
}

async function rejectAdmission(id) {
    const reviewNote = window.prompt('Enter rejection reason (visible to employee):', '');
    if (reviewNote === null) return;
    try {
        const res = await fetch(`${API_BASE_URL}/admissions/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'rejected', reviewNote: reviewNote.trim() })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.error || 'Failed to reject admission', 'error');
            return;
        }
        cachedSalesData = null;
        showNotification('Admission rejected', 'success');
        await viewAdmissions(_admCurrentEmployeeId, _admCurrentEmployeeName, _admCurrentMonth);
        await loadSalesData();
    } catch (e) {
        showNotification('Failed to reject admission', 'error');
    }
}

function closeAdmissionsListModal() {
    document.getElementById('admissionsListModal').style.display = 'none';
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
    if (typeof window.loadEmployees === 'function') {
        await window.loadEmployees();
    }
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
    const editAdmissionModal = document.getElementById('editAdmissionModal');
    
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

    if (editAdmissionModal) {
        editAdmissionModal.addEventListener('click', function(event) {
            if (event.target === editAdmissionModal) closeEditAdmissionModal();
        });
    }

    const admListModal = document.getElementById('admissionsListModal');
    if (admListModal) {
        admListModal.addEventListener('click', function(event) {
            if (event.target === admListModal) closeAdmissionsListModal();
        });
    }

    // Close admissions list modal on Escape
    document.addEventListener('keydown', function(event) {
        if ((event.key === 'Escape' || event.key === 'Esc') && admListModal && admListModal.style.display === 'flex') {
            closeAdmissionsListModal();
        }
    });
});

// Make functions globally available
window.openTargetModal = openTargetModal;
window.closeTargetModal = closeTargetModal;
window.saveTarget = saveTarget;
window.openSalesModal = openSalesModal;
window.closeSalesModal = closeSalesModal;
window.recordSales = recordSales;
window.loadSalesData = loadSalesData;
window.viewAdmissions = viewAdmissions;
window.deleteAdmission = deleteAdmission;
window.approveAdmission = approveAdmission;
window.rejectAdmission = rejectAdmission;
window.openEditAdmissionModal = openEditAdmissionModal;
window.closeEditAdmissionModal = closeEditAdmissionModal;
window.saveAdmissionEdits = saveAdmissionEdits;
window.closeAdmissionsListModal = closeAdmissionsListModal;
