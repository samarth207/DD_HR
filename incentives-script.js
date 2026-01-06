// Incentives & Payments Management

// LocalStorage functions
function getIncentiveConfig() {
    const config = localStorage.getItem('hrIncentiveConfig');
    return config ? JSON.parse(config) : {
        slabs: { 100: 3, 150: 4, 200: 7 },
        courseRewards: { onetime: 1000, annual: 500, semester: 300 },
        dailyTarget: { salesCount: 2, bonusAmount: 1000 }
    };
}

function saveIncentiveConfig(config) {
    localStorage.setItem('hrIncentiveConfig', JSON.stringify(config));
}

function getIncentiveData() {
    const data = localStorage.getItem('hrIncentiveData');
    return data ? JSON.parse(data) : {
        monthlyIncentives: {},
        dailyBonuses: [],
        courseRewards: [],
        salaryAdvances: []
    };
}

function saveIncentiveData(data) {
    localStorage.setItem('hrIncentiveData', JSON.stringify(data));
}

// Tab switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    event.target.closest('.tab-button').classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Load relevant data
    switch(tabName) {
        case 'monthly':
            loadMonthlyIncentives();
            break;
        case 'daily':
            loadDailyBonuses();
            break;
        case 'salary':
            loadSalaryCrediting();
            break;
        case 'advances':
            loadSalaryAdvances();
            break;
    }
}

// Configuration Modal
function openConfigModal() {
    const config = getIncentiveConfig();
    
    document.getElementById('slab100').value = config.slabs[100];
    document.getElementById('slab150').value = config.slabs[150];
    document.getElementById('slab200').value = config.slabs[200];
    
    document.getElementById('rewardOneTime').value = config.courseRewards.onetime;
    document.getElementById('rewardAnnual').value = config.courseRewards.annual;
    document.getElementById('rewardSemester').value = config.courseRewards.semester;
    
    document.getElementById('dailyTarget').value = config.dailyTarget.salesCount;
    document.getElementById('dailyBonus').value = config.dailyTarget.bonusAmount;
    
    document.getElementById('configModal').style.display = 'flex';
}

function closeConfigModal() {
    document.getElementById('configModal').style.display = 'none';
}

function saveConfiguration(event) {
    event.preventDefault();
    
    const config = {
        slabs: {
            100: parseFloat(document.getElementById('slab100').value),
            150: parseFloat(document.getElementById('slab150').value),
            200: parseFloat(document.getElementById('slab200').value)
        },
        courseRewards: {
            onetime: parseFloat(document.getElementById('rewardOneTime').value),
            annual: parseFloat(document.getElementById('rewardAnnual').value),
            semester: parseFloat(document.getElementById('rewardSemester').value)
        },
        dailyTarget: {
            salesCount: parseInt(document.getElementById('dailyTarget').value),
            bonusAmount: parseFloat(document.getElementById('dailyBonus').value)
        }
    };
    
    saveIncentiveConfig(config);
    addLog('system', 'Updated incentive configuration settings');
    showNotification('Configuration saved successfully!', 'success');
    closeConfigModal();
    
    // Refresh current tab
    const activeTab = document.querySelector('.tab-button.active').textContent.trim().split(' ')[0].toLowerCase();
    switchTab(activeTab);
}

// Monthly Incentives
function calculateMonthlyIncentive(employeeId, month) {
    const salesData = getSalesData();
    const config = getIncentiveConfig();
    
    if (!salesData[month] || !salesData[month][employeeId]) {
        return { eligible: false, amount: 0, percentage: 0, achievementRate: 0 };
    }
    
    const empSales = salesData[month][employeeId];
    const revenueTarget = empSales.revenueTarget || 0;
    const revenueAchieved = empSales.revenueAchieved || 0;
    
    if (revenueTarget === 0) {
        return { eligible: false, amount: 0, percentage: 0, achievementRate: 0 };
    }
    
    const achievementRate = (revenueAchieved / revenueTarget) * 100;
    let incentivePercentage = 0;
    
    if (achievementRate >= 200) {
        incentivePercentage = config.slabs[200];
    } else if (achievementRate >= 150) {
        incentivePercentage = config.slabs[150];
    } else if (achievementRate >= 100) {
        incentivePercentage = config.slabs[100];
    }
    
    const incentiveAmount = (revenueAchieved * incentivePercentage) / 100;
    
    return {
        eligible: achievementRate >= 100,
        amount: Math.round(incentiveAmount),
        percentage: incentivePercentage,
        achievementRate: Math.round(achievementRate),
        revenueTarget,
        revenueAchieved
    };
}

