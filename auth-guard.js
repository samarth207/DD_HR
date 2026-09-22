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
    let csrfToken = null;
    const HR_RESTRICTED_PAGES = new Set([
        'sales-tracking.html',
        'admissions-analytics.html',
        'incentives.html'
    ]);

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

    async function getCSRFToken() {
        if (csrfToken) return csrfToken;
        
        const auth = getAuth();
        if (!auth?.token) return null;

        try {
            const response = await nativeFetch(`${API_BASE_URL}/csrf-token`, {
                headers: { Authorization: `Bearer ${auth.token}` }
            });
            if (response.ok) {
                const data = await response.json();
                csrfToken = data.csrfToken;
                return csrfToken;
            }
        } catch (error) {
            console.warn('Failed to fetch CSRF token:', error);
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

    function toRoleList(expectedRoles) {
        return Array.isArray(expectedRoles) ? expectedRoles : [expectedRoles];
    }

    function isAllowedRole(role, allowedRoles) {
        return !!role && allowedRoles.includes(role);
    }

    function getPageNameFromHref(href) {
        if (!href) return '';
        try {
            const url = new URL(href, window.location.origin);
            return (url.pathname.split('/').pop() || '').toLowerCase();
        } catch {
            return String(href).split('/').pop().split('?')[0].split('#')[0].toLowerCase();
        }
    }

    function applyRoleBasedNavigation(role) {
        document.querySelectorAll('.nav-item').forEach((item) => {
            const href = item.getAttribute('href') || '';
            const pageName = getPageNameFromHref(href);
            if (HR_RESTRICTED_PAGES.has(pageName)) {
                item.style.display = role === 'hr' ? 'none' : '';
            }
        });
    }

    function applyRoleIdentity(role) {
        const avatar = document.querySelector('.sidebar-avatar');
        const nameEl = document.querySelector('.sidebar-user-info p');
        const roleEl = document.querySelector('.sidebar-user-info span');

        if (!avatar || !nameEl || !roleEl) return;

        if (role === 'hr') {
            avatar.textContent = 'HR';
            nameEl.textContent = 'HR Portal';
            roleEl.textContent = 'HR Manager';
            return;
        }

        if (role === 'admin') {
            avatar.textContent = 'AD';
            nameEl.textContent = 'Admin Portal';
            roleEl.textContent = 'Administrator';
        }
    }

    async function requireRole(expectedRoles) {
        const allowedRoles = toRoleList(expectedRoles);
        const auth = getAuth();
        if (!auth || !auth.token || !isAllowedRole(auth.role, allowedRoles)) {
            window.location.replace('login.html');
            return;
        }

        applyRoleBasedNavigation(auth.role);
        applyRoleIdentity(auth.role);
        document.documentElement.style.visibility = 'visible';

        const verified = await validateAuthSession();
        if (!verified || !isAllowedRole(verified.role, allowedRoles)) {
            logout();
            return;
        }

        if (verified.role !== auth.role) {
            applyRoleBasedNavigation(verified.role);
            applyRoleIdentity(verified.role);
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

    // Require HR role only
    window.requireHR = function() { requireRole('hr'); };

    // Require admin or HR role — used by shared management pages
    window.requireManagement = function() { requireRole(['admin', 'hr']); };

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

                // Add CSRF token for state-changing operations
                const method = (init && init.method) || (input && input.method) || 'GET';
                const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
                
                // Skip CSRF for auth endpoints and health endpoint
                if (stateChangingMethods.includes(method.toUpperCase()) && 
                    !url.includes('/api/auth/') && 
                    !url.includes('/api/v1/auth/') &&
                    !url.includes('/health')) {
                    const csrfTokenValue = await getCSRFToken();
                    if (csrfTokenValue && !headers.has('X-CSRF-Token')) {
                        headers.set('X-CSRF-Token', csrfTokenValue);
                    }
                }

                const nextInit = { ...init, headers };
                const response = await nativeFetch(input, nextInit);

                // If server rejects token, force a clean relogin instead of repeated 401 spam.
                if (response.status === 401 && !url.includes('/api/auth/')) {
                    logout();
                }
                
                // If CSRF token is invalid, fetch a new one and retry
                if (response.status === 403) {
                    try {
                        const errorData = await response.json();
                        if (errorData.error === 'Invalid CSRF token' || errorData.error === 'CSRF token missing') {
                            csrfToken = null; // Reset module-level CSRF token
                            const newCsrfToken = await getCSRFToken();
                            if (newCsrfToken) {
                                headers.set('X-CSRF-Token', newCsrfToken);
                                return nativeFetch(input, { ...init, headers });
                            }
                        }
                    } catch (e) {
                        // If we can't parse the error, just return the response
                    }
                }
                
                return response;
            } catch (_) {
                return nativeFetch(input, init);
            }
        };
    }
})();
