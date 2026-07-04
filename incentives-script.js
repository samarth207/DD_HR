// Incentives & Payments Management
let cachedIncentiveConfig = null;
let cachedIncentiveData = null;
let cachedSalesData = null;
let cachedAdmissionsByMonth = {};
let dbUnavailable = false;

// Check DB status once on load
async function checkDBStatus() {
    try {
        const res = await fetch(`${API_BASE_URL}/health`);
        const data = await res.json();
        dbUnavailable = !data.dbConnected;
        if (dbUnavailable) showDBWarning();
    } catch (e) {
        dbUnavailable = true;
        showDBWarning();
    }
}

function showDBWarning() {
    const existing = document.getElementById('dbWarningBanner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'dbWarningBanner';
    banner.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:14px 20px;border-radius:10px;margin-bottom:20px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500;';
    banner.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:18px"></i><div><strong>Database not connected.</strong> Incentive data cannot be loaded or saved. Please whitelist your IP in <a href="https://cloud.mongodb.com" target="_blank" style="color:#856404">MongoDB Atlas</a> → Network Access, then restart the server.</div>';
    const mainContent = document.querySelector('.main-content') || document.querySelector('.container') || document.body;
    mainContent.insertBefore(banner, mainContent.firstChild);
}

// API function to get sales data (needed for incentive calculations)
async function getSalesData() {
    if (cachedSalesData) return cachedSalesData;
    try {
        const response = await fetch(`${API_BASE_URL}/sales`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (err.dbUnavailable) dbUnavailable = true;
            throw new Error('Failed to fetch sales data');
        }
        const data = await response.json();
        cachedSalesData = data;
        return data;
    } catch (error) {
        console.error('Error fetching sales data:', error);
        return cachedSalesData || {};
    }
}

async function getApprovedAdmissionsByMonth(month) {
    if (cachedAdmissionsByMonth[month]) return cachedAdmissionsByMonth[month];
    try {
        const response = await fetch(`${API_BASE_URL}/admissions?month=${month}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (err.dbUnavailable) dbUnavailable = true;
            throw new Error('Failed to fetch admissions data');
        }
        const records = await response.json();
        const approved = (Array.isArray(records) ? records : []).filter(record => (record.status || 'approved').toLowerCase() === 'approved');
        cachedAdmissionsByMonth[month] = approved;
        return approved;
    } catch (error) {
        console.error('Error fetching admissions data:', error);
        return cachedAdmissionsByMonth[month] || [];
    }
}

// API functions for incentives
async function getIncentiveConfig() {
    if (cachedIncentiveConfig) return cachedIncentiveConfig;
    try {
        const response = await fetch(`${API_BASE_URL}/incentives/config`);
        if (!response.ok) throw new Error('Failed to fetch config');
        const config = await response.json();
        cachedIncentiveConfig = config;
        return config;
    } catch (error) {
        console.error('Error fetching incentive config:', error);
        return {
            slabs: { 100: 3, 150: 4, 200: 7 },
            courseRewards: { onetime: 1000, annual: 500, semester: 300 },
            dailyTarget: { salesCount: 2, bonusAmount: 1000 }
        };
    }
}

async function saveIncentiveConfig(config) {
    cachedIncentiveConfig = config;
    try {
        await fetch(`${API_BASE_URL}/incentives/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    } catch (error) {
        console.error('Error saving incentive config:', error);
        throw error;
    }
}

async function getIncentiveData() {
    if (cachedIncentiveData) return cachedIncentiveData;
    try {
        const response = await fetch(`${API_BASE_URL}/incentives/data`);
        if (!response.ok) throw new Error('Failed to fetch data');
        const data = await response.json();
        cachedIncentiveData = data;
        return data;
    } catch (error) {
        console.error('Error fetching incentive data:', error);
        return {
            monthlyIncentives: {},
            dailyBonuses: [],
            salaryAdvances: [],
            salaryPayments: {}
        };
    }
}

async function saveIncentiveData(data) {
    cachedIncentiveData = data;
    try {
        await fetch(`${API_BASE_URL}/incentives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (error) {
        console.error('Error saving incentive data:', error);
        throw error;
    }
}

// Tab switching
function switchTab(tabName, event) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    
    // If event exists, mark the clicked button as active
    if (event && event.target) {
        const targetBtn = event.target.closest('.tab-button');
        if (targetBtn) targetBtn.classList.add('active');
    } else {
        // Find and activate button by matching the onclick parameter exactly
        document.querySelectorAll('.tab-button').forEach(btn => {
            if (btn.getAttribute('onclick') === `switchTab('${tabName}')`) {
                btn.classList.add('active');
            }
        });
    }
    
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
async function openConfigModal() {
    const config = await getIncentiveConfig();
    
    document.getElementById('slab100').value = config.slabs[100];
    document.getElementById('slab150').value = config.slabs[150];
    document.getElementById('slab200').value = config.slabs[200];
    
    // Set reward values with currency formatting
    const rewardOneTimeInput = document.getElementById('rewardOneTime');
    const rewardAnnualInput = document.getElementById('rewardAnnual');
    const rewardSemesterInput = document.getElementById('rewardSemester');
    
    rewardOneTimeInput.value = formatRupees(config.courseRewards.onetime);
    rewardAnnualInput.value = formatRupees(config.courseRewards.annual);
    rewardSemesterInput.value = formatRupees(config.courseRewards.semester);
    
    // Add currency formatting event listeners
    rewardOneTimeInput.addEventListener('input', function() { formatCurrencyInput(this); });
    rewardAnnualInput.addEventListener('input', function() { formatCurrencyInput(this); });
    rewardSemesterInput.addEventListener('input', function() { formatCurrencyInput(this); });
    
    // Set dates - use existing dates or default to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('rewardOneTimeDate').value = config.courseRewards.onetimeDate || today;
    document.getElementById('rewardAnnualDate').value = config.courseRewards.annualDate || today;
    document.getElementById('rewardSemesterDate').value = config.courseRewards.semesterDate || today;
    
    document.getElementById('configModal').style.display = 'flex';
}

function closeConfigModal() {
    document.getElementById('configModal').style.display = 'none';
}

async function saveConfiguration(event) {
    event.preventDefault();
    
    const config = {
        slabs: {
            100: parseFloat(document.getElementById('slab100').value),
            150: parseFloat(document.getElementById('slab150').value),
            200: parseFloat(document.getElementById('slab200').value)
        },
        courseRewards: {
            onetime: getRawCurrencyValue(document.getElementById('rewardOneTime')),
            onetimeDate: document.getElementById('rewardOneTimeDate').value,
            annual: getRawCurrencyValue(document.getElementById('rewardAnnual')),
            annualDate: document.getElementById('rewardAnnualDate').value,
            semester: getRawCurrencyValue(document.getElementById('rewardSemester')),
            semesterDate: document.getElementById('rewardSemesterDate').value
        },
        dailyTarget: {
            salesCount: 0,
            bonusAmount: 0
        }
    };
    
    await saveIncentiveConfig(config);
    addLog('system', 'Updated incentive configuration settings');
    showNotification('Configuration saved successfully!', 'success');
    closeConfigModal();
    
    // Refresh current tab
    const activeTabContent = document.querySelector('.tab-content.active');
    const activeTab = activeTabContent ? activeTabContent.id.replace('-tab', '') : 'monthly';
    switchTab(activeTab);
}

// Monthly Incentives
async function calculateMonthlyIncentive(employeeId, month) {
    const salesData = await getSalesData();
    const config = await getIncentiveConfig();
    const approvedAdmissions = await getApprovedAdmissionsByMonth(month);
        
    if (!salesData[month] || !salesData[month][employeeId]) {
        return { eligible: false, amount: 0, percentage: 0, achievementRate: 0 };
    }
    
    const empSales = salesData[month][employeeId];
    
    const salesTarget = empSales.salesTarget || 0;
    const employeeApprovedAdmissions = approvedAdmissions.filter(admission => admission.employeeId === employeeId || admission.employeeId === String(employeeId));
    const salesAchieved = employeeApprovedAdmissions.length;
    const revenueTarget = empSales.revenueTarget || 0;
    const revenueAchieved = employeeApprovedAdmissions.reduce((sum, admission) => sum + (parseFloat(admission.revenue) || 0), 0);
    
    // Determine achievement rate:
    // - If salesTarget is set (>0), use sales count achievement
    // - If only revenueTarget is set, use revenue achievement
    // - If neither is set, ineligible
    let achievementRate = 0;
    let achievementBasis = 'sales';

    if (salesTarget > 0) {
        achievementRate = (salesAchieved / salesTarget) * 100;
        achievementBasis = 'sales';
    } else if (revenueTarget > 0) {
        achievementRate = (revenueAchieved / revenueTarget) * 100;
        achievementBasis = 'revenue';
    } else {
        return { eligible: false, amount: 0, percentage: 0, achievementRate: 0, salesTarget, salesAchieved, revenueTarget, revenueAchieved };
    }

    let incentivePercentage = 0;
    
    // Determine incentive percentage based on achievement
    if (achievementRate >= 200) {
        incentivePercentage = config.slabs[200];
    } else if (achievementRate >= 150) {
        incentivePercentage = config.slabs[150];
    } else if (achievementRate >= 100) {
        incentivePercentage = config.slabs[100];
    }
    
    // Calculate incentive amount as percentage of REVENUE achieved
    const incentiveAmount = (revenueAchieved * incentivePercentage) / 100;
    
    console.log('Calculation result:', {
        achievementBasis,
        salesTarget,
        salesAchieved,
        revenueTarget,
        revenueAchieved,
        achievementRate: Math.round(achievementRate),
        incentivePercentage,
        incentiveAmount,
        eligible: achievementRate >= 100
    });
    
    return {
        eligible: achievementRate >= 100,
        amount: Math.round(incentiveAmount),
        percentage: incentivePercentage,
        achievementRate: Math.round(achievementRate),
        achievementBasis,
        salesTarget,
        salesAchieved,
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

async function loadEmployeeFilters() {
    const allEmployees = await loadEmployees();
    const salesEmployees = allEmployees.filter(e => e.department === 'Sales' && e.status === 'Active');
    const activeEmployees = allEmployees.filter(e => e.status === 'Active');

    // Monthly incentives and daily bonuses are Sales-only
    const salesSelects = ['monthlyEmployeeFilter', 'bonusEmployee'];
    salesSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        select.innerHTML = selectId === 'monthlyEmployeeFilter'
            ? '<option value="">All Employees</option>'
            : '<option value="">Choose employee...</option>';
        salesEmployees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.firstName} ${emp.lastName}`;
            select.appendChild(option);
        });
    });

    // Salary advances are available for all active employees
    const advSelect = document.getElementById('advanceEmployee');
    if (advSelect) {
        advSelect.innerHTML = '<option value="">Choose employee...</option>';
        activeEmployees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.firstName} ${emp.lastName} (${emp.department})`;
            advSelect.appendChild(option);
        });
    }
}

async function loadMonthlyIncentives() {
    const month = document.getElementById('monthlyMonthFilter').value;
    const employeeFilter = document.getElementById('monthlyEmployeeFilter').value;
    delete cachedAdmissionsByMonth[month];
    const allEmployees = await loadEmployees();
    const employees = allEmployees.filter(e => e.department === 'Sales');
    const container = document.getElementById('monthlyIncentivesContainer');
    const incentiveData = await getIncentiveData();
    
    let totalIncentives = 0;
    let pendingCount = 0;
    let paidThisMonth = 0;
    
    container.innerHTML = '';
    
    for (const emp of employees) {
        if (employeeFilter && emp.id !== parseInt(employeeFilter)) continue;
        
        const incentive = await calculateMonthlyIncentive(emp.id, month);
        
        if (!incentive.eligible) continue;
        
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
                ${incentive.achievementBasis === 'revenue' ? `
                <div class="incentive-box">
                    <label>Revenue Achieved</label>
                    <div class="value">${formatRupees(incentive.revenueAchieved)}</div>
                </div>
                ` : `
                <div class="incentive-box">
                    <label>Sales Target</label>
                    <div class="value">${incentive.salesTarget} sales</div>
                </div>
                <div class="incentive-box">
                    <label>Sales Achieved</label>
                    <div class="value">${incentive.salesAchieved} sales</div>
                </div>
                `}
                <div class="incentive-box">
                    <label>Achievement Rate</label>
                    <div class="value">${incentive.achievementRate}%</div>
                </div>
                <div class="incentive-box">
                    <label>Revenue Achieved</label>
                    <div class="value">${formatRupees(incentive.revenueAchieved)}</div>
                </div>
                <div class="incentive-box">
                    <label>Incentive (${incentive.percentage}%)</label>
                    <div class="value" style="color: #38ef7d;">${formatRupees(incentive.amount)}</div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    }
    
    if (container.children.length === 0) {
        container.innerHTML = dbUnavailable ? `
            <div class="no-data-message">
                <i class="fas fa-database"></i>
                <h3>Database Not Connected</h3>
                <p>Cannot load sales or incentive data. Please connect to MongoDB Atlas first.</p>
            </div>
        ` : `
            <div class="no-data-message">
                <i class="fas fa-hand-holding-usd"></i>
                <h3>No Incentives Found</h3>
                <p>No employees have achieved the minimum target (100%) for this month, or no sales data has been entered.</p>
            </div>
        `;
    }
    
    document.getElementById('totalMonthlyIncentives').textContent = formatRupees(totalIncentives);
    document.getElementById('pendingIncentives').textContent = pendingCount;
    document.getElementById('paidThisMonth').textContent = formatRupees(paidThisMonth);
}

async function markIncentivePaid(monthKey, amount, employeeName, month) {
    try {
        // Save to database
        await fetch(`${API_BASE_URL}/incentives/monthly`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: monthKey,
                data: {
                    paid: true,
                    paidDate: new Date().toISOString(),
                    amount: amount
                }
            })
        });
        
        // Clear cache to force reload
        cachedIncentiveData = null;
        
        addLog('incentive', `Marked monthly incentive as paid for ${employeeName} - ${month}: ${formatRupees(amount)}`);
        showNotification('Incentive marked as paid!', 'success');
        await loadMonthlyIncentives();
    } catch (error) {
        console.error('Error marking incentive as paid:', error);
        showNotification('Failed to mark incentive as paid', 'error');
    }
}

// Daily Bonuses
function openDailyBonusModal() {
    console.log('🚀 Opening Daily Bonus Modal');
    
    // Set initial values
    document.getElementById('bonusDate').valueAsDate = new Date();
    document.getElementById('oneTimeCount').value = 0;
    document.getElementById('annualCount').value = 0;
    document.getElementById('semesterCount').value = 0;
    document.getElementById('bonusAmount').value = 0;
    
    // Show modal
    document.getElementById('dailyBonusModal').style.display = 'flex';
    
    // Load reward rates for today
    updateRewardRates();
}

async function onDateChange() {
    await updateRewardRates();
    await calculateDailyReward();
}

async function updateRewardRates() {
    const selectedDate = document.getElementById('bonusDate').value;
    if (!selectedDate) return;
    
    const config = await getIncentiveConfig();
    const infoDiv = document.getElementById('rewardRatesInfo');
    
    // Check if reward dates are within 24 hours of selected date
    const isRewardValidForDate = (rewardDate, targetDate) => {
        if (!rewardDate) return false;
        const rewardTime = new Date(rewardDate).getTime();
        const targetTime = new Date(targetDate).getTime();
        const hoursDiff = (targetTime - rewardTime) / (1000 * 60 * 60);
        return hoursDiff >= 0 && hoursDiff <= 24;
    };
    
    const onetimeReward = isRewardValidForDate(config.courseRewards.onetimeDate, selectedDate) ? config.courseRewards.onetime : 0;
    const annualReward = isRewardValidForDate(config.courseRewards.annualDate, selectedDate) ? config.courseRewards.annual : 0;
    const semesterReward = isRewardValidForDate(config.courseRewards.semesterDate, selectedDate) ? config.courseRewards.semester : 0;
    
    // Update rate display
    document.getElementById('oneTimeRate').textContent = onetimeReward > 0 ? `(${formatRupees(onetimeReward)})` : '(₹0)';
    document.getElementById('annualRate').textContent = annualReward > 0 ? `(${formatRupees(annualReward)})` : '(₹0)';
    document.getElementById('semesterRate').textContent = semesterReward > 0 ? `(${formatRupees(semesterReward)})` : '(₹0)';
    
    // Update info message
    if (onetimeReward > 0 || annualReward > 0 || semesterReward > 0) {
        infoDiv.innerHTML = `<i class="fas fa-check-circle"></i> Reward rates for ${new Date(selectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} are active`;
        infoDiv.style.borderLeftColor = '#38ef7d';
    } else {
        infoDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> No active reward rates for this date. Please set configuration first.`;
        infoDiv.style.borderLeftColor = '#f5576c';
    }
    
    // Don't recalculate here - let the input events handle it
    // This prevents race conditions when modal opens
}

