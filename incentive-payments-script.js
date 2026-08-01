/**
 * incentive-payments-script.js
 * Handles the Incentive Payments tab in incentives.html
 * Adds Mark-as-Paid functionality with email notification and email logs.
 */

(function () {
    // ─── State ────────────────────────────────────────────────────────────────
    let ipRecords = [];
    let ipEmployees = [];
    let pendingMarkPaidId = null;

    const API = API_BASE_URL;

    function authHdr() {
        return { 'Content-Type': 'application/json' };
    }

    // ─── Patch switchTab to handle incentive-payments ─────────────────────────
    const _origSwitchTab = window.switchTab;
    window.switchTab = function (tabName, event) {
        if (tabName === 'incentive-payments') {
            // Update tab buttons
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-button').forEach(b => {
                if ((b.getAttribute('onclick') || '').includes("'incentive-payments'")) b.classList.add('active');
            });
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const tab = document.getElementById('incentive-payments-tab');
            if (tab) tab.classList.add('active');
            // Load data
            initIPTab();
        } else if (_origSwitchTab) {
            _origSwitchTab(tabName, event);
        }
    };

    // ─── Init tab ─────────────────────────────────────────────────────────────
    async function initIPTab() {
        await loadIPEmployees();
        await Promise.all([loadIPRecords(), loadEmailLogs()]);
    }

    async function loadIPEmployees() {
        if (ipEmployees.length) return; // already loaded
        try {
            const res = await fetch(`${API}/employees`, { headers: authHdr() });
            if (!res.ok) return;
            ipEmployees = await res.json();

            // Populate employee select in modal
            const sel = document.getElementById('ipEmpSelect');
            if (sel) {
                ipEmployees.forEach(e => {
                    const name = `${e.firstName || ''} ${e.lastName || ''}`.trim();
                    const opt = document.createElement('option');
                    opt.value = e.id;
                    opt.dataset.name = name;
                    opt.textContent = `${name} (${e.id})`;
                    sel.appendChild(opt);
                });
            }

            // Populate filter dropdown
            const filt = document.getElementById('ipEmpFilter');
            if (filt) {
                ipEmployees.forEach(e => {
                    const name = `${e.firstName || ''} ${e.lastName || ''}`.trim();
                    const opt = document.createElement('option');
                    opt.value = e.id;
                    opt.textContent = `${name} (${e.id})`;
                    filt.appendChild(opt);
                });
            }

            // Populate month filter
            const mf = document.getElementById('ipMonthFilter');
            if (mf) {
                const now = new Date();
                for (let i = 0; i < 24; i++) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = label;
                    mf.appendChild(opt);
                }
            }
        } catch (e) { console.error('IP: loadEmployees', e); }
    }

    async function autofillIncentiveFromMonthly() {
        const empEl = document.getElementById('ipEmpSelect');
        const monthEl = document.getElementById('ipMonth');
        const amountEl = document.getElementById('ipAmount');
        const admCountEl = document.getElementById('ipAdmCount');

        if (!empEl || !monthEl || !amountEl || !admCountEl) return;

        const employeeId = parseInt(empEl.value, 10);
        const month = monthEl.value;
        if (!employeeId || !month) return;

        // Reuse the same monthly incentive calculation used in Monthly Incentives tab.
        if (typeof window.calculateMonthlyIncentive !== 'function') return;

        try {
            const incentive = await window.calculateMonthlyIncentive(employeeId, month);
            if (!incentive || !incentive.eligible) {
                if (!amountEl.value) amountEl.value = '0';
                if (!admCountEl.value) admCountEl.value = String(incentive?.salesAchieved || 0);
                return;
            }

            amountEl.value = String(incentive.amount || 0);
            admCountEl.value = String(incentive.salesAchieved || incentive.revenueAchieved || 0);
        } catch (error) {
            console.error('IP: incentive autofill failed', error);
        }
    }

    function wireIPAutofillHandlers() {
        const empEl = document.getElementById('ipEmpSelect');
        const monthEl = document.getElementById('ipMonth');
        if (!empEl || !monthEl) return;

        if (!empEl.dataset.autofillBound) {
            empEl.addEventListener('change', autofillIncentiveFromMonthly);
            empEl.dataset.autofillBound = '1';
        }
        if (!monthEl.dataset.autofillBound) {
            monthEl.addEventListener('change', autofillIncentiveFromMonthly);
            monthEl.dataset.autofillBound = '1';
        }
    }

    // ─── Load records ─────────────────────────────────────────────────────────
    async function loadIPRecords() {
        const status = (document.getElementById('ipStatusFilter') || {}).value || '';
        const empId  = (document.getElementById('ipEmpFilter')    || {}).value || '';
        const month  = (document.getElementById('ipMonthFilter')  || {}).value || '';

        const p = new URLSearchParams();
        if (status) p.set('status', status);
        if (empId)  p.set('employeeId', empId);
        if (month)  p.set('month', month);

        try {
            const res = await fetch(`${API}/incentives/payments?${p}`, { headers: authHdr() });
            if (!res.ok) throw new Error('API error');
            ipRecords = await res.json();
            renderIPTable();
            updateIPKPIs();
        } catch (e) {
            document.getElementById('ipTableBody').innerHTML =
                `<tr><td colspan="10" class="ip-empty"><i class="fas fa-exclamation-triangle"></i>Failed to load records.</td></tr>`;
        }
    }

    function updateIPKPIs() {
        const total   = ipRecords.length;
        const pending = ipRecords.filter(r => r.status === 'pending');
        const paid    = ipRecords.filter(r => r.status === 'paid');
        const amtPaid    = paid.reduce((s, r) => s + (r.incentiveAmount || 0), 0);
        const amtPending = pending.reduce((s, r) => s + (r.incentiveAmount || 0), 0);

        setText('ipKpiTotal',      total);
        setText('ipKpiPending',    pending.length);
        setText('ipKpiPaid',       paid.length);
        setText('ipKpiAmtPaid',    `₹${amtPaid.toLocaleString('en-IN')}`);
        setText('ipKpiAmtPending', `₹${amtPending.toLocaleString('en-IN')}`);
    }

    function renderIPTable() {
        const tbody = document.getElementById('ipTableBody');
        if (!tbody) return;
        if (!ipRecords.length) {
            tbody.innerHTML = `<tr><td colspan="10" class="ip-empty"><i class="fas fa-coins"></i>No records found. Click "Add Incentive Record" to create one.</td></tr>`;
            return;
        }
        tbody.innerHTML = ipRecords.map((r, i) => {
            const statusBadge = r.status === 'paid'
                ? `<span class="status-paid"><i class="fas fa-check" style="margin-right:4px;font-size:10px;"></i>Paid</span>`
                : `<span class="status-pending"><i class="fas fa-clock" style="margin-right:4px;font-size:10px;"></i>Pending</span>`;
            const payDate = r.paymentDate ? new Date(r.paymentDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '–';
            const actions = r.status === 'pending'
                ? `<button class="btn btn-success btn-sm" onclick="openMarkPaid('${r._id}')"><i class="fas fa-check"></i> Mark Paid</button>
                   <button class="btn btn-outline btn-sm" onclick="deleteIPRecord('${r._id}')" style="margin-left:4px;color:#ef4444;border-color:#fca5a5;"><i class="fas fa-trash"></i></button>`
                : `<span style="font-size:12px;color:#9ca3af;">Paid ✓</span>`;
            return `<tr>
                <td><span style="font-size:12px;color:#9ca3af;">${i + 1}</span></td>
                <td><div style="font-weight:700;color:#111827;">${esc(r.employeeName)}</div><div style="font-size:11px;color:#9ca3af;">ID: ${r.employeeId}</div></td>
                <td>${r.admissionCount || '–'}</td>
                <td><strong>₹${Number(r.incentiveAmount || 0).toLocaleString('en-IN')}</strong></td>
                <td>${r.incentiveMonth ? formatMonth(r.incentiveMonth) : '–'}</td>
                <td>${statusBadge}</td>
                <td style="font-size:12px;">${payDate}</td>
                <td style="font-size:12px;">${esc(r.paidBy || '–')}</td>
                <td style="font-size:12px;color:#6b7280;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.remarks || '')}">${esc(r.remarks || '–')}</td>
                <td>${actions}</td>
            </tr>`;
        }).join('');
    }

    // ─── Create record modal ───────────────────────────────────────────────────
    function openIPModal() {
        const modal = document.getElementById('ipModal');
        if (modal) { modal.style.display = 'flex'; }
        document.getElementById('ipForm').reset();
        const monthEl = document.getElementById('ipMonth');
        if (monthEl) {
            const now = new Date();
            monthEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        wireIPAutofillHandlers();
        autofillIncentiveFromMonthly();
    }

    function closeIPModal() {
        const modal = document.getElementById('ipModal');
        if (modal) modal.style.display = 'none';
    }

    async function submitIPRecord(e) {
        e.preventDefault();
        const btn = document.getElementById('ipSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Creating…';

        const empSel = document.getElementById('ipEmpSelect');
        const empId  = empSel.value;
        const empName = empSel.options[empSel.selectedIndex]?.dataset.name || '';

        const body = {
            employeeId:    empId,
            employeeName:  empName,
            admissionCount: parseInt(document.getElementById('ipAdmCount').value) || 0,
            incentiveAmount: parseFloat(document.getElementById('ipAmount').value) || 0,
            incentiveMonth: document.getElementById('ipMonth').value,
            remarks: document.getElementById('ipRemarks').value
        };

        try {
            const res = await fetch(`${API}/incentives/payments`, {
                method: 'POST', headers: authHdr(), body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            closeIPModal();
            showToast('Incentive record created successfully!', 'success');
            await loadIPRecords();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Record';
        }
    }

    // ─── Mark as Paid modal ───────────────────────────────────────────────────
    function openMarkPaid(id) {
        pendingMarkPaidId = id;
        const record = ipRecords.find(r => r._id === id);
        if (!record) return;

        const info = document.getElementById('ipPaidRecordInfo');
        if (info) {
            info.innerHTML = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div><strong>Employee:</strong> ${esc(record.employeeName)}</div>
                    <div><strong>ID:</strong> ${record.employeeId}</div>
                    <div><strong>Amount:</strong> ₹${Number(record.incentiveAmount).toLocaleString('en-IN')}</div>
                    <div><strong>Month:</strong> ${record.incentiveMonth ? formatMonth(record.incentiveMonth) : '–'}</div>
                    <div><strong>Admissions:</strong> ${record.admissionCount || '–'}</div>
                </div>`;
        }

        document.getElementById('ipPaidBy').value = window.getAuthName ? window.getAuthName() : '';
        document.getElementById('ipPaidRemarks').value = '';

        const modal = document.getElementById('ipPaidModal');
        if (modal) modal.style.display = 'flex';
    }

    function closeIPPaidModal() {
        const modal = document.getElementById('ipPaidModal');
        if (modal) modal.style.display = 'none';
        pendingMarkPaidId = null;
    }

    async function confirmMarkPaid() {
        if (!pendingMarkPaidId) return;
        const btn = document.getElementById('ipConfirmPaidBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

        const paidBy   = document.getElementById('ipPaidBy').value.trim() || 'Admin';
        const remarks  = document.getElementById('ipPaidRemarks').value.trim();

        try {
            const res = await fetch(`${API}/incentives/payments/${pendingMarkPaidId}/mark-paid`, {
                method: 'PUT', headers: authHdr(), body: JSON.stringify({ paidBy, remarks })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');

            closeIPPaidModal();

            const emailMsg = data.emailStatus === 'sent'
                ? ' Email sent to employee.' : data.emailStatus === 'skipped'
                ? ' (Email skipped — no email on file.)' : ' (Email delivery failed.)';

            showToast('✅ Incentive marked as paid!' + emailMsg, 'success');
            await Promise.all([loadIPRecords(), loadEmailLogs()]);
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Confirm & Mark Paid';
        }
    }

    async function deleteIPRecord(id) {
        if (!confirm('Delete this incentive record? This cannot be undone.')) return;
        try {
            const res = await fetch(`${API}/incentives/payments/${id}`, { method: 'DELETE', headers: authHdr() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            showToast('Record deleted.', 'success');
            await loadIPRecords();
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    }

    // ─── Email logs ───────────────────────────────────────────────────────────
    async function loadEmailLogs() {
        try {
            const res = await fetch(`${API}/incentives/email-logs`, { headers: authHdr() });
            if (!res.ok) return;
            const logs = await res.json();
            const tbody = document.getElementById('emailLogBody');
            if (!tbody) return;
            if (!logs.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="ip-empty"><i class="fas fa-envelope-open"></i>No email logs yet.</td></tr>`;
                return;
            }
            tbody.innerHTML = logs.map(l => {
                const statusCls = l.status === 'sent' ? 'email-sent' : l.status === 'failed' ? 'email-failed' : 'email-skipped';
                const statusLabel = l.status === 'sent' ? '✓ Sent' : l.status === 'failed' ? '✗ Failed' : '– Skipped';
                const sentAt = l.sentAt ? new Date(l.sentAt).toLocaleString('en-IN') : '–';
                return `<tr>
                    <td><strong>${esc(l.employeeName || '–')}</strong><br><span style="font-size:11px;color:#9ca3af;">ID: ${l.employeeId || '–'}</span></td>
                    <td style="font-size:12px;">${esc(l.to || '–')}</td>
                    <td style="font-size:12px;">${esc(l.subject || '–')}</td>
                    <td><span class="${statusCls}">${statusLabel}</span></td>
                    <td style="font-size:12px;">${sentAt}</td>
                    <td style="font-size:12px;color:#ef4444;">${esc(l.error || '–')}</td>
                </tr>`;
            }).join('');
        } catch (e) { console.error('IP: email logs', e); }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatMonth(m) {
        if (!m) return '–';
        const [y, mo] = m.split('-');
        const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return `${names[parseInt(mo) - 1] || mo} ${y}`;
    }

    function showToast(msg, type) {
        // Use existing toast if available, else fallback
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type);
            return;
        }
        const d = document.createElement('div');
        d.textContent = msg;
        Object.assign(d.style, {
            position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
            background: type === 'success' ? '#10b981' : '#ef4444',
            color: '#fff', padding: '14px 20px', borderRadius: '12px',
            fontFamily: "'Inter', sans-serif", fontSize: '14px', fontWeight: '600',
            boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxWidth: '380px',
            animation: 'fadeIn .3s ease'
        });
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 4000);
    }

    // ─── Expose to global scope (onclick handlers) ────────────────────────────
    window.loadIPRecords    = loadIPRecords;
    window.loadEmailLogs    = loadEmailLogs;
    window.openIPModal      = openIPModal;
    window.closeIPModal     = closeIPModal;
    window.submitIPRecord   = submitIPRecord;
    window.openMarkPaid     = openMarkPaid;
    window.closeIPPaidModal = closeIPPaidModal;
    window.confirmMarkPaid  = confirmMarkPaid;
    window.deleteIPRecord   = deleteIPRecord;

})();
