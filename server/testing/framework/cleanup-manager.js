class CleanupManager {
    constructor() {
        this.steps = [];
    }

    add(label, fn) {
        this.steps.push({ label, fn });
    }

    async run() {
        const results = [];
        for (let i = this.steps.length - 1; i >= 0; i -= 1) {
            const step = this.steps[i];
            try {
                await step.fn();
                results.push({ label: step.label, ok: true });
            } catch (error) {
                results.push({ label: step.label, ok: false, error: error.message });
            }
        }
        return {
            ok: results.every((r) => r.ok),
            details: results
        };
    }
}

module.exports = { CleanupManager };
