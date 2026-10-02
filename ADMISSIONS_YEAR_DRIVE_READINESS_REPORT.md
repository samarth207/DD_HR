# Year-wise and Drive-wise Admissions: Final Readiness Review

**Review date:** 2026-10-01  
**Review scope:** Current workspace implementation and its configured Jest/Supertest suites. No production database was connected, no migration was run, and no live payment was made.

## 1. Executive Summary

The implementation follows the portal's static HTML/JavaScript plus Express/MongoDB architecture and now has passing unit, integration, and general E2E tests. During this review, concrete issues were fixed: analytics API authorization order and role restriction, forged employee audit attribution, inference of re-registration cadence from legacy admission type, formula injection and silent truncation risks in XLSX output, stale deployment documentation, and unused payment-attempt indexes.

**Readiness: NOT APPROVED for production deployment against the full stated requirements.** Passing tests do not close the release gates below. The application has no period-payment gateway verification/reconciliation, the course configuration is not operable through the admin UI, report exports do not match the dashboard fee totals, duplicate admission POST semantics are undefined, the live Atlas/index plan was not verified, and a database URI previously present in documentation requires rotation.

## 2. Final Architecture

- **Frontend:** Existing multi-page HTML/CSS/JavaScript. Admin admission creation is in `sales-tracking.html`/`sales-script.js`; employee creation is in `employee-portal.html`/`employee-portal-script.js`. The allocation dashboard is `admission-allocation-dashboard.html` plus its CSS/JS. Re-registration details share the admission modal UI modules.
- **Backend:** Express route modules served by the same Node process as static files. API routes retain both `/api` and `/api/v1` aliases. Authenticated API scope is enforced server-side; page guards are an additional UI boundary only.
- **Database:** MongoDB Atlas, official driver, schemaless documents, Stable API v1 strict/deprecation errors. There are no database foreign keys or ODM schemas; ObjectId relationships and employee ownership are checked in application code.
- **Admission allocation:** `admissionYear` and `admissionDrive` are top-level admission values. Server validates them at create and rejects update attempts. Existing records are not backfilled.
- **Course/re-registration:** Course API accepts validated `reRegistration` config. New admissions snapshot it as `courseReRegistrationSnapshot`. The snapshot is preferred for cadence/applicability; when absent, supported cadence/duration fall back to the saved Live Fee Calculation. Period amounts and paid status always come from saved `feeManagement.installments`.
- **Payments:** No payment gateway or period transaction ledger exists. The active transition is management-only manual `PATCH .../mark-paid`, which records the full calculated installment amount in the existing fee management document.
- **Reports/export:** `admission-reports` provides aggregates, an allocation dashboard response, and XLSX. Employee scope derives from token identity. Analytics APIs are now authenticated and admin-only, matching the existing page guard.

## 3. Files Created and Modified

### Feature and UI files

- Modified: `sales-tracking.html`, `sales-script.js`, `employee-portal.html`, `employee-portal-script.js`, `admissions-analytics.html`.
- Added: `admission-allocation-dashboard.html`, `admission-allocation-dashboard.css`, `admission-allocation-dashboard.js`, `admission-reregistration-ui.js`, `admission-reregistration.css`.

### Backend and database files

- Modified: `server/app.js`, `server/db.js`, `server/routes/admissions.js`, `server/routes/courses.js`, `server/routes/analytics.js`, `server/package.json`.
- Added: `server/routes/admission-reports.js`, `server/routes/admission-reregistrations.js`, `server/utils/admission-access.js`, `server/utils/admission-dashboard.js`, `server/utils/admission-indexes.js`, `server/utils/admission-reregistration.js`, `server/scripts/migrate-admission-year-drive-reregistration.js`.

### Tests and documentation

- Modified test/config files: `server/jest.qa.config.js`, `server/jest.e2e.config.js`, existing admission fee/business-rule, admission authorization, course and master-data authorization integration tests.
- Added: `server/tests/helpers/sanitize-html.js`, `server/tests/integration/admission-year-drive-reregistration.integration.test.js`, `server/tests/unit/admission-reregistration.unit.test.js`.
- Added/updated docs: `ADMISSIONS_YEAR_DRIVE_AUDIT.md`, `ADMISSIONS_YEAR_DRIVE_TEST_REPORT.md`, `DATABASE_SETUP.md`, this report.

## 4. Database Schema and Integrity

