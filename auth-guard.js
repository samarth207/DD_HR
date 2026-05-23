/**
 * auth-guard.js
 * Include this script BEFORE other scripts on every protected page.
 *
 * Admin pages:  requireAdmin()
 * Employee page: requireEmployee()
 */

(function() {
    function getAuth() {
        try { return JSON.parse(localStorage.getItem('hrPortalAuth') || 'null'); } catch { return null; }
    }

    function logout() {
        localStorage.removeItem('hrPortalAuth');
        window.location.replace('login.html');
    }

    // Expose on window for use in page scripts
    window.getAuthToken = function() { return (getAuth() || {}).token || ''; };
    window.getAuthRole  = function() { return (getAuth() || {}).role  || ''; };
    window.getAuthEmployeeId = function() { return (getAuth() || {}).employeeId || null; };
    window.getAuthName  = function() { return (getAuth() || {}).name  || ''; };
    window.logout = logout;

    // Require admin role — called by admin pages
    window.requireAdmin = function() {
        const auth = getAuth();
        if (!auth || !auth.token || auth.role !== 'admin') {
            window.location.replace('login.html');
        }
    };

    // Require employee role — called by employee portal
    window.requireEmployee = function() {
        const auth = getAuth();
        if (!auth || !auth.token || auth.role !== 'employee') {
            window.location.replace('login.html');
        }
    };
})();
