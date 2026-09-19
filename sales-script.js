// API Configuration loaded from config.js

// Sales Data Management Functions
let cachedSalesData = null;
let cachedUniversityOptions = [];
let cachedCourseOptionsByUniversity = new Map();
let admissionFormHandlersInitialized = false;
let currentLiveFeeCalculation = null;
let lastLiveCalculationInputKey = '';
let currentLiveInstallmentStatuses = {};
let currentLiveInstallmentDiscounts = {};
let editAdmissionFormHandlersInitialized = false;
let currentEditFeeCalculation = null;
let lastEditFeeCalculationInputKey = '';
let currentEditInstallmentStatuses = {};
let currentEditInstallmentDiscounts = {};

function normalizeAdmissionTypeValue(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'annual') return 'yearly';
    if (raw === 'semester') return 'semester-wise';
    return raw;
}

function getRecommendedDiscountType(admissionType) {
    const normalized = normalizeAdmissionTypeValue(admissionType);
    if (normalized === 'yearly') return 'yearly';
    if (normalized === 'semester-wise') return 'semester';
    return 'whole-fees';
}

function getAdmissionTypeLabel(value) {
    const type = normalizeAdmissionTypeValue(value);
    if (type === 'one-time') return 'One-Time';
    if (type === 'yearly') return 'Yearly';
    if (type === 'semester-wise') return 'Semester-Wise';
    return value || '—';
}

function getDiscountTypeLabel(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type === 'whole-fees') return 'Whole Fees';
    if (type === 'yearly') return 'Yearly';
    if (type === 'semester') return 'Semester';
    return value || '—';
}

function formatNumericDisplay(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return num % 1 === 0 ? String(num) : num.toFixed(2);
}

function parseNumericInput(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function collectInstallmentDiscounts(selector = '[data-installment-discount]') {
    const discountInputs = document.querySelectorAll(selector);
    if (!discountInputs.length) return {};

    const discounts = {};
    discountInputs.forEach((input) => {
        const key = String(
            input.getAttribute('data-installment-discount')
            || input.getAttribute('data-edit-installment-discount')
            || ''
        ).trim();
        if (!key) return;
        discounts[key] = parseNumericInput(input.value);
    });
    return discounts;
}

function buildInstallmentDiscountState(installments) {
    if (!Array.isArray(installments)) return {};

    return installments.reduce((state, item) => {
        const key = Number(item?.installmentNumber);
        if (!Number.isFinite(key) || key < 1) return state;
        state[key] = parseNumericInput(item?.discountPercent);
        return state;
    }, {});
}

function getLiveInstallmentStatus(installmentNumber) {
    return currentLiveInstallmentStatuses[Number(installmentNumber)] === 'paid' ? 'paid' : 'pending';
}

function getLiveInstallmentDiscountValue(installmentNumber, fallbackValue) {
    const key = Number(installmentNumber);
    return Number.isFinite(currentLiveInstallmentDiscounts[key]) ? currentLiveInstallmentDiscounts[key] : fallbackValue;
}

function markLiveInstallmentPaid(installmentNumber) {
    const key = Number(installmentNumber);
    if (!Number.isFinite(key) || key < 1) return;
    currentLiveInstallmentStatuses[key] = 'paid';
    renderLiveCalculation(currentLiveFeeCalculation);
}

function markLiveInstallmentPending(installmentNumber) {
    const key = Number(installmentNumber);
    if (!Number.isFinite(key) || key < 1) return;
    currentLiveInstallmentStatuses[key] = 'pending';
    renderLiveCalculation(currentLiveFeeCalculation);
}

function markAllLiveInstallmentsPaid() {
    if (!currentLiveFeeCalculation?.installments?.length) return;
    currentLiveFeeCalculation.installments.forEach((item) => {
        currentLiveInstallmentStatuses[item.installmentNumber] = 'paid';
    });
    renderLiveCalculation(currentLiveFeeCalculation);
}

function buildLiveInstallmentPayloads(calculation) {
    if (!calculation?.installments?.length) return [];

    return calculation.installments.map((item) => {
        const status = getLiveInstallmentStatus(item.installmentNumber);
        const isPaid = status === 'paid';

        return {
            installmentNumber: item.installmentNumber,
            installmentName: item.installmentName,
            discountPercent: item.discountPercent,
            originalFees: item.originalFees,
            calculatedFees: item.calculatedFees,
            remainingFees: isPaid ? 0 : item.calculatedFees,
            feesPaid: isPaid ? item.calculatedFees : 0,
            status
        };
    });
}

function getInstallmentDiscountSignature(discounts) {
    if (!discounts || typeof discounts !== 'object') return '';

    return Object.keys(discounts)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => `${key}:${parseNumericInput(discounts[key]).toFixed(2)}`)
        .join('|');
}

function getFocusedInstallmentInputState(selectorPrefix) {
    const activeElement = document.activeElement;
    if (!activeElement || activeElement.tagName !== 'INPUT') return null;
    if (!activeElement.matches(`input[data-${selectorPrefix}]`)) return null;

    return {
        key: activeElement.getAttribute(`data-${selectorPrefix}`),
        value: activeElement.value,
        selectionStart: activeElement.selectionStart,
        selectionEnd: activeElement.selectionEnd
    };
}