function initializeMonthFilters() {
    const select = document.getElementById('monthlyMonthFilter');
    const currentDate = new Date();
    
    for (let i = 0; i <= 12; i++) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        
        if (i === 0) option.selected = true;
        select.appendChild(option);
    }
}

function loadEmployeeFilters() {
    const employees = getEmployees().filter(e => e.department === 'Sales' && e.status === 'Active');
    const selects = ['monthlyEmployeeFilter', 'bonusEmployee', 'advanceEmployee'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (selectId === 'monthlyEmployeeFilter') {
            select.innerHTML = '<option value="">All Employees</option>';
        } else {
            select.innerHTML = '<option value="">Choose employee...</option>';
        }
        
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.firstName} ${emp.lastName}`;
            select.appendChild(option);
        });
    });
}

function loadMonthlyIncentives() {
    const month = document.getElementById('monthlyMonthFilter').value;
    const employeeFilter = document.getElementById('monthlyEmployeeFilter').value;
    const employees = getEmployees().filter(e => e.department === 'Sales');
    const container = document.getElementById('monthlyIncentivesContainer');
    const incentiveData = getIncentiveData();
    
    let totalIncentives = 0;
    let pendingCount = 0;
    let paidThisMonth = 0;
    
    container.innerHTML = '';
    
    employees.forEach(emp => {
        if (employeeFilter && emp.id !== parseInt(employeeFilter)) return;
        
        const incentive = calculateMonthlyIncentive(emp.id, month);
        
        if (!incentive.eligible) return;
        
        const monthKey = `${month}_${emp.id}`;
        const isPaid = incentiveData.monthlyIncentives[monthKey]?.paid || false;
        
        totalIncentives += incentive.amount;
        if (!isPaid) pendingCount++;
        if (isPaid) paidThisMonth += incentive.amount;
        
        const card = document.createElement('div');
        card.className = 'employee-incentive-card';
        card.innerHTML = `
            <div class="employee-header">
                <div>
                    <div class="employee-name">${emp.firstName} ${emp.lastName}</div>
                    <div class="employee-dept">${emp.position}</div>
                </div>
                <div class="action-buttons">
                    ${!isPaid ? `<button class="btn-sm success" onclick="markIncentivePaid('${monthKey}', ${incentive.amount}, '${emp.firstName} ${emp.lastName}', '${month}')">
                        <i class="fas fa-check"></i> Mark Paid
                    </button>` : '<span style="color: #38ef7d; font-weight: 600;"><i class="fas fa-check-circle"></i> Paid</span>'}
                </div>
            </div>
            
            <div class="incentive-summary">
                <div class="incentive-box">
                    <label>Achievement Rate</label>
                    <div class="value">${incentive.achievementRate}%</div>
                </div>
                <div class="incentive-box">
                    <label>Revenue Target</label>
                    <div class="value">₹${incentive.revenueTarget.toLocaleString()}</div>
                </div>
                <div class="incentive-box">
                    <label>Revenue Achieved</label>
                    <div class="value">₹${incentive.revenueAchieved.toLocaleString()}</div>
                </div>
                <div class="incentive-box">
                    <label>Incentive (${incentive.percentage}%)</label>
                    <div class="value" style="color: #38ef7d;">₹${incentive.amount.toLocaleString()}</div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    if (container.children.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <i class="fas fa-hand-holding-usd"></i>
                <h3>No Incentives Found</h3>
                <p>No employees have achieved the minimum target for this month.</p>
            </div>
        `;
    }
    
    document.getElementById('totalMonthlyIncentives').textContent = `₹${totalIncentives.toLocaleString()}`;
    document.getElementById('pendingIncentives').textContent = pendingCount;
    document.getElementById('paidThisMonth').textContent = `₹${paidThisMonth.toLocaleString()}`;
}

function markIncentivePaid(monthKey, amount, employeeName, month) {
    const incentiveData = getIncentiveData();
    
    if (!incentiveData.monthlyIncentives[monthKey]) {
        incentiveData.monthlyIncentives[monthKey] = {};
    }
    
    incentiveData.monthlyIncentives[monthKey].paid = true;
    incentiveData.monthlyIncentives[monthKey].paidDate = new Date().toISOString();
    incentiveData.monthlyIncentives[monthKey].amount = amount;
    
    saveIncentiveData(incentiveData);
    addLog('incentive', `Marked monthly incentive as paid for ${employeeName} - ${month}: ₹${amount.toLocaleString()}`);
    showNotification('Incentive marked as paid!', 'success');
    loadMonthlyIncentives();
}

// Daily Bonuses
function openDailyBonusModal() {
    document.getElementById('bonusDate').valueAsDate = new Date();
    document.getElementById('bonusSalesCount').value = 0;
    document.getElementById('oneTimeCount').value = 0;
    document.getElementById('annualCount').value = 0;
    document.getElementById('semesterCount').value = 0;
    document.getElementById('bonusAmount').value = 0;
    document.getElementById('dailyBonusModal').style.display = 'flex';
}

function closeDailyBonusModal() {
    document.getElementById('dailyBonusModal').style.display = 'none';
    document.getElementById('dailyBonusForm').reset();
}

function calculateDailyReward() {
    const config = getIncentiveConfig();
    const salesCount = parseInt(document.getElementById('bonusSalesCount').value) || 0;
    const oneTimeCount = parseInt(document.getElementById('oneTimeCount').value) || 0;
    const annualCount = parseInt(document.getElementById('annualCount').value) || 0;
    const semesterCount = parseInt(document.getElementById('semesterCount').value) || 0;
    
    let totalReward = 0;
    
    // Check if daily sales target is met
    if (salesCount >= config.dailyTarget.salesCount) {
        totalReward += config.dailyTarget.bonusAmount;
    }
    
    // Add course-specific rewards
    totalReward += (oneTimeCount * config.courseRewards.onetime);
    totalReward += (annualCount * config.courseRewards.annual);
    totalReward += (semesterCount * config.courseRewards.semester);
    
    document.getElementById('bonusAmount').value = totalReward;
}

function saveDailyBonus(event) {
    event.preventDefault();
    
    const incentiveData = getIncentiveData();
    const employees = getEmployees();
    const employeeId = parseInt(document.getElementById('bonusEmployee').value);
    const employee = employees.find(e => e.id === employeeId);
    
    const bonus = {
        id: Date.now(),
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        date: document.getElementById('bonusDate').value,
        salesCount: parseInt(document.getElementById('bonusSalesCount').value) || 0,
        courseAdmissions: {
            onetime: parseInt(document.getElementById('oneTimeCount').value) || 0,
            annual: parseInt(document.getElementById('annualCount').value) || 0,
            semester: parseInt(document.getElementById('semesterCount').value) || 0
        },
        amount: parseFloat(document.getElementById('bonusAmount').value),
        universityNames: document.getElementById('universityNames').value,
        notes: document.getElementById('bonusNotes').value,
        addedDate: new Date().toISOString()
    };
    
    incentiveData.dailyBonuses.push(bonus);
    saveIncentiveData(incentiveData);
    
    const courseDetails = [];
    if (bonus.courseAdmissions.onetime > 0) courseDetails.push(`${bonus.courseAdmissions.onetime} One-Time`);
    if (bonus.courseAdmissions.annual > 0) courseDetails.push(`${bonus.courseAdmissions.annual} Annual`);
    if (bonus.courseAdmissions.semester > 0) courseDetails.push(`${bonus.courseAdmissions.semester} Semester`);
    
    const logMsg = `Recorded daily sales for ${bonus.employeeName}: ${bonus.salesCount} total sales${courseDetails.length > 0 ? ` (${courseDetails.join(', ')})` : ''} - ₹${bonus.amount.toLocaleString()} reward`;
    addLog('incentive', logMsg);
    
    showNotification('Daily sales recorded successfully!', 'success');
    closeDailyBonusModal();
    loadDailyBonuses();
}

function loadDailyBonuses() {
    const incentiveData = getIncentiveData();
    const config = getIncentiveConfig();
    const container = document.getElementById('dailyBonusesContainer');
    const bonuses = incentiveData.dailyBonuses.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    let totalBonuses = 0;
    let totalSales = 0;
    let totalCourseAdmissions = 0;
    
    container.innerHTML = '';
    
    bonuses.forEach(bonus => {
        totalBonuses += bonus.amount;
        totalSales += bonus.salesCount;
        totalCourseAdmissions += (bonus.courseAdmissions.onetime + bonus.courseAdmissions.annual + bonus.courseAdmissions.semester);
        
        const courseBreakdown = [];
        if (bonus.courseAdmissions.onetime > 0) {
            courseBreakdown.push(`${bonus.courseAdmissions.onetime} One-Time (₹${(bonus.courseAdmissions.onetime * config.courseRewards.onetime).toLocaleString()})`);
        }
        if (bonus.courseAdmissions.annual > 0) {
            courseBreakdown.push(`${bonus.courseAdmissions.annual} Annual (₹${(bonus.courseAdmissions.annual * config.courseRewards.annual).toLocaleString()})`);
        }
        if (bonus.courseAdmissions.semester > 0) {
            courseBreakdown.push(`${bonus.courseAdmissions.semester} Semester (₹${(bonus.courseAdmissions.semester * config.courseRewards.semester).toLocaleString()})`);
        }
        
        const card = document.createElement('div');
        card.className = 'bonus-card';
        card.innerHTML = `
            <div class="bonus-header">
                <div>
                    <div class="bonus-employee">${bonus.employeeName}</div>
                    <div class="bonus-date">${new Date(bonus.date).toLocaleDateString('en-US', { 
                        year: 'numeric', month: 'long', day: 'numeric' 
                    })}</div>
                </div>
                <div class="bonus-amount">₹${bonus.amount.toLocaleString()}</div>
            </div>
            
            <div class="bonus-details">
                <div class="detail-row">
                    <span><i class="fas fa-shopping-cart"></i> Sales Count:</span>
                    <strong>${bonus.salesCount}</strong>
                </div>
                ${courseBreakdown.length > 0 ? `
                <div class="detail-row">
                    <span><i class="fas fa-graduation-cap"></i> Course Admissions:</span>
                    <div class="course-breakdown">
                        ${courseBreakdown.map(cb => `<div>${cb}</div>`).join('')}
                    </div>
                </div>
                ` : ''}
                ${bonus.universityNames ? `
                <div class="detail-row">
                    <span><i class="fas fa-university"></i> Universities:</span>
                    <div>${bonus.universityNames}</div>
                </div>
                ` : ''}
                ${bonus.notes ? `
                <div class="detail-row">
                    <span><i class="fas fa-sticky-note"></i> Notes:</span>
                    <div>${bonus.notes}</div>
                </div>
                ` : ''}
            </div>
        `;
        
        container.appendChild(card);
    });
    
    if (bonuses.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <i class="fas fa-coins"></i>
                <h3>No Daily Bonuses</h3>
                <p>No daily sales bonuses have been recorded yet.</p>
            </div>
        `;
    }
    
    document.getElementById('totalDailyBonuses').textContent = `₹${totalBonuses.toLocaleString()}`;
    document.getElementById('totalDailySales').textContent = totalSales;
    document.getElementById('totalCourseAdmissions').textContent = totalCourseAdmissions;
}

