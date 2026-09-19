(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.MasterDataValidation = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    function normalizeName(value) {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function normalizeSearch(value) {
        return String(value || '').trim();
    }

    function isPositiveInteger(value) {
        const num = Number(value);
        return Number.isInteger(num) && num > 0;
    }

    function isPositiveNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) && num > 0;
    }

    function validateUniversityInput(input, options) {
        const opts = options || {};
        const maxNameLength = Number.isFinite(opts.maxNameLength) ? opts.maxNameLength : 160;
        const normalizedName = normalizeName(input && input.name);
        const existingNames = Array.isArray(opts.existingNames)
            ? opts.existingNames.map((name) => normalizeName(name).toLowerCase())
            : [];
        const editingId = String(opts.editingId || '').trim();
        const existingItems = Array.isArray(opts.existingItems) ? opts.existingItems : [];

        if (!normalizedName) {
            return { ok: false, error: 'University name is required.' };
        }

        if (normalizedName.length > maxNameLength) {
            return { ok: false, error: 'University name is too long.' };
        }

        const duplicateByName = existingItems.find((item) => {
            if (!item || item.isDeleted) return false;
            if (editingId && String(item._id) === editingId) return false;
            return normalizeName(item.name).toLowerCase() === normalizedName.toLowerCase();
        });

        if (!duplicateByName && existingNames.includes(normalizedName.toLowerCase())) {
            return { ok: false, error: 'University with same name already exists.' };
        }

        if (duplicateByName) {
            return { ok: false, error: 'University with same name already exists.' };
        }

        return {
            ok: true,
            value: {
                name: normalizedName,
                isActive: Boolean(input && input.isActive)
            }
        };
    }

    function validateCourseInput(input, options) {
        const opts = options || {};
        const maxNameLength = Number.isFinite(opts.maxNameLength) ? opts.maxNameLength : 160;
        const normalizedName = normalizeName(input && input.name);
        const universityId = String((input && input.universityId) || '').trim();
        const duration = Number(input && input.duration);
        const totalFees = Number(input && input.totalFees);
        const editingId = String(opts.editingId || '').trim();
        const existingItems = Array.isArray(opts.existingItems) ? opts.existingItems : [];

        if (!universityId) {
            return { ok: false, error: 'University is required.' };
        }

        if (!normalizedName) {
            return { ok: false, error: 'Course name is required.' };
        }

        if (normalizedName.length > maxNameLength) {
            return { ok: false, error: 'Course name is too long.' };
        }

        if (!isPositiveInteger(duration)) {
            return { ok: false, error: 'Duration must be a positive integer.' };
        }

        if (!isPositiveNumber(totalFees)) {
            return { ok: false, error: 'Total fees must be a positive number.' };
        }

        const duplicateByScope = existingItems.find((item) => {
            if (!item || item.isDeleted) return false;
            if (editingId && String(item._id) === editingId) return false;
            return String(item.universityId) === universityId
                && normalizeName(item.name).toLowerCase() === normalizedName.toLowerCase();
        });

        if (duplicateByScope) {
            return { ok: false, error: 'Same course already exists under this university.' };
        }

        return {
            ok: true,
            value: {
                universityId,
                name: normalizedName,
                duration,
                totalFees,
                isActive: Boolean(input && input.isActive)
            }
        };
    }

    return {
        normalizeName: normalizeName,
        normalizeSearch: normalizeSearch,
        isPositiveInteger: isPositiveInteger,
        isPositiveNumber: isPositiveNumber,
        validateUniversityInput: validateUniversityInput,
        validateCourseInput: validateCourseInput
    };
}));
