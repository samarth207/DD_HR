module.exports = function sanitizeHtml(input) {
    return String(input ?? '');
};