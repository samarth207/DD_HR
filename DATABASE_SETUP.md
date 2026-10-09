# DD HR portal - MongoDB Integration
node scripts/import-amogh-admissions-from-xlsx.js "../CRM sheet data ipload .xlsx" "Amogh"
## Database Setup

The DD HR portal now uses **MongoDB Atlas** for data storage with a separate database: `HR_PORTAL_DB`

### Collections Created:
1. **employees** - Employee records
2. **leaves** - Leave applications
3. **holidays** - Holiday calendar
4. **sales** - Sales tracking data
5. **monthly_incentives** - Monthly incentive payments
6. **daily_bonuses** - Daily sales bonuses
7. **salary_advances** - Salary advance records
8. **salary_payments** - Salary payment tracking
9. **incentive_config** - Incentive configuration
11. **account** - Account details

---

## Server Setup Instructions

### 1. Install Dependencies

Open PowerShell/Terminal and navigate to the server folder:

```powershell
cd "c:\Users\samth\Desktop\DD\HR\server"
npm install
```

This will install:
- express (Web server)
- mongodb (MongoDB driver)
- cors (Cross-origin requests)
- dotenv (Environment variables)
- body-parser (Request parsing)

### 2. Start the Server

```powershell
npm start
```

Or for development with auto-restart:

```powershell
npm run dev
```

The server will run on **http://localhost:3000**

### 3. Salary Period Metadata Migration (Non-destructive)

To annotate historical payroll records with centralized salary period fields
(`monthKey`, `cycleStart`, `cycleEnd`, `isFirstSalaryMonth`, `salaryPeriod`) without
deleting any existing payroll history, run:

```powershell
cd "c:\Users\samth\Desktop\DD\HR\server"
npm run migrate:salary-period
```

This script updates both `salaryPayments` and legacy `salary_payments` collections.

You should see:
```
✅ Connected to MongoDB Atlas
✅ Using database: HR_PORTAL_DB
✅ Database indexes created
🚀 Server running on http://localhost:3000
📊 API endpoint: http://localhost:3000/api
```

### Admission Year/Drive and Re-registration Indexes (Non-destructive)

Create the indexes required by admission allocation, reporting, re-registration schedules, and payment idempotency with:

```powershell
cd "c:\Users\samth\Desktop\DD\HR\server"
npm run migrate:admission-year-drive
```

This migration only ensures indexes. It does not update or assign values to existing admissions. Historical records without `admissionYear` or `admissionDrive` remain unchanged. The application also ensures these indexes during startup; run the migration explicitly during a controlled deployment to confirm index creation succeeds.

