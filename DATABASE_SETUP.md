# HR Portal - MongoDB Integration

## Database Setup

The HR Portal now uses **MongoDB Atlas** for data storage with a separate database: `HR_PORTAL_DB`

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
10. **logs** - Activity logs
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

You should see:
```
✅ Connected to MongoDB Atlas
✅ Using database: HR_PORTAL_DB
✅ Database indexes created
🚀 Server running on http://localhost:3000
📊 API endpoint: http://localhost:3000/api
```

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
- `GET /api/incentives/data` - Get all incentive data
- `POST /api/incentives/monthly` - Save monthly incentive
- `POST /api/incentives/daily` - Add daily bonus
- `POST /api/incentives/advance` - Add salary advance
- `POST /api/incentives/salary-payment` - Save salary payment

### Logs
- `GET /api/logs` - Get all logs
- `POST /api/logs` - Add new log
- `DELETE /api/logs` - Clear all logs

### Account
- `GET /api/account` - Get account details
- `PUT /api/account` - Update account

---

## Testing the Setup

1. Start the server: `npm start`
2. Open your browser to: http://localhost:3000/api/health
3. You should see: `{"status":"OK","message":"HR Portal API is running"}`
4. Open any HR Portal page (make sure to include `api.js`)
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

File: `server/.env`

```
MONGODB_URI=mongodb+srv://CRM_DB:NXDJ0hwfe0wZq7q5@crm.4dgei3o.mongodb.net/?appName=CRM
DB_NAME=HR_PORTAL_DB
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