function restoreFocusedInstallmentInputState(selectorPrefix, state) {
    if (!state?.key) return;

    const selector = `input[data-${selectorPrefix}="${CSS.escape(String(state.key))}"]`;
    const input = document.querySelector(selector);
    if (!input) return;

    input.focus({ preventScroll: true });
    if (state.selectionStart !== null && state.selectionEnd !== null && typeof input.setSelectionRange === 'function') {
        try {
            input.setSelectionRange(state.selectionStart, state.selectionEnd);
        } catch (_) {
            // Ignore selection restore failures for unsupported input states.
        }
    }
}

function updateDiscountModeUI(discountType, groupId = 'admDiscountPercentGroup') {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.style.display = (discountType === 'whole-fees' || discountType === 'one-time' || !discountType) ? '' : 'none';
}

function getLiveCalculationInputs() {
    const admissionType = normalizeAdmissionTypeValue(document.getElementById('admType').value);
    const discountType = document.getElementById('admDiscountType').value;
    const useInstallmentDiscounts = discountType === 'yearly' || discountType === 'semester';
    return {
        admissionType,
        discountType,
        discountPercent: useInstallmentDiscounts ? 0 : parseNumericInput(document.getElementById('admDiscountPercent').value),
        duration: parseNumericInput(document.getElementById('admDuration').value),
        totalFees: parseNumericInput(document.getElementById('admTotalFees').value),
        installmentDiscounts: useInstallmentDiscounts ? collectInstallmentDiscounts() : undefined
    };
}

function getLiveCalculationInputKey(inputs) {
    const admissionType = normalizeAdmissionTypeValue(inputs.admissionType || '');
    const discountType = String(inputs.discountType || '').trim().toLowerCase();
    const discountPercent = Number.isFinite(Number(inputs.discountPercent)) ? Number(inputs.discountPercent) : 0;
    const duration = Number.isFinite(Number(inputs.duration)) ? Number(inputs.duration) : 0;
    const totalFees = Number.isFinite(Number(inputs.totalFees)) ? Number(inputs.totalFees) : 0;
    const installmentDiscountSignature = getInstallmentDiscountSignature(inputs.installmentDiscounts);
    return [
        admissionType,
        discountType,
        discountPercent.toFixed(2),
        duration.toFixed(2),
        totalFees.toFixed(2),
        installmentDiscountSignature
    ].join('|');
}

function renderLiveValidation(calculation) {
    const validationBox = document.getElementById('liveCalcValidation');
    const errors = Array.isArray(calculation?.validation?.errors) ? calculation.validation.errors : [];

    if (!errors.length) {
        validationBox.style.display = 'none';
        validationBox.innerHTML = '';
        return;
    }

    validationBox.style.display = 'block';
    validationBox.innerHTML = errors.map((error) => `<div>${error}</div>`).join('');
}

function renderLiveCalculation(calculation) {
    const focusState = getFocusedInstallmentInputState('installment-discount');
    const actualFees = document.getElementById('liveActualFees');
    const totalDiscount = document.getElementById('liveTotalDiscount');
    const payableFees = document.getElementById('livePayableFees');
    const paidFees = document.getElementById('livePaidFees');
    const outstandingFees = document.getElementById('liveOutstandingFees');
    const tableBody = document.getElementById('liveInstallmentBody');
    const revenuePreviewInput = document.getElementById('admRevenuePreview');
    const hiddenRevenueInput = document.getElementById('admRevenue');

    const summary = calculation?.summary || {
        actualFees: 0,
        totalDiscount: 0,
        totalFeesPayable: 0,
        feesPaid: 0,
        outstandingFees: 0
    };

    const installmentRows = Array.isArray(calculation?.installments) ? calculation.installments : [];
    const paidTotal = installmentRows.reduce((sum, item) => sum + (getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? Number(item.calculatedFees) || 0 : 0), 0);
    const outstandingTotal = installmentRows.reduce((sum, item) => sum + (getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? 0 : Number(item.calculatedFees) || 0), 0);

    if (installmentRows.length && Object.keys(currentLiveInstallmentDiscounts).length === 0) {
        currentLiveInstallmentDiscounts = buildInstallmentDiscountState(installmentRows);
    }

    actualFees.textContent = formatRupees(summary.actualFees || 0);
    totalDiscount.textContent = formatRupees(summary.totalDiscount || 0);
    payableFees.textContent = formatRupees(summary.totalFeesPayable || 0);
    paidFees.textContent = formatRupees(paidTotal || 0);
    outstandingFees.textContent = formatRupees(outstandingTotal || 0);

    revenuePreviewInput.value = formatRupees(summary.totalFeesPayable || 0);
    hiddenRevenueInput.value = String(summary.totalFeesPayable || 0);
    renderLiveValidation(calculation);
    updateDiscountModeUI(calculation?.discountType);

    const useInstallmentDiscounts = calculation?.discountType === 'yearly' || calculation?.discountType === 'semester';

    if (!calculation?.installments?.length) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:10px;">Complete the flow to preview installments</td></tr>';
        return;
    }

    tableBody.innerHTML = calculation.installments.map((item) => `
        <tr>
            <td>${item.installmentNumber}</td>
            <td>${item.installmentName}</td>
            <td>${formatRupees(item.originalFees)}</td>
            <td>${useInstallmentDiscounts ? `
                <div class="installment-discount-cell">
                    <input type="number" class="installment-discount-input" data-installment-discount="${item.installmentNumber}" min="0" max="100" step="0.01" value="${getLiveInstallmentDiscountValue(item.installmentNumber, item.discountPercent)}" oninput="recalculateLiveFees()">
                    <span style="font-size:11px;color:#64748b;">%</span>
                </div>
            ` : `${item.discountPercent}% (${formatRupees(item.discountAmount)})`}</td>
            <td><strong>${formatRupees(item.calculatedFees)}</strong></td>
            <td><span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? '#dcfce7' : '#fef3c7'};color:${getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? '#166534' : '#92400e'};">${getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? 'Paid' : 'Pending'}</span></td>
            <td>
                <div class="edit-fee-actions">
                    ${getLiveInstallmentStatus(item.installmentNumber) === 'paid' ? `
                        <button type="button" class="edit-fee-action-btn secondary" onclick="markLiveInstallmentPending(${item.installmentNumber})">Undo</button>
                    ` : `
                        <button type="button" class="edit-fee-action-btn primary" onclick="markLiveInstallmentPaid(${item.installmentNumber})">Mark Paid</button>
                    `}
                </div>
            </td>
        </tr>
    `).join('');

    restoreFocusedInstallmentInputState('installment-discount', focusState);
}