function closeDailyBonusModal() {
    document.getElementById('dailyBonusModal').style.display = 'none';
    document.getElementById('dailyBonusForm').reset();
}

async function calculateDailyReward() {
    console.log('🔢 calculateDailyReward called');
    
    const selectedDate = document.getElementById('bonusDate')?.value;
    console.log('📅 Selected date:', selectedDate);
    
    if (!selectedDate) {
        console.log('⚠️ No date selected, setting reward to 0');
        document.getElementById('bonusAmount').value = 0;
        return;
    }
    
    const config = await getIncentiveConfig();
    console.log('⚙️ Config loaded:', config);
    
    // Get counts directly from inputs
    const oneTimeEl = document.getElementById('oneTimeCount');
    const annualEl = document.getElementById('annualCount');
    const semesterEl = document.getElementById('semesterCount');
    
    console.log('📝 Elements found:', {
        oneTime: oneTimeEl ? 'YES' : 'NO',
        annual: annualEl ? 'YES' : 'NO',
        semester: semesterEl ? 'YES' : 'NO'
    });
    
    console.log('🔍 RAW VALUES:', {
        oneTimeRaw: oneTimeEl?.value,
        annualRaw: annualEl?.value,
        semesterRaw: semesterEl?.value
    });
    
    const oneTimeCount = parseInt(oneTimeEl?.value || '0');
    const annualCount = parseInt(annualEl?.value || '0');
    const semesterCount = parseInt(semesterEl?.value || '0');
    
    console.log('🔢 Counts:', { oneTimeCount, annualCount, semesterCount });
    
    // Check if reward dates are within 24 hours of selected date
    const isRewardValidForDate = (rewardDate, targetDate) => {
        if (!rewardDate || !targetDate) return false;
        const rewardTime = new Date(rewardDate).getTime();
        const targetTime = new Date(targetDate).getTime();
        const hoursDiff = (targetTime - rewardTime) / (1000 * 60 * 60);
        return hoursDiff >= 0 && hoursDiff <= 24;
    };
    
    // Get applicable rewards based on date
    const onetimeReward = isRewardValidForDate(config.courseRewards.onetimeDate, selectedDate) ? config.courseRewards.onetime : 0;
    const annualReward = isRewardValidForDate(config.courseRewards.annualDate, selectedDate) ? config.courseRewards.annual : 0;
    const semesterReward = isRewardValidForDate(config.courseRewards.semesterDate, selectedDate) ? config.courseRewards.semester : 0;
    
    console.log('💰 Reward rates:', { onetimeReward, annualReward, semesterReward });
    
    // Calculate total reward
    const totalReward = (oneTimeCount * onetimeReward) + (annualCount * annualReward) + (semesterCount * semesterReward);
    
    console.log('🧮 Calculation:', `(${oneTimeCount} × ${onetimeReward}) + (${annualCount} × ${annualReward}) + (${semesterCount} × ${semesterReward}) = ${totalReward}`);
    
    // Update the total reward field
    const bonusAmountEl = document.getElementById('bonusAmount');
    if (bonusAmountEl) {
        bonusAmountEl.value = totalReward;
        console.log('✅ Total reward field updated to:', totalReward);
    } else {
        console.error('❌ bonusAmount element not found!');
    }
}

