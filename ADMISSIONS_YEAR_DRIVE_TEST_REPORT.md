# Admissions Year/Drive Enhancement QA Report

**Date:** 2026-10-01  
**Environment:** Jest/Supertest with isolated MongoMemoryServer databases; no production database or payment provider was contacted.

## Execution Summary

- QA suite: **20 suites passed, 139 tests passed, 0 failed**.
- E2E automation: **1 suite passed, 7 tests passed, 0 failed**.
- Combined: **21 suite executions, 146 tests passed, 0 failed**. The E2E suite is general portal automation; it does not automate the admissions dashboard UI.
- Focused admission allocation integration suite: **1 suite passed, 8 tests passed, 0 failed**; it is included in the QA totals above.
- Final JavaScript syntax checks, editor diagnostics, and `git diff --check` passed.

Category rows below count relevant Jest suites, not individual test cases. A suite may cover more than one category, so category totals overlap. Status is Partial when the automated suite passes but some requested behaviors remain untested or unsupported.

| Category | Total (suites) | Passed | Failed | Status |
|---|---:|---:|---:|---|
| Admission allocation | 1 | 1 | 0 | Partial: API cases pass; form interaction and duplicate-request policy not verified |
| Course configuration | 3 | 3 | 0 | Partial: API/domain validation pass; configuration UI workflows not browser-tested |
| Re-registration | 2 | 2 | 0 | Partial: Live Fee projection, repeat generation, applicability and owner checks pass |
| Payments | 5 | 5 | 0 | Partial: existing fee rules and admin mark-paid pass; no gateway lifecycle/reconciliation |
| Calculations | 4 | 4 | 0 | Partial: representative fee/period/dashboard totals pass; not every report combination tested |
| Authorization | 3 | 3 | 0 | Partial: tested roles and scoped API paths pass; not exhaustive security testing |
| Dashboards | 1 | 1 | 0 | Partial: dashboard API and filters pass; desktop/mobile browser behavior not tested |
| Excel export | 1 | 1 | 0 | Partial: scope, formula-like text escaping and size cap pass; dashboard fee-total parity is not implemented |
| Regression | 21 | 21 | 0 | Partial: configured QA and E2E suites pass; not every existing application workflow is represented |

## Verified Behavior

- Admission API defaults the year to the current year; tests save Drive 1 and Drive 2, previous years (2025 and 2024), and next year (2027 for the current test date).
- Missing/invalid drive and malformed year are rejected. Updates attempting to change year and drive, individually or together, are rejected. A historical fixture without allocation fields remains unchanged.
- Semester and yearly schedules derive period counts from course duration/configuration. Incomplete semester configuration is rejected; applicability and configured fees are projected; course configuration changes do not replace an existing admission's saved snapshot.
- Repeated period generation is read-only and does not create duplicate schedule records. Period status and fees derive from the same admission's saved `feeManagement.installments`; NA periods are excluded from fee totals.
- Partial installments do not project as Paid; fully paid installments do. Duplicate admin mark-paid requests are idempotent, NA installments are rejected, and employees cannot use the management-only mark-paid action.
- Mark-paid ignores client-supplied amount/status/owner/allocation fields and writes the calculated full installment amount. Invalid admission IDs and invalid installment numbers are rejected.
- Employee-submitted admissions cannot forge `submittedBy: admin`; the server records the authenticated employee role.
- When the course snapshot is missing, supported cadence/duration fall back to saved Live Fee Calculation data; the actual installment fees and paid status are projected from that saved record.
- Representative dashboard totals are asserted independently in the fixture, including applicable, paid and pending amounts, period totals, drive/year/course filters, and employee scope. The repeated mark-paid assertion verifies totals update once.
- Employee reads, re-registration views/summaries/generation, reports and exports are scoped or denied when another employee is requested. Management can use dashboard/report endpoints. Anonymous analytics and export requests are denied.
- Analytics APIs are authenticated and admin-only, matching the existing page guard; direct HR and employee calls are denied. The departments endpoint uses aggregation instead of `distinct`, compatible with MongoDB Atlas Stable API v1 strict mode.

## Failed Tests

No test failed in the final configured QA or E2E runs. The first attempted full-suite command used the workspace root, could not resolve the Jest config, and executed no tests; it was rerun from `server` and is not counted as a test failure.

## Gaps and Risks

- **Duplicate admission request idempotency is unresolved.** Admission creation has no request idempotency key or duplicate-request guard. Replaying a valid POST can create another record. A global same-student dedupe rule was not added because the product rule is unspecified and separate admissions may be legitimate. Define the idempotency contract before treating retries/double submission as verified.
- **Payment gateway scenarios are not supported by the current application.** There is no gateway initiation, transaction notification, cancellation/failure callback, transaction-reference dedupe, amount reconciliation or gateway retry path for these period fees. The old separate re-registration payment endpoints return 410. Admin Mark Paid is a manual assertion that the full fee was received; below/equal/above gateway amount cases cannot be exercised.
- **No admissions frontend component/browser test harness is configured.** Automatic-year editing, drive selection, duplicate-click UX, dynamic columns, filters, pagination, loading/empty/error states, Excel download UX, and desktop/mobile layout were not browser-tested in this pass.
- **Production data and migration safety were not tested.** Integration tests use isolated in-memory databases. No production migration ran, and no live historical records were compared before/after migration.
- **Report breadth is incomplete.** XLSX row scope and formula-like text escaping are tested; dashboard fee-total parity and every course/year/drive report permutation are not implemented or verified.
- Admission year validation currently accepts any four-digit year from 1900 through 9999; this pass verifies representative past/current/next years, not a narrower product-specific permitted-year policy.
- Course re-registration configuration is not exposed in the course admin UI. `periodFee` and overrides are stored, but live period amount/status comes from admission `feeManagement.installments`; resolve this source-of-truth mismatch before relying on configured course fees.
- XLSX export rejects results above 10,000 records with HTTP 413 instead of silently truncating. It exports credited admission revenue and allocation fields, not dashboard applicable/paid/pending or period totals.
- `server/.env` is ignored and untracked but contains a configured MongoDB URI. Its value was not printed. The URI previously present in setup documentation has been redacted; rotate it because repository history may retain the credential.

## Changes Made During QA

- Analytics API middleware authenticates then enforces the existing admin-only access contract.
- Admissions Analytics department options use a MongoDB aggregation compatible with Stable API strict mode.
- Admission integration coverage now includes a future year, separate year/drive immutability attempts, cross-owner re-registration access, malformed mark-paid identifiers, mass-assignment attempts, anonymous export denial, and analytics role checks.
- Employee `submittedBy` attribution is enforced server-side and covered against a forged admin value.
- Legacy admissions with a supported saved Live Fee Calculation now display those periods even without a course snapshot; course-specific applicability exceptions still require a snapshot.
- XLSX export string values are formula-safe; exports over 10,000 records are rejected rather than silently truncated. Unused payment-attempt indexes are no longer created; no existing database index was dropped.

**Assessment:** The executed automated suites pass, but duplicate-admission semantics, absent gateway/reconciliation, missing course configuration UI, dashboard/export parity, untested admissions UI, and lack of production-data verification mean this report does **not** certify the enhancement as production-ready across the full requested scope.