function recalculateLiveFees() {
    const inputs = getLiveCalculationInputs();

    if (!window.SalesFeeCalculator || typeof window.SalesFeeCalculator.buildLiveFeeCalculation !== 'function') {
        return;
    }

    currentLiveInstallmentDiscounts = collectInstallmentDiscounts();
    lastLiveCalculationInputKey = getLiveCalculationInputKey(inputs);

    currentLiveFeeCalculation = window.SalesFeeCalculator.buildLiveFeeCalculation(inputs);
    renderLiveCalculation(currentLiveFeeCalculation);
}

function getEditInstallmentDiscountMap(installments) {
    if (!Array.isArray(installments)) return {};

    return installments.reduce((discounts, item) => {
        const key = Number(item?.installmentNumber);
        if (!Number.isFinite(key) || key < 1) return discounts;
        discounts[key] = parseNumericInput(item?.discountPercent);
        return discounts;
    }, {});
}

function getEditInstallmentDiscountValue(installmentNumber, fallbackValue) {
    const key = Number(installmentNumber);
    return Number.isFinite(currentEditInstallmentDiscounts[key]) ? currentEditInstallmentDiscounts[key] : fallbackValue;
}

function getEditInstallmentStatusMap(installments) {
    if (!Array.isArray(installments)) return {};

    return installments.reduce((statuses, item) => {
        const key = Number(item?.installmentNumber);
        if (!Number.isFinite(key) || key < 1) return statuses;
        statuses[key] = String(item?.status || 'pending').trim().toLowerCase() === 'paid' ? 'paid' : 'pending';
        return statuses;
    }, {});
}

function getEditInstallmentStatus(installmentNumber) {
    return currentEditInstallmentStatuses[Number(installmentNumber)] === 'paid' ? 'paid' : 'pending';
}

function setEditInstallmentStatus(installmentNumber, status) {
    const key = Number(installmentNumber);
    if (!Number.isFinite(key) || key < 1) return;
    currentEditInstallmentStatuses[key] = String(status || 'pending').toLowerCase() === 'paid' ? 'paid' : 'pending';
    renderEditCalculation(currentEditFeeCalculation);
}

function markEditInstallmentPaid(installmentNumber) {
    setEditInstallmentStatus(installmentNumber, 'paid');
}

function markEditInstallmentPending(installmentNumber) {
    setEditInstallmentStatus(installmentNumber, 'pending');
}

function markAllEditInstallmentsPaid() {
    if (!currentEditFeeCalculation?.installments?.length) return;

    currentEditFeeCalculation.installments.forEach((item) => {
        currentEditInstallmentStatuses[item.installmentNumber] = 'paid';
    });
    renderEditCalculation(currentEditFeeCalculation);
}

function buildEditInstallmentPayloads(calculation) {
    if (!calculation?.installments?.length) return [];

    return calculation.installments.map((item) => {
        const status = getEditInstallmentStatus(item.installmentNumber);
        const isPaid = status === 'paid';

        return {
            installmentNumber: item.installmentNumber,
            installmentName: item.installmentName,
            discountPercent: item.discountPercent,
            originalFees: item.originalFees,
            calculatedFees: item.calculatedFees,
            remainingFees: isPaid ? 0 : item.calculatedFees,
            feesPaid: isPaid ? item.calculatedFees : 0,
            status
        };
    });
}

function getEditLiveCalculationInputs() {
    const admissionType = normalizeAdmissionTypeValue(document.getElementById('editAdmType').value);
    const discountType = document.getElementById('editAdmDiscountType').value;
    const useInstallmentDiscounts = discountType === 'yearly' || discountType === 'semester';
    const durationRaw = document.getElementById('editAdmDurationRaw').value;
    const totalFeesRaw = document.getElementById('editAdmTotalFeesRaw').value;
    return {
        admissionType,
        discountType,
        discountPercent: useInstallmentDiscounts ? 0 : parseNumericInput(document.getElementById('editAdmDiscountPercent').value),
        duration: parseNumericInput(durationRaw || document.getElementById('editAdmDuration').value),
        totalFees: parseNumericInput(totalFeesRaw || document.getElementById('editAdmTotalFees').value),
        installmentDiscounts: useInstallmentDiscounts ? collectInstallmentDiscounts('[data-edit-installment-discount]') : undefined
    };
}

function getEditLiveCalculationInputKey(inputs) {
    const admissionType = normalizeAdmissionTypeValue(inputs.admissionType || '');
    const discountType = String(inputs.discountType || '').trim().toLowerCase();
    const discountPercent = Number.isFinite(Number(inputs.discountPercent)) ? Number(inputs.discountPercent) : 0;
    const duration = Number.isFinite(Number(inputs.duration)) ? Number(inputs.duration) : 0;
    const totalFees = Number.isFinite(Number(inputs.totalFees)) ? Number(inputs.totalFees) : 0;
    const installmentDiscountSignature = getInstallmentDiscountSignature(inputs.installmentDiscounts);
    return [
        admissionType,
        discountType,
        discountPercent.toFixed(2),
        duration.toFixed(2),
        totalFees.toFixed(2),
        installmentDiscountSignature
    ].join('|');
}