async function saveDailyBonus(event) {
    event.preventDefault();
    
    const employees = await loadEmployees();
    const employeeId = parseInt(document.getElementById('bonusEmployee').value);
    const employee = employees.find(e => e.id === employeeId);
    const config = await getIncentiveConfig();
    const selectedDate = document.getElementById('bonusDate').value;
    
    // Get admission counts
    const oneTimeCount = parseInt(document.getElementById('oneTimeCount').value) || 0;
    const annualCount = parseInt(document.getElementById('annualCount').value) || 0;
    const semesterCount = parseInt(document.getElementById('semesterCount').value) || 0;
    
    // Calculate total sales count from admission types
    const totalSalesCount = oneTimeCount + annualCount + semesterCount;
    
    // Get the reward rates that were applicable for this date
    const isRewardValidForDate = (rewardDate, targetDate) => {
        if (!rewardDate || !targetDate) return false;
        const rewardTime = new Date(rewardDate).getTime();
        const targetTime = new Date(targetDate).getTime();
        const hoursDiff = (targetTime - rewardTime) / (1000 * 60 * 60);
        return hoursDiff >= 0 && hoursDiff <= 24;
    };
    
    const appliedRates = {
        onetime: isRewardValidForDate(config.courseRewards.onetimeDate, selectedDate) ? config.courseRewards.onetime : 0,
        annual: isRewardValidForDate(config.courseRewards.annualDate, selectedDate) ? config.courseRewards.annual : 0,
        semester: isRewardValidForDate(config.courseRewards.semesterDate, selectedDate) ? config.courseRewards.semester : 0
    };
    
    const bonus = {
        id: Date.now(),
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        date: selectedDate,
        salesCount: totalSalesCount, // Calculated from admission types
        courseAdmissions: {
            onetime: oneTimeCount,
            annual: annualCount,
            semester: semesterCount
        },
        appliedRates: appliedRates, // Store the rates used for this bonus
        amount: parseFloat(document.getElementById('bonusAmount').value),
        universityNames: document.getElementById('universityNames').value,
        notes: document.getElementById('bonusNotes').value,
        addedDate: new Date().toISOString()
    };
    
    try {
        // Save to database
        await fetch(`${API_BASE_URL}/incentives/daily`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bonus)
        });
        
        // Clear all caches to force reload
        cachedIncentiveData = null;
        cachedIncentiveConfig = null;
        cachedSalesData = null;
        
        const courseDetails = [];
        if (bonus.courseAdmissions.onetime > 0) courseDetails.push(`${bonus.courseAdmissions.onetime} One-Time`);
        if (bonus.courseAdmissions.annual > 0) courseDetails.push(`${bonus.courseAdmissions.annual} Annual`);
        if (bonus.courseAdmissions.semester > 0) courseDetails.push(`${bonus.courseAdmissions.semester} Semester`);
        
        const logMsg = `Recorded daily sales for ${bonus.employeeName}: ${bonus.salesCount} total sales${courseDetails.length > 0 ? ` (${courseDetails.join(', ')})` : ''} - ${formatRupees(bonus.amount)} reward`;
        addLog('incentive', logMsg);
        
        showNotification('Daily sales recorded successfully!', 'success');
        closeDailyBonusModal();
        await loadDailyBonuses();
    } catch (error) {
        console.error('Error saving daily bonus:', error);
        showNotification('Failed to save daily bonus', 'error');
    }
}