- New admission fields: integer `admissionYear`, enum-like string `admissionDrive` (`Drive 1` or `Drive 2`), and optional `courseReRegistrationSnapshot`.
- Course documents can store `reRegistration` with yearly/semester cadence, course duration, semester count, applicable period list, period fee and overrides.
- Existing `feeManagement` remains the source for applicable period amounts and paid state. No new active payment transaction collection is written.
- Historical admissions lacking allocation values remain unchanged. Allocation dashboard queries require `admissionYear`, so legacy records do not appear in Drive/year dashboards. Unfiltered aggregate/export output can represent them as unallocated/null.
- Added indexes include admission year/drive/status/course and employee/year/drive/status/date; schedule lookup/uniqueness indexes remain for legacy schedule reads. Unused payment-attempt idempotency/reference indexes are no longer created. No production index was dropped.
- MongoDB has no foreign keys here. Course/admission relationships are validated and copied/snapshotted by route logic; integrity depends on those checks.
- Index migration is non-destructive and index-only. There is no data backfill or destructive rollback script. Startup index creation is best-effort and can log a warning; it does not prove that every index exists.
- Admission insert and existing sales aggregate updates are separate writes, not one MongoDB transaction. This pre-existing consistency risk was not redesigned in this review.

## 5. APIs

- `POST /api[/v1]/admissions`: validates required year/drive; year defaults to server calendar year only when omitted. Employee ID/status/submission attribution are token-controlled for employee submissions.
- `PUT /api[/v1]/admissions/:id`: rejects edits to allocation fields.
- `GET /api[/v1]/admissions` and `GET /api[/v1]/admissions/:id`: employee ownership scoped.
- `GET` and read-only `POST /api[/v1]/admissions/:id/re-registration-periods...`: project the saved admission fee schedule; generation does not persist a second schedule.
- `PATCH /api[/v1]/admissions/:id/fee-installments/:installmentNumber/mark-paid`: admin/HR only; marks the full saved calculated amount and is duplicate-safe. Employees cannot invoke it.
- Former re-registration payment initiation and verification endpoints return 410; they do not accept or verify real payment events.
- `GET /api[/v1]/admission-reports/aggregates`, `/dashboard`, and `/export.xlsx`: authenticated; reports/export apply token-derived employee scope. Analytics endpoints are admin-only at both aliases.

## 6. Frontend Modules

- Both admission-entry forms default to the current calendar year, permit year editing, require explicit Drive 1/2 selection, and display saved allocation. Edit controls are read-only for allocation.
- Allocation dashboard supports year/drive/course/type/payment/admission status/search filters, pagination, combined/drive views, dynamic periods, NA values, and management mark-paid confirmation.
- Re-registration modal projects the same admission fee data and does not write a parallel payment ledger.
- Course configuration fields are **not present in the course management UI**. Configuration currently requires API/manual operational setup; existing courses are not automatically configured.
- No frontend component-test or admission browser E2E harness is configured. Layout and user workflows were not browser-verified as part of this review.

## 7. Business Rules: Verification Status

### Completed and verified

- Current-year default, editable year at creation, required Drive 1/2, valid representative past/current/future years, and invalid/missing allocation rejection.
- Year and drive are immutable after creation, including separate-field direct API attempts.
- Historical fixtures without allocation remain unchanged.
- Course snapshots drive cadence/applicability when present. Without a snapshot, supported legacy cadence/duration fall back to saved Live Fee Calculation data; period fees/status are projected from those saved installments. Semester/year period counts are checked against duration and installment count.
- One-time admissions remain period-free. If the saved cadence/duration/installment count is missing or inconsistent, the modal reports a configuration error rather than inventing fees.
- Repeated period projection creates no duplicate schedule or transaction records. NA is excluded from applicable/paid/pending totals. Partial fees are not projected as Paid; only a fully paid fee installment is Paid.
- Duplicate manual mark-paid calls are idempotent; employee attempts and NA periods are rejected.
- Course edits do not replace a saved admission snapshot in covered integration cases.

### Implemented but not fully verified

- Browser form defaults, selectable drives, display/edit behavior, dashboard filters, empty/error/loading states, responsive/mobile layout, modal behavior and download UX were inspected in code, but not exercised in a browser suite.
- Aggregates are asserted against representative isolated datasets, not production snapshots or all report filter combinations.
- Admin/employee admission create, edit/review, fee behavior, course API and existing general HR E2E regressions pass configured suites; not every live workflow was covered.

### Not implemented or unresolved

- Real payment initiation, provider confirmation, cancellation/failure notifications, payment retries, transaction-reference uniqueness, reconciliation, refunds, receipts and gateway amount matching.
- Course configuration management UI. Legacy admissions can project saved Live Fee installments, but without a snapshot their course-specific applicability exceptions and fee overrides cannot be reconstructed.
- A defined idempotency/duplicate policy for replayed admission creation requests. Current valid POST replay can create another admission; same-student deduplication must not be guessed.
- Configured course `periodFee`/overrides are validated and snapshotted, but live period amounts come from `feeManagement.installments`. Confirm that source-of-truth choice; otherwise schedule totals may not match course-configured fees.
- XLSX export currently exports credited admission revenue/allocation fields, not the dashboard's applicable/paid/pending and period totals. It is not a dashboard-equivalent export.
- Product-specific permitted year bounds. Current server accepts 1900 through 9999; form and server enforce that broad range.