function renderEditValidation(calculation) {
    const validationBox = document.getElementById('editLiveCalcValidation');
    const errors = Array.isArray(calculation?.validation?.errors) ? calculation.validation.errors : [];

    if (!errors.length) {
        validationBox.style.display = 'none';
        validationBox.innerHTML = '';
        return;
    }

    validationBox.style.display = 'block';
    validationBox.innerHTML = errors.map((error) => `<div>${error}</div>`).join('');
}

function renderEditCalculation(calculation) {
    const focusState = getFocusedInstallmentInputState('edit-installment-discount');
    const actualFees = document.getElementById('editLiveActualFees');
    const totalDiscount = document.getElementById('editLiveTotalDiscount');
    const payableFees = document.getElementById('editLivePayableFees');
    const paidFees = document.getElementById('editLivePaidFees');
    const outstandingFees = document.getElementById('editLiveOutstandingFees');
    const tableBody = document.getElementById('editLiveInstallmentBody');
    const revenuePreviewInput = document.getElementById('editAdmRevenuePreview');
    const hiddenRevenueInput = document.getElementById('editAdmRevenue');

    const summary = calculation?.summary || {
        actualFees: 0,
        totalDiscount: 0,
        totalFeesPayable: 0,
        feesPaid: 0,
        outstandingFees: 0
    };

    const installmentRows = Array.isArray(calculation?.installments) ? calculation.installments : [];
    const paidTotal = installmentRows.reduce((sum, item) => {
        const status = getEditInstallmentStatus(item.installmentNumber);
        return sum + (status === 'paid' ? Number(item.calculatedFees) || 0 : 0);
    }, 0);
    const outstandingTotal = installmentRows.reduce((sum, item) => {
        const status = getEditInstallmentStatus(item.installmentNumber);
        return sum + (status === 'paid' ? 0 : Number(item.calculatedFees) || 0);
    }, 0);

    actualFees.textContent = formatRupees(summary.actualFees || 0);
    totalDiscount.textContent = formatRupees(summary.totalDiscount || 0);
    payableFees.textContent = formatRupees(summary.totalFeesPayable || 0);
    paidFees.textContent = formatRupees(paidTotal || 0);
    outstandingFees.textContent = formatRupees(outstandingTotal || 0);

    revenuePreviewInput.value = formatRupees(summary.totalFeesPayable || 0);
    hiddenRevenueInput.value = String(summary.totalFeesPayable || 0);
    renderEditValidation(calculation);
    updateDiscountModeUI(calculation?.discountType, 'editAdmDiscountPercentGroup');

    const useInstallmentDiscounts = calculation?.discountType === 'yearly' || calculation?.discountType === 'semester';

    if (installmentRows.length && Object.keys(currentEditInstallmentDiscounts).length === 0) {
        currentEditInstallmentDiscounts = buildInstallmentDiscountState(installmentRows);
    }

    if (!calculation?.installments?.length) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:10px;">No installment schedule available for this fee plan</td></tr>';
        return;
    }

    tableBody.innerHTML = calculation.installments.map((item) => `
        ${(() => {
            const status = getEditInstallmentStatus(item.installmentNumber);
            const isPaid = status === 'paid';
            return `
        <tr>
            <td>${item.installmentNumber}</td>
            <td>${item.installmentName}</td>
            <td>${formatRupees(item.originalFees)}</td>
            <td>${useInstallmentDiscounts ? `
                <div class="installment-discount-cell">
                    <input type="number" class="installment-discount-input" data-edit-installment-discount="${item.installmentNumber}" min="0" max="100" step="0.01" value="${getEditInstallmentDiscountValue(item.installmentNumber, item.discountPercent)}" ${isPaid ? 'disabled' : ''} oninput="recalculateEditFees()">
                    <span style="font-size:11px;color:#64748b;">%</span>
                </div>
            ` : `${item.discountPercent}% (${formatRupees(item.discountAmount)})`}</td>
            <td><strong>${formatRupees(item.calculatedFees)}</strong></td>
            <td><span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${isPaid ? '#dcfce7' : '#fef3c7'};color:${isPaid ? '#166534' : '#92400e'};">${isPaid ? 'Paid' : 'Pending'}</span></td>
            <td>
                <div class="edit-fee-actions">
                    ${isPaid ? `
                        <button type="button" class="edit-fee-action-btn secondary" onclick="markEditInstallmentPending(${item.installmentNumber})">Undo</button>
                    ` : `
                        <button type="button" class="edit-fee-action-btn primary" onclick="markEditInstallmentPaid(${item.installmentNumber})">Mark Paid</button>
                    `}
                </div>
            </td>
        </tr>
        `;
        })()}
    `).join('');

    restoreFocusedInstallmentInputState('edit-installment-discount', focusState);
}

function recalculateEditFees() {
    const inputs = getEditLiveCalculationInputs();

    if (!window.SalesFeeCalculator || typeof window.SalesFeeCalculator.buildLiveFeeCalculation !== 'function') {
        return;
    }

    currentEditInstallmentDiscounts = collectInstallmentDiscounts('[data-edit-installment-discount]');
    lastEditFeeCalculationInputKey = getEditLiveCalculationInputKey(inputs);
    currentEditFeeCalculation = window.SalesFeeCalculator.buildLiveFeeCalculation(inputs);
    renderEditCalculation(currentEditFeeCalculation);
}