async function loadDailyBonuses() {
    // Force fresh data fetch
    cachedIncentiveData = null;
    cachedIncentiveConfig = null;
    
    const incentiveData = await getIncentiveData();
    const config = await getIncentiveConfig();
    const container = document.getElementById('dailyBonusesContainer');
    const bonuses = incentiveData.dailyBonuses.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log('Loading daily bonuses:', bonuses);
    
    let totalBonuses = 0;
    let totalSales = 0;
    let totalCourseAdmissions = 0;
    let todayBonuses = 0;
    let oneTimeTotal = 0;
    let annualTotal = 0;
    let semesterTotal = 0;
    
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
    
    container.innerHTML = '';
    
    bonuses.forEach(bonus => {
        console.log('Processing bonus:', bonus);
        console.log('Bonus amount:', bonus.amount, 'Sales count:', bonus.salesCount);
        
        totalBonuses += (bonus.amount || 0);
        totalSales += (bonus.salesCount || 0);
        
        const bonusDate = new Date(bonus.date).toISOString().split('T')[0];
        if (bonusDate === today) {
            todayBonuses += (bonus.amount || 0);
        }
        
        // Count course admissions
        if (bonus.courseAdmissions) {
            const oneTime = bonus.courseAdmissions.onetime || 0;
            const annual = bonus.courseAdmissions.annual || 0;
            const semester = bonus.courseAdmissions.semester || 0;
            
            oneTimeTotal += oneTime;
            annualTotal += annual;
            semesterTotal += semester;
            totalCourseAdmissions += (oneTime + annual + semester);
        }
        
        const courseAdmissions = bonus.courseAdmissions || { onetime: 0, annual: 0, semester: 0 };
        const courseBreakdown = [];
        if (courseAdmissions.onetime > 0) {
            courseBreakdown.push(`${courseAdmissions.onetime} One-Time (${formatRupees(courseAdmissions.onetime * config.courseRewards.onetime)})`);
        }
        if (courseAdmissions.annual > 0) {
            courseBreakdown.push(`${courseAdmissions.annual} Annual (${formatRupees(courseAdmissions.annual * config.courseRewards.annual)})`);
        }
        if (courseAdmissions.semester > 0) {
            courseBreakdown.push(`${courseAdmissions.semester} Semester (${formatRupees(courseAdmissions.semester * config.courseRewards.semester)})`);
        }
        
        // Build course types string and calculate breakdown
        const courseTypes = [];
        let courseRewardTotal = 0;
        let dailyTargetBonus = 0;
        
        // Use stored appliedRates if available, otherwise fall back to calculation
        let onetimeReward, annualReward, semesterReward;
        
        if (bonus.appliedRates) {
            // Use the rates that were stored with the bonus
            onetimeReward = bonus.appliedRates.onetime || 0;
            annualReward = bonus.appliedRates.annual || 0;
            semesterReward = bonus.appliedRates.semester || 0;
        } else {
            // Fallback: calculate rates based on config (for old records)
            const isRewardValidForDate = (rewardDate, bonusDate) => {
                if (!rewardDate) return false;
                const rewardTime = new Date(rewardDate).getTime();
                const bonusTime = new Date(bonusDate).getTime();
                const hoursDiff = (bonusTime - rewardTime) / (1000 * 60 * 60);
                return hoursDiff >= 0 && hoursDiff <= 24;
            };
            
            onetimeReward = isRewardValidForDate(config.courseRewards.onetimeDate, bonus.date) ? config.courseRewards.onetime : 0;
            annualReward = isRewardValidForDate(config.courseRewards.annualDate, bonus.date) ? config.courseRewards.annual : 0;
            semesterReward = isRewardValidForDate(config.courseRewards.semesterDate, bonus.date) ? config.courseRewards.semester : 0;
        }
        
        if (courseAdmissions.onetime > 0) {
            const amt = courseAdmissions.onetime * onetimeReward;
            courseTypes.push(`${courseAdmissions.onetime} One-Time (${formatRupees(amt)})`);
            courseRewardTotal += amt;
        }
        if (courseAdmissions.annual > 0) {
            const amt = courseAdmissions.annual * annualReward;
            courseTypes.push(`${courseAdmissions.annual} Annual (${formatRupees(amt)})`);
            courseRewardTotal += amt;
        }
        if (courseAdmissions.semester > 0) {
            const amt = courseAdmissions.semester * semesterReward;
            courseTypes.push(`${courseAdmissions.semester} Semester (${formatRupees(amt)})`);
            courseRewardTotal += amt;
        }
        
        // Check if daily target was met
        const metDailyTarget = bonus.salesCount >= config.dailyTarget.salesCount;
        if (metDailyTarget) {
            dailyTargetBonus = config.dailyTarget.bonusAmount;
        }
        
        const courseTypeStr = courseTypes.length > 0 ? courseTypes.join('<br>') : '<span style="color: #a0aec0;">None</span>';
        
        const card = document.createElement('div');
        card.className = 'bonus-card';
        card.innerHTML = `
            <div style="display: flex; gap: 20px; align-items: stretch;">
                <!-- Left: Employee & Date Info -->
                <div style="flex: 0 0 200px; border-right: 2px solid #e2e8f0; padding-right: 15px;">
                    <div class="bonus-employee" style="font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 6px;">${bonus.employeeName}</div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
                        <i class="fas fa-calendar" style="color: #4299e1; font-size: 12px;"></i>
                        <div class="bonus-date" style="font-size: 13px; color: #4a5568; font-weight: 600;">${new Date(bonus.date).toLocaleDateString('en-US', { 
                            year: 'numeric', month: 'short', day: 'numeric' 
                        })}</div>
                    </div>
                    <div style="background: #f0f4ff; padding: 10px; border-radius: 8px; text-align: center; border: 2px solid #4299e1;">
                        <div style="font-size: 10px; color: #2c5282; font-weight: 600; margin-bottom: 3px;">TOTAL ADMISSIONS</div>
                        <div style="font-size: 24px; font-weight: 700; color: #2d3748;">${(bonus.salesCount || 0)}</div>
                    </div>
                </div>
                
                <!-- Middle: Admission Type Breakdown -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                    <div style="background: #f7fafc; padding: 12px; border-radius: 8px; border-left: 3px solid #667eea;">
                        <div style="font-size: 11px; color: #5a67d8; font-weight: 700; margin-bottom: 8px; text-transform: uppercase;">
                            <i class="fas fa-graduation-cap"></i> Admission Type Breakdown
                        </div>
                        <div style="font-size: 13px; color: #2d3748; line-height: 2;">${courseTypeStr}</div>
                    </div>
                    
                    ${bonus.universityNames ? `
                    <div style="background: #fefcf7; padding: 10px 12px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                        <div style="font-size: 10px; color: #92400e; font-weight: 700; margin-bottom: 4px;">
                            <i class="fas fa-university"></i> UNIVERSITIES
                        </div>
                        <div style="font-size: 12px; color: #2d3748;">${bonus.universityNames}</div>
                    </div>
                    ` : ''}
                    
                    ${bonus.notes ? `
                    <div style="background: #f7fafc; padding: 8px 12px; border-radius: 8px; border-left: 3px solid #a0aec0;">
                        <div style="font-size: 10px; color: #4a5568; font-weight: 700; margin-bottom: 3px;">
                            <i class="fas fa-sticky-note"></i> NOTES
                        </div>
                        <div style="font-size: 12px; color: #4a5568;">${bonus.notes}</div>
                    </div>
                    ` : ''}
                </div>
                
                <!-- Right: Total Reward -->
                <div style="flex: 0 0 180px; border-left: 2px solid #e2e8f0; padding-left: 15px; display: flex; flex-direction: column; justify-content: center;">
                    <div style="text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                                padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
                        <div style="font-size: 11px; color: rgba(255,255,255,0.9); margin-bottom: 6px; font-weight: 600; letter-spacing: 1px;">TOTAL REWARD</div>
                        <div style="font-size: 28px; font-weight: 700; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">${formatRupees(bonus.amount || 0)}</div>
                    </div>
                    ${courseRewardTotal > 0 ? `
                    <div style="margin-top: 10px; text-align: center; font-size: 11px; color: #718096;">
                        Calculated from admission types
                    </div>
                    ` : ''}
                </div>
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
    
    // Update stats if elements exist
    const totalBonusesEl = document.getElementById('totalDailyBonuses');
    const totalSalesEl = document.getElementById('totalDailySales');
    const totalAdmissionsEl = document.getElementById('totalCourseAdmissions');
    const todayBonusesEl = document.getElementById('todayBonuses');
    const oneTimeCountEl = document.getElementById('summaryOneTimeCount');
    const annualCountEl = document.getElementById('summaryAnnualCount');
    const semesterCountEl = document.getElementById('summarySemesterCount');
    
    if (totalBonusesEl) totalBonusesEl.textContent = formatRupees(totalBonuses);
    if (totalSalesEl) totalSalesEl.textContent = formatIndianNumber(totalSales);
    if (totalAdmissionsEl) totalAdmissionsEl.textContent = formatIndianNumber(totalCourseAdmissions);
    if (todayBonusesEl) todayBonusesEl.textContent = formatRupees(todayBonuses);
    if (oneTimeCountEl) oneTimeCountEl.textContent = oneTimeTotal;
    if (annualCountEl) annualCountEl.textContent = annualTotal;
    if (semesterCountEl) semesterCountEl.textContent = semesterTotal;
}

// Salary Advances
function openAdvanceModal() {
    document.getElementById('advanceDate').valueAsDate = new Date();
    document.getElementById('advanceReason').value = '';
    
    // Setup currency formatting for advance amount
    const amountInput = document.getElementById('advanceAmount');
    amountInput.value = '';
    amountInput.addEventListener('input', function() {
        formatCurrencyInput(this);
    });
    
    document.getElementById('advanceModal').style.display = 'flex';
}

function closeAdvanceModal() {
    document.getElementById('advanceModal').style.display = 'none';
    document.getElementById('advanceForm').reset();
}

async function saveAdvance(event) {
    event.preventDefault();
    
    const employees = await loadEmployees();
    const employeeId = parseInt(document.getElementById('advanceEmployee').value);
    const employee = employees.find(e => e.id === employeeId);
    const amount = getRawCurrencyValue(document.getElementById('advanceAmount'));
    
    const advance = {
        id: Date.now(),
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        date: document.getElementById('advanceDate').value,
        amount: amount,
        reason: document.getElementById('advanceReason').value,
        status: 'Outstanding',
        adjustedInSalary: false,
        adjustedMonth: null,
        addedDate: new Date().toISOString()
    };
    
    try {
        // Save to database
        await fetch(`${API_BASE_URL}/incentives/advance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(advance)
        });
        
        // Clear cache to force reload
        cachedIncentiveData = null;
        
        addLog('salary', `Salary advance given to ${advance.employeeName}: ${formatRupees(amount)} - ${advance.reason}`);
        showNotification('Salary advance recorded successfully!', 'success');
        closeAdvanceModal();
        loadSalaryAdvances();
    } catch (error) {
        console.error('Error saving advance:', error);
        showNotification('Failed to save advance', 'error');
    }
}

