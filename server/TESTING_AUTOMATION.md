# HR Portal Automated Testing Framework

## Safety and Isolation

The automation suite is isolated from production by design:

- Runs against an in-memory MongoDB instance (`mongodb-memory-server`)
- Uses suffixed business collections (`*_Test`) through a DB wrapper
- Stores run telemetry in dedicated test collections:
  - `TestingRuns`
  - `TestingLogs`
  - `TestingExpected`
  - `TestingResults`
  - `TestingSummary`
- Never touches production Atlas collections when running `npm run test:e2e`

## Commands

```bash
npm run test:e2e
# alias
npm run test:automation
# persisted records visible on localhost dashboard/report
npm run test:e2e:report
# wizard to generate a new feature test file
npm run test:case:new
```

Note:

- `npm run test:e2e` uses Mongo memory and records disappear after run.
- `npm run test:e2e:report` persists `Testing*` records and `*_Test` business data into your configured DB so they appear in `http://localhost:3000/testing-dashboard.html` and `http://localhost:3000/testing-report.html`.

## Add a New Feature Test in 1 Command

Run:

```bash
npm run test:case:new
```

The wizard asks:

- Feature name
- Module name
- API method
- API endpoint
- Expected status code
- JSON payload

It generates a ready-to-run test file in:

- `tests/e2e/generated/*.test.js`

Then run:

```bash
npm run test:e2e
```

## What the Runner Does

For each test case:

1. Seeds realistic data via reusable factories
2. Executes real API workflows with Supertest
3. Validates API responses and DB state
4. Compares expected vs actual results
5. Persists logs/results/summary in testing collections
6. Rolls back seeded data with cleanup helpers

## Implemented E2E Scenarios

- Employee ID sequencing without recycle (100001, 100002, ...)
- Holiday leave rejection
- Paid leave rejection during probation
- Sandwich leave calculation
- Sales monthly tracking verification
- Late policy salary impact with strict Rs1 mismatch rule
- Employee cascade delete validation

## Key Files

- `tests/e2e/automation.e2e.test.js`
- `testing/framework/test-runner.js`
- `testing/framework/cleanup-manager.js`
- `testing/framework/http-client.js`
- `testing/factories/seed-factory.js`
- `testing/assertions/validation-engine.js`
- `testing/repositories/testing-repository.js`
- `routes/testing.js`
- `testing-dashboard.html`

## Dashboard

Open `testing-dashboard.html` in your app host and it will read from:

- `GET /api/testing/summary`
- `GET /api/testing/runs`
- `GET /api/testing/runs/:runId/results`
- `GET /api/testing/runs/:runId/logs`

For non-technical users, open:

- `testing-easy.html`

Easy Mode uses:

- `GET /api/testing/latest-easy-summary`

It explains results in plain language and highlights Sales/Target checks in a simple table.

Easy Mode also includes a browser form to generate new feature test files without terminal usage.
It uses:

- `POST /api/testing/generate-case`

For deep behavior inspection (data fed, API response, DB validation, business-rule checks), open:

- `testing-report.html`

This detailed report uses:

- `GET /api/testing/runs/:runId/full-report`
- `GET /api/testing/runs/:runId/expected`

It shows, case-by-case:

- Request payloads sent during execution
- API responses returned
- Expected vs actual results
- DB validation and tracked DB changes
- Execution timeline logs (including sales/target-related API calls when present)

## Notes

- App bootstrapping now supports test-only route toggles via `createApp({ includeAuthRoutes: false })`.
- Salary module includes a deterministic test endpoint:
  - `GET /api/salary-payments/preview?employeeId=<id>&month=<m>&year=<y>`

## Learn What To Edit For New Test Cases

See:

- `NEW_TEST_CASE_GUIDE.md`

This explains, file-by-file, what does what and what to edit when adding a new test case.
