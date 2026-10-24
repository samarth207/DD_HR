const { execFileSync } = require('child_process');

// PDF.js imports its ESM worker dynamically, outside Jest's CommonJS VM.
module.exports = function readPdf(buffer) {
    const script = `
        const fs = require('fs');
        const { PDFParse } = require(${JSON.stringify(require.resolve('pdf-parse'))});
        (async () => {
            const parser = new PDFParse({ data: fs.readFileSync(0) });
            try {
                const result = await parser.getText();
                process.stdout.write(JSON.stringify({ text: result.text, total: result.total }));
            } finally { await parser.destroy(); }
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { input: buffer, encoding: 'utf8' }));
};