async function loadSalaryAdvances() {
    const incentiveData = await getIncentiveData();
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
        if (!advance.adjustedInSalary) {
            outstandingAdvances += advance.amount;
        }
        
        const advanceDate = new Date(advance.date);
        if (advanceDate.getMonth() === currentMonth && advanceDate.getFullYear() === currentYear) {
            thisMonthAdvances += advance.amount;
        }
        
        const card = document.createElement('div');
        card.className = 'advance-card';
        card.innerHTML = `
            <div class="advance-header" style="display: flex; align-items: center; gap: 15px;">
                <div style="flex: 1;">
                    <div class="advance-employee">${advance.employeeName}</div>
                    <div class="advance-date">${new Date(advance.date).toLocaleDateString('en-US', { 
                        year: 'numeric', month: 'short', day: 'numeric' 
                    })}</div>
                </div>
                <div style="flex: 2; padding: 10px 15px; background: #f7fafc; border-radius: 8px;">
                    <div style="font-size: 11px; color: #718096; margin-bottom: 3px;">Reason</div>
                    <div style="font-size: 13px; color: #2d3748;">${advance.reason}</div>
                </div>
                <div style="text-align: center;">
                    <span class="status-badge ${advance.adjustedInSalary ? 'paid' : 'pending'}">${advance.adjustedInSalary ? 'Adjusted' : 'Pending Adjustment'}</span>
                    <div style="font-size: 10px; color: #a0aec0; margin-top: 4px;">${advance.adjustedInSalary ? (advance.adjustedMonth ? `Adjusted in ${advance.adjustedMonth}` : 'Adjusted in salary') : 'Will be deducted in salary'}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; color: #718096; margin-bottom: 2px;">Amount</div>
                    <div class="advance-amount">${formatRupees(advance.amount)}</div>
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
    
    document.getElementById('totalAdvances').textContent = formatRupees(totalAdvances);
    document.getElementById('thisMonthAdvances').textContent = formatRupees(thisMonthAdvances);
    document.getElementById('outstandingAdvances').textContent = formatRupees(outstandingAdvances);
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

async function loadSalaryEmployeeFilters() {
    const allEmployees = await loadEmployees();
    const employees = allEmployees.filter(e => e.status === 'Active');
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

function getCycleDayFromHireDate(hireDate) {
    if (!hireDate) return null;
    const d = new Date(hireDate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    // Keep cycles stable across months; payroll UI supports 1-28 as safe day range.
    return Math.min(d.getDate(), 28);
}

function getSalaryCycleRange(month, hireDate) {
    const [year, mon] = month.split('-').map(Number);
    const cycleDay = getCycleDayFromHireDate(hireDate);
    if (!cycleDay) {
        const start = new Date(year, mon - 1, 1);
        const end = new Date(year, mon, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end, cycleDay: null };
    }

    const start = new Date(year, mon - 2, cycleDay);
    const end = new Date(year, mon - 1, cycleDay);
    end.setHours(23, 59, 59, 999);
    return { start, end, cycleDay };
}

// Only 'Unpaid Leave' type deducts from salary. Paid Leave uses leave balance — no salary impact.
// Returns number of unpaid leave days for the given month (format "YYYY-MM")
function getUnpaidLeaveDaysForMonth(employeeId, month, hireDate = null) {
    const cycle = getSalaryCycleRange(month, hireDate);
    const monthStart = cycle.start;
    const monthEnd = cycle.end;

    const allLeaves = getLeaves();
    // Only count Unpaid Leave type — Paid Leave has no salary deduction
    const unpaidLeaves = allLeaves.filter(l =>
        l.employeeId === employeeId &&
        l.status === 'approved' &&
        l.leaveType === 'Unpaid Leave'
    );

    let totalDaysInMonth = 0;
    for (const leave of unpaidLeaves) {
        if (leave.halfDay === true) {
            const leaveStart = new Date(leave.startDate + 'T00:00:00');
            if (leaveStart >= monthStart && leaveStart <= monthEnd) totalDaysInMonth += 0.5;
        } else {
            const leaveStart = new Date(leave.startDate + 'T00:00:00');
            const leaveEnd = new Date(leave.endDate + 'T00:00:00');
            const overlapStart = leaveStart < monthStart ? monthStart : leaveStart;
            const overlapEnd = leaveEnd > monthEnd ? monthEnd : leaveEnd;
            if (overlapStart <= overlapEnd) {
                const days = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                totalDaysInMonth += days;
                // Sandwich Sundays on this leave are also unpaid (they follow Monday's type)
                totalDaysInMonth += leave.sandwichDays || 0;
            }
        }
    }

    return totalDaysInMonth;
}

async function getOutstandingAdvanceForEmployee(employeeId, month) {
    const incentiveData = await getIncentiveData();
    const payments = incentiveData.salaryPayments || {};
    const advances = (incentiveData.salaryAdvances || []).filter(a => {
        if (a.employeeId !== employeeId) return false;
        if (a.status === 'Repaid' || a.repaid) return false;
        if (a.status !== 'Outstanding') return false;
        // Exclude if this advance was already deducted in a salary paid before `month`
        if (a.date && month) {
            const advMonth = a.date.substring(0, 7); // YYYY-MM
            const alreadyDeducted = Object.entries(payments).some(([key, val]) => {
                if (!val.paid) return false;
                const payMonth = key.substring(0, 7);
                const payEmp   = key.substring(8);
                if (parseInt(payEmp) !== employeeId) return false;
                // Settled if a paid salary exists in [advMonth, month)
                return payMonth >= advMonth && payMonth < month;
            });
            if (alreadyDeducted) return false;
        }
        return true;
    });
    return advances.reduce((total, advance) => total + advance.amount, 0);
}

async function getSalaryPaymentStatus(employeeId, month) {
    const incentiveData = await getIncentiveData();
    if (!incentiveData.salaryPayments) {
        return { paid: false };
    }
    
    const key = `${month}_${employeeId}`;
    return incentiveData.salaryPayments[key] || { paid: false };
}

async function markSalaryPaid(employeeId, employeeName, month, grossSalary, deductions, netSalary) {
    try {
        const key = `${month}_${employeeId}`;
        
        // Save to incentives collection (used by salary crediting tab)
        await fetch(`${API_BASE_URL}/incentives/salary-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: key,
                data: {
                    paid: true,
                    paidDate: new Date().toISOString(),
                    grossSalary,
                    deductions,
                    netSalary
                }
            })
        });

        // Also sync to salary-payments collection so dashboard notification clears
        try {
            const [yearStr, monthStr] = (month || '').split('-');
            const monthNum = parseInt(monthStr, 10);
            const yearNum  = parseInt(yearStr,  10);
            if (monthNum && yearNum) {
                await fetch(`${API_BASE_URL}/salary-payments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId, month: monthNum, year: yearNum })
                });
            }
        } catch (_) { /* non-critical */ }

        // Auto-mark all outstanding advances for this employee as repaid
        // (they were included in the deductions for this salary payment)
        try {
            const allData = await fetch(`${API_BASE_URL}/incentives/data`).then(r => r.json());
            const outstandingAdvances = (allData.salaryAdvances || []).filter(a =>
                (a.employeeId === employeeId || a.employeeId === String(employeeId)) &&
                a.status !== 'Repaid' && !a.repaid
            );
            for (const adv of outstandingAdvances) {
                await fetch(`${API_BASE_URL}/incentives/advance/${adv.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Repaid', repaid: true, repaidDate: new Date().toISOString(), adjustedInSalary: true, adjustedMonth: month })
                });
            }
        } catch (_) { /* non-critical — advance marking failed but salary is still paid */ }
        
        // Clear cache to force reload
        cachedIncentiveData = null;
        
        addLog('salary', `Salary credited to ${employeeName} for ${month}: ${formatRupees(netSalary)} (Gross: ${formatRupees(grossSalary)}, Deductions: ${formatRupees(deductions)})`);
        showNotification('Salary marked as paid!', 'success');
        await loadSalaryCrediting();
    } catch (error) {
        console.error('Error marking salary as paid:', error);
        showNotification('Failed to mark salary as paid', 'error');
    }
}

