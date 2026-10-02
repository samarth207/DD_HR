(function() {
    let modal;
    let content;
    let message;
    let activeAdmission;
    let activeSchedule;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatCurrency(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '\u20B90.00';
        return `\u20B9${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }

    function isManagementUser() {
        const role = typeof window.getAuthRole === 'function' ? window.getAuthRole() : '';
        return role === 'admin' || role === 'hr';
    }

    async function apiRequest(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Request failed. Please try again.');
        return payload;
    }

    function ensureModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'admissionReregistrationModal';
        modal.className = 'modal rereg-modal';
        modal.innerHTML = `
            <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="reregTitle">
                <div class="modal-header">
                    <div class="modal-header-copy">
                        <h2 id="reregTitle">Semester / Year Fees</h2>
                        <p id="reregSubtitle"></p>
                    </div>
                    <button type="button" class="close-btn" data-rereg-close aria-label="Close fee schedule">&times;</button>
                </div>
                <div class="rereg-content" id="reregContent"></div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-rereg-close>Close</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        content = modal.querySelector('#reregContent');
        message = document.createElement('div');
        message.className = 'rereg-message';
        message.hidden = true;
        content.before(message);

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-rereg-close]')) closeModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.classList.contains('show')) closeModal();
        });
    }

    function showMessage(text, isError = false) {
        message.textContent = text;
        message.classList.toggle('error', isError);
        message.hidden = !text;
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('show');
        activeAdmission = null;
        activeSchedule = null;
    }

    function statusPresentation(period) {
        if (!period.applicable || period.status === 'na') return { label: 'NA', className: 'na' };
        if (period.status === 'paid') return { label: 'Paid', className: 'paid' };
        return { label: 'Unpaid', className: 'pending' };
    }

    function renderSchedule(admission, schedule, summary) {
        const config = schedule.courseConfigSnapshot?.reRegistration || {};
        const configuredType = schedule.reRegistrationType || config.type;
        const type = configuredType === 'semester-wise' ? 'Semester-wise' : configuredType === 'yearly' ? 'Yearly' : configuredType === 'one-time' ? 'One-time (no semester/year fees)' : 'Unconfigured';
        const periods = Array.isArray(schedule.periods) ? schedule.periods : [];
        document.getElementById('reregSubtitle').textContent = `${admission.customerName || 'Admission'} · ${admission.course || schedule.courseName || 'Course'}`;

        content.innerHTML = `
            <div class="rereg-info-grid">
                <div class="rereg-info-item"><span>Student</span>${escapeHtml(admission.customerName || '—')}</div>
                <div class="rereg-info-item"><span>Course</span>${escapeHtml(admission.course || schedule.courseName || '—')}</div>
                <div class="rereg-info-item"><span>Admission Year</span>${escapeHtml(admission.admissionYear ?? 'Unallocated')}</div>
                <div class="rereg-info-item"><span>Drive</span>${escapeHtml(admission.admissionDrive || 'Unallocated')}</div>
                <div class="rereg-info-item"><span>Course Fee Schedule</span>${type}</div>
                <div class="rereg-info-item"><span>Applicable Periods</span>${Number(summary.applicablePeriodCount) || 0} of ${Number(summary.periodCount) || 0}</div>
            </div>
            <div class="rereg-summary" aria-label="Semester and year fee summary">
                <div class="rereg-summary-item"><span>Total Scheduled Fees</span><strong>${formatCurrency(summary.applicableFees)}</strong></div>
                <div class="rereg-summary-item"><span>Total Paid</span><strong>${formatCurrency(summary.paidAmount)}</strong></div>
                <div class="rereg-summary-item"><span>Pending Fees</span><strong>${formatCurrency(summary.pendingAmount ?? summary.outstandingAmount)}</strong></div>
            </div>
            <div class="rereg-table-wrap">
                <table class="rereg-table">
                    <thead><tr><th>Period</th><th>Period Fee</th><th>Amount Paid</th><th>Payment Status</th></tr></thead>
                    <tbody>${periods.length ? periods.map((period) => {
                        const status = statusPresentation(period);
                        const fee = period.applicable ? formatCurrency(period.applicableFee) : '—';
                        const periodNumber = period.academicYearNumber || period.semesterNumber;
                        const meta = periodNumber ? ` · Period ${escapeHtml(periodNumber)}` : '';
                        const paidAmount = period.status === 'paid' ? formatCurrency(period.paidAmount) : formatCurrency(0);
                        return `<tr>
                            <td><span class="rereg-period-label">${escapeHtml(period.periodLabel)}</span><span class="rereg-period-meta">${escapeHtml(period.periodId)}${meta}</span></td>
                            <td>${fee}</td>
                            <td>${paidAmount}</td>
                            <td><span class="rereg-status ${status.className}">${status.label}</span></td>
                        </tr>`;
                    }).join('') : `<tr><td colspan="4">${escapeHtml(schedule.configurationError || 'No semester/year fee periods are present in this Live Fee Calculation.')}</td></tr>`}</tbody>
                </table>
            </div>
            <p class="rereg-footer-note">Period fees and payment status are read from this admission's saved Live Fee Calculation. Update them through the existing admission fee workflow; this view does not create a new admission or payment record.</p>`;
    }

    async function loadSchedule(admission, announce = '') {
        const admissionId = encodeURIComponent(String(admission._id || admission.id || ''));
        const [periodData, detailData] = await Promise.all([
            apiRequest(`/admissions/${admissionId}/re-registration-periods`),
            apiRequest(`/admissions/${admissionId}/re-registration-summary`)
        ]);
        const schedule = {
            admissionId: admission._id || admission.id,
            courseName: admission.course || '',
            courseConfigSnapshot: admission.courseReRegistrationSnapshot || {},
            reRegistrationType: periodData.reRegistrationType || detailData.reRegistrationType,
            configurationError: periodData.configurationError || detailData.configurationError,
            periods: Array.isArray(detailData.periods) ? detailData.periods : (periodData.data || [])
        };
        activeSchedule = schedule;
        renderSchedule(admission, schedule, detailData.summary || {});
        showMessage(announce);
    }

    async function openAdmissionReregistration(admission) {
        ensureModal();
        activeAdmission = admission;
        activeSchedule = null;
        content.innerHTML = '<div class="no-data">Loading scheduled semester/year fees...</div>';
        showMessage('');
        modal.classList.add('show');
        try {
            await loadSchedule(admission);
        } catch (error) {
            content.innerHTML = '';
            showMessage(error.message || 'Unable to load scheduled fees.', true);
        }
    }

    async function openAdmissionReregistrationById(admissionId) {
        ensureModal();
        content.innerHTML = '<div class="no-data">Loading admission...</div>';
        showMessage('');
        modal.classList.add('show');
        try {
            const admission = await apiRequest(`/admissions/${encodeURIComponent(admissionId)}`);
            await openAdmissionReregistration(admission);
        } catch (error) {
            content.innerHTML = '';
            showMessage(error.message || 'Unable to load this admission.', true);
        }
    }

    window.openAdmissionReregistration = openAdmissionReregistration;
    window.openAdmissionReregistrationById = openAdmissionReregistrationById;
}());