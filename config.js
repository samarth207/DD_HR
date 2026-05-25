// Shared API Configuration
// Uses same host+port the page was loaded from, so it works on any port.
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${window.location.protocol}//${window.location.host}/api`
    : '/api';