// Returns number of half-day-equivalent leave days accumulated from late attendance this month
async function getHalfDayAttendanceDaysForMonth(employeeId, month, hireDate = null) {
    // Read settings saved by attendance page
    let settings = { officeStartTime: '09:00', lateThresholdMins: 10, lateDaysHalfDay: 3 };
    try {
        const saved = localStorage.getItem('attendanceSettings');
        if (saved) settings = { ...settings, ...JSON.parse(saved) };
    } catch (e) {}

    // Fetch attendance records for the month (and previous month for shifted cycles)
    let docs = [];
    try {
        const res = await fetch(`${API_BASE_URL}/attendance/month/${month}`);
        if (res.ok) docs = await res.json();
    } catch (e) {}

    const [y, m] = month.split('-').map(Number);
    const prevMonthKey = m === 1
        ? `${y - 1}-12`
        : `${y}-${String(m - 1).padStart(2, '0')}`;
    try {
        const prevRes = await fetch(`${API_BASE_URL}/attendance/month/${prevMonthKey}`);
        if (prevRes.ok) {
            const prevDocs = await prevRes.json();
            docs = docs.concat(prevDocs || []);
        }
    } catch (e) {}

    // Also check localStorage
    Object.keys(localStorage)
        .filter(k => k.startsWith(`attendance_${month}`))
        .forEach(k => {
            const date = k.replace('attendance_', '');
            if (!docs.find(d => d.date === date)) {
                try { docs.push({ date, records: JSON.parse(localStorage.getItem(k)) }); } catch (e) {}
            }
        });
    Object.keys(localStorage)
        .filter(k => k.startsWith(`attendance_${prevMonthKey}`))
        .forEach(k => {
            const date = k.replace('attendance_', '');
            if (!docs.find(d => d.date === date)) {
                try { docs.push({ date, records: JSON.parse(localStorage.getItem(k)) }); } catch (e) {}
            }
        });

    const cycle = getSalaryCycleRange(month, hireDate);
    const allLeaves = getLeaves();
    const hasFullDayLeaveOnDate = (dateStr) => allLeaves.some(l => {
        const isSameEmployee = (l.employeeId === employeeId || l.employeeId === String(employeeId));
        const isApproved = l.status === 'approved';
        const inRange = dateStr >= l.startDate && dateStr <= l.endDate;
        const isHalfDayLeave = l.halfDay === true || l.leaveType === 'Half Day';
        return isSameEmployee && isApproved && inRange && !isHalfDayLeave;
    });

    // Count late days for this employee
    const [oh, om] = settings.officeStartTime.split(':').map(Number);
    let lateDays = 0;
    docs.forEach(doc => {
        const docDate = new Date((doc.date || '') + 'T00:00:00');
        if (Number.isNaN(docDate.getTime()) || docDate < cycle.start || docDate > cycle.end) return;
        if (hasFullDayLeaveOnDate(doc.date || '')) return;
        const rec = (doc.records || {})[employeeId];
        if (rec && rec.time) {
            const [eh, em] = rec.time.split(':').map(Number);
            const minsLate = (eh * 60 + em) - (oh * 60 + om);
            if (minsLate > settings.lateThresholdMins) lateDays++;
        }
    });

    const halfDays = Math.floor(lateDays / settings.lateDaysHalfDay);
    return halfDays * 0.5; // each half-day = 0.5 leave days
}

