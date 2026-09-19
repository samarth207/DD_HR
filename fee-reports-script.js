(function() {
    let feeCharts = {};

    function getAuthHeaders() {
        return {};
    }

    function getCurrentMonthKey() {
        const dt = new Date();
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }

    function populateMonthFilter() {
        const select = document.getElementById('feeMonthFilter');
        const current = new Date();
        select.innerHTML = '<option value="">All Months</option>';
        for (let i = -12; i <= 1; i++) {
            const dt = new Date(current.getFullYear(), current.getMonth() + i, 1);
            const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
            const option = document.createElement('option');
            option.value = key;
            option.textContent = dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            if (key === getCurrentMonthKey()) option.selected = true;
            select.appendChild(option);
        }
    }

    async function fetchAdmissions() {
        const response = await fetch(`${API_BASE_URL}/admissions`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to load admissions');
        return response.json();
    }

    function destroyChart(id) {
        if (feeCharts[id]) {
            feeCharts[id].destroy();
            delete feeCharts[id];
        }
    }

    function renderCards(metrics) {
        document.getElementById('feeOutstanding').textContent = formatRupees(metrics.outstanding);
        document.getElementById('feeCollected').textContent = formatRupees(metrics.collected);
        document.getElementById('feePending').textContent = formatIndianNumber(metrics.pending);
        document.getElementById('feeDiscount').textContent = formatRupees(metrics.discount);

        document.getElementById('feeOutstandingSub').textContent = `${formatIndianNumber(metrics.admissionsCount)} admissions`;
        document.getElementById('feeCollectedSub').textContent = `${formatIndianNumber(metrics.installmentsCount)} installments`;
        document.getElementById('feePendingSub').textContent = `${formatRupees(metrics.pendingAmount)} pending amount`;
    }

    function renderBreakdownChart(metrics) {
        destroyChart('breakdown');
        const ctx = document.getElementById('feeBreakdownChart').getContext('2d');
        feeCharts.breakdown = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Outstanding', 'Collected', 'Discount'],
                datasets: [{
                    data: [metrics.outstanding, metrics.collected, metrics.discount],
                    backgroundColor: ['#ef4444', '#10b981', '#6366f1'],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    function renderTrendChart(series) {
        destroyChart('trend');
        const ctx = document.getElementById('feeTrendChart').getContext('2d');
        feeCharts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: series.map((row) => row.month),
                datasets: [
                    {
                        label: 'Outstanding',
                        data: series.map((row) => row.outstanding),
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.15)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Collected',
                        data: series.map((row) => row.collected),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.08)',
                        tension: 0.3,
                        fill: false
                    },
                    {
                        label: 'Discount',
                        data: series.map((row) => row.discount),
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99,102,241,0.08)',
                        tension: 0.3,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    function renderTable(admissions, monthFilter) {
        const tbody = document.getElementById('feeTableBody');
        const scoped = monthFilter
            ? admissions.filter((item) => FeeReportingUtils.getAdmissionMonthKey(item) === monthFilter)
            : admissions;

        if (!scoped.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;">No records found</td></tr>';
            return;
        }

        tbody.innerHTML = scoped.map((admission, index) => {
            const rows = FeeReportingUtils.extractInstallments(admission);
            const summary = FeeReportingUtils.summarizeInstallments(rows);
            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${admission.customerName || '—'}</td>
                    <td>${FeeReportingUtils.getAdmissionMonthKey(admission) || '—'}</td>
                    <td>${formatRupees(summary.outstanding)}</td>
                    <td>${formatRupees(summary.collected)}</td>
                    <td>${formatRupees(summary.discount)}</td>
                    <td>${summary.pendingCount}</td>
                </tr>
            `;
        }).join('');
    }

    async function renderFeeReports() {
        try {
            const admissions = await fetchAdmissions();
            const monthFilter = document.getElementById('feeMonthFilter').value;
            const metrics = FeeReportingUtils.buildFeeReportMetrics(admissions, { month: monthFilter });
            const series = FeeReportingUtils.buildFeeMonthlySeries(admissions);

            renderCards(metrics);
            renderBreakdownChart(metrics);
            renderTrendChart(series);
            renderTable(admissions, monthFilter);
        } catch (error) {
            showNotification('Unable to load fee reports', 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        populateMonthFilter();
        document.getElementById('feeMonthFilter').addEventListener('change', renderFeeReports);
        document.getElementById('feeRefreshBtn').addEventListener('click', renderFeeReports);
        renderFeeReports();
    });
}());