function syncEditDiscountTypeByAdmissionType() {
    const admissionType = document.getElementById('editAdmType').value;
    const discountTypeSelect = document.getElementById('editAdmDiscountType');
    if (!admissionType || !discountTypeSelect) return;
    discountTypeSelect.value = getRecommendedDiscountType(admissionType);
    updateDiscountModeUI(discountTypeSelect.value, 'editAdmDiscountPercentGroup');
    recalculateEditFees();
}

function initializeEditAdmissionFormHandlers() {
    if (editAdmissionFormHandlersInitialized) return;

    const admissionTypeSelect = document.getElementById('editAdmType');
    const durationInput = document.getElementById('editAdmDuration');
    const totalFeesInput = document.getElementById('editAdmTotalFees');
    const discountTypeSelect = document.getElementById('editAdmDiscountType');
    const discountPercentInput = document.getElementById('editAdmDiscountPercent');

    admissionTypeSelect.addEventListener('change', syncEditDiscountTypeByAdmissionType);
    durationInput.addEventListener('input', recalculateEditFees);
    totalFeesInput.addEventListener('input', recalculateEditFees);
    discountTypeSelect.addEventListener('change', function() {
        updateDiscountModeUI(this.value, 'editAdmDiscountPercentGroup');
        recalculateEditFees();
    });
    discountPercentInput.addEventListener('input', recalculateEditFees);
    editAdmissionFormHandlersInitialized = true;
}

function setEditFeePlanFromRecord(record) {
    const feeManagement = record?.feeManagement || {};
    const summary = feeManagement.summary || {};
    const admissionType = normalizeAdmissionTypeValue(feeManagement.admissionType || record?.admissionType || 'one-time');
    const discountType = String(feeManagement.discountType || record?.discountType || getRecommendedDiscountType(admissionType)).trim().toLowerCase() || getRecommendedDiscountType(admissionType);
    const duration = Number(feeManagement.duration ?? record?.courseDuration ?? record?.duration ?? 0);
    const totalFees = Number(summary.actualFees ?? record?.courseTotalFees ?? record?.totalFees ?? record?.fees ?? record?.revenue ?? 0);
    const discountPercent = Number(feeManagement.discountPercent ?? record?.discountPercent ?? 0);
    const installmentDiscounts = feeManagement.installments && feeManagement.installments.length
        ? getEditInstallmentDiscountMap(feeManagement.installments)
        : feeManagement.installmentDiscounts || {};
    currentEditInstallmentStatuses = feeManagement.installments && feeManagement.installments.length
        ? getEditInstallmentStatusMap(feeManagement.installments)
        : {};

    document.getElementById('editAdmType').value = admissionType;
    document.getElementById('editAdmDuration').value = formatNumericDisplay(duration);
    document.getElementById('editAdmDurationRaw').value = String(Number.isFinite(duration) ? duration : 0);
    document.getElementById('editAdmTotalFees').value = Number.isFinite(totalFees) ? formatRupees(totalFees) : '';
    document.getElementById('editAdmTotalFeesRaw').value = String(Number.isFinite(totalFees) ? totalFees : 0);
    document.getElementById('editAdmDiscountType').value = discountType;
    document.getElementById('editAdmDiscountPercent').value = formatNumericDisplay(discountPercent || 0);
    updateDiscountModeUI(discountType, 'editAdmDiscountPercentGroup');
    currentEditInstallmentDiscounts = feeManagement.installments && feeManagement.installments.length
        ? buildInstallmentDiscountState(feeManagement.installments)
        : {};

    if (!window.SalesFeeCalculator || typeof window.SalesFeeCalculator.buildLiveFeeCalculation !== 'function') {
        return;
    }

    currentEditFeeCalculation = window.SalesFeeCalculator.buildLiveFeeCalculation({
        admissionType,
        discountType,
        discountPercent,
        duration,
        totalFees,
        installmentDiscounts
    });

    lastEditFeeCalculationInputKey = getEditLiveCalculationInputKey({
        admissionType,
        discountType,
        discountPercent: discountType === 'whole-fees' ? discountPercent : 0,
        duration,
        totalFees,
        installmentDiscounts
    });

    renderEditCalculation(currentEditFeeCalculation);
}

async function fetchUniversityDropdownOptions() {
    if (cachedUniversityOptions.length) return cachedUniversityOptions;
    const response = await fetch(`${API_BASE_URL}/universities/dropdown?limit=100`);
    if (!response.ok) throw new Error('Failed to load universities');
    const payload = await response.json();
    cachedUniversityOptions = Array.isArray(payload?.data) ? payload.data : [];
    return cachedUniversityOptions;
}

async function fetchCourseDropdownOptions(universityId) {
    const key = String(universityId || '').trim();
    if (!key) return [];
    if (cachedCourseOptionsByUniversity.has(key)) return cachedCourseOptionsByUniversity.get(key);

    const response = await fetch(`${API_BASE_URL}/courses/dropdown?universityId=${encodeURIComponent(key)}&limit=200`);
    if (!response.ok) throw new Error('Failed to load courses');
    const payload = await response.json();
    const courses = Array.isArray(payload?.data) ? payload.data : [];
    cachedCourseOptionsByUniversity.set(key, courses);
    return courses;
}