// ── Salary-due-tomorrow reminder banner (inside Salary Crediting tab) ──────
async function loadSalaryDueReminders() {
    const banner = document.getElementById('salaryDueReminderBanner');
    if (!banner) return;

    const allEmployees = getEmployees().filter(e => e.status === 'Active' && e.salaryDay);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowDay = tomorrow.getDate();
    const currentMonth = document.getElementById('salaryMonthFilter')?.value || '';

    // Employees whose salary day is tomorrow
    const due = allEmployees.filter(e => parseInt(e.salaryDay) === tomorrowDay);
    if (!due.length) { banner.style.display = 'none'; return; }

    // Check which are already paid for current month using the incentive data
    const unpaid = [];
    for (const emp of due) {
        const status = await getSalaryPaymentStatus(emp.id, currentMonth);
        if (!status.paid) unpaid.push(emp);
    }

    if (!unpaid.length) { banner.style.display = 'none'; return; }

    banner.style.display = 'block';
    banner.innerHTML = `
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:10px;padding:16px 20px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <i class="fas fa-bell" style="color:#f59e0b;font-size:16px;"></i>
                <span style="font-weight:700;font-size:15px;color:#92400e;">
                    Salary Due Tomorrow
                </span>
                <span style="background:#f59e0b;color:#fff;border-radius:20px;padding:2px 9px;font-size:12px;font-weight:700;">
                    ${unpaid.length}
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${unpaid.map(emp => `
                <div id="salary-due-row-${emp.id}" style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;gap:12px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:34px;height:34px;border-radius:50%;background:#fef3c7;display:flex;align-items:center;justify-content:center;font-weight:700;color:#92400e;font-size:13px;">
                            ${(emp.firstName?.[0]||'')+(emp.lastName?.[0]||'')}
                        </div>
                        <div>
                            <div style="font-weight:600;color:#1a202c;font-size:14px;">${emp.firstName} ${emp.lastName}</div>
                            <div style="font-size:12px;color:#718096;">${emp.department} · Salary day: <strong>${emp.salaryDay}</strong> · Gross: <strong>${formatRupees(parseFloat(emp.salary)||0)}</strong></div>
                        </div>
                    </div>
                    <button onclick="markSalaryPaidFromReminder(${emp.id}, '${emp.firstName} ${emp.lastName}', '${currentMonth}')"
                        style="background:#10b981;color:#fff;border:none;padding:7px 16px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
                        <i class="fas fa-check"></i> Mark as Paid
                    </button>
                </div>`).join('')}
            </div>
        </div>`;
}

