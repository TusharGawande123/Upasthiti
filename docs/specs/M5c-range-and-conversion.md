# M5c – Attendance date range, temporary-to-permanent conversion, no overtime for permanent employees: Specification

Status: Approved 2026-11-04 · Author: spec-writer · Date: 2026-11-04
Related: docs/SRS.md (FR-07, FR-10, FR-12, FR-28, FR-29, FR-35, NFR-03, NFR-04, NFR-06, NFR-07), docs/architecture.md,
docs/specs/M5-attendance-reports.md (§5.1, §5.5, §7 rules 5-14), docs/specs/M4b-phone-punch.md,
docs/specs/M1-foundation.md §7 rule 1 (roles), decisions 0005, 0016, 0017, 0023, 0034, 0035, 0036,
docs/decisions/accepted-extras.md, CLAUDE.md §1, §5, §6, §7, §10, §11.

> Simple English. No application code. The gate attendance device stays the main punch channel; phone punching stays
> the admin-controlled option of M4b. **Wording rule (decision 0013):** every text people read says "attendance
> device", never "kiosk"; code, API paths and database names keep "kiosk". Refusals end with "Please visit the plant office."
> **Where this spec sits:** it is a follow-up slice after M5 and M4b (built on a branch called
> `milestone/M5c-range-and-conversion`). It comes from the client visit of 2026-11-03. M7 (salary estimate) is CANCELLED
> and is not touched here.

The lead (Tushar) and the team **decided** the three changes below. They are written as requirements and are not asked
again. Questions and extras are answered in §12 and §14; only lines marked "Open" are still undecided.

## 1. Problem and goal
After the client visit of 2026-11-03 three things are needed:
1. **Date range.** Attendance can be seen today only for one day (`/attendance/daily`) or one month
   (`/attendance/register`, employee month view). The client wants any range: all employees as a grid, and one
   employee as a day-by-day list, on screen and as Excel / PDF.
2. **Temporary to permanent conversion.** A temporary worker can become a permanent employee. Today the type of an
   employee has no history, so changing it would silently change every past month. We need a safe, audited conversion
   with an effective date, and a type history so past days stay correct.
3. **No overtime for permanent employees.** The client does not need overtime for permanent employees. Temporary
   workers keep it.

"Done" means: ranges work with a bounded memory use; a conversion is one clear action with approval for the Corporate
Head; past months and reports do not change because of a conversion; no overtime field, number or column remains for
permanent employees.

## 2. Scope
- **In scope**
  1. Range register (all employees, max 93 days on screen, export up to 366 days for one plant, streamed).
  2. One-employee range list (up to 366 days, screen and export) with totals.
  3. Conversion temporary -> permanent (Super Admin direct, Corporate Head as change request), effective date,
     type history, contractor cleared, old card revoked, "Face enrolment pending", urgent notification, daily-job
     application of future dates, audit, stale days.
  4. Removal of overtime for permanent employees (rate field, computation, display, reports, import).
- **Out of scope / non-goals**
  - Moving the app to the team's own server (hosting is out of scope; the design only has to be light on memory so
    it works on Render 512 MB today and on a bigger server later).
  - Salary estimate (M7, cancelled), payroll, PF/ESIC/TDS, payslips, statutory reports (CLAUDE.md §1).
  - Permanent -> temporary reversal (proposed as "not built", see §14 Q9).
  - Conversion by Excel import (import stays create-only; it is not affected).
  - Bulk conversion (single only; reason in §7 rule 18, to confirm).
  - Any change to the gate screens other than the refusal texts that already exist.

## 3. Users and user stories
Roles: Super Admin (SA), Corporate Head (CH), Plant Head (PH). Employees never use the website; phone punching is M4b.

| ID | As a... | I want to... | So that... | SRS ref |
|---|---|---|---|---|
| US-1 | Plant Head | see attendance of my plant for any 1 to 93 days as an employee x day grid | I can follow a week or a custom period without opening months | FR-28, FR-35 |
| US-2 | Corporate Head | download the register of one plant for up to one year as Excel or PDF | accounts and the client's audits get the full period at once | FR-35 |
| US-3 | Plant Head | open one employee and see day-by-day in, out, hours, status, late, early (and overtime for temporary) for up to 366 days with totals | I can answer a question about one person quickly | FR-28, FR-29 |
| US-4 | Corporate Head | download that one-employee list as Excel or PDF | I can attach it to a file or a discussion | FR-35 |
| US-5 | Super Admin | convert a temporary worker to permanent from a chosen date | the worker's status in the company matches the record | FR-07 |
| US-6 | Corporate Head | ask for a conversion and have the Super Admin approve it | I can start the change without having the power to finish it (decision 0005) | FR-07 |
| US-7 | Super Admin | be told at once that a converted person needs face enrolment, and see a list of such people | the person can punch again quickly | FR-12 |
| US-8 | Super Admin | see old months and reports stay unchanged after a conversion | records stay honest (Labour Codes) | FR-35 |
| US-9 | Client / Plant Head | see no overtime figure for permanent employees anywhere | the screens match the client's rules | FR-29 |
| US-10 | Super Admin | still enter and see overtime for temporary workers | temporary workers keep their overtime | FR-29 |

## 4. Screens and UX (light, modern, premium; English first)
Design gate: every changed or new screen gets a mock-up image approved before frontend code (team rule). Mock-ups go to
`docs/design-refs/m5c/`. Dates are shown DD/MM/YYYY, times HH:mm in IST. Texts live in `common.json` (i18n keys).