## 8. Security Findings

- Fixed analytics API mount to authenticate and enforce admin-only access, consistent with `requireAdmin()` and the HR-restricted page. Tests cover anonymous/admin/HR/employee results.
- Fixed employee-created `submittedBy` mass assignment: token role now determines the saved attribution even if the request body says admin.
- Employee admission reads, re-registration views/summaries/generation, reports and workbook export are tested for cross-owner denial/scoping. Employee IDs in query/body do not override token scope.
- Mark-paid ignores client-supplied status, payment amount, employee ID and allocation values; it derives fee value from the stored installment.
- XLSX string fields are protected against formula-like prefixes. Export over 10,000 rows returns 413 rather than silently truncating. It still materializes at most 10,001 records in memory to enforce the cap.
- Invalid identifiers and malformed filters are rejected in covered API cases. No production penetration test, secret manager audit, or Atlas network-policy review was performed.
- **Credential exposure:** a MongoDB URI was present in `DATABASE_SETUP.md` and is now redacted. A configured URI exists in ignored, untracked `server/.env`; its value was not printed. Rotate the exposed credential because Git history may retain it; verify Atlas user/network permissions and do not paste the value into tickets/logs.

## 9. Performance Review

- Dashboard requests are bounded in response page size, but the implementation scans every admission matching year/drive/employee filters to compute complete aggregates and performs related schedule/employee reads in batches. Runtime is proportional to matching admissions, not page size. No Atlas query plan or load test was run.
- New compound indexes help filters but do not prove the dashboard sort/aggregation is covered. Inspect `explain()` plans and index presence on a production-like Atlas copy.
- XLSX work is bounded by a 10,000-record cap and explicit 413 response; export is buffered, not streamed.
- No measured dashboard load time, export memory profile, or request-count/browser network audit is available.

## 10. Final Test Results

- QA/Jest: **20 suites passed, 139 tests passed, 0 failed**.
- E2E automation: **1 suite passed, 7 tests passed, 0 failed**. Its scenarios cover general employee/leave/sales/payroll behavior; it does not automate the admissions UI.
- Combined final runs: **21 suite executions, 146 tests passed, 0 failed**.
- Focused final admission integration run: **8/8 passed**. Focused attribution suite: **5/5 passed**. Focused cadence unit suite: **6/6 passed**.
- JavaScript syntax, editor diagnostics and `git diff --check` passed.
- Test DBs were isolated MongoMemoryServer instances. This does not validate Atlas Stable API behavior, actual production indexes, existing production records, or live payment behavior.

## 11. Known Limitations and Release Gates

1. Rotate the credential formerly exposed in documentation and check the repository's remote/history handling process.
2. Decide whether course-configured period fees or the existing admission Live Fee installments are the authoritative amount. Current behavior uses Live Fee installments.
3. Provide a management workflow to configure active courses and define how course-specific exceptions/overrides are applied to legacy admissions without snapshots.
4. Decide admission POST idempotency semantics and add a request key/duplicate retry policy if duplicate retries must be prevented.
5. Decide whether manual admin Mark Paid is acceptable evidence. If payment must be verified externally, integrate provider verification and transaction idempotency before enabling the workflow.
6. Align XLSX export with dashboard metrics if operators expect the workbook to reconcile to applicable/paid/pending and period totals.
7. Browser-test admin/employee creation and mobile/desktop dashboard workflows; verify download behavior and error states.
8. Test index migration, query plans, legacy records and app startup against a production-like Atlas deployment.
9. Confirm permitted year range and atomic/staged deployment policy.

## 12. Migration and Deployment Instructions

### Environment

- Configure `MONGODB_URI`, `DB_NAME`, `PORT` (defaults to 3000), and `ALLOWED_ORIGINS` in the deployment secret/environment store. The server `.env.example` has blank DB fields; it must not be used as a production credential source.
- Configure SMTP variables only if existing email notifications are required. Do not commit `.env` files or emit secret values in logs.
- Install the server lockfile dependencies with `npm ci`; use the deployment's approved Node.js LTS runtime. This review did not verify a specific production Node version or hosting provider.

### Pre-deployment