// Salary Advances
function openAdvanceModal() {
    document.getElementById('advanceDate').valueAsDate = new Date();
    document.getElementById('advanceAmount').value = '';
    document.getElementById('advanceReason').value = '';
    document.getElementById('advanceModal').style.display = 'flex';
}

function closeAdvanceModal() {
    document.getElementById('advanceModal').style.display = 'none';
    document.getElementById('advanceForm').reset();
}

function saveAdvance(event) {
    event.preventDefault();
    
    const incentiveData = getIncentiveData();
    const employees = getEmployees();
    const employeeId = parseInt(document.getElementById('advanceEmployee').value);
    const employee = employees.find(e => e.id === employeeId);
    const amount = parseFloat(document.getElementById('advanceAmount').value);
    
    const advance = {
        id: Date.now(),
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        date: document.getElementById('advanceDate').value,
        amount: amount,
        reason: document.getElementById('advanceReason').value,
        status: 'Outstanding',
        addedDate: new Date().toISOString()
    };
    
    incentiveData.salaryAdvances.push(advance);
    saveIncentiveData(incentiveData);
    
    addLog('salary', `Salary advance given to ${advance.employeeName}: ₹${amount.toLocaleString()} - ${advance.reason}`);
    
    showNotification('Salary advance recorded successfully!', 'success');
    closeAdvanceModal();
    loadSalaryAdvances();
}

