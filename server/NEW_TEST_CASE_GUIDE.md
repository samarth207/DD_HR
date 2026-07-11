# New Test Case Guide (Beginner Friendly)

This guide explains exactly what each file does and what you should edit when adding a new test case.

## Quick Flow (No Coding Knowledge)

1. Open `http://localhost:3000/testing-easy.html`
2. Fill the **Create New Feature Test** form
3. Click **Generate Test File**
4. Run test command:
   - `npm run test:e2e` (normal)
   - `npm run test:e2e:report` (save records for dashboard/report)
5. Check results:
   - Easy view: `http://localhost:3000/testing-easy.html`
   - Full details: `http://localhost:3000/testing-report.html`

## What To Enter In The Form (Simple Explanation)

When you create a test from Easy Mode, these fields mean:

### Module Name (example: Leave)
- This is the business area label.
- Use values like `Leave`, `Attendance`, `Sales`, `Salary`, `Employee`.

### HTTP Method (example: POST)
- This is the API action type:
  - `POST` = create
  - `GET` = read
  - `PUT` / `PATCH` = update
  - `DELETE` = remove

### Expected Status Code (example: 200)
- This is the response code you expect if behavior is correct.
- Common values:
  - `200` success
  - `201` created
  - `400` validation/business-rule rejection
  - `401` unauthorized
  - `403` forbidden
  - `404` not found

### API Endpoint (example: /api/example)
- This is the actual backend route to test.
- Replace placeholder with real route like:
  - `/api/leaves`
  - `/api/attendance/settings`
  - `/api/sales`

### JSON Payload
- This is the input data sent to the API.
- Must be valid JSON.
- Example (Leave):

```json
{
  "employeeId": 100001,
  "leaveType": "Paid Leave",
  "startDate": "2026-07-20",
  "endDate": "2026-07-20",
  "status": "pending"
}
```

### Example For Leave Test
- Module Name: `Leave`
- HTTP Method: `POST`
- API Endpoint: `/api/leaves`
- Expected Status:
  - `201` or `200` for successful creation
  - `400` for rule rejection test cases
- JSON Payload: leave request object

## What Each File Does

### Core Test Case File
- `tests/e2e/automation.e2e.test.js`
- Purpose: Main end-to-end test scenarios.
- Edit when: You want to add or modify official workflow test coverage.

### Auto-Generated Feature Tests
- `tests/e2e/generated/*.test.js`
- Purpose: New feature tests created by wizard/form.
- Edit when: You need to add specific DB assertions for your feature.

### Data Seed Factory
- `testing/factories/seed-factory.js`
- Purpose: Generates realistic fake data (employee, leave, holiday, sales, salary input values).
- Edit when: Your new feature needs new sample data shape.

### Validation Helpers
- `testing/assertions/validation-engine.js`
- Purpose: Common assertions (status checks, payload checks, strict salary mismatch rules, etc.).
- Edit when: You want reusable new assertion logic.

### Runner and Logging
- `testing/framework/test-runner.js`
- Purpose: Run lifecycle, pass/fail tracking, expected vs actual logging, execution metrics.
- Edit when: You want extra run metadata or report fields.

### Cleanup / Rollback
- `testing/framework/cleanup-manager.js`
- Purpose: Deletes seeded test data after each case.
- Edit when: New feature creates extra collections/files that must be cleaned.

### HTTP Wrapper
- `testing/framework/http-client.js`
- Purpose: Captures request/response logs with timing for report pages.
- Edit when: You want extra request metadata in reports.

### Report APIs
- `routes/testing.js`
- Purpose: Serves dashboard/report/easy-mode data and test generation endpoint.
- Edit when: You want new report view/filter or extra summary fields.

### No-Code Generation Engine
- `testing/framework/test-case-generator.js`
- Purpose: Creates test file from form/CLI inputs.
- Edit when: You want generated files to include more default checks.

### CLI Generator
- `scripts/generate-test-case.js`
- Purpose: Terminal wizard to generate test case file.
- Edit when: You want more CLI prompts or behavior.

### Easy User Page
- `testing-easy.html`
- Purpose: Non-technical page for viewing results and generating new tests.
- Edit when: You want simpler instructions or additional UI controls.

## What You Must Verify for Any New Test Case

For each new case, verify all 5:

1. API Validation
- Response status and body are correct.

2. Database Validation
- Records created/updated/deleted exactly as expected.

3. Business Rule Validation
- Rule logic matches feature expectation (example: leave policy, sales policy, salary formula).

4. Expected vs Actual
- Clearly store both values in the test result.

5. Rollback/Cleanup
- Test data removed after run.

## Add a New Test Case (Technical Steps)

1. Generate file using one of these:
- Easy Mode page: `http://localhost:3000/testing-easy.html`
- CLI: `npm run test:case:new`

2. Open generated file in:
- `tests/e2e/generated/`

3. Replace TODO section with real checks:
- DB query assertions
- Business rule assertions
- expected vs actual comparison

4. Run tests:
- `npm run test:e2e`

5. Run persisted report mode:
- `npm run test:e2e:report`

6. Validate report output:
- `http://localhost:3000/testing-dashboard.html`
- `http://localhost:3000/testing-report.html`
- `http://localhost:3000/testing-easy.html`

## Troubleshooting

### No records on dashboard/report
- Use `npm run test:e2e:report` (not only `npm run test:e2e`)
- Ensure backend is running from server path:
  - `npm --prefix "c:\\Users\\samth\\Desktop\\DD\\HR\\server" start`

### Test file generated but failing
- Verify endpoint starts with `/api/`
- Verify payload is valid JSON
- Add needed seed data before API call

### Test passes but business logic is wrong
- Add stricter assertions in generated test:
  - DB value checks
  - formula comparisons
  - edge-case checks

## Recommended Naming Convention

- Feature name: short and clear, e.g. `WFH Restriction`
- Module: `Leave`, `Attendance`, `Sales`, `Salary`, `Employee`
- Test ID pattern is automatically generated by runner.

## Best Practice

Do not keep generated tests as-is.
Always replace TODO with real business validations before considering the test complete.