function setAdmissionComputedFields(course = null) {
    const durationInput = document.getElementById('admDuration');
    const feesInput = document.getElementById('admTotalFees');
    const revenuePreviewInput = document.getElementById('admRevenuePreview');
    const hiddenRevenueInput = document.getElementById('admRevenue');

    if (!course) {
        durationInput.value = '';
        feesInput.value = '';
        revenuePreviewInput.value = '';
        hiddenRevenueInput.value = '';
        currentLiveInstallmentStatuses = {};
        currentLiveInstallmentDiscounts = {};
        lastLiveCalculationInputKey = '';
        recalculateLiveFees();
        return;
    }

    const duration = Number(course.duration);
    const totalFees = Number(course.totalFees);

    durationInput.value = formatNumericDisplay(duration);
    feesInput.value = Number.isFinite(totalFees) ? formatNumericDisplay(totalFees) : '';
    revenuePreviewInput.value = Number.isFinite(totalFees) ? formatRupees(totalFees) : '';
    hiddenRevenueInput.value = Number.isFinite(totalFees) ? String(totalFees) : '';
    recalculateLiveFees();
}

async function populateUniversityDropdown() {
    const universitySelect = document.getElementById('admUniversitySelect');
    universitySelect.innerHTML = '<option value="">Select university...</option>';

    const universities = await fetchUniversityDropdownOptions();
    universities.forEach((item) => {
        if (!item?._id) return;
        const option = document.createElement('option');
        option.value = String(item._id);
        option.textContent = item.code ? `${item.name} (${item.code})` : item.name;
        option.dataset.universityName = item.name || '';
        universitySelect.appendChild(option);
    });
}

async function populateCourseDropdown(universityId) {
    const courseSelect = document.getElementById('admCourseSelect');
    courseSelect.innerHTML = '<option value="">Select course...</option>';
    courseSelect.disabled = true;
    setAdmissionComputedFields(null);

    const key = String(universityId || '').trim();
    if (!key) return;

    const courses = await fetchCourseDropdownOptions(key);
    courses.forEach((course) => {
        const option = document.createElement('option');
        option.value = String(course._id);
        option.textContent = course.code ? `${course.name} (${course.code})` : course.name;
        option.dataset.courseName = course.name || '';
        option.dataset.universityName = course.universityName || '';
        option.dataset.duration = String(course.duration ?? '');
        option.dataset.totalFees = String(course.totalFees ?? '');
        courseSelect.appendChild(option);
    });

    courseSelect.disabled = courses.length === 0;
}

function syncDiscountTypeByAdmissionType() {
    const admissionType = document.getElementById('admType').value;
    const discountTypeSelect = document.getElementById('admDiscountType');
    if (!admissionType || !discountTypeSelect) return;
    discountTypeSelect.value = getRecommendedDiscountType(admissionType);
    updateDiscountModeUI(discountTypeSelect.value);
    recalculateLiveFees();
}

function initializeAdmissionFormHandlers() {
    if (admissionFormHandlersInitialized) return;

    const universitySelect = document.getElementById('admUniversitySelect');
    const courseSelect = document.getElementById('admCourseSelect');
    const admissionTypeSelect = document.getElementById('admType');
    const durationInput = document.getElementById('admDuration');
    const totalFeesInput = document.getElementById('admTotalFees');
    const discountTypeSelect = document.getElementById('admDiscountType');
    const discountPercentInput = document.getElementById('admDiscountPercent');

    universitySelect.addEventListener('change', async function() {
        try {
            await populateCourseDropdown(this.value);
        } catch (error) {
            showNotification('Unable to load courses for selected university', 'error');
        }
    });

    courseSelect.addEventListener('change', function() {
        const selected = this.options[this.selectedIndex];
        if (!selected || !selected.value) {
            setAdmissionComputedFields(null);
            return;
        }

        setAdmissionComputedFields({
            duration: selected.dataset.duration,
            totalFees: selected.dataset.totalFees
        });
    });

    admissionTypeSelect.addEventListener('change', syncDiscountTypeByAdmissionType);
    durationInput.addEventListener('input', recalculateLiveFees);
    totalFeesInput.addEventListener('input', recalculateLiveFees);
    discountTypeSelect.addEventListener('change', recalculateLiveFees);
    discountTypeSelect.addEventListener('change', function() {
        updateDiscountModeUI(this.value);
    });
    discountPercentInput.addEventListener('input', recalculateLiveFees);
    admissionFormHandlersInitialized = true;
}

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