### 4.1 Attendance register: "Date range" mode (`/admin/attendance/register`)
- The existing page gets a switch "Month | Date range". In range mode: two date boxes (From, To), plant (required),
  type, department, search, Excel and PDF buttons. Max 93 days on screen; a longer pick shows the message from
  `REPORT_RANGE_TOO_LONG` and offers "Download Excel (up to 1 year)".
- Grid: one row per employee, one column per day (date on top as `dd/mm`, weekday letter below), frozen first two
  columns (code, name), the same cell codes and colours as the month register, and a totals column. A month label
  row groups the day columns. The card scrolls sideways inside itself; the page does not (360 px rule).
- Days not yet computed: a thin bar "Getting the days ready 72%" while the server prepares (rule 9); the grid fills in.
- States: empty (no employees), loading skeleton, error with retry, "Some days are still being prepared".
- Accessibility: cells carry text codes, not only colour; the date headers are real column headers.

### 4.2 Employee page, Attendance tab: "Date range" list (`/admin/employees/:id?tab=attendance`)
- Beside the month heatmap: From/To boxes (max 366 days), a table of days and a totals card, Excel and PDF buttons.
- Columns: Date (with weekday), In, Out, Hours, Status, Late, Early exit, Overtime (shown only for a day on which the
  person was temporary), Type (shown only when the person's type changes inside the range, e.g. "Temporary"
  until 14/11/2026, "Permanent" from 15/11/2026), a small mark for "Corrected". A row opens the existing day drawer.
- Totals: days by status, total hours worked, number and total minutes of late days, early exits, and overtime
  (temporary days only). When the type changes inside the range the totals are also split by type.
- On a 360 px phone the table scrolls inside its card and the totals card stacks above it.

### 4.3 Reports page (`/admin/reports`)
- Two new cards: "Register for a period (up to 1 year)" (plant required) and "One employee for a period".
  The existing card rules apply (20 files in 10 minutes, one report at a time, audit row).
- While days are being prepared the button shows "Getting the days ready" and retries by itself every 5 seconds.

### 4.4 Employee page: convert (Super Admin and Corporate Head)
- Button "Convert to permanent" on a temporary, active employee (hidden for Plant Head, for permanent and left people).
- Dialog: what changes in plain words (type becomes Permanent, contractor and hourly rate stop, the ID card is
  cancelled, the person must enrol their face and cannot punch until then), "Effective from" date, "Reason",
  buttons Convert / Cancel. For a Corporate Head the button reads "Ask for conversion" and the result says
  "Sent to the Super Admin for approval".
- After conversion the employee page shows a banner "Face enrolment pending" with a button "Enrol face" (Super Admin),
  a "Converted on dd/mm/yyyy" badge and a "Type history" list (Temporary from ... to ..., Permanent from ...).
- If a conversion is scheduled for a future date: banner "Becomes permanent on dd/mm/yyyy" with "Cancel the
  scheduled conversion" (Super Admin; reuses the approvals-style withdraw: see rule 15).

### 4.5 Employees list and dashboard
- Employees list: new badge "Face enrolment pending" (existing filter "Not enrolled" finds them) and a small "Converted"
  tag. The M3 enrolment card on the dashboard counts them as it already counts every face employee without a template.
- Notification bell and Notifications page: new kind "Face enrolment pending" (urgent, red icon + word).
- Approvals inbox: new request type "Convert to permanent" with employee, effective date, reason.

### 4.6 Removed overtime
- Employee form: the "Overtime rate (Rs per hour)" box is shown only when Type = Temporary.
- Daily list, register totals, day drawer, explain-this-day sentences, reports: no overtime for permanent rows.
- Shift form: the "smallest overtime" field stays; its help text says "Used for temporary workers".

### 4.7 Phone menu and responsive check
No new menu entry: both range views are inside existing pages (register, employee page, reports), which are already in the
phone menu. Add the new states (range mode, employee range tab, the two report cards, convert dialog) to
`e2e/tests/responsive.spec.ts` at 360 px and 768 px.

## 5. API contract
Conventions: `/api/v1`, JSON, errors `{ "error": { "code", "message", "details" } }`, dates ISO `YYYY-MM-DD`,
timestamps ISO with offset (screens show IST). Every error that a screen can show has a code and a message stored as the
translation key `errors.<CODE>` (the `check-error-codes` script enforces it).

### 5.1 Range reads (new, additive; existing month/day endpoints do not change)
| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | /attendance/register-range | SA, CH (all plants), PH (own plant) | `date_from`, `date_to`, `plant_id` (required), `type`, `department_id`, `q`, `include_demo`, `page`, `page_size` (default 50, max 100) | `{ date_from, date_to, plant, days:[{date, weekday, day_kind}], items:[{employee, cells:[{date, code, is_corrected, has_exceptions}], totals}], page, page_size, total, preparing:{pending_days} }` | `REPORT_RANGE_TOO_LONG` (more than 93 days), `VALIDATION_FAILED` (end before start, details.field), `ATTENDANCE_DATE_INVALID` (start in the future), `NOT_FOUND` (plant not allowed) |
| GET | /attendance/employee/{employee_id}/range | same, plant-scoped | `date_from`, `date_to` | `{ employee, date_from, date_to, days:[Day with employee_type per day, plant_code, day_kind], totals, totals_by_type, type_changes:[{from_date, type}], preparing }` | `REPORT_RANGE_TOO_LONG` (more than 366 days), `VALIDATION_FAILED`, `ATTENDANCE_DATE_INVALID`, `NOT_FOUND` |

- `date_to` after today is cut to today. Days before the plant's attendance start date or before joining show
  `not_employed` (code "–"), as in the month register.
- `preparing.pending_days` > 0 means some days are still stale; the response holds what is ready and the client asks
  again (rule 9). Leave reasons are never sent (Super Admin only, decision 0036 line 7); the leave itself is.
