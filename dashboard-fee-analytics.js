(function() {
    let dashFeeCharts = {};

    function getCurrentMonthKey() {
        const dt = new Date();
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }

    function destroyChart(name) {
        if (dashFeeCharts[name]) {
            dashFeeCharts[name].destroy();
            delete dashFeeCharts[name];
        }
    }

    async function fetchAdmissions() {
        const response = await fetch(`${API_BASE_URL}/admissions`);
        if (!response.ok) throw new Error('Unable to load admissions');
        return response.json();
    }

    function renderCards(metrics) {
        document.getElementById('dashFeeOutstanding').textContent = formatRupees(metrics.outstanding);
        document.getElementById('dashFeeCollected').textContent = formatRupees(metrics.collected);
        document.getElementById('dashFeePending').textContent = formatIndianNumber(metrics.pending);
        document.getElementById('dashFeeDiscount').textContent = formatRupees(metrics.discount);

        document.getElementById('dashFeeOutstandingSub').textContent = `${formatIndianNumber(metrics.admissionsCount)} admissions`;
        document.getElementById('dashFeeCollectedSub').textContent = `${formatIndianNumber(metrics.installmentsCount)} installments`; 
        document.getElementById('dashFeePendingSub').textContent = `${formatRupees(metrics.pendingAmount)} pending amount`;
        document.getElementById('dashFeeDiscountSub').textContent = 'Current month discount';
    }

    function renderMixChart(metrics) {
        destroyChart('mix');
        const canvas = document.getElementById('dashFeeMixChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const ctx = canvas.getContext('2d');
        dashFeeCharts.mix = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Outstanding', 'Collected', 'Discount'],
                datasets: [{
                    data: [metrics.outstanding, metrics.collected, metrics.discount],
                    backgroundColor: ['#ef4444', '#10b981', '#6366f1'],
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    function renderTrendChart(series) {
        destroyChart('trend');
        const canvas = document.getElementById('dashFeeTrendChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const recent = series.slice(-6);
        const ctx = canvas.getContext('2d');
        dashFeeCharts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: recent.map((row) => row.month),
                datasets: [
                    {
                        label: 'Outstanding',
                        data: recent.map((row) => row.outstanding),
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.12)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Collected',
                        data: recent.map((row) => row.collected),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.08)',
                        fill: false,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    async function renderDashboardFeeAnalytics() {
        try {
            if (!window.FeeReportingUtils) return;
            const admissions = await fetchAdmissions();
            const month = getCurrentMonthKey();
            const metrics = FeeReportingUtils.buildFeeReportMetrics(admissions, { month });
            const series = FeeReportingUtils.buildFeeMonthlySeries(admissions);

            renderCards(metrics);
            renderMixChart(metrics);
            renderTrendChart(series);
        } catch (error) {
            if (typeof console !== 'undefined') {
                console.warn('Fee analytics load failed:', error.message || error);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        renderDashboardFeeAnalytics();
    });

    window.renderDashboardFeeAnalytics = renderDashboardFeeAnalytics;
}());
