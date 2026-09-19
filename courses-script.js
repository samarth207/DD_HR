let courses = [];
let filteredCourses = [];
let universityOptions = [];
let editingCourseId = null;

const courseState = {
    page: 1,
    limit: 80,
    search: '',
    status: 'active',
    universityId: ''
};

function courseApi(path, options) {
    return fetch(`${API_BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
        ...(options || {})
    });
}

function formatCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `Rs ${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCourseStatusBadge(item) {
    if (item.isDeleted) return '<span class="status-badge inactive">Deleted</span>';
    if (item.isActive) return '<span class="status-badge active">Active</span>';
    return '<span class="status-badge on-leave">Inactive</span>';
}

function renderCourseTable() {
    const tbody = document.getElementById('coursesTableBody');
    if (!filteredCourses.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">No courses found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredCourses.map((item) => {
        const id = String(item._id || '');
        const actions = item.isDeleted
            ? `<button class="icon-btn" style="background:#dcfce7;color:#166534;" onclick="restoreCourse('${id}')" title="Restore"><i class="fas fa-rotate-left"></i></button>`
            : `<button class="icon-btn edit" onclick="openCourseModal('${id}')" title="Edit"><i class="fas fa-edit"></i></button>
               <button class="icon-btn delete" onclick="deleteCourse('${id}')" title="Delete"><i class="fas fa-trash"></i></button>`;

        return `<tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.universityName)}</td>
            <td>${Number(item.duration || 0)}</td>
            <td>${formatCurrency(item.totalFees)}</td>
            <td>${getCourseStatusBadge(item)}</td>
            <td class="actions">${actions}</td>
        </tr>`;
    }).join('');
}

function applyCourseFilters() {
    const search = (document.getElementById('courseSearchInput').value || '').trim().toLowerCase();
    const status = document.getElementById('courseStatusFilter').value;
    const universityId = document.getElementById('courseUniversityFilter').value;

    filteredCourses = courses.filter((item) => {
        const matchesSearch = !search
            || String(item.name || '').toLowerCase().includes(search)
            || String(item.universityName || '').toLowerCase().includes(search)
            || String(item.code || '').toLowerCase().includes(search);

        if (!matchesSearch) return false;

        if (universityId && String(item.universityId) !== universityId) return false;

        if (status === 'deleted') return item.isDeleted === true;
        if (status === 'inactive') return item.isDeleted !== true && item.isActive === false;
        if (status === 'all') return true;
        return item.isDeleted !== true && item.isActive === true;
    });

    renderCourseTable();
}

function buildCourseQuery() {
    const params = new URLSearchParams();
    params.set('page', String(courseState.page));
    params.set('limit', String(courseState.limit));

    if (courseState.search) params.set('search', courseState.search);
    if (courseState.universityId) params.set('universityId', courseState.universityId);

    if (courseState.status === 'deleted' || courseState.status === 'all') {
        params.set('includeDeleted', 'true');
    }

    if (courseState.status === 'active') {
        params.set('activeOnly', 'true');
    }

    return params.toString();
}

async function loadUniversityOptions() {
    const response = await courseApi('/universities/dropdown?limit=100');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load universities');
    universityOptions = Array.isArray(payload.data) ? payload.data : [];

    const filterSelect = document.getElementById('courseUniversityFilter');
    const formSelect = document.getElementById('courseUniversity');

    filterSelect.innerHTML = '<option value="">All Universities</option>';
    formSelect.innerHTML = '<option value="">Select University</option>';

    universityOptions.forEach((item) => {
        if (!item || !item._id || item.source !== 'master') return;
        const optionText = item.code ? `${item.name} (${item.code})` : item.name;

        const filterOption = document.createElement('option');
        filterOption.value = String(item._id);
        filterOption.textContent = optionText;
        filterSelect.appendChild(filterOption);

        const formOption = document.createElement('option');
        formOption.value = String(item._id);
        formOption.textContent = optionText;
        formSelect.appendChild(formOption);
    });
}

async function loadCourses() {
    const tbody = document.getElementById('coursesTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">Loading courses...</td></tr>';

    try {
        const query = buildCourseQuery();
        const response = await courseApi(`/courses?${query}`);
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || 'Failed to load courses');

        courses = Array.isArray(payload.data) ? payload.data : [];
        applyCourseFilters();
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">Failed to load courses</td></tr>';
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

function openCourseModal(id) {
    editingCourseId = id || null;
    const modal = document.getElementById('courseModal');
    const title = document.getElementById('courseModalTitle');
    const universityInput = document.getElementById('courseUniversity');
    const nameInput = document.getElementById('courseName');
    const durationInput = document.getElementById('courseDuration');
    const totalFeesInput = document.getElementById('courseTotalFees');
    const activeInput = document.getElementById('courseIsActive');

    if (editingCourseId) {
        const current = courses.find((item) => String(item._id) === String(editingCourseId));
        if (!current) {
            if (typeof showNotification === 'function') showNotification('Course not found', 'error');
            return;
        }

        title.textContent = 'Edit Course';
        universityInput.value = String(current.universityId || '');
        nameInput.value = current.name || '';
        durationInput.value = String(current.duration || '');
        totalFeesInput.value = String(current.totalFees || '');
        activeInput.value = current.isActive === false ? 'false' : 'true';
    } else {
        title.textContent = 'Add Course';
        universityInput.value = '';
        nameInput.value = '';
        durationInput.value = '';
        totalFeesInput.value = '';
        activeInput.value = 'true';
    }

    document.getElementById('courseFormError').textContent = '';
    modal.classList.add('show');
}

function closeCourseModal() {
    document.getElementById('courseModal').classList.remove('show');
    editingCourseId = null;
}

async function saveCourse(event) {
    event.preventDefault();

    const payload = {
        universityId: document.getElementById('courseUniversity').value,
        name: document.getElementById('courseName').value,
        duration: document.getElementById('courseDuration').value,
        totalFees: document.getElementById('courseTotalFees').value,
        isActive: document.getElementById('courseIsActive').value === 'true'
    };

    const errorBox = document.getElementById('courseFormError');

    const validation = window.MasterDataValidation.validateCourseInput(payload, {
        maxNameLength: 160,
        existingItems: courses,
        editingId: editingCourseId
    });

    if (!validation.ok) {
        errorBox.textContent = validation.error;
        return;
    }

    const nextPayload = validation.value;
    const isEdit = Boolean(editingCourseId);

    try {
        const response = await courseApi(
            isEdit ? `/courses/${editingCourseId}` : '/courses',
            {
                method: isEdit ? 'PUT' : 'POST',
                body: JSON.stringify(nextPayload)
            }
        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to save course');

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') {
            showNotification(isEdit ? 'Course updated successfully' : 'Course added successfully', 'success');
        }
        closeCourseModal();
        await loadCourses();
    } catch (error) {
        errorBox.textContent = error.message;
    }
}

async function deleteCourse(id) {
    if (!window.confirm('Delete this course? It can be restored later.')) return;
    try {
        const response = await courseApi(`/courses/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to delete course');

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') showNotification('Course deleted', 'success');
        await loadCourses();
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

async function restoreCourse(id) {
    try {
        const response = await courseApi(`/courses/${id}/restore`, { method: 'PATCH' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to restore course');

        localStorage.setItem('masterDataVersion', String(Date.now()));
        if (typeof showNotification === 'function') showNotification('Course restored', 'success');
        await loadCourses();
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
}

function onCourseSearch() {
    courseState.search = document.getElementById('courseSearchInput').value.trim();
    courseState.page = 1;
    loadCourses();
}

function onCourseStatusFilter() {
    courseState.status = document.getElementById('courseStatusFilter').value;
    courseState.page = 1;
    loadCourses();
}

function onCourseUniversityFilter() {
    courseState.universityId = document.getElementById('courseUniversityFilter').value;
    courseState.page = 1;
    loadCourses();
}

document.addEventListener('DOMContentLoaded', async function() {
    const modal = document.getElementById('courseModal');
    modal.addEventListener('click', function(event) {
        if (event.target === modal) closeCourseModal();
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modal.classList.contains('show')) {
            closeCourseModal();
        }
    });

    try {
        await loadUniversityOptions();
        await loadCourses();
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
});

window.openCourseModal = openCourseModal;
window.closeCourseModal = closeCourseModal;
window.saveCourse = saveCourse;
window.deleteCourse = deleteCourse;
window.restoreCourse = restoreCourse;
window.onCourseSearch = onCourseSearch;
window.onCourseStatusFilter = onCourseStatusFilter;
window.onCourseUniversityFilter = onCourseUniversityFilter;