- Overtime fields (`overtime_min`) are sent only on days of temporary type; for permanent days the field is absent.

### 5.2 Range downloads (extend `GET /reports/{kind}.{format}`)
| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | /reports/register-range.{xlsx,pdf} | SA, CH, PH (own plant) | `plant_id` (required), `date_from`, `date_to` (max 366 days), `type`, `department_id` | file (streamed) | `REPORT_RANGE_TOO_LONG`, `VALIDATION_FAILED`, `REPORT_TOO_LARGE` (PDF only, rule 8), `ATTENDANCE_PREPARING` (409), `TOO_MANY_REQUESTS`, `REPORT_BUSY`, `NOT_FOUND` |
| GET | /reports/employee-range.{xlsx,pdf} | same | `employee_id` (new parameter), `date_from`, `date_to` (max 366 days) | file | same, without `REPORT_TOO_LARGE` |

- File names have no person names: `upasthiti-register-range-<PLANT>-<yyyymmdd>-<yyyymmdd>.xlsx`;
  the one-employee file uses the employee code (as the audit row does), never the name.
- Every download writes the existing `report.download` audit row (kind, plant, period, row count).
- `ATTENDANCE_PREPARING` (409): "The attendance of this period is still being calculated. Please try again in a few
  minutes." with `details.pending_days`.

### 5.3 Conversion (new)
| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | /employees/{employee_id}/convert-to-permanent | SA: direct; CH: change request; PH: refused | `{ effective_from, reason }` (reason 3 to 300 characters) | SA: `200 EmployeeResponse`; CH: `202 { change_request_id, status:"pending", summary }` | `FORBIDDEN` (403, Plant Head), `NOT_FOUND`, `EMPLOYEE_LEFT` (409), `EMPLOYEE_ALREADY_PERMANENT` (409), `CHANGE_ALREADY_PENDING` (409), `CONVERSION_ALREADY_SCHEDULED` (409), `CONVERSION_DATE_INVALID` (422, details.field = effective_from) |
| DELETE | /employees/{employee_id}/convert-to-permanent | SA | `{ reason }` | `200 EmployeeResponse` | `CONVERSION_NOT_SCHEDULED` (409), `NOT_FOUND` |
| GET | /employees/{employee_id} (changed) | as today | - | adds `type_history:[{type, from_date, to_date, reason}]`, `converted_on`, `conversion_scheduled_for`, `face_enrolment_pending` | as today |
| GET | /employees (changed) | as today | adds `converted=true` filter | items add `converted_on`, `face_enrolment_pending` | as today |

- The role decides on the server (`CHANGE_EMPLOYEES` access: Super Admin all, Corporate Head via approval,
  Plant Head none). The browser sends no "needs approval" flag.
- Approvals: a new request kind `employee.convert`. The existing inbox, approve, reject (reason), withdraw and the
  "one pending change per employee" index work as they are. The re-check at approval runs the same rules
  again; a failure makes the request `failed` with the error code.
- Employee create/update/import (changed): `ot_rate_per_hour` on a permanent employee answers `422 NOT_FOR_PERMANENT`
  (`details.field = ot_rate_per_hour`), the same code as for hourly rate and contractor.

### 5.4 Notification (new kind)
`conversion_face_pending` (severity `urgent`), for the Super Admin only. Title "Face enrolment pending", text
"A worker became permanent on dd/mm/yyyy at K134. Their face is not enrolled yet. They cannot punch until it is."
(no name in the text, as every M5 notification; the link opens the employee page). Delivered when the conversion
takes effect (rule 14). Deduplicated by employee + effective date.