async function markSalaryPaidFromReminder(employeeId, employeeName, month) {
    const allEmployees = getEmployees();
    const emp = allEmployees.find(e => e.id === employeeId);
    if (!emp) return;
    const grossSalary = parseFloat(emp.salary) || 0;
    // Use 0 for deductions here — full breakdown is visible in the salary crediting cards below
    await markSalaryPaid(employeeId, employeeName, month, grossSalary, 0, grossSalary);
    // Remove the row from the reminder banner
    const row = document.getElementById(`salary-due-row-${employeeId}`);
    if (row) row.remove();
    // Hide banner if no rows remain
    const banner = document.getElementById('salaryDueReminderBanner');
    if (banner && !banner.querySelector('[id^="salary-due-row-"]')) {
        banner.style.display = 'none';
    }
}
function toggleSalaryDetails(cardId) {
    const details = document.getElementById(cardId);
    const chevron = document.getElementById('chevron-' + cardId);
    if (!details) return;
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ────────────────────────────────────────────────────────────────────────────

async function loadSalaryCrediting() {
    const month = document.getElementById('salaryMonthFilter').value;
    const employeeFilter = document.getElementById('salaryEmployeeFilter').value;
    const departmentFilter = document.getElementById('salaryDepartmentFilter').value;
    const allEmployees = await loadEmployees();
    const employees = allEmployees.filter(e => e.status === 'Active');
    const container = document.getElementById('salaryCreditingContainer');

    // Refresh salary-due reminders whenever this tab reloads
    loadSalaryDueReminders();
    
    let totalGross = 0;
    let totalIncentives = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    
    container.innerHTML = '';
    
    for (const emp of employees) {
        if (employeeFilter && emp.id !== parseInt(employeeFilter)) continue;
        if (departmentFilter && emp.department !== departmentFilter) continue;
        
        const grossSalary = parseFloat(emp.salary) || 0;
        const dailyRate = grossSalary / 30;
        const cycle = getSalaryCycleRange(month, emp.hireDate);

        // Pro-rate salary if employee joined during this month
        let effectiveGross = grossSalary;
        let joiningDays = 0;
        if (emp.hireDate) {
            const hireDate = new Date(emp.hireDate + 'T00:00:00');
            if (hireDate > cycle.start && hireDate <= cycle.end) {
                joiningDays = Math.floor((cycle.end - hireDate) / 86400000) + 1;
                effectiveGross = Math.round(dailyRate * joiningDays * 100) / 100;
            }
        }

        const outstandingAdvance = await getOutstandingAdvanceForEmployee(emp.id, month);

        // Unpaid leave deduction: daily rate × unpaid leave days (1 paid leave/month policy, 30-day basis)
        const unpaidLeaveDays = getUnpaidLeaveDaysForMonth(emp.id, month, emp.hireDate);
        const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate * 100) / 100;

        // Half-day attendance deduction: each accumulated half-day = 0.5 day × daily rate
        const halfDayAttDays = await getHalfDayAttendanceDaysForMonth(emp.id, month, emp.hireDate);
        const halfDayAttDeduction = Math.round(halfDayAttDays * dailyRate * 100) / 100;
        
        // Calculate monthly incentive if sales department
        let monthlyIncentive = 0;
        if (emp.department === 'Sales') {
            const incentiveCalc = await calculateMonthlyIncentive(emp.id, month);
            if (incentiveCalc.eligible) {
                monthlyIncentive = incentiveCalc.amount;
            }
        }
        
        const totalEarnings = effectiveGross + monthlyIncentive;
        const totalDeductionsAmt = outstandingAdvance + unpaidLeaveDeduction + halfDayAttDeduction;
        const netSalary = totalEarnings - totalDeductionsAmt;
        
        const paymentStatus = await getSalaryPaymentStatus(emp.id, month);
        
        totalGross += effectiveGross;
        totalIncentives += monthlyIncentive;
        totalDeductions += totalDeductionsAmt;
        totalNet += netSalary;
        
        const cardId = `salary-card-${emp.id}`;
        const card = document.createElement('div');
        card.className = 'employee-incentive-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="employee-header" onclick="toggleSalaryDetails('${cardId}')" style="user-select:none;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;border-radius:50%;background:#667eea22;display:flex;align-items:center;justify-content:center;font-weight:700;color:#667eea;font-size:15px;flex-shrink:0;">
                        ${(emp.firstName?.[0]||'').toUpperCase()}${(emp.lastName?.[0]||'').toUpperCase()}
                    </div>
                    <div>
                        <div class="employee-name">${emp.firstName} ${emp.lastName}</div>
                        <div class="employee-dept">${emp.position} · ${emp.department}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="text-align:right;">
                        <div style="font-size:11px;color:#718096;margin-bottom:2px;">Net Payable</div>
                        <div style="font-size:18px;font-weight:700;color:${paymentStatus.paid ? '#38ef7d' : '#667eea'};">${formatRupees(netSalary)}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                        ${!paymentStatus.paid
                            ? `<button class="btn-sm success" onclick="event.stopPropagation();markSalaryPaid(${emp.id}, '${emp.firstName} ${emp.lastName}', '${month}', ${totalEarnings}, ${totalDeductionsAmt}, ${netSalary})">
                                <i class="fas fa-check"></i> Mark Paid
                               </button>`
                            : `<span style="color:#38ef7d;font-weight:600;font-size:13px;"><i class="fas fa-check-circle"></i> Paid</span>`
                        }
                        <span style="font-size:11px;color:#718096;">
                            <i class="fas fa-chevron-down" id="chevron-${cardId}" style="transition:transform 0.2s;"></i> Details
                        </span>
                    </div>
                </div>
            </div>

            <div id="${cardId}" style="display:none;margin-top:16px;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">
                <div class="incentive-summary">
                    <div class="incentive-box">
                        <label>${joiningDays > 0 ? `Salary (${joiningDays}d in cycle × ₹${Math.round(dailyRate)}/day)` : 'Gross Salary'}</label>
                        <div class="value">${formatRupees(effectiveGross)}${joiningDays > 0 ? `<span style="font-size:11px;color:#6b7280;display:block;">Full: ${formatRupees(grossSalary)}</span>` : ''}</div>
                    </div>
                    ${monthlyIncentive > 0 ? `
                    <div class="incentive-box">
                        <label>Monthly Incentive</label>
                        <div class="value" style="color:#38ef7d;">+ ${formatRupees(monthlyIncentive)}</div>
                    </div>` : ''}
                    ${unpaidLeaveDeduction > 0 ? `
                    <div class="incentive-box">
                        <label>Unpaid Leave (${unpaidLeaveDays}d × ₹${Math.round(dailyRate)})</label>
                        <div class="value" style="color:#f5576c;">- ${formatRupees(unpaidLeaveDeduction)}</div>
                    </div>` : ''}
                    ${halfDayAttDeduction > 0 ? `
                    <div class="incentive-box">
                        <label>Late Half Days (${halfDayAttDays}d × ₹${Math.round(dailyRate)})</label>
                        <div class="value" style="color:#f5576c;">- ${formatRupees(halfDayAttDeduction)}</div>
                    </div>` : ''}
                    <div class="incentive-box">
                        <label>Outstanding Advances</label>
                        <div class="value" style="color:${outstandingAdvance > 0 ? '#f5576c' : '#718096'};">- ${formatRupees(outstandingAdvance)}</div>
                    </div>
                    <div class="incentive-box">
                        <label>Net Payable</label>
                        <div class="value" style="color:#667eea;font-size:24px;font-weight:700;">${formatRupees(netSalary)}</div>
                    </div>
                </div>
                ${joiningDays > 0 ? `
                <div style="margin-top:12px;padding:12px;background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;">
                    <small style="color:#1d4ed8;font-weight:600;"><i class="fas fa-user-plus"></i> Joined inside cycle: ${joiningDays} day${joiningDays !== 1 ? 's' : ''} worked (from ${new Date(emp.hireDate+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}) × ₹${Math.round(dailyRate)}/day = ${formatRupees(effectiveGross)}</small>
                </div>` : ''}
                ${monthlyIncentive > 0 ? `
                <div style="margin-top:12px;padding:12px;background:#f0fff4;border-left:4px solid #38ef7d;border-radius:6px;">
                    <small style="color:#22543d;font-weight:600;"><i class="fas fa-star"></i> Performance incentive included: ${formatRupees(monthlyIncentive)}</small>
                </div>` : ''}
                ${unpaidLeaveDays > 0 ? `
                <div style="margin-top:12px;padding:12px;background:#fff5f5;border-left:4px solid #f5576c;border-radius:6px;">
                    <small style="color:#c53030;font-weight:600;"><i class="fas fa-calendar-times"></i> Unpaid leave: ${unpaidLeaveDays} day${unpaidLeaveDays !== 1 ? 's' : ''} × ${formatRupees(Math.round(dailyRate))}/day = ${formatRupees(unpaidLeaveDeduction)}</small>
                </div>` : ''}
                ${halfDayAttDeduction > 0 ? `
                <div style="margin-top:12px;padding:12px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;">
                    <small style="color:#92400e;font-weight:600;"><i class="fas fa-adjust"></i> Late half-day: ${halfDayAttDays} day${halfDayAttDays !== 0.5 ? 's' : ''} × ${formatRupees(Math.round(dailyRate))}/day = ${formatRupees(halfDayAttDeduction)}</small>
                </div>` : ''}
                ${outstandingAdvance > 0 ? `
                <div style="margin-top:12px;padding:12px;background:#fff5f5;border-left:4px solid #f5576c;border-radius:6px;">
                    <small style="color:#c53030;font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Advance deduction: ${formatRupees(outstandingAdvance)}</small>
                </div>` : ''}
            </div>
        `;

        container.appendChild(card);
    }
    
    if (container.children.length === 0) {
        container.innerHTML = `
            <div class="no-data-message">
                <i class="fas fa-wallet"></i>
                <h3>No Employees Found</h3>
                <p>No active employees match the selected filters.</p>
            </div>
        `;
    }
    
    document.getElementById('totalGrossSalary').textContent = formatRupees(totalGross);
    document.getElementById('totalIncentivesAdded').textContent = formatRupees(totalIncentives);
    document.getElementById('totalDeductions').textContent = formatRupees(totalDeductions);
    document.getElementById('totalNetPayable').textContent = formatRupees(totalNet);
}

// Initialize page
document.addEventListener('DOMContentLoaded', async function() {
    checkDBStatus();
    initializeMonthFilters();
    initializeSalaryMonthFilters();
    await loadEmployeeFilters();
    await loadSalaryEmployeeFilters();
    await loadMonthlyIncentives();
    
    // Event delegation for admission type inputs - fires on any input in the document
    document.addEventListener('input', function(event) {
        const target = event.target;
        if (target.id === 'oneTimeCount' || target.id === 'annualCount' || target.id === 'semesterCount') {
            console.log(`📊 ${target.id} changed to:`, target.value);
            console.log('🔍 Checking for duplicate IDs...');
            
            // Check if there are multiple elements with the same ID
            const allElements = document.querySelectorAll(`#${target.id}`);
            console.log(`Found ${allElements.length} elements with id="${target.id}"`);
            allElements.forEach((el, idx) => {
                console.log(`  [${idx}] value="${el.value}", visible=${el.offsetParent !== null}`);
            });
            
            calculateDailyReward();
        }
    });
    
    // Event delegation for date change
    document.addEventListener('change', function(event) {
        if (event.target.id === 'bonusDate') {
            console.log('📅 Date changed to:', event.target.value);
            onDateChange();
        }
    });
    
    console.log('✅ Event delegation set up for admission inputs');
    
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
window.updateRewardRates = updateRewardRates;
window.saveDailyBonus = saveDailyBonus;
window.openAdvanceModal = openAdvanceModal;
window.closeAdvanceModal = closeAdvanceModal;
window.saveAdvance = saveAdvance;
window.markIncentivePaid = markIncentivePaid;
window.markAdvanceRepaid = markAdvanceRepaid;
window.markSalaryPaid = markSalaryPaid;
window.markSalaryPaidFromReminder = markSalaryPaidFromReminder;
window.loadSalaryDueReminders = loadSalaryDueReminders;
window.loadMonthlyIncentives = loadMonthlyIncentives;
window.loadSalaryCrediting = loadSalaryCrediting;
window.getSalesData = getSalesData;