1. Rotate the URI credential exposed in the former setup document. Confirm the old credential is revoked and the replacement has least-privilege database access.
2. Take and verify an Atlas backup/PITR restore point; rehearse restore in a non-production environment.
3. Deploy to a staging copy with MongoDB Atlas Stable API v1 strict mode enabled. Verify startup and all required indexes; inspect query plans for dashboard filters.
4. Decide course period fee source, duplicate request behavior, year bounds, payment evidence and export parity. Configure courses and migration/remediation policy before re-registration is used operationally.
5. Verify static assets and API code are deployed atomically. New API validation requires a drive; an old cached client that omits it will fail. A new form paired with an old API may lose allocation fields. No feature-flag compatibility window is implemented.

### Deployment sequence

1. Back up production and record existing index names/state.
2. Deploy the matching backend and frontend release atomically (or use an explicitly tested compatibility window).
3. From `server`, run `npm run migrate:admission-year-drive` against the intended database. This ensures indexes only and does not assign fields or alter admissions.
4. Verify index names/state in Atlas, especially admission year/drive and schedule indexes. Treat any index-build warning/error as a release stop; startup logs alone are insufficient.
5. Run smoke tests using a dedicated synthetic admission/employee: create with each drive, verify stored allocation and dashboard filtering, verify employee cross-owner denial, verify admin report/export scope, and check workbook contents. Do not mark a real student's fee paid as a smoke test.
6. Monitor 4xx/5xx API rates, MongoDB query latency/index usage, and rejected old-client submissions. Do not log tokens, connection strings, or student contact data.

### Post-deployment smoke tests

- `/api/v1/health` responds and reports database connectivity.
- Admin can create a synthetic current-year Drive 1/Drive 2 admission; selected values persist and cannot be edited.
- Employee can retrieve only own admission/dashboard/report/export rows; anonymous and HR calls to analytics are denied.
- Re-registration projection matches saved course snapshot cadence/applicability and Live Fee installment amounts; partial installment is not displayed as Paid.
- Management mark-paid updates one synthetic applicable unpaid installment once; NA and employee requests are rejected.
- Workbook filters/scope are correct; >10,000 matching rows returns 413 rather than a partial file.

## 13. Rollback Plan

- This enhancement migration changes indexes only; it does not rewrite admission documents. There is no destructive migration rollback to run.
- If the application release must be rolled back, redeploy the prior application/static bundle while retaining new admission fields and database indexes. Old application code should ignore additive fields; verify that behavior on staging before production rollout.
- Do not delete new fields, drop indexes, or restore a full database snapshot simply to roll back code. That can destroy admissions created after deployment. Remove indexes only as a separately reviewed operation after confirming no deployed code depends on them.
- If data corruption is suspected, stop writes, preserve current state, compare against the backup and follow the approved recovery process. No production rollback was executed for this review.

## 14. Outstanding Risks

- Duplicate admission POSTs may create duplicate business records.
- Course configuration cannot currently be administered in the UI, and amount-source semantics need product confirmation.
- Manual mark-paid is not payment verification; no append-only receipt/transaction/audit event exists.
- Dashboard scan cost grows with matching admissions; production query plans/load were not evaluated.
- Export and dashboard fee totals differ by design at present.
- Existing active courses/legacy admissions may not have snapshots; fallback can only reflect saved Live Fee installments and cannot infer course-specific NA exceptions or overrides. No data remediation was run.
- A credential appeared in documentation and may remain in repository history; rotation is mandatory.
- Previous `npm run dev` context reports exit code 1; this review did not re-run a live server against the configured Atlas database, so production startup remains unverified.

## 15. Final Readiness Assessment

| State | Items |
|---|---|
| **Completed and verified** | API year/drive validation and immutability; employee scoping; snapshot-preferred cadence plus tested Live Fee fallback for legacy admissions; full saved-installment payment transition; admin-only analytics; employee audit attribution; representative summaries; XLSX row scoping/formula sanitation/size cap; configured test suites. |
| **Implemented but not fully verified** | Browser forms/dashboard/modal; responsive behavior; Atlas indexes/query plans; production startup; migration rollout; all historical-data compatibility; complete dashboard/export reconciliation. |
| **Not implemented** | Payment gateway initiation/verification/reconciliation; course configuration UI; dashboard-equivalent XLSX fee/period totals; defined admission-creation idempotency. |
| **Blocked by unresolved requirements** | Course fee source of truth, duplicate admission semantics, permitted year range, acceptable evidence for manual Mark Paid, course-specific legacy applicability/override policy, export parity and release compatibility window. |

**Decision: Do not declare production-ready yet.** The tested code paths are substantially covered, but several release requirements are absent or unresolved and the production database/environment was not verified. Close the release gates in Section 11 and complete staging/Atlas verification before approval.