New admissions store `admissionYear` (defaults to the server's current calendar year) and `admissionDrive` (`Drive 1` or `Drive 2`). Both are immutable after creation. Admission creation accepts `admissionYear`/`admissionDrive` and the snake_case aliases `admission_year`/`admission_drive`.

Course documents may include a `reRegistration` configuration:

```json
{
	"type": "semester-wise",
	"semestersPerAcademicYear": 2,
	"periodFee": 5000,
	"applicablePeriods": [1, 2, 3],
	"periodFeeOverrides": [{ "periodNumber": 2, "fee": 5500 }]
}
```

`type` may be `yearly` or `semester-wise`. `duration` remains the existing course duration in years; period fees are explicit because the existing course `totalFees` represents the full course fee, not a defined re-registration charge. New admissions snapshot this configuration. Existing admissions without a saved configuration cannot generate periods; an explicit, separately approved remediation/snapshot step is required. No historical allocation or course configuration is inferred.

Authenticated API endpoints are available under both `/api` and `/api/v1`:

- `GET /admissions/:id` and `GET /admissions?admissionYear=YYYY&admissionDrive=Drive%201` - retrieve/filter admissions; employees are restricted to their own records.
- `GET /admissions/:id/re-registration-periods` and `GET /admissions/:id/re-registration-summary` - project periods and summaries from the admission's saved Live Fee Calculation.
- `POST /admissions/:id/re-registration-periods/generate` - read-only projection; it does not create a second schedule or payment ledger.
- `PATCH /admissions/:id/fee-installments/:installmentNumber/mark-paid` - management-only manual confirmation that the full existing installment fee was received.
- The former re-registration payment initiation and verification endpoints return `410 Gone`. There is no payment-gateway initiation, transaction verification, or reconciliation integration for these fees.
- `GET /admission-reports/aggregates?groupBy=year|drive|year-drive|course|employee`, `GET /admission-reports/dashboard`, and `GET /admission-reports/export.xlsx` - report/dashboard/workbook APIs. Employee scope is derived from the token; management roles may report across employees.

No production migration was run as part of this implementation. Existing admissions are not backfilled: missing allocation fields remain missing and are excluded from year/drive-specific dashboards. The migration only creates indexes; there is no destructive rollback operation. Before deployment, back up the database, run the migration in a production-like copy, verify each named index in Atlas, and investigate any duplicate-key/index-build errors. Startup index creation is best-effort and is not a substitute for migration verification.

---

## Frontend Integration

The frontend has been updated to use the API instead of localStorage.

### Include API file in HTML pages

Add this line to ALL HTML pages **before** other script files:

```html
<script src="api.js"></script>
```

For example in `employees.html`:
```html
<script src="api.js"></script>
<script src="script.js"></script>
<script src="employees-script.js"></script>
```

---

## API Endpoints

### Employees
- `GET /api/employees` - Get all employees
- `GET /api/employees/:id` - Get employee by ID
- `POST /api/employees` - Add new employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Leaves
- `GET /api/leaves` - Get all leaves
- `GET /api/leaves/employee/:id` - Get leaves by employee
- `POST /api/leaves` - Add new leave
- `PUT /api/leaves/:id` - Update leave
- `DELETE /api/leaves/:id` - Delete leave

### Sales
- `GET /api/sales` - Get all sales data
- `GET /api/sales/month/:month` - Get sales by month
- `POST /api/sales` - Save sales data

### Incentives
- `GET /api/incentives/config` - Get configuration
- `POST /api/incentives/config` - Save configuration
- `POST /api/incentives/config/preview` - Generate email preview for incentive configuration
- `POST /api/incentives/config/notify` - Send incentive configuration notification to sales employees
- `GET /api/incentives/data` - Get monthly incentives, daily bonuses, and salary payments
- `POST /api/incentives/monthly` - Save monthly incentive
- `POST /api/incentives/daily` - Add daily bonus
- `POST /api/incentives/salary-payment` - Save salary payment

### Account
- `GET /api/account` - Get account details
- `PUT /api/account` - Update account

---

## Testing the Setup

1. Start the server: `npm start`
2. Open your browser to: http://localhost:3000/api/health
3. You should see: `{"status":"OK","message":"DD HR portal API is running"}`
4. Open any DD HR portal page (make sure to include `api.js`)
5. Check browser console for connection status

---

## Troubleshooting

### Server won't start
- Check if MongoDB connection string is correct in `.env`
- Ensure you have internet connection (MongoDB Atlas is cloud-based)
- Check if port 3000 is available

### Frontend shows "Unable to connect to database server"
- Make sure the server is running (`npm start`)
- Check if API_BASE_URL in `api.js` matches your server URL
- Verify CORS is enabled in server

### Data not saving
- Check browser console for errors
- Verify server logs for error messages
- Ensure all required fields are provided

---

## Migration from localStorage

The system will automatically use the database when the server is running. Your existing localStorage data will remain in the browser but won't be used.

To migrate existing data:
1. Export data from localStorage (use browser DevTools)
2. Use the API endpoints to import the data

---

## Environment Variables

File: `server/.env` (keep out of source control)

```
MONGODB_URI=<MongoDB Atlas connection string>
DB_NAME=<database name>
PORT=3000
```

**Note:** Keep the `.env` file secure and never commit it to version control!

---

## Production Deployment

For production:
1. Update `API_BASE_URL` in `api.js` to your production server URL
2. Set up environment variables on your hosting platform
3. Use a process manager like PM2: `pm2 start server.js`
4. Enable HTTPS
5. Add authentication middleware

---

## Database Structure

All collections have appropriate indexes for performance:
- Unique indexes on `id` and `email` for employees
- Compound indexes for sales data (month + employeeId)
- Timestamp indexes for logs
- Status indexes for leaves and advances

---

## Support

For issues or questions, check:
1. Server console logs
2. Browser console (F12)
3. MongoDB Atlas dashboard for connection issues
4. API response messages