function markAdvanceRepaid(advanceId, employeeName, amount) {
    const incentiveData = getIncentiveData();
    const advance = incentiveData.salaryAdvances.find(a => a.id === advanceId);
    
    if (advance) {
        advance.status = 'Repaid';
        advance.repaidDate = new Date().toISOString();
        
        saveIncentiveData(incentiveData);
        showNotification('Advance marked as repaid!', 'success');
        loadSalaryAdvances();
    }
}

function loadSalaryAdvances() {
    const incentiveData = getIncentiveData();
    const container = document.getElementById('advancesContainer');
    const advances = incentiveData.salaryAdvances.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    let totalAdvances = 0;
    let outstandingAdvances = 0;
    let thisMonthAdvances = 0;
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    container.innerHTML = '';
    
    advances.forEach(advance => {
        totalAdvances += advance.amount;
        if (advance.status === 'Outstanding') {
            outstandingAdvances += advance.amount;
        }
        
        const advanceDate = new Date(advance.date);
        if (advanceDate.getMonth() === currentMonth && advanceDate.getFullYear() === currentYear) {
            thisMonthAdvances += advance.amount;
        }
        
        const card = document.createElement('div');
        card.className = 'advance-card';
        card.innerHTML = `
            <div class="advance-header">
                <div>
                    <div class="advance-employee">${advance.employeeName}</div>
                    <div class="advance-date">${new Date(advance.date).toLocaleDateString('en-US', { 
                        year: 'numeric', month: 'long', day: 'numeric' 
                    })}</div>
                </div>
                <div>
                    <div class="advance-amount">₹${advance.amount.toLocaleString()}</div>
                    <span class="status-badge ${advance.status.toLowerCase()}">${advance.status}</span>
                </div>
            </div>
            
            <div class="advance-details">
                <div class="detail-row">
                    <span><i class="fas fa-comment-alt"></i> Reason:</span>
                    <div>${advance.reason}</div>
                </div>
                <div class="detail-row">
                    <span><i class="fas fa-info-circle"></i> Note:</span>
                    <div style="color: #718096; font-size: 13px;">This advance will be deducted from monthly salary</div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    if (advances.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <i class="fas fa-money-bill-wave"></i>
                <h3>No Salary Advances</h3>
                <p>No salary advances have been given yet.</p>
            </div>
        `;
    }
    
    document.getElementById('totalAdvances').textContent = `₹${totalAdvances.toLocaleString()}`;
    document.getElementById('thisMonthAdvances').textContent = `₹${thisMonthAdvances.toLocaleString()}`;
    document.getElementById('outstandingAdvances').textContent = `₹${outstandingAdvances.toLocaleString()}`;
}

// Salary Crediting
function initializeSalaryMonthFilters() {
    const select = document.getElementById('salaryMonthFilter');
    if (!select) return;
    
    const currentDate = new Date();
    select.innerHTML = '';
    
    for (let i = 0; i <= 12; i++) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        
        if (i === 0) option.selected = true;
        select.appendChild(option);
    }
}

