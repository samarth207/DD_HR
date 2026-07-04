const { sendMail } = require('../utils/mailer');

async function main() {
    const recipient = process.argv[2] || process.env.TEST_EMAIL_TO;

    if (!recipient) {
        console.error('Usage: npm run test:email -- recipient@example.com');
        console.error('Or set TEST_EMAIL_TO in server/.env');
        process.exit(1);
    }

    const now = new Date();
    const subject = `DegreeDrishti SMTP Test - ${now.toISOString()}`;
    const text = [
        'This is a local SMTP test from DegreeDrishti HR backend.',
        `Timestamp: ${now.toISOString()}`,
        '',
        'If you received this message, SMTP configuration is working.'
    ].join('\n');
    const html = `
        <p>This is a local SMTP test from <strong>DegreeDrishti HR backend</strong>.</p>
        <p><strong>Timestamp:</strong> ${now.toISOString()}</p>
        <p>If you received this message, SMTP configuration is working.</p>
    `;

    const ok = await sendMail({
        to: recipient,
        subject,
        text,
        html
    });

    if (!ok) {
        console.error('Email send failed. Check SMTP values in server/.env.');
        process.exit(1);
    }

    console.log(`Test email sent successfully to ${recipient}`);
}

main().catch((error) => {
    console.error('Unexpected error while sending test email:', error?.message || error);
    process.exit(1);
});