function parseDateOnly(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getEmployeeJoinDate(employee) {
    return employee?.hireDate || employee?.joinDate || employee?.joiningDate || employee?.dateOfJoining || '';
}

function isAdmissionVisibleForEmployee(admission, employee) {
    const joinDateValue = getEmployeeJoinDate(employee);
    if (!joinDateValue) return true;
    const joinDate = parseDateOnly(joinDateValue);
    const admissionDate = parseDateOnly(admission?.admissionDate);
    if (!joinDate || !admissionDate) return true;
    return admissionDate >= joinDate;
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
    
    const employees = await loadEmployees();
    const salesEmployees = employees.filter(emp => {
        const department = emp.department?.toLowerCase() || '';
        const status = emp.status || 'Active';
        return department.includes('sales') && status === 'Active';
    });
    
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
        const employeeVisibleAdmissions = approvedAdmissions
            .concat(pendingAdmissions)
            .filter(a => a.employeeId === employee.id && isAdmissionVisibleForEmployee(a, employee));
        const employeeApprovedAdmissions = employeeVisibleAdmissions.filter(a => (a.status || 'approved').toLowerCase() === 'approved');
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
        
        const pendingCount = employeeVisibleAdmissions.filter(a => (a.status || '').toLowerCase() === 'pending').length;
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
    document.getElementById('admAlternatePhone').value = '';
    document.getElementById('admAlternateEmail').value = '';
    document.getElementById('admDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('admType').value = 'one-time';
    document.getElementById('admDiscountType').value = 'whole-fees';
    document.getElementById('admDiscountPercent').value = '0';
    updateDiscountModeUI('whole-fees');
    currentLiveInstallmentStatuses = {};
    currentLiveInstallmentDiscounts = {};
    document.getElementById('admUniversitySelect').value = '';
    document.getElementById('admCourseSelect').innerHTML = '<option value="">Select course...</option>';
    document.getElementById('admCourseSelect').disabled = true;
    cachedUniversityOptions = [];
    cachedCourseOptionsByUniversity = new Map();
    lastLiveCalculationInputKey = '';
    setAdmissionComputedFields(null);

    initializeAdmissionFormHandlers();

    try {
        await populateUniversityDropdown();
    } catch (error) {
        showNotification('Unable to load universities. Please try again.', 'error');
    }

    recalculateLiveFees();
    
    document.getElementById('salesModal').style.display = 'flex';
}

// Close sales modal
function closeSalesModal() {
    document.getElementById('salesModal').style.display = 'none';
    document.getElementById('salesForm').reset();
    currentLiveInstallmentStatuses = {};
    currentLiveInstallmentDiscounts = {};
}

// ─── Sales Recording ─────────────────────────────────────────────────────────
async function recordSales(event) {
    event.preventDefault();
    
    const employeeId = parseInt(document.getElementById('salesEmployeeId').value);
    const month = document.getElementById('salesMonth').value;
    const customerName    = document.getElementById('admCustomerName').value.trim();
    const customerPhone   = document.getElementById('admCustomerPhone').value.trim();
    const customerEmail   = document.getElementById('admCustomerEmail').value.trim();
    const alternateCustomerPhone = document.getElementById('admAlternatePhone').value.trim();
    const alternateCustomerEmail = document.getElementById('admAlternateEmail').value.trim();
    const universitySelect = document.getElementById('admUniversitySelect');
    const courseSelect = document.getElementById('admCourseSelect');
    const selectedUniversity = universitySelect.options[universitySelect.selectedIndex];
    const selectedCourse = courseSelect.options[courseSelect.selectedIndex];
    const universityId = universitySelect.value;
    const courseId = courseSelect.value;
    const universityName = selectedUniversity?.dataset?.universityName || '';
    const course = selectedCourse?.dataset?.courseName || '';
    const admissionDate   = document.getElementById('admDate').value;
    const admissionType = normalizeAdmissionTypeValue(document.getElementById('admType').value);
    const discountType = document.getElementById('admDiscountType').value;
    const duration = parseNumericInput(document.getElementById('admDuration').value);
    const totalFees = parseNumericInput(document.getElementById('admTotalFees').value);
    const discountPercent = parseNumericInput(document.getElementById('admDiscountPercent').value);
    const installmentDiscounts = collectInstallmentDiscounts();

    currentLiveFeeCalculation = window.SalesFeeCalculator.buildLiveFeeCalculation({
        admissionType,
        discountType,
        discountPercent,
        duration,
        totalFees,
        installmentDiscounts
    });

    if (!currentLiveFeeCalculation?.validation?.isValid) {
        const firstError = currentLiveFeeCalculation?.validation?.errors?.[0] || 'Please fix validation errors before recording admission';
        showNotification(firstError, 'error');
        renderLiveCalculation(currentLiveFeeCalculation);
        return;
    }

    const revenue = Number(currentLiveFeeCalculation?.summary?.totalFeesPayable || 0);
    const installmentRows = buildLiveInstallmentPayloads(currentLiveFeeCalculation);

    if (!universityId || !courseId) {
        showNotification('Please select university and course', 'error');
        return;
    }

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(totalFees) || totalFees < 0) {
        showNotification('Selected course has invalid duration or fees. Please reselect.', 'error');
        return;
    }

    if (!admissionType || !discountType) {
        showNotification('Please select admission type and discount type', 'error');
        return;
    }
    
    const response = await fetch(`${API_BASE_URL}/admissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            employeeId,
            month,
            customerName,
            customerPhone,
            customerEmail,
            alternateCustomerPhone,
            alternateCustomerEmail,
            universityId,
            universityName,
            courseId,
            course,
            courseDuration: duration,
            courseTotalFees: totalFees,
            duration,
            totalFees,
            fees: totalFees,
            admissionDate,
            admissionType,
            discountType,
            discountPercent,
            feeManagement: {
                admissionType,
                discountType,
                duration,
                totalFees,
                discountPercent,
                installmentDiscounts: (discountType === 'yearly' || discountType === 'semester') ? installmentDiscounts : undefined,
                installments: installmentRows
            },
            revenue,
            status: 'approved',
            submittedBy: 'admin'
        })
    });
    
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showNotification(err.error || 'Failed to record admission', 'error');
        return;
    }
    
    const employees = await window.loadEmployees();
    const employee = employees.find(e => e.id === employeeId);
    addLog('sales', `Recorded admission for ${employee.firstName} ${employee.lastName} - ${formatMonth(month)}: ${customerName} (${getAdmissionTypeLabel(admissionType)} / ${getDiscountTypeLabel(discountType)}), ${formatRupees(revenue)}`);
    
    // Invalidate cached sales data so the table refreshes
    cachedSalesData = null;
    currentLiveInstallmentStatuses = {};
    
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
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#718096;">Loading…</td></tr>';
    modal.style.display = 'flex';

    try {
        const employees = await loadEmployees();
        const employee = employees.find(e => e.id === employeeId || String(e.id) === String(employeeId));
        const res = await fetch(`${API_BASE_URL}/admissions?employeeId=${employeeId}&month=${month}`);
        const records = await res.json();
        _admCurrentRecords = Array.isArray(records)
            ? records.filter(record => isAdmissionVisibleForEmployee(record, employee))
            : [];

        if (!_admCurrentRecords.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#718096;">No admission records for this month</td></tr>';
            return;
        }

        const typeLabel = {
            'one-time': 'One-Time',
            yearly: 'Yearly',
            annual: 'Annual',
            'semester-wise': 'Semester-Wise',
            semester: 'Semester'
        };
        const typeColor = {
            'one-time': '#3730a3',
            yearly: '#065f46',
            annual: '#065f46',
            'semester-wise': '#92400e',
            semester: '#92400e'
        };
        const typeBg = {
            'one-time': '#e0e7ff',
            yearly: '#d1fae5',
            annual: '#d1fae5',
            'semester-wise': '#fef3c7',
            semester: '#fef3c7'
        };

        tbody.innerHTML = _admCurrentRecords
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
                    <td style="padding:10px 12px;font-size:12px;color:#718096;">
                        ${r.customerPhone || '\u2014'}${r.alternateCustomerPhone ? `<br><span style="color:#9ca3af;">Alt: ${r.alternateCustomerPhone}</span>` : ''}
                        <br><span style="color:#a0aec0;">${r.customerEmail || ''}</span>${r.alternateCustomerEmail ? `<br><span style="color:#9ca3af;">Alt: ${r.alternateCustomerEmail}</span>` : ''}
                    </td>
                    <td style="padding:10px 12px;font-size:12px;color:#4a5568;">${r.course || '\u2014'}</td>
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
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#dc2626;">Failed to load records</td></tr>';
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
    document.getElementById('editAdmAlternatePhone').value = record.alternateCustomerPhone || '';
    document.getElementById('editAdmAlternateEmail').value = record.alternateCustomerEmail || '';
    document.getElementById('editAdmCourse').value = record.course || '';
    document.getElementById('editAdmDate').value = record.admissionDate || '';
    document.getElementById('editAdmType').value = normalizeAdmissionTypeValue(record.admissionType || 'one-time');
    document.getElementById('editAdmRevenue').value = formatRupees(record.revenue || 0);
    document.getElementById('editAdmUniversity').value = record.universityName || '';
    document.getElementById('editAdmReviewNote').value = record.reviewNote || '';

    const revenueInput = document.getElementById('editAdmRevenue');
    revenueInput.oninput = function() { formatCurrencyInput(this); };

    initializeEditAdmissionFormHandlers();
    setEditFeePlanFromRecord(record);

    document.getElementById('editAdmissionModal').style.display = 'flex';
}

function closeEditAdmissionModal() {
    document.getElementById('editAdmissionModal').style.display = 'none';
    document.getElementById('editAdmissionForm').reset();
    currentEditFeeCalculation = null;
    lastEditFeeCalculationInputKey = '';
    currentEditInstallmentStatuses = {};
    currentEditInstallmentDiscounts = {};
}

async function saveAdmissionEdits(event) {
    event.preventDefault();
    const id = document.getElementById('editAdmissionId').value;
    const currentInputs = getEditLiveCalculationInputs();
    currentEditFeeCalculation = window.SalesFeeCalculator.buildLiveFeeCalculation(currentInputs);

    if (!currentEditFeeCalculation?.validation?.isValid) {
        const firstError = currentEditFeeCalculation?.validation?.errors?.[0] || 'Please fix validation errors before saving';
        showNotification(firstError, 'error');
        renderEditCalculation(currentEditFeeCalculation);
        return;
    }

    const editInstallments = buildEditInstallmentPayloads(currentEditFeeCalculation);

    const payload = {
        customerName: document.getElementById('editAdmCustomerName').value.trim(),
        customerPhone: document.getElementById('editAdmCustomerPhone').value.trim(),
        customerEmail: document.getElementById('editAdmCustomerEmail').value.trim(),
        alternateCustomerPhone: document.getElementById('editAdmAlternatePhone').value.trim(),
        alternateCustomerEmail: document.getElementById('editAdmAlternateEmail').value.trim(),
        course: document.getElementById('editAdmCourse').value.trim(),
        admissionDate: document.getElementById('editAdmDate').value,
        admissionType: document.getElementById('editAdmType').value,
        revenue: getRawCurrencyValue(document.getElementById('editAdmRevenue')),
        universityName: document.getElementById('editAdmUniversity').value.trim(),
        reviewNote: document.getElementById('editAdmReviewNote').value.trim(),
        feeManagement: {
            admissionType: currentInputs.admissionType,
            discountType: currentInputs.discountType,
            duration: currentInputs.duration,
            totalFees: currentInputs.totalFees,
            discountPercent: currentInputs.discountPercent,
            installmentDiscounts: (currentInputs.discountType === 'yearly' || currentInputs.discountType === 'semester')
                ? currentInputs.installmentDiscounts
                : undefined,
            installments: editInstallments
        }
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

    window.addEventListener('storage', function(event) {
        if (event.key === 'masterDataVersion') {
            cachedUniversityOptions = [];
            cachedCourseOptionsByUniversity = new Map();
        }
    });

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