function loadSalaryEmployeeFilters() {
    const employees = getEmployees().filter(e => e.status === 'Active');
    const empSelect = document.getElementById('salaryEmployeeFilter');
    const deptSelect = document.getElementById('salaryDepartmentFilter');
    
    if (!empSelect || !deptSelect) return;
    
    empSelect.innerHTML = '<option value="">All Employees</option>';
    
    employees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.firstName} ${emp.lastName}`;
        empSelect.appendChild(option);
    });
    
    // Get unique departments
    const departments = [...new Set(employees.map(e => e.department))];
    deptSelect.innerHTML = '<option value="">All Departments</option>';
    departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        deptSelect.appendChild(option);
    });
}

function getOutstandingAdvanceForEmployee(employeeId) {
    const incentiveData = getIncentiveData();
    const advances = incentiveData.salaryAdvances.filter(a => 
        a.employeeId === employeeId && a.status === 'Outstanding'
    );
    
    return advances.reduce((total, advance) => total + advance.amount, 0);
}

function getSalaryPaymentStatus(employeeId, month) {
    const incentiveData = getIncentiveData();
    if (!incentiveData.salaryPayments) {
        incentiveData.salaryPayments = {};
    }
    
    const key = `${month}_${employeeId}`;
    return incentiveData.salaryPayments[key] || { paid: false };
}

function markSalaryPaid(employeeId, employeeName, month, grossSalary, deductions, netSalary) {
    const incentiveData = getIncentiveData();
    if (!incentiveData.salaryPayments) {
        incentiveData.salaryPayments = {};
    }
    
    const key = `${month}_${employeeId}`;
    incentiveData.salaryPayments[key] = {
        paid: true,
        paidDate: new Date().toISOString(),
        grossSalary,
        deductions,
        netSalary
    };
    
    saveIncentiveData(incentiveData);
    addLog('salary', `Salary credited to ${employeeName} for ${month}: ₹${netSalary.toLocaleString()} (Gross: ₹${grossSalary.toLocaleString()}, Deductions: ₹${deductions.toLocaleString()})`);
    showNotification('Salary marked as paid!', 'success');
    loadSalaryCrediting();
}

function loadSalaryCrediting() {
    const month = document.getElementById('salaryMonthFilter').value;
    const employeeFilter = document.getElementById('salaryEmployeeFilter').value;
    const departmentFilter = document.getElementById('salaryDepartmentFilter').value;
    const employees = getEmployees().filter(e => e.status === 'Active');
    const container = document.getElementById('salaryCreditingContainer');
    
    let totalGross = 0;
    let totalIncentives = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    
    container.innerHTML = '';
    
    employees.forEach(emp => {
        if (employeeFilter && emp.id !== parseInt(employeeFilter)) return;
        if (departmentFilter && emp.department !== departmentFilter) return;
        
        const grossSalary = parseFloat(emp.salary) || 0;
        const outstandingAdvance = getOutstandingAdvanceForEmployee(emp.id);
        
        // Calculate monthly incentive if sales department
        let monthlyIncentive = 0;
        if (emp.department === 'Sales') {
            const incentiveCalc = calculateMonthlyIncentive(emp.id, month);
            if (incentiveCalc.eligible) {
                monthlyIncentive = incentiveCalc.amount;
            }
        }
        
        const totalEarnings = grossSalary + monthlyIncentive;
        const netSalary = totalEarnings - outstandingAdvance;
        
        const paymentStatus = getSalaryPaymentStatus(emp.id, month);
        
        totalGross += grossSalary;
        totalIncentives += monthlyIncentive;
        totalDeductions += outstandingAdvance;
        totalNet += netSalary;
        
        const card = document.createElement('div');
        card.className = 'employee-incentive-card';
        card.innerHTML = `
            <div class="employee-header">
                <div>
                    <div class="employee-name">${emp.firstName} ${emp.lastName}</div>
                    <div class="employee-dept">${emp.position} - ${emp.department}</div>
                </div>
                <div class="action-buttons">
                    ${!paymentStatus.paid ? `<button class="btn-sm success" onclick="markSalaryPaid(${emp.id}, '${emp.firstName} ${emp.lastName}', '${month}', ${totalEarnings}, ${outstandingAdvance}, ${netSalary})">
                        <i class="fas fa-check"></i> Mark Paid
                    </button>` : '<span style="color: #38ef7d; font-weight: 600;"><i class="fas fa-check-circle"></i> Paid</span>'}
                </div>
            </div>
            
            <div class="incentive-summary">
                <div class="incentive-box">
                    <label>Gross Salary</label>
                    <div class="value">₹${grossSalary.toLocaleString()}</div>
                </div>
                ${monthlyIncentive > 0 ? `
                <div class="incentive-box">
                    <label>Monthly Incentive</label>
                    <div class="value" style="color: #38ef7d;">+ ₹${monthlyIncentive.toLocaleString()}</div>
                </div>
                ` : ''}
                <div class="incentive-box">
                    <label>Outstanding Advances</label>
                    <div class="value" style="color: ${outstandingAdvance > 0 ? '#f5576c' : '#718096'};">- ₹${outstandingAdvance.toLocaleString()}</div>
                </div>
                <div class="incentive-box">
                    <label>Net Payable</label>
                    <div class="value" style="color: #667eea; font-size: 24px; font-weight: 700;">₹${netSalary.toLocaleString()}</div>
                </div>
            </div>
            ${monthlyIncentive > 0 ? `
            <div style="margin-top: 15px; padding: 12px; background: #f0fff4; border-left: 4px solid #38ef7d; border-radius: 6px;">
                <small style="color: #22543d; font-weight: 600;">
                    <i class="fas fa-star"></i> Performance incentive included: ₹${monthlyIncentive.toLocaleString()}
                </small>
            </div>
            ` : ''}
            ${outstandingAdvance > 0 ? `
            <div style="margin-top: 15px; padding: 12px; background: #fff5f5; border-left: 4px solid #f5576c; border-radius: 6px;">
                <small style="color: #c53030; font-weight: 600;">
                    <i class="fas fa-exclamation-triangle"></i> Advance salary deduction: ₹${outstandingAdvance.toLocaleString()}
                </small>
            </div>
            ` : ''}
        `;
        
        container.appendChild(card);
    });
    
    if (container.children.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <i class="fas fa-wallet"></i>
                <h3>No Employees Found</h3>
                <p>No active employees match the selected filters.</p>
            </div>
        `;
    }
    
    document.getElementById('totalGrossSalary').textContent = `₹${totalGross.toLocaleString()}`;
    document.getElementById('totalIncentivesAdded').textContent = `₹${totalIncentives.toLocaleString()}`;
    document.getElementById('totalDeductions').textContent = `₹${totalDeductions.toLocaleString()}`;
    document.getElementById('totalNetPayable').textContent = `₹${totalNet.toLocaleString()}`;
}

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    initializeMonthFilters();
    initializeSalaryMonthFilters();
    loadEmployeeFilters();
    loadSalaryEmployeeFilters();
    loadMonthlyIncentives();
    
    // Add Escape key listener for closing modals
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
            const modals = ['configModal', 'dailyBonusModal', 'advanceModal'];
            modals.forEach(modalId => {
                const modal = document.getElementById(modalId);
                if (modal && modal.style.display === 'flex') {
                    modal.style.display = 'none';
                }
            });
        }
    });
    
    // Click outside to close modals
    const modals = ['configModal', 'dailyBonusModal', 'advanceModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', function(event) {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        }
    });
});

// Make functions globally available
window.switchTab = switchTab;
window.openConfigModal = openConfigModal;
window.closeConfigModal = closeConfigModal;
window.saveConfiguration = saveConfiguration;
window.openDailyBonusModal = openDailyBonusModal;
window.closeDailyBonusModal = closeDailyBonusModal;
window.calculateDailyReward = calculateDailyReward;
window.saveDailyBonus = saveDailyBonus;
window.openAdvanceModal = openAdvanceModal;
window.closeAdvanceModal = closeAdvanceModal;
window.saveAdvance = saveAdvance;
window.markIncentivePaid = markIncentivePaid;
window.markAdvanceRepaid = markAdvanceRepaid;
window.markSalaryPaid = markSalaryPaid;
window.loadMonthlyIncentives = loadMonthlyIncentives;
window.loadSalaryCrediting = loadSalaryCrediting;
window.getSalesData = getSalesData;
