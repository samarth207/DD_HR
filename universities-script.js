let universities = [];
let filteredUniversities = [];
let editingUniversityId = null;

const universityState = {
    page: 1,
    limit: 50,
    search: '',
    status: 'active'
};

function universityApi(path, options) {
    return fetch(`${API_BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
        ...(options || {})
    });
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getUniversityStatusBadge(item) {
    if (item.isDeleted) return '<span class="status-badge inactive">Deleted</span>';
    if (item.isActive) return '<span class="status-badge active">Active</span>';
    return '<span class="status-badge on-leave">Inactive</span>';
}

function applyUniversityFilters() {
    const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const status = document.getElementById('statusFilter').value;

    filteredUniversities = universities.filter((item) => {
        const matchesSearch = !search
            || String(item.name || '').toLowerCase().includes(search)
            || String(item.code || '').toLowerCase().includes(search);

        if (!matchesSearch) return false;

        if (status === 'deleted') return item.isDeleted === true;
        if (status === 'inactive') return item.isDeleted !== true && item.isActive === false;
        if (status === 'all') return true;
        return item.isDeleted !== true && item.isActive === true;
    });

    renderUniversityTable();
}

function renderUniversityTable() {
    const tbody = document.getElementById('universitiesTableBody');
    if (!filteredUniversities.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">No universities found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredUniversities.map((item) => {
        const id = String(item._id || '');
        const actions = item.isDeleted
            ? `<button class="icon-btn" style="background:#dcfce7;color:#166534;" onclick="restoreUniversity('${id}')" title="Restore"><i class="fas fa-rotate-left"></i></button>`
            : `<button class="icon-btn edit" onclick="openUniversityModal('${id}')" title="Edit"><i class="fas fa-edit"></i></button>
               <button class="icon-btn delete" onclick="deleteUniversity('${id}')" title="Delete"><i class="fas fa-trash"></i></button>`;

        return `<tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${getUniversityStatusBadge(item)}</td>
            <td>${formatDate(item.createdAt)}</td>
            <td>${formatDate(item.updatedAt)}</td>
            <td class="actions">${actions}</td>
        </tr>`;
    }).join('');
}

function buildUniversityQuery() {
    const params = new URLSearchParams();
    params.set('page', String(universityState.page));
    params.set('limit', String(universityState.limit));

    if (universityState.search) params.set('search', universityState.search);

    if (universityState.status === 'deleted' || universityState.status === 'all') {
        params.set('includeDeleted', 'true');
    }

    if (universityState.status === 'active') {
        params.set('activeOnly', 'true');
    }

    return params.toString();
}

async function loadUniversities() {
    const tbody = document.getElementById('universitiesTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="no-data">Loading universities...</td></tr>';

    try {
        const query = buildUniversityQuery();
        const response = await universityApi(`/universities?${query}`);
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Failed to load universities');
        }

        universities = Array.isArray(payload.data) ? payload.data : [];
        applyUniversityFilters();
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">Failed to load universities</td></tr>';
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

function openUniversityModal(id) {
    editingUniversityId = id || null;
    const modal = document.getElementById('universityModal');
    const title = document.getElementById('universityModalTitle');
    const nameInput = document.getElementById('universityName');
    const activeInput = document.getElementById('universityIsActive');

    if (editingUniversityId) {
        const current = universities.find((item) => String(item._id) === String(editingUniversityId));
        if (!current) {
            if (typeof showNotification === 'function') showNotification('University not found', 'error');
            return;
        }
        title.textContent = 'Edit University';
        nameInput.value = current.name || '';
        activeInput.value = current.isActive === false ? 'false' : 'true';
    } else {
        title.textContent = 'Add University';
        nameInput.value = '';
        activeInput.value = 'true';
    }

    document.getElementById('universityFormError').textContent = '';
    modal.classList.add('show');
}

function closeUniversityModal() {
    const modal = document.getElementById('universityModal');
    modal.classList.remove('show');
    editingUniversityId = null;
}

async function saveUniversity(event) {
    event.preventDefault();

    const name = document.getElementById('universityName').value;
    const isActive = document.getElementById('universityIsActive').value === 'true';
    const errorBox = document.getElementById('universityFormError');

    const validation = window.MasterDataValidation.validateUniversityInput(
        { name, isActive },
        {
            maxNameLength: 160,
            existingItems: universities,
            editingId: editingUniversityId
        }
    );

    if (!validation.ok) {
        errorBox.textContent = validation.error;
        return;
    }

    const payload = validation.value;
    const isEdit = Boolean(editingUniversityId);

    try {
        const response = await universityApi(
            isEdit ? `/universities/${editingUniversityId}` : '/universities',
            {
                method: isEdit ? 'PUT' : 'POST',
                body: JSON.stringify(payload)
            }
        );
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to save university');
        }

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') {
            showNotification(isEdit ? 'University updated successfully' : 'University added successfully', 'success');
        }
        closeUniversityModal();
        await loadUniversities();
    } catch (error) {
        errorBox.textContent = error.message;
    }
}

async function deleteUniversity(id) {
    if (!window.confirm('Delete this university? It can be restored later.')) return;
    try {
        const response = await universityApi(`/universities/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to delete university');

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') showNotification('University deleted', 'success');
        await loadUniversities();
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

async function restoreUniversity(id) {
    try {
        const response = await universityApi(`/universities/${id}/restore`, { method: 'PATCH' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to restore university');

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') showNotification('University restored', 'success');
        await loadUniversities();
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

function onUniversitySearch() {
    universityState.search = document.getElementById('searchInput').value.trim();
    universityState.page = 1;
    loadUniversities();
}

function onUniversityStatusFilter() {
    universityState.status = document.getElementById('statusFilter').value;
    universityState.page = 1;
    loadUniversities();
}

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('universityModal');
    modal.addEventListener('click', function(event) {
        if (event.target === modal) closeUniversityModal();
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modal.classList.contains('show')) {
            closeUniversityModal();
        }
    });

    loadUniversities();
});

window.openUniversityModal = openUniversityModal;
window.closeUniversityModal = closeUniversityModal;
window.saveUniversity = saveUniversity;
window.deleteUniversity = deleteUniversity;
window.restoreUniversity = restoreUniversity;
window.onUniversitySearch = onUniversitySearch;
window.onUniversityStatusFilter = onUniversityStatusFilter;
