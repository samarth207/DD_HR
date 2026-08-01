/**
 * auth-guard.js
 * Include this script BEFORE other scripts on every protected page.
 *
 * Admin pages:  requireAdmin()
 * Employee page: requireEmployee()
 */

(function() {
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    let authValidationInFlight = null;
    let logoutTriggered = false;

    function parseJsonSafe(value) {
        try { return JSON.parse(value); } catch { return null; }
    }

    function readAuthFromLegacyKeys() {
        // Backward compatibility: tolerate older key shapes if present in browser storage.
        const legacyAdminToken = localStorage.getItem('adminToken') || '';
        const legacyEmployeeToken = localStorage.getItem('employeeToken') || '';
        if (legacyAdminToken) {
            return { token: legacyAdminToken, role: 'admin' };
        }
        if (legacyEmployeeToken) {
            return { token: legacyEmployeeToken, role: 'employee' };
        }
        return null;
    }

    function getAuth() {
        const raw = localStorage.getItem('hrPortalAuth');
        const parsed = parseJsonSafe(raw || 'null');
        if (parsed && typeof parsed === 'object' && parsed.token) return parsed;

        const legacy = readAuthFromLegacyKeys();
        if (legacy) {
            localStorage.setItem('hrPortalAuth', JSON.stringify(legacy));
            return legacy;
        }
        return null;
    }

    function logout() {
        if (logoutTriggered) return;
        logoutTriggered = true;
        localStorage.removeItem('hrPortalAuth');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('employeeToken');
        window.location.replace('login.html');
    }

    async function validateAuthSession() {
        if (authValidationInFlight) return authValidationInFlight;
        authValidationInFlight = (async () => {
            const auth = getAuth();
            if (!auth?.token) return null;
            if (!nativeFetch) return auth;

            try {
                const response = await nativeFetch(`${API_BASE_URL}/auth/me`, {
                    headers: { Authorization: `Bearer ${auth.token}` }
                });
                if (!response.ok) return null;
                const profile = await response.json();
                if (!profile?.role) return null;

                const nextAuth = { ...auth, role: profile.role };
                if (profile.employeeId != null) nextAuth.employeeId = profile.employeeId;
                if (profile.name) nextAuth.name = profile.name;
                localStorage.setItem('hrPortalAuth', JSON.stringify(nextAuth));
                return nextAuth;
            } catch {
                return auth;
            }
        })();

        try {
            return await authValidationInFlight;
        } finally {
            authValidationInFlight = null;
        }
    }

    async function requireRole(expectedRole) {
        const auth = getAuth();
        if (!auth || !auth.token || auth.role !== expectedRole) {
            window.location.replace('login.html');
            return;
        }

        document.documentElement.style.visibility = 'visible';

        const verified = await validateAuthSession();
        if (!verified || verified.role !== expectedRole) {
            logout();
        }
    }

    // Expose on window for use in page scripts
    window.getAuthToken = function() { return (getAuth() || {}).token || ''; };
    window.getAuthRole  = function() { return (getAuth() || {}).role  || ''; };
    window.getAuthEmployeeId = function() { return (getAuth() || {}).employeeId || null; };
    window.getAuthName  = function() { return (getAuth() || {}).name  || ''; };
    window.logout = logout;

    // Require admin role — called by admin pages
    window.requireAdmin = function() { requireRole('admin'); };

    // Require employee role — called by employee portal
    window.requireEmployee = function() { requireRole('employee'); };

    // Backward compatibility: many modules use direct fetch() calls.
    // Inject Authorization header automatically for same-origin API requests.
    if (nativeFetch) {
        window.fetch = async function(input, init = {}) {
            try {
                const auth = getAuth();
                const token = auth?.token;
                if (!token) return nativeFetch(input, init);

                const url = typeof input === 'string' ? input : String(input?.url || '');
                const isApiCall = url.includes('/api/') || (typeof API_BASE_URL === 'string' && url.startsWith(API_BASE_URL));
                if (!isApiCall) return nativeFetch(input, init);

                const headers = new Headers((init && init.headers) || (input && input.headers) || {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `Bearer ${token}`);
                }

                const nextInit = { ...init, headers };
                const response = await nativeFetch(input, nextInit);

                // If server rejects token, force a clean relogin instead of repeated 401 spam.
                if (response.status === 401 && !url.includes('/api/auth/')) {
                    logout();
                }
                return response;
            } catch (_) {
                return nativeFetch(input, init);
            }
        };
    }
})();
