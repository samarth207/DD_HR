const express = require('express');
const request = require('supertest');
const readPdf = require('../helpers/read-pdf');

jest.mock('../../db', () => ({ getDB: jest.fn(), isDBConnected: jest.fn(() => true) }));
jest.mock('../../utils/mailer', () => ({ sendMail: jest.fn(async () => true) }));

const { getDB, isDBConnected } = require('../../db');
const router = require('../../routes/salaryPayments');
const { createApp } = require('../../app');
const { calculate } = require('../../../salary-breakup-utils');

describe('Paid payslip download API', () => {
    let modern, legacy, employee, collections;
    const url = '/salary-payments/payslip?employeeId=11&month=10&year=2026';
    function appFor(role = 'employee', employeeId = 11) {
        const app = express();
        app.use((req, res, next) => { req.auth = { role, employeeId }; next(); });
        app.use('/salary-payments', router);
        return app;
    }
    beforeEach(() => {
        isDBConnected.mockReturnValue(true);
        employee = { id: 11, firstName: 'Test', lastName: 'Employee', salary: 90000 };
        modern = { employeeId: 11, month: 10, year: 2026, paidAt: '2026-10-24T12:00:00Z',
            breakup: { grossSalary: 50000, effectiveGross: 50000, totalDeductions: 0, totalEarnings: 50000, netSalary: 50000,
                salaryComponents: calculate(50000), payslipEmployee: { id: 11, name: 'Paid Name', position: 'Recorded Role' } } };
        legacy = null;
        collections = Object.fromEntries(['employees', 'salaryPayments', 'salary_payments'].map(name => [name, {
            findOne: jest.fn(async () => name === 'employees' ? employee : name === 'salaryPayments' ? modern : legacy)
        }]));
        getDB.mockReturnValue({ collection: name => {
            if (!collections[name]) throw new Error(`Unexpected live payroll query: ${name}`);
            return collections[name];
        } });
    });

    test('employee downloads only their saved paid PDF without querying live payroll', async () => {
        const before = JSON.stringify({ employee, modern });
        const response = await request(appFor()).get(url);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/pdf');
        expect(response.headers['content-disposition']).toContain('attachment; filename="Payslip_Paid_Name_October_2026.pdf"');
        expect(response.headers['cache-control']).toBe('private, no-store');
        const result = readPdf(response.body);
        expect(result.text).toContain('Paid Name');
        expect(result.text).toContain('Recorded Role');
        expect(result.text).toContain('25,000.00');
        expect(result.text).not.toContain('90,000.00');
        expect(JSON.stringify({ employee, modern })).toBe(before);
    });

    test('rejects other employees, unsupported roles, unauthenticated requests and invalid parameters', async () => {
        expect((await request(appFor('employee', 12)).get(url)).status).toBe(403);
        expect((await request(appFor('guest')).get(url)).status).toBe(403);
        expect((await request(createApp()).get('/api/v1/salary-payments/payslip?employeeId=11&month=10&year=2026')).status).toBe(401);
        for (const query of ['employeeId=11&month=13&year=2026', 'employeeId=11&month=10&year=abc',
            'employeeId=11&month=10', 'employeeId=11&month=1.5&year=2026', 'employeeId=11&month=10&month=11&year=2026']) {
            expect((await request(appFor()).get(`/salary-payments/payslip?${query}`)).status).toBe(400);
        }
        expect((await request(appFor()).get(url.replace('employeeId=11', 'employeeId=11oops'))).status).toBe(403);
    });

    test('rejects unpaid periods, unknown employees, unavailable database and incomplete snapshots explicitly', async () => {
        modern = null;
        expect((await request(appFor()).get(url)).status).toBe(409);
        employee = null;
        expect((await request(appFor()).get(url)).status).toBe(404);
        isDBConnected.mockReturnValue(false);
        expect((await request(appFor()).get(url)).status).toBe(503);
    });

    test('handles legacy paid snapshots and legacy gross-only records without inventing a split', async () => {
        legacy = { key: '2026-10_11', paid: true, breakup: modern.breakup };
        modern = null;
        expect((await request(appFor()).get(url)).status).toBe(200);
        legacy = { key: '2026-10_11', paid: true, grossSalary: 20000, netSalary: 19000, deductions: 1000 };
        const response = await request(appFor()).get(url);
        expect(response.status).toBe(200);
        const result = readPdf(response.body);
        expect(result.text).toContain('Gross Salary');
        expect(result.text).toContain('19,000.00');
        expect(result.text).not.toContain('Basic Salary');
        expect(result.text).toContain('not recorded');
        delete legacy.deductions;
        const invalid = await request(appFor()).get(url);
        expect(invalid.status).toBe(409);
        expect(invalid.body.error).toContain('deductions');
    });

    test.each(['admin', 'hr'])('%s can download a paid payslip', async role => {
        expect((await request(appFor(role)).get(url)).status).toBe(200);
    });
});
