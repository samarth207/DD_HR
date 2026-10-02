(function() {
    const role = typeof window.getAuthRole === 'function' ? window.getAuthRole() : '';
    const management = role === 'admin' || role === 'hr';
    const state = {
        view: 'combined',
        year: String(new Date().getFullYear()),
        drive: 'all',
        courseId: 'all',
        reRegistrationType: 'all',
        paymentStatus: 'all',
        admissionStatus: 'all',
        employeeId: 'all',
        search: '',
        page: 1,
        limit: 25,
        debounce: null
    };
    const markingPaid = new Set();
    let pendingMarkPaid = null;

    const elements = {
        year: document.getElementById('filterYear'),
        drive: document.getElementById('filterDrive'),
        course: document.getElementById('filterCourse'),
        type: document.getElementById('filterType'),
        paymentStatus: document.getElementById('filterPaymentStatus'),
        employee: document.getElementById('filterEmployee'),
        admissionStatus: document.getElementById('filterAdmissionStatus'),
        search: document.getElementById('filterSearch'),
        employeeWrap: document.getElementById('employeeFilterWrap'),
        heading: document.getElementById('allocationHeading'),
        subtitle: document.getElementById('allocationSubtitle'),
        message: document.getElementById('allocationMessage'),
        metrics: document.getElementById('allocationMetrics'),
        breakdown: document.getElementById('allocationBreakdown'),
        periodTables: document.getElementById('reregistrationTables'),
        markPaidDialog: document.getElementById('markPaidDialog'),
        markPaidDialogMessage: document.getElementById('markPaidDialogMessage'),
        markPaidDialogError: document.getElementById('markPaidDialogError'),
        confirmMarkPaid: document.getElementById('confirmMarkPaid'),
        rows: document.getElementById('allocationRows'),
        recordsHeading: document.getElementById('recordsHeading'),
        recordCount: document.getElementById('recordCount'),
        paginationText: document.getElementById('paginationText'),
        previous: document.getElementById('previousPage'),
        next: document.getElementById('nextPage')
    };

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
        if (!Number.isFinite(amount)) return '\u20B90';
        return `\u20B9${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }

    function formatViewName() {
        const names = {
            'drive-1': 'Drive 1 Admissions',
            'drive-2': 'Drive 2 Admissions',
            combined: 'Combined Admission Summary'
        };
        const name = names[state.view] || names.combined;
        return state.view !== 'drive-1' && state.view !== 'drive-2' && state.drive !== 'all'
            ? `${name} · ${state.drive}`
            : name;
    }

    function getDriveFilter() {
        if (state.view === 'drive-1') return 'Drive 1';
        if (state.view === 'drive-2') return 'Drive 2';
        return state.drive === 'all' ? '' : state.drive;
    }

    function setMessage(text, isError = false) {
        elements.message.textContent = text;
        elements.message.classList.toggle('error', isError);
        elements.message.hidden = !text;
    }

    function setLoading(isLoading) {
        if (isLoading) {
            elements.rows.innerHTML = '<tr><td colspan="9" class="no-data"><div class="spinner"></div> Loading admissions...</td></tr>';
            elements.metrics.innerHTML = '';
            elements.breakdown.innerHTML = '';
            elements.periodTables.hidden = true;
        }
        elements.previous.disabled = isLoading;
        elements.next.disabled = isLoading;
    }

    function buildQuery() {
        const params = new URLSearchParams({
            admissionYear: state.year,
            page: String(state.page),
            limit: String(state.limit),
            reRegistrationType: state.reRegistrationType,
            paymentStatus: state.paymentStatus,
            admissionStatus: state.admissionStatus
        });
        const drive = getDriveFilter();
        if (drive) params.set('admissionDrive', drive);
        if (state.courseId !== 'all') params.set('courseId', state.courseId);
        if (management && state.employeeId !== 'all') params.set('employeeId', state.employeeId);
        if (state.search) params.set('search', state.search);
        return params.toString();
    }

    function updateYearOptions(years) {
        const selected = state.year;
        const available = Array.from(new Set([String(new Date().getFullYear()), ...(years || []).map(String)]))
            .sort((left, right) => Number(right) - Number(left));
        elements.year.innerHTML = available.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('');
        if (!available.includes(selected)) {
            const option = document.createElement('option');
            option.value = selected;
            option.textContent = selected;
            elements.year.appendChild(option);
        }
        elements.year.value = selected;
    }

    function updateCourseOptions(courses) {
        const selected = state.courseId;
        elements.course.innerHTML = '<option value="all">All courses</option>' + (courses || []).map((course) => (
            `<option value="${escapeHtml(course.courseId)}">${escapeHtml(course.courseName)}</option>`
        )).join('');
        elements.course.value = selected;
        if (elements.course.value !== selected) {
            state.courseId = 'all';
            elements.course.value = 'all';
        }
    }

    function updateEmployeeOptions(employees) {
        if (!management) return;
        const selected = state.employeeId;
        elements.employee.innerHTML = '<option value="all">All employees</option>' + (employees || []).map((employee) => (
            `<option value="${escapeHtml(employee.employeeId)}">${escapeHtml(employee.employeeName || employee.employeeId)}</option>`
        )).join('');
        elements.employee.value = selected;
        if (elements.employee.value !== selected) {
            state.employeeId = 'all';
            elements.employee.value = 'all';
        }
    }

    function metricCard(label, value) {
        return `<div class="allocation-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }

    function renderMetrics(summary) {
        elements.metrics.innerHTML = [
            metricCard('Admissions', summary.admissionCount || 0),
            metricCard('Drive 1 Admissions', summary.drive1Count || 0),
            metricCard('Drive 2 Admissions', summary.drive2Count || 0),
            metricCard('Total Scheduled Fees', formatCurrency(summary.applicableFees)),
            metricCard('Amount Paid', formatCurrency(summary.paidAmount)),
            metricCard('Pending Fees', formatCurrency(summary.pendingAmount))
        ].join('');
    }

    function renderBreakdown(data) {
        const selectedDrive = getDriveFilter();
        const visibleDriveRows = selectedDrive
            ? (data.byDrive || []).filter((item) => item.drive === selectedDrive)
            : (data.byDrive || []);
        const driveRows = visibleDriveRows.map((item) => `<tr>
            <td>${escapeHtml(item.drive)}</td><td>${item.admissionCount}</td>
            <td>${formatCurrency(item.applicableFees)}</td><td>${formatCurrency(item.paidAmount)}</td><td>${formatCurrency(item.pendingAmount)}</td>
        </tr>`).join('');
        const courseRows = (data.byCourse || []).map((item) => `<tr>
            <td>${escapeHtml(item.courseName)}</td><td>${item.admissionCount}</td>
            <td>${formatCurrency(item.applicableFees)}</td><td>${formatCurrency(item.paidAmount)}</td><td>${formatCurrency(item.pendingAmount)}</td>
        </tr>`).join('');

        let rightTitle = 'Admissions by Course';
        const drivePanel = state.view === 'drive-1' || state.view === 'drive-2'
            ? ''
            : `<section class="allocation-panel">
                <h2>${state.view === 'combined' ? `Drive comparison · ${state.year}` : 'Admissions by Drive'}</h2>
                <div class="table-wrap"><table><thead><tr><th>Drive</th><th>Admissions</th><th>Applicable</th><th>Paid</th><th>Pending</th></tr></thead>
                    <tbody>${driveRows || '<tr><td colspan="5" class="no-data">No drive totals</td></tr>'}</tbody>
                </table></div>
            </section>`;

        elements.breakdown.innerHTML = `
            ${drivePanel}
            <section class="allocation-panel">
                <h2>${escapeHtml(rightTitle)}</h2>
                <div class="table-wrap"><table><thead><tr><th>Course</th><th>Admissions</th><th>Applicable</th><th>Paid</th><th>Pending</th></tr></thead>
                    <tbody>${courseRows || '<tr><td colspan="5" class="no-data">No course totals</td></tr>'}</tbody>
                </table></div>
            </section>`;
    }

    function markPaidButtonMarkup(admission, period) {
        return `<button type="button" class="allocation-mark-paid" title="Mark paid after receiving the full fee" aria-label="Mark ${escapeHtml(period.periodLabel)} paid" data-admission-id="${escapeHtml(admission.admissionId)}" data-installment-number="${escapeHtml(period.sourceInstallmentNumber || period.periodNumber)}" data-period-fee="${escapeHtml(period.applicableFee)}" data-period-label="${escapeHtml(period.periodLabel)}"><i class="fas fa-check" aria-hidden="true"></i></button>`;
    }

    function renderNaCell() {
        return '<td><div class="allocation-period-value"><span class="allocation-period-na">NA</span><span class="allocation-period-state"></span></div></td>';
    }

    function renderPeriodTable(title, type, definitions, admissions) {
        const rows = (admissions || []).filter((admission) => admission.reRegistrationType === type);
        if (!definitions?.length) {
            return `<section class="allocation-period-panel"><h2>${escapeHtml(title)}</h2><div class="no-data">No ${type === 'yearly' ? 'yearly' : 'semester-wise'} periods in the filtered admissions.</div></section>`;
        }
        const periodHeaders = definitions.map((period) => (
            `<th>${type === 'yearly' ? 'Year' : 'Sem'} Re-Reg ${escapeHtml(period.periodNumber)}</th>`
        )).join('');
        const bodyRows = rows.map((admission) => {
            const cells = definitions.map((definition) => {
                const period = admission.periods.find((item) => Number(item.periodNumber) === Number(definition.periodNumber));
                if (!period) return renderNaCell();
                if (!period.applicable || period.status === 'na') return renderNaCell();
                const markPaidButton = management && period.status !== 'paid'
                    ? markPaidButtonMarkup(admission, period)
                    : '';
                const statusLabel = period.status === 'paid' ? 'Paid' : management ? '' : 'Unpaid';
                const statusContent = markPaidButton || (statusLabel
                    ? `<span class="allocation-period-status ${statusLabel.toLowerCase()}">${escapeHtml(statusLabel)}</span>`
                    : '');
                return `<td><div class="allocation-period-value"><strong>${formatCurrency(period.applicableFee)}</strong><span class="allocation-period-state">${statusContent}</span></div></td>`;
            }).join('');
            return `<tr>
                <td>${escapeHtml(admission.courseName || '—')}</td>
                <td>${escapeHtml(admission.studentName)}<span class="allocation-subtext">${escapeHtml(admission.admissionYear ?? '')} · ${escapeHtml(admission.admissionDrive || 'Unallocated')}</span></td>
                ${cells}
            </tr>`;
        }).join('');
        const footerRow = (label, key) => `<tr><td colspan="2">${label}</td>${definitions.map((period) => (
            `<td>${formatCurrency(period[key])}</td>`
        )).join('')}</tr>`;
        const emptyRow = `<tr><td colspan="${2 + definitions.length}" class="no-data">No matching ${type === 'yearly' ? 'yearly' : 'semester-wise'} admissions on this page.</td></tr>`;
        return `<section class="allocation-period-panel">
            <h2>${escapeHtml(title)}</h2>
            <div class="allocation-period-scroll"><table class="allocation-period-table">
                <thead><tr><th>Course</th><th>Admission</th>${periodHeaders}</tr></thead>
                <tbody>${bodyRows || emptyRow}</tbody>
                <tfoot>${footerRow('Total fees', 'applicableFees')}${footerRow('Total paid', 'paidAmount')}${footerRow('Total pending', 'pendingAmount')}</tfoot>
            </table></div>
        </section>`;
    }

    function renderPeriodTables(data) {
        const periodTotals = data.periodTotals || {};
        const admissions = data.data || [];
        const sections = [];
        if (admissions.some((admission) => admission.reRegistrationType === 'semester-wise') && periodTotals.semesterWise?.length) {
            sections.push(renderPeriodTable('Semester-wise Fees', 'semester-wise', periodTotals.semesterWise, admissions));
        }
        if (admissions.some((admission) => admission.reRegistrationType === 'yearly') && periodTotals.yearly?.length) {
            sections.push(renderPeriodTable('Yearly Fees', 'yearly', periodTotals.yearly, admissions));
        }
        elements.periodTables.innerHTML = sections.join('');
        elements.periodTables.hidden = sections.length === 0;
    }

    function renderAdmissions(data) {
        const rows = data.data || [];
        elements.recordsHeading.textContent = `${formatViewName()} · ${state.year}`;
        elements.recordCount.textContent = `${data.pagination?.total || 0} matching admissions`;
        if (!rows.length) {
            elements.rows.innerHTML = '<tr><td colspan="9" class="no-data">No admissions match these filters.</td></tr>';
            return;
        }
        elements.rows.innerHTML = rows.map((admission) => `
            <tr>
                <td class="allocation-student"><strong>${escapeHtml(admission.studentName || '—')}</strong><span class="allocation-subtext">${escapeHtml(admission.admissionId)}</span></td>
                <td class="allocation-course" title="${escapeHtml(admission.courseName || '')}">${escapeHtml(admission.courseName || '—')}</td>
                <td class="allocation-date">${escapeHtml(admission.admissionDate || '—')}</td>
                <td><span class="allocation-drive ${admission.admissionDrive === 'Drive 1' ? 'drive-one' : admission.admissionDrive === 'Drive 2' ? 'drive-two' : ''}">${escapeHtml(admission.admissionDrive || 'Unallocated')}</span></td>
                <td>${escapeHtml(admission.employeeName || '—')}</td>
                <td><span class="allocation-type">${escapeHtml(admission.reRegistrationType || '—')}</span>${admission.periods.length ? `<span class="allocation-subtext">${admission.periods.length} periods</span>` : ''}</td>
                <td class="allocation-money">${formatCurrency(admission.summary.applicableFees)}</td>
                <td class="allocation-money paid">${formatCurrency(admission.summary.paidAmount)}</td>
                <td class="allocation-money pending">${formatCurrency(admission.summary.pendingAmount)}</td>
            </tr>`).join('');
    }

    function renderPagination(pagination) {
        const page = Number(pagination?.page) || 1;
        const pages = Number(pagination?.totalPages) || 1;
        elements.paginationText.textContent = `Page ${page} of ${pages}`;
        elements.previous.disabled = page <= 1;
        elements.next.disabled = page >= pages;
    }

    function updateTitle() {
        elements.heading.textContent = `${formatViewName()} · ${state.year}`;
        elements.subtitle.textContent = 'Permission-scoped admissions and scheduled semester/year course fees';
    }

    async function loadDashboard() {
        setLoading(true);
        setMessage('');
        updateTitle();
        const params = new URLSearchParams({
            admissionYear: state.year,
            page: String(state.page),
            limit: String(state.limit),
            reRegistrationType: state.reRegistrationType,
            paymentStatus: state.paymentStatus,
            admissionStatus: state.admissionStatus,
            search: state.search
        });
        if (state.courseId !== 'all') params.set('courseId', state.courseId);
        const drive = getDriveFilter();
        if (drive) params.set('admissionDrive', drive);
        if (management && state.employeeId !== 'all') params.set('employeeId', state.employeeId);

        try {
            const response = await fetch(`${API_BASE_URL}/admission-reports/dashboard?${params.toString()}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Unable to load admission dashboard.');
            updateYearOptions(payload.years);
            updateCourseOptions(payload.courses);
            updateEmployeeOptions(payload.employees);
            renderMetrics(payload.summary || {});
            renderBreakdown(payload);
            renderAdmissions(payload);
            if (state.view === 'drive-1' || state.view === 'drive-2') {
                renderPeriodTables(payload);
            } else {
                elements.periodTables.innerHTML = '';
                elements.periodTables.hidden = true;
            }
            renderPagination(payload.pagination || {});
        } catch (error) {
            elements.metrics.innerHTML = '';
            elements.breakdown.innerHTML = '';
            elements.periodTables.hidden = true;
            elements.rows.innerHTML = '<tr><td colspan="9" class="no-data">Unable to load admissions.</td></tr>';
            setMessage(error.message || 'Unable to load admission dashboard.', true);
        }
    }

    function openMarkPaidDialog(button) {
        if (!management || !button) return;
        const admissionId = button.dataset.admissionId;
        const installmentNumber = button.dataset.installmentNumber;
        const periodFee = Number(button.dataset.periodFee);
        const key = `${admissionId}:${installmentNumber}`;
        if (!admissionId || markingPaid.has(key)) return;

        pendingMarkPaid = {
            admissionId,
            installmentNumber,
            periodFee,
            periodLabel: button.dataset.periodLabel || 'this fee period',
            key
        };
        elements.markPaidDialogMessage.textContent = `Mark ${pendingMarkPaid.periodLabel} as paid for ${formatCurrency(periodFee)}? Continue only if the full fee has been received.`;
        elements.markPaidDialogError.hidden = true;
        elements.markPaidDialogError.textContent = '';
        elements.markPaidDialog.showModal();
    }

    async function confirmMarkInstallmentPaid() {
        if (!pendingMarkPaid || markingPaid.has(pendingMarkPaid.key)) return;
        const { admissionId, installmentNumber, key } = pendingMarkPaid;
        markingPaid.add(key);
        elements.confirmMarkPaid.disabled = true;
        elements.confirmMarkPaid.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Updating';
        try {
            const response = await fetch(`${API_BASE_URL}/admissions/${encodeURIComponent(admissionId)}/fee-installments/${encodeURIComponent(installmentNumber)}/mark-paid`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Unable to mark this fee period paid.');
            elements.markPaidDialog.close();
            pendingMarkPaid = null;
            await loadDashboard();
            setMessage(result.duplicate ? 'This fee period is already marked Paid.' : 'Fee period marked Paid.');
        } catch (error) {
            elements.markPaidDialogError.textContent = error.message || 'Unable to mark this fee period paid.';
            elements.markPaidDialogError.hidden = false;
        } finally {
            markingPaid.delete(key);
            elements.confirmMarkPaid.disabled = false;
            elements.confirmMarkPaid.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Mark Paid';
        }
    }

    function handlePeriodTableClick(event) {
        const button = event.target.closest('[data-installment-number]');
        if (button) openMarkPaidDialog(button);
    }

    function applyFilter(id, value) {
        state[id] = value;
        state.page = 1;
        loadDashboard();
    }

    function bindEvents() {
        elements.periodTables.addEventListener('click', handlePeriodTableClick);
        elements.confirmMarkPaid.addEventListener('click', confirmMarkInstallmentPaid);
        elements.year.addEventListener('change', () => applyFilter('year', elements.year.value));
        elements.drive.addEventListener('change', () => {
            if (state.view === 'drive-1' || state.view === 'drive-2') {
                state.view = 'combined';
                document.querySelectorAll('.allocation-tabs [data-view]').forEach((tab) => {
                    const selected = tab.dataset.view === 'combined';
                    tab.classList.toggle('active', selected);
                    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
            }
            applyFilter('drive', elements.drive.value);
        });
        elements.course.addEventListener('change', () => applyFilter('courseId', elements.course.value));
        elements.type.addEventListener('change', () => applyFilter('reRegistrationType', elements.type.value));
        elements.paymentStatus.addEventListener('change', () => applyFilter('paymentStatus', elements.paymentStatus.value));
        elements.admissionStatus.addEventListener('change', () => applyFilter('admissionStatus', elements.admissionStatus.value));
        elements.employee.addEventListener('change', () => applyFilter('employeeId', elements.employee.value));
        elements.search.addEventListener('input', () => {
            clearTimeout(state.debounce);
            state.debounce = setTimeout(() => applyFilter('search', elements.search.value.trim()), 300);
        });
        elements.previous.addEventListener('click', () => {
            if (state.page > 1) { state.page -= 1; loadDashboard(); }
        });
        elements.next.addEventListener('click', () => { state.page += 1; loadDashboard(); });
        document.getElementById('refreshAllocation').addEventListener('click', loadDashboard);
        document.querySelectorAll('.allocation-tabs [data-view]').forEach((button) => {
            button.addEventListener('click', () => {
                state.view = button.dataset.view;
                state.page = 1;
                document.querySelectorAll('.allocation-tabs [data-view]').forEach((tab) => {
                    const selected = tab === button;
                    tab.classList.toggle('active', selected);
                    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
                loadDashboard();
            });
        });
    }

    if (!management) elements.employeeWrap.hidden = true;
    updateYearOptions([Number(state.year)]);
    bindEvents();
    loadDashboard();
}());