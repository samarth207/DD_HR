# DD_HR

## Salary Changes

- Change salary through Employees > Edit Employee, then select the effective month and optionally enter a reason.
- Changes apply from the first day of the selected month, including future months. Future entries are marked Scheduled, while profiles and payroll continue using the currently effective salary until that month. Multiple changes in the same month are not supported. Effective months must follow the previous change and cannot overlap any paid payroll period.
- A position entered alongside a salary change is saved in its history entry and shown in both history views. Position edits themselves take effect immediately; only the salary is future-dated.
- Salary changes retain the previous rate, effective date, department, designation, reason, recording time, and management identity in the employee's `salaryHistory`. Ordinary profile edits cannot replace this history.
- Employees can view these records under Salary Breakup > Salary Changes. Amounts are hidden until the visibility button is selected.
- Admin and HR can open Employees > employee row > Salary History (history icon) to view effective dates, previous/new salary, change percentages, department, designation, reason, and recording details.
- Payroll previews and salary-till-date use the applicable historical rate. Newly paid payroll stores a complete breakup snapshot so later changes do not recalculate paid salary.
- Existing employees require no migration: the first recorded change preserves their current salary as the initial rate. Rates overwritten before this feature cannot be reconstructed automatically; reconcile them from verified historical records. Existing payments without a breakup snapshot retain their stored gross salary but cannot recover missing historical calculation details.
- Restart the backend after deployment. Payroll regression checks: `npx --prefix server jest --runInBand --config server/jest.qa.config.js --runTestsByPath server/tests/integration/qa.integration.test.js --testNamePattern "Payroll|Salary"`.
