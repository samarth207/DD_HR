const supertest = require('supertest');

function createHttpClient(app, logger) {
    const raw = supertest(app);

    async function send(method, path, payload, context = {}) {
        const started = Date.now();
        let req = raw[method](path);
        if (payload !== undefined) req = req.send(payload);
        const response = await req;

        if (logger) {
            await logger('debug', `HTTP ${method.toUpperCase()} ${path}`, {
                request: payload,
                responseStatus: response.status,
                responseBody: response.body,
                latencyMs: Date.now() - started,
                ...context
            });
        }

        return response;
    }

    return { send };
}

module.exports = { createHttpClient };