## 6. Data model changes
Migrations continue after `0030_grace_after_shift_end`. Every new table: in the same migration run
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY deny_all ... USING (false) WITH CHECK (false)`
(decision 0007; tests fail when missing). UTC timestamps; `numeric(12,2)` for money.

**0031_employee_type_history** (new table, append-style like `employee_plant_history`)
- `employee_type_history`: `id`, `employee_id` FK, `type` (`permanent`/`temporary`, check), `from_date` date,
  `to_date` date null (open row = current), `contractor_id` FK null, `hourly_rate` numeric(12,2) null,
  `ot_rate_per_hour` numeric(12,2) null (the values that applied in that period, so past contractor and rate are kept),
  `reason` text null, `change_request_id` FK null, `created_by` FK users null, `created_at` timestamptz.
- Indexes: `(employee_id, from_date)`; unique partial index "one open row per employee" (`to_date IS NULL`).
- Backfill: one open row per employee: `type`, `from_date = joined_on`, the employee's current contractor and rates.
  A reactivated employee keeps their history; no row is deleted or rewritten except closing `to_date`.
- `employees.type` stays as "the type today" (like `plant_id` after a transfer); the daily job flips it on the
  effective date.
- Consumers of "the type on a date" must use the history: `AttendanceCalendar` (replaces `EmployeeFacts.employee_type`
  by a type per day, like `plant_on`), contractor-hours report and dashboard contractor split (the contractor of the day
  from the history row), `regularisations/service.py` (lines that check `employee.type`), reports `data.py`
  (type label and the late/early/overtime report), `detail_service` (employee month), `gate_lines.py` (today's type
  is fine: it is about now). List filters by type (employees, cards) keep using today's type.

**0032_conversion_kinds_and_no_permanent_ot** (changed constraints and data)
- `change_requests.kind_known`: add `employee.convert`.
- `notifications.kind_known`: add `conversion_face_pending`.
- `qr_credentials` revoke kind check: add `converted` (new `RevokeKind.CONVERTED`).
- Clean-up: set `ot_rate_per_hour = NULL` for every permanent employee; write one audit row `employee.ot_rate_cleared`
  with the list of employee ids and old values (so nothing is lost); add check `permanent_has_no_ot_rate`
  (`type <> 'permanent' OR ot_rate_per_hour IS NULL`).
- No new column on `attendance_days`. `ATTENDANCE_CALC_VERSION` goes from 1 to 2 (permanent overtime rule and type per
  day): the 5-minute catch-up job then recomputes stored days, newest first (see rule 9 and §14 Q1).
- Audit actions added: `employee.convert`, `employee.convert_scheduled`, `employee.convert_cancelled`,
  `employee.ot_rate_cleared`, `qr_card.revoke` (existing action, kind `converted`).

## 7. Business rules
### 7.1 Date range
1. A range is `date_from..date_to`, both days included, IST dates. `date_to` after today is cut to today. A start date
   in the future is `ATTENDANCE_DATE_INVALID`.
2. Limits: register on screen 93 days; register export 366 days and one plant; one-employee list and export 366 days.
   The check is one shared helper (`check_date_range`) so the message and code are the same everywhere
   (`REPORT_RANGE_TOO_LONG`, `details.max_days`).
3. Reads come from stored `attendance_days`; nothing is computed in the browser. The plant of each cell is the plant of
   that date (history), so an employee who moved plants shows in the register of each plant for the right dates only.
4. The register lists employees employed at any time in the range (joined on or before `date_to`, not left before
   `date_from`), ordered by employee code, paged. Test (DEMO) plants are left out as everywhere (decision 0034 line 7).
5. Cell codes, totals and the leave/holiday words are those of the M5 month register. Totals per person cover the range.
6. One-employee totals: counts per status, total worked minutes, late days and minutes, early exits, overtime minutes
   of temporary days only, and the same split by type when the type changed in the range.
7. Excel register: first sheet "Summary" (one row per employee: totals for the whole range, from one aggregate query),
   then one sheet per calendar month with the employee x day grid (a month fits a sheet; a 366-column sheet is
   unreadable). PDF register: A4 landscape, one block of pages per month, same grid.
8. **Memory:** rows are fetched in batches (at most 100 employees at a time), written to the file writer at once and
   released. Excel is written with XlsxWriter in its low-memory mode into a temporary file on disk (not
   an in-memory buffer), and the file is sent from disk in chunks; the temporary file is removed afterwards. The PDF builder
   keeps pages in memory, so a PDF of more than a set size answers `REPORT_TOO_LARGE`
   ("This file is too big for PDF. Please choose Excel or fewer months."; proposed limit: employees x months above
   3,000; to be fixed by the S-42 style memory check, §14 Q6). The design needs no more memory on a bigger server.
   One report at a time per user and 20 files per 10 minutes stay (existing).
9. **Freshness without recomputing everything at once.** Every read calls `ensure_fresh` per batch (500 employees in
   the existing code). For a long range the first look at old dates may need thousands of missing or stale days.
   Therefore each request recomputes at most a fixed budget of employee-days (proposed 3,000, or about 8 seconds),
   newest days first; whatever remains is reported as `preparing.pending_days` and finished by a background task and by the
   5-minute catch-up job. A screen read answers with what is ready plus `preparing` and the page asks again. A file
   download never writes a half-ready file: it answers `ATTENDANCE_PREPARING` (409) until
   no stale day is left in the range, then builds. A read is never wrong, only sometimes "not ready yet".
10. Corrections, leave, holiday and shift-rule changes already mark days stale (M5 rule 14); nothing new is needed.
11. Dates are displayed DD/MM/YYYY and times in IST on screen and in files; file headers say "IST".

### 7.2 Conversion temporary -> permanent
12. Who: the Super Admin converts at once. A Corporate Head's conversion is stored as a change request (kind
    `employee.convert`) and takes effect only when a Super Admin approves; the server decides from the role. A Plant Head
    cannot (403). The Super Admin can reject with a reason; the Corporate Head sees the result in the inbox.
13. Allowed only for an active, temporary employee. Left -> `EMPLOYEE_LEFT`. Already permanent ->
    `EMPLOYEE_ALREADY_PERMANENT`. Another pending request for the person -> `CHANGE_ALREADY_PENDING`.
    A scheduled (future) conversion already exists -> `CONVERSION_ALREADY_SCHEDULED`.
    A pending request on the person also blocks a direct conversion by the Super Admin until it is decided (same
    index as every change).
14. **Effective date.** The admin picks "effective from". Allowed: not before the joining date and not before the
    first day of the previous month (proposed; §14 Q3), and up to 60 days ahead (as transfers, `MAX_DAYS_AHEAD`);
    otherwise `CONVERSION_DATE_INVALID`. On the effective date (immediately when it is today or past, otherwise
    by the daily job, like future plant transfers) all of this happens in one transaction:
    - `employees.type` becomes `permanent`; the open type-history row (temporary) is closed the day before; a new row
      (permanent) opens on the effective date. The old row keeps contractor, hourly rate and overtime rate.
    - `contractor_id`, `hourly_rate` and `ot_rate_per_hour` on the employee are cleared (history keeps them).
    - `punch_method` becomes `face`.
    - The working QR card is revoked with kind `converted` (record kept, never deleted).
    - Every stored day from the effective date to today is marked stale (and from the first day of the same month
      when the date is in the past, to be safe); days before the effective date are computed as temporary.
    - The audit entry `employee.convert` (before and after, reason, change request id, plant).
    - The notification `conversion_face_pending` (urgent) goes to the Super Admin.
    Same employee id and `employee_code`; name, plant, category, department, shift, joining date, phone-punch switches
    and consent records do not change.
15. A future-dated conversion is stored at once as a scheduled type-history row (audit `employee.convert_scheduled`);
    the Super Admin can cancel it before its date (`DELETE`, audit `employee.convert_cancelled`, row marked cancelled by
    closing it on its own start date, as the plant history does). Until the date the person is temporary and the card works.
    A Corporate Head's approved future request creates the same scheduled row.
16. **Until the face is enrolled the person cannot punch in any way.** The card is revoked (gate: card refused, `QR_REVOKED`
    "Card blocked"; if a card were still readable `EMPLOYEE_NOT_QR`); face punch has no template so the face is not
    recognised and the code fallback cannot match (`FACE_NOT_RECOGNISED`, `CODE_NOT_MATCHED`; all end "Please visit the plant
    office."); phone: gate-code path `EMPLOYEE_NOT_QR`, phone face path `PHONE_FACE_NOT_READY`.
    **Consequence:** attendance is missed for the days between the conversion date and the enrolment; these days become
    Absent or Incomplete unless the Super Admin adds a correction. **Mitigation:** the urgent notification, the
    "Face enrolment pending" banner and filter, the existing enrolment dashboard card, and a recommendation that the
    admin converts only when the person is at the office and enrols on the same day (or sets the effective date to the day of enrolment).
17. **Face enrolment after conversion** uses the existing flow unchanged: only the Super Admin, only after the person's
    consent is recorded on screen, five poses, no pictures stored (decisions 0016, 0017, 0023). The temporary worker has no face consent
    before. If the person refuses consent, face data are not taken; the Super Admin then edits the punch method of the permanent
    employee to QR and issues a new card (an existing edit). **No one may be forced to give consent as a condition of a record
    change; the alternative must exist** (§8).
18. **Single only, no bulk conversion** (proposed reason: each conversion needs a face enrolment right after, a bulk
    of many would leave many people unable to punch at once and the Super Admin cannot enrol them all the same day; it
    also limits mistakes. §14 Q4). Excel import does not convert: it stays create-only and its type column is only for new people.
19. **Type history and past data.** Reports, register, range views, the day drawer and stored `attendance_days` use the type
    of each date. `attendance_days.employee_type` of a past day stays "temporary"; temporary days keep hours and
    overtime and are not given Half-day/Short-hours; permanent days from the effective date follow permanent rules. The
    contractor-hours report of a past month keeps the worker under the old contractor.
20. **Phone-punch settings.** The switches (phone punching, outside work) and the phone sign-in are not changed by the
    conversion. The phone path follows the new method: a phone face punch is refused with `PHONE_FACE_NOT_READY` until the
    face is enrolled. (§14 Q8 asks whether sign-ins should end.)
21. **Hourly rate stops applying** from the effective date; it stays in the type history. Nothing in M5 uses it for money.
22. Reverse conversion (permanent -> temporary) is not built (§14 Q9). A mistake before the effective date is cancelled (rule 15);
    after it, the Super Admin uses a normal correction and, if truly needed, a new decision.
23. Shift, plant, category and department are unchanged. Transfers after conversion work as before.

### 7.3 No overtime for permanent employees
24. The overtime rate field exists only for temporary workers: form, API, import, approvals, audit snapshot. A permanent
    employee with `ot_rate_per_hour` is `NOT_FOR_PERMANENT`.
25. `compute_day` gives `overtime_min = 0` for a permanent employee on every day type (working, weekly off, holiday).
    Worked minutes, status, late, early exit and half-day rules for permanent employees do not change. `payable_min`
    of a permanent day ends at the shift end (no overtime extension). Temporary workers: unchanged (overtime from the shift end,
    only from the shift's smallest overtime, default 2 hours).
26. Screens, API and exports omit overtime for permanent employees: daily list, register totals, one-employee totals, day
    drawer and day sentences (`overtimeReached` / `overtimeNotReached` are not said for permanent), reports
    (late-early-overtime shows overtime only for temporary rows; contractor-hours is temporary only already), the
    dashboard (none shown today) and the gate lines.
27. **Stored overtime of permanent days (OPEN, §14 Q1).** Recommendation: raise the calculation version so the stored
    days are recomputed with overtime 0 for permanent employees. This loses no real record: `attendance_days` is a derived copy
    and the punches, corrections and audit stay; the system is young and M7 (the only user of overtime money) is cancelled.
    Alternative: keep old minutes of past days stored and untouched and only stop for days from a cut-off date (a date
    branch inside `compute_day`, old numbers never change but the code is harder to read and the screens would need
    to hide them anyway).
28. The `ot_rate_per_hour` clean-up of permanent employees is done by migration 0032 with one audit row (§6).
    A pending change request created earlier with an overtime rate on a permanent employee is made harmless:
    the value is dropped when the payload is read, so the request does not fail only for that reason.

## 8. Security, privacy and compliance
- **Roles matrix**

| Action | Super Admin | Corporate Head | Plant Head |
|---|---|---|---|
| Range register / employee range (screen) | all plants | all plants | own plant |
| Range downloads | all plants | all plants | own plant |
| Convert to permanent | direct | request (needs approval) | refused (403) |
| Approve / reject a conversion, cancel a scheduled one | yes | no | no |
| Enrol face after conversion | yes (only role) | no | no |
| See leave reasons in range views | yes | no | no |

- Every endpoint checks the role and plant scope on the server. The Plant Head cannot pass another plant's id (404).
- **Audit:** `employee.convert`, `employee.convert_scheduled`, `employee.convert_cancelled`, `employee.ot_rate_cleared`,
  `qr_card.revoke` (kind `converted`), `change_request.*`, `report.download` (range reports). Audit and type history are
  append-only; nothing is hard-deleted (CLAUDE.md §5). Attendance rows are only recomputed, never deleted.
- **Face consent / DPDP:** conversion collects no biometric data. Face data are taken only by the existing enrolment, after
  the recorded consent, by the Super Admin, never through any outside service, and stored as an encrypted template
  (AES-256-GCM). Consent must be free: a person who does not agree keeps a way to punch (QR card, rule 17). The consent screen and
  privacy notice already name the purpose. The compliance-auditor should look at the "no punching until enrolment" gap and the
  alternative (§14 Q5, to also be added to docs/compliance/ open points if the client wants a written answer).
- Range reports show names and codes; files are downloaded by authenticated users only, never stored on the server after sending
  (temporary file deleted), rate limited and audited. Leave reasons never appear.
- Overtime removal reduces personal-data processing (no figure kept visible for permanent employees).
- Labour Codes: history of type, contractor and rates is kept; past registers can be regenerated as they were.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | Message (English; key `errors.<CODE>`) |
|---|---|---|---|
| Range longer than the limit | Refused, nothing computed | `REPORT_RANGE_TOO_LONG` | "Choose at most N days." |
| End before start | Refused | `VALIDATION_FAILED` | "The end is before the start." |
| Start in the future | Refused | `ATTENDANCE_DATE_INVALID` | "This day has not begun yet." |
| Plant of another Plant Head | Hidden | `NOT_FOUND` | "Not found." |
| Days still being prepared (screen) | Partial grid + progress, page asks again | (none, `preparing` field) | "Getting the days ready" |
| Days still being prepared (download) | No file | `ATTENDANCE_PREPARING` | "The attendance of this period is still being calculated. Please try again in a few minutes." |
| PDF too big | Refused | `REPORT_TOO_LARGE` | "This file is too big for PDF. Please choose Excel or fewer months." |
| Another report running / too many files | Refused | `REPORT_BUSY` / `TOO_MANY_REQUESTS` | existing texts |
| Employee has no days in range (joined later, left earlier) | Empty list with a note, totals 0 | none | "No attendance days in this period." |
| Employee moved plants inside the range | Each day shows its plant code; the Plant Head sees only days of their plant in the register | none | - |
| Type changes inside the range | Type column and split totals shown | none | - |
| Convert: employee left | Refused | `EMPLOYEE_LEFT` | "This employee has left; reactivate them first." |
| Convert: already permanent | Refused | `EMPLOYEE_ALREADY_PERMANENT` | "This employee is already permanent." |
| Convert: pending request for the person | Refused | `CHANGE_ALREADY_PENDING` | "A change for this employee is waiting for approval." |
| Convert: a conversion is already scheduled | Refused | `CONVERSION_ALREADY_SCHEDULED` | "A conversion is already planned for this employee." |
| Convert: bad date | Refused | `CONVERSION_DATE_INVALID` | "Choose a valid date for the conversion." |
| Convert as Plant Head | Refused | `FORBIDDEN` | existing text |
| Cancel scheduled: none exists | Refused | `CONVERSION_NOT_SCHEDULED` | "No conversion is planned for this employee." |
| Corporate Head's request approved after the person left | Request `failed`, nothing applied | `EMPLOYEE_LEFT` | shown in the inbox |
| Corporate Head's request approved when the date has passed | Re-check fails the date rule only if it is now older than allowed; otherwise applied with the saved date | `CONVERSION_DATE_INVALID` | - |
| Daily job finds the employee left before the date | Scheduled row closed, nothing applied, audit line | none | - |
| Converted person scans the old card at the gate | Refused, the card is blocked | `QR_REVOKED` | "Card blocked. Please visit the plant office." |
| Converted person tries face before enrolment | Not recognised, code fallback fails | `FACE_NOT_RECOGNISED`, `CODE_NOT_MATCHED` | "...Please visit the plant office." |
| Phone punch before enrolment | Refused | `PHONE_FACE_NOT_READY` | "Your face is not set up for attendance. Please visit the plant office." |
| Person refuses face consent | Super Admin changes punch method to QR and issues a card | none | - |
| Permanent employee created/edited with an overtime rate | Refused | `NOT_FOR_PERMANENT` | "Permanent employees have no overtime rate." |
| Old import file with a rate on a permanent row | That row is an error; nothing saved | `NOT_FOR_PERMANENT` | same, shown per row/column |
| Old pending request with overtime rate on a permanent employee | The value is dropped when read | none | - |
| Conversion with a past date and many stale days | Days marked stale; reads follow rule 9 | none | - |

## 10. Acceptance criteria (Given / When / Then)
**Range**
- **AC-1** Given a plant with 20 employees, when a Plant Head of that plant asks the register for 01/11/2026 to 30/12/2026
  (60 days), then every employee has 60 cells and totals for the range, and the days are shown as DD/MM/YYYY.
- **AC-2** Given a range of 94 days, when the register is asked, then the answer is 422 `REPORT_RANGE_TOO_LONG` with
  `details.max_days = 93`.
- **AC-3** Given a Plant Head of plant A, when they ask the register or a download for plant B, then the answer is 404.
- **AC-4** Given a Corporate Head, when they download the register of one plant for 366 days as Excel, then the file has a
  Summary sheet and one grid sheet per month, and a request for 367 days gives `REPORT_RANGE_TOO_LONG`.
- **AC-5** Given the range export of one year for 300 employees, when it is built on the 512 MB container, then the peak memory
  stays under the agreed limit (check in CI like S-42) and no more than one batch of rows is held at a time.
- **AC-6** Given 10,000 stale or missing days in a range, when the register is read, then the answer arrives within the
  time limit with `preparing.pending_days` > 0, a later read has fewer pending days, and a download in that state
  answers 409 `ATTENDANCE_PREPARING` and no partial file.
- **AC-7** Given a temporary worker, when their range list is read for 30 days, then each worked day shows in, out, hours,
  status and overtime, and the totals add up to the rows (a test compares the totals with the sum of the rows).
- **AC-8** Given a permanent employee, when their range list is read, then late and early exit show and there is no overtime
  value or column anywhere in the answer or in the Excel/PDF.
- **AC-9** Given an employee range of 366 days, then it works; given 367 days, `REPORT_RANGE_TOO_LONG`.
- **AC-10** Given a range that includes a leave with a reason, when a Corporate Head or Plant Head reads it, then the leave is
  shown and its reason is not.
- **AC-11** Given an employee who moved from plant A to plant B on day D, when the register of A is read over D-5..D+5, then
  the employee's cells are filled up to D-1 and show "–" from D; plant B shows them from D.
- **AC-12** Given any range download, then an audit row `report.download` exists with kind, plant, period and row count and the
  file name has no person name.

**Conversion**
- **AC-13** Given an active temporary worker, when the Super Admin converts with effective date today, then in one transaction the
  type is permanent, contractor, hourly rate and overtime rate are cleared, punch method is face, the card is revoked
  (kind `converted`, record kept), a type-history row exists for each period, the audit row exists, and the Super Admin gets an
  urgent notification; id and employee code are unchanged.
- **AC-14** Given the same worker, when a Corporate Head sends the conversion, then the answer is 202, nothing changes, an
  inbox item exists, and after the Super Admin approves it everything in AC-13 happens; if rejected nothing changes.
- **AC-15** Given a Plant Head, when they call the conversion, then 403 `FORBIDDEN` and nothing changes.
- **AC-16** Given a left employee, a permanent employee, an employee with a pending request, or one with a scheduled conversion,
  when conversion is tried, then the matching code (`EMPLOYEE_LEFT`, `EMPLOYEE_ALREADY_PERMANENT`, `CHANGE_ALREADY_PENDING`,
  `CONVERSION_ALREADY_SCHEDULED`) is returned and nothing changes.
- **AC-17** Given an effective date 10 days ahead, when the Super Admin converts, then the person stays temporary and their card
  works until that date; when the daily job runs on that date, everything in AC-13 happens once; running it twice changes
  nothing more.
- **AC-18** Given a scheduled conversion, when the Super Admin cancels it, then no change happens on the date and the audit has
  `employee.convert_cancelled`.
- **AC-19** Given a conversion effective 15/11/2026, when the month of 10/2026 and 01/11-14/11 are read, then those days are
  temporary (hours, overtime kept), and days from 15/11 follow permanent rules; the contractor-hours report of October still
  lists the worker under the old contractor.
- **AC-20** Given a conversion dated in the past, then the affected stored days are marked stale and recomputed by the type of
  each date, and the one-employee range shows the type change.
- **AC-21** Given a converted person without a face template, when they scan the old card, then the gate refuses (`QR_REVOKED`);
  when they punch by face, they are refused with the face texts ending "Please visit the plant office."; a phone face punch gives
  `PHONE_FACE_NOT_READY`; no punch is stored as accepted.
- **AC-22** Given a converted person, then the employee page shows "Face enrolment pending", the list filter finds them, and after
  the Super Admin enrols the face (consent first) a face punch works and the banner goes away.
- **AC-23** Given a conversion, then the phone-punch switches and sign-in are unchanged, plant, shift, category and department
  are unchanged.
- **AC-24** Given an Excel import with a type column, then it only creates new people; no conversion happens.
- **AC-25** Given a type history, then no row is ever deleted by app code, and a conversion always adds an audit entry with
  the reason.

**No overtime for permanent**
- **AC-26** Given the employee form, when Type is Permanent, then there is no overtime rate box; the API answers 422
  `NOT_FOR_PERMANENT` for a rate; Type Temporary shows and accepts it.
- **AC-27** Given a permanent employee who worked 3 hours after the shift end, when the day is computed, then `overtime_min` is
  0, status and late/early are as before, and the day sentence does not mention overtime.
- **AC-28** Given a temporary worker with the same punches, then overtime counts as before (from the shift end, from the smallest
  overtime).
- **AC-29** Given the daily list, register totals, day drawer, dashboards and the late-early-overtime report, then none shows an
  overtime figure for permanent employees; the report keeps temporary overtime.
- **AC-30** Given the migration, then every permanent employee has no overtime rate, one audit row lists the old values, and
  the database refuses a permanent employee with a rate.
- **AC-31** Given the calculation version raised, then stored days are recomputed (catch-up job) and permanent days
  have overtime 0 (outcome of Q1; changes if the lead chooses the other option).
- **AC-32** Given an Excel import row for a permanent employee with an overtime rate, then that row is reported as an error and
  nothing is saved.

**Cross-cutting**
- **AC-33** Given any new error code, then `errors.<CODE>` exists in `common.json` (the i18n check passes).
- **AC-34** Given the new screens, then none scrolls sideways at 360 px and 768 px and all are in `responsive.spec.ts`; the new
  texts say "attendance device", never "kiosk".
- **AC-35** Given the migrations, then a test finds every new table with Row-Level Security and the `deny_all` policy.

## 11. Test plan
- Unit (pytest): range limit helper; `compute_day` for permanent with after-shift time (overtime 0) and for temporary
  (unchanged); the golden table gets permanent rows with overtime expected 0 (S-39); calendar type-per-day with a
  conversion in the middle of a month; type-history rules; Hypothesis: "total of rows = totals" and "a conversion never changes
  days before its date".
- API (pytest + httpx): AC-1 to AC-4, AC-6 to AC-18, AC-21, AC-23, AC-24, AC-26, AC-29 to AC-32; role matrix for each
  endpoint; the daily job with a future conversion, run twice; failed approval after the person left.
- Report read-back (S-41 style): open the Excel/PDF with openpyxl / pypdfium2 and compare with the API; memory check of a
  one-year export in the 512 MB container (AC-5).
- Vitest: register range mode, employee range table, convert dialog (both roles), type-history list, overtime hidden for
  permanent, report cards and the "getting the days ready" retry.
- Playwright: convert as Super Admin, convert as Corporate Head then approve, enrolment pending banner, range register and
  download; `responsive.spec.ts` additions (AC-34).
- Manual: real-device check of a conversion followed by a face enrolment at the gate; print check of the PDF register.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** answered in chat on 2026-11-04. Rows marked "Approved" are built; "Not now (Later)" rows are not built in M5c.
IDs continue after F-81 and S-49.

| # | Suggestion | Why it helps | Milestone | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| F-82 | **Range presets**: This month, Last month, Last 7 days, Last 30 days, This quarter above the date boxes | Most users want a standard period, fewer clicks and typing | M5c | S | Low | Approved 2026-11-04 |
| F-83 | **CSV export** of the range register and the employee range (UTF-8 with BOM so Excel opens it) | Easy to load into other tools; very light on memory (pure streaming) | M5c | S | Low | Not now (Later) |
| F-84 | **"Ready to convert" list**: temporary workers with at least N continuous months at the same plant (N is a setting, default typed by the client); shown on the employees page and as a dashboard line | Helps the client keep to its own rules for long-serving temporary workers; no legal advice given | M5c | M | Low (only a list; the client decides the number) | Not now (Later) |
| F-85 | **Conversion due reminder**: a bell notice to the Super Admin when a temporary worker passes N months (same setting as F-84), one per person | The client does not forget long-serving workers | M5c | S | Low (noise if N is small; off by default) | Not now (Later) |
| F-86 | **Daily reminder while face enrolment is pending**: the 07:00 job re-sends one notice per day (digest line "N converted people still need a face") until enrolled | A single notice is easy to miss; the gap means lost attendance | M5c | S | Low | Not now (Later) |
| F-87 | **"Convert and enrol" guided flow**: after Convert, the dialog offers "Enrol face now" and goes straight to the consent screen | Shortens the gap in which the person cannot punch | M5c | S | Low (still consent first) | Approved 2026-11-04 |
| F-88 | **Conversion preview**: before confirming, show the days that will be recomputed and the card that will be revoked | Fewer mistakes with back-dated dates | M5c | S | Low | Approved 2026-11-04 |
| F-89 | **Print-friendly one-employee sheet**: A4 page with name, code, period, totals and the list; useful for disputes | Disputes get settled on paper | M5c | S | Low | Approved 2026-11-04 |
| F-90 | **Compare two periods** for one employee (this month vs last month: days present, late, hours) | Reviews and warnings with facts | M5c | M | Low | Not now (Later) |
| F-91 | **Conversion history report** (who was converted, when, by whom, approved by) as Excel | Evidence for the client and audits | M5c | S | Low | Approved 2026-11-04 |
| S-50 | **Server-side file streaming helper** (batch iterator + temp-file writer) reused by every report | Keeps memory flat, one place to fix; makes a later server move easy | M5c | M | Low | Approved 2026-11-04 |
| S-51 | **Database index check for range reads** (`attendance_days(plant_id, attendance_date)` exists; test with `EXPLAIN` on 650 x 366 rows) | A year of one plant stays fast | M5c | S | Low | Not now (Later) |
| S-52 | **Memory check of a one-year export** added to the existing 512 MB container check in CI | Proves the memory claim in AC-5 on every PR | M5c | S | Low | Not now (Later) |
| S-53 | **Calculation-version recompute progress** line on the settings page ("Recomputing: 12,000 days left") | The team can see the catch-up job finish after the version raise | M5c | S | Low | Not now (Later) |

## 13. Dependencies to add
None planned. XlsxWriter (low-memory mode), fpdf2, Pillow and the existing helpers cover the work. If the team wants CSV
(F-83) the Python standard library `csv` is enough. Nothing costs money.

## 14. Questions and answers
Answered by the lead's team in chat on 2026-11-04 (Anuradha for the team; Tushar can still change any line).

1. **Stored overtime of permanent employees: ANSWERED (a).** Recompute so stored overtime becomes 0 for permanent days.
   Punches never change. Past printed reports will differ from new ones.
2. **Excel import with an overtime rate on a permanent row: ANSWERED, error** with a clear message.
3. **Back-dating: ANSWERED.** From the first day of the previous month, up to 60 days ahead.
4. **Bulk conversion: ANSWERED, single employee only.**
5. **The gap before face enrolment: ANSWERED.** The gap is accepted. The Super Admin fills the missed days with manual
   corrections; the "enrolment pending" notice stays urgent (one notice; the daily reminder F-86 is Later). Open detail: if a person refuses face
   consent, the Super Admin changes the punch method back to QR and issues a new card.
6. Report limits: **Open, proposed values stay** (PDF above 3,000 employee-months is refused; recompute budget 3,000 days
   or about 8 seconds per request).
7. **Notification: ANSWERED, only the Super Admin.**
8. **Phone sign-ins on conversion: ANSWERED, leave them as they are.**
9. **Permanent to temporary reversal: ANSWERED, not built.**
10. Type-history backfill uses the joining date: **Open, proposed value stays.** Check with the client at handover.
11. "Not yet computed" days: **Open, proposed value stays** (a progress line for admin roles only).
12. Plant Head sees a converted person's earlier temporary days: **Open, proposed value stays** (yes, same plant).
