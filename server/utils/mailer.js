const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `${SMTP_USER}` : 'noreply@degreedrishti.com');
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'DegreeDrishti HR';

let transporter = null;

if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });
} else {
    console.warn('⚠️ Email mailer is not fully configured. Email notifications are disabled. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM in server/.env.');
}

async function sendMail({ to, subject, text, html }) {
    if (!transporter) {
        console.warn(`⚠️ Skipping email to ${to}: mailer not configured.`);
        return false;
    }

    try {
        const fromHeader = MAIL_FROM.includes('<') ? MAIL_FROM : `${MAIL_FROM_NAME} <${MAIL_FROM}>`;
        await transporter.sendMail({
            from: fromHeader,
            to,
            subject,
            text,
            html
        });
        return true;
    } catch (error) {
        console.error('❌ Failed to send email:', error?.message || error);
        return false;
    }
}

module.exports = { sendMail };