# M5c – Date range, temporary-to-permanent conversion, no overtime for permanent staff: Implementation Plan

Status: Approved 2026-11-04 ·
Spec: docs/specs/M5c-range-and-conversion.md (Approved 2026-11-04) · Branch: `milestone/M5c-range-and-conversion` ·
Next decision file: `docs/decisions/0037-m5c-build-choices.md` · Next migrations: 0031, 0032.

## Context
After the client visit of 2026-11-03 three changes are needed (spec §1): any date range of attendance (all employees as a
grid, one employee as a list, on screen and as Excel/PDF); a temporary to permanent conversion that keeps the employee id
and, through a new type history, leaves past months unchanged; and no overtime for permanent employees. Approved extras:
F-82, F-87, F-89, S-50 (F-88 and F-91 dropped 2026-11-04). Answers already fixed (spec §14): permanent stored overtime recomputed to 0; import row with
OT rate on a permanent employee is an error; back-date to the 1st of the previous month, 60 days ahead; single conversion only;
gap before enrolment fixed by manual corrections; notify Super Admin only; phone sign-ins untouched; no reverse conversion.
Hosting move is out of scope. No new dependency (XlsxWriter, fpdf2, openpyxl, pypdfium2 already used).

Every step is one small Conventional Commit, no Claude co-author or "Generated with" lines. Each slice ends with push and an
update of a "Status" section at the bottom of this plan (handoff rule). Every new file starts with a one-line purpose comment.
Texts say "attendance device", never "kiosk". Every new error code gets `errors.<CODE>` in `common.json`.

## Order of slices (riskiest data rule first, screens last)
**Slice A – type history (foundation).** Everything else reads "the type on a date".
1. Migration 0031 `employee_type_history` (RLS + deny_all, one-open-row unique index, backfill from `joined_on`); model in
   `modules/employees/models.py`; new `modules/employees/type_history.py` with `type_on(session, employee_id, day)` and a batch
   version, modelled on the plant-history code in `employees/operations.py` (`_close_open_plant_row`, `apply_due_transfers`).
   `create_employee` writes the first row.
2. `modules/attendance/calendar.py` (`AttendanceCalendar`, `plant_on` pattern): replace `EmployeeFacts.employee_type` by a type per day;
   `compute.py` reads it. Same for `attendance/detail_service.py`, `regularisations/service.py` (checks of `employee.type`),
   `reports/data.py` (type label, late-early-overtime, contractor-hours: contractor of the day from the history row), dashboard
   contractor split. List filters by type keep using today's type.
3. Tests: calendar with a conversion in mid-month, contractor-hours of a past month, backfill, Hypothesis "a conversion never changes days
   before its date", RLS test (existing check finds the table).

**Slice B – DROPPED 2026-11-04** (no overtime for permanent employees: not built; steps 4 to 8 removed, numbers kept so the rest
of the plan still reads the same). Permanent employees keep today's overtime. Migration 0032 holds only the kinds of slice C.

**Slice C – conversion backend.**
9. Migration 0032: `change_requests.kind_known` + `employee.convert`, `notifications.kind_known` + `conversion_face_pending`,
   QR revoke kind `converted`; audit action names.
10. `employees/operations.py` `convert_to_permanent(...)` in one transaction (spec rule 14): close/open type-history rows (old row keeps
    contractor and rates), clear contractor/hourly rate (the overtime rate stays: slice B dropped), `punch_method = face`, revoke the working card (reuse the qr_cards revoke service with
    `RevokeKind.CONVERTED`), mark days stale from the effective date (reuse `_mark_attendance_stale`), audit `employee.convert`, notification
    through the M5 notification service (urgent, Super Admin only, dedup by employee + date). Future date: scheduled history row +
    `employee.convert_scheduled`; the daily job (next to `apply_due_transfers`) applies it, idempotent; cancel = `DELETE` with
    `employee.convert_cancelled`.
11. Router: `POST/DELETE /employees/{id}/convert-to-permanent`, role from the server (Super Admin direct, Corporate Head `employee.convert` change
    request through the existing approvals flow, Plant Head 403); approvals re-check runs the same rules; `EmployeeResponse` / detail add
    `type_history`, `converted_on`, `conversion_scheduled_for`, `face_enrolment_pending`; `GET /employees` gets `converted=true`.
12. (F-91 conversion history report dropped 2026-11-04.)
13. Tests: AC-13 to AC-25 (role matrix, every error code, scheduled run twice, failed approval after the person left, gate refusals with the real
    card/face/phone paths, face enrolment makes punches work again). Compliance-auditor looks at the enrolment gap.

**Slice D – range reads.**
14. `check_date_range` helper (one place for `REPORT_RANGE_TOO_LONG`, `VALIDATION_FAILED`, `ATTENDANCE_DATE_INVALID`), used by every range endpoint.
15. `read_service`: `register_range` (93 days, paged, plant history per date) and `employee_range` (366 days, totals and `totals_by_type`,
    `type_changes`); `ensure_fresh` with a per-request budget (3,000 employee-days or about 8 s, newest first) and `preparing.pending_days`;
    background finish plus the existing 5-minute catch-up job. Routes `GET /attendance/register-range`, `GET /attendance/employee/{id}/range`.
16. Tests: AC-1 to AC-3, AC-6 to AC-11 (including 10,000 stale days, leave reason hidden, plant move), Hypothesis "rows add up to totals", EXPLAIN check on
    `attendance_days` for 650 x 366 (S-51 idea kept as a simple test only).

**Slice E – range downloads and streaming (S-50).**
17. `reports/streaming.py` (S-50): batch iterator (at most 100 employees) and a temp-file writer; XlsxWriter low-memory mode to a temp file sent in
    chunks, file removed afterwards. Existing report builders stay on the old path until moved.
18. `GET /reports/register-range.{xlsx,pdf}` (Summary sheet + one sheet per month; PDF landscape per month, `REPORT_TOO_LARGE` above 3,000 employee-months)
    and `GET /reports/employee-range.{xlsx,pdf}` with a print-friendly A4 layout (F-89); 409 `ATTENDANCE_PREPARING`; audit row `report.download`; no names in file names.
19. Tests: AC-4, AC-5 (memory check of a one-year export, same method as the S-42 register check, run locally and in the CI `docker` job only if it stays
    under its time budget), AC-8, AC-12, read-back with openpyxl and pypdfium2.

**Design gate – DROPPED 2026-11-04** (no mock-up images for M5c; the frontend follows the spec text and the existing design system; exception to the team rule, decided by the team for this milestone only).
20. (Mock-ups dropped.)

**Slice F – frontend** (`frontend/src/features/{attendance,employees,reports,approvals,notifications}`, i18n texts, `public/locales/en/common.json`).
21. Range mode on the register page; presets; progress bar that re-asks every 5 s; Excel/PDF buttons.
22. Employee Attendance tab: range list, totals card, type column, print sheet button.
23. Reports page: two range cards.
24. Employee page: "Convert to permanent" / "Ask for conversion" dialog, "Enrol face now" step, banners, "Converted" tag, type history list,
    cancel scheduled; employees list badge and filter; approvals inbox kind `employee.convert`; notification kind.
25. (Hiding overtime for permanent dropped 2026-11-04.)
26. Vitest for every new component, Biome, typecheck, `npm run i18n:check`, bundle `npm run size`.

**Slice G – close-out.**
27. Playwright: convert as Super Admin, convert as Corporate Head then approve, enrolment banner, range register + download; add all new states to
    `e2e/tests/responsive.spec.ts` (360 and 768 px).
28. Run alone, in this order: backend `uv run pytest`, `ruff`, `pyright`; frontend `npm test`; then e2e (never at the same time).
29. `/review-milestone` (test-engineer, code-quality-reviewer, security-reviewer, compliance-auditor, i18n-reviewer) and fix findings.
30. Write `docs/decisions/0037-m5c-build-choices.md`; update CLAUDE.md (tick M5c, M7 cancelled and the salary-estimate lines removed from §1, §6, §7,
    new routes and the type history rule, calculation version 2); show the CLAUDE.md diff to the lead first; `/ship` (PR after the five checks).

## Files to create or change (patterns, not every file)
- Create: `backend/migrations/versions/0031_employee_type_history.py`, `0032_conversion_and_no_permanent_ot.py`,
  `modules/employees/type_history.py`, `modules/attendance/range_service.py` (or inside `read_service.py` if small),
  `modules/reports/streaming.py`, range builders in `reports/xlsx_writer.py` / `pdf_writer.py`, frontend range components,
  `docs/design-refs/m5c/`, `docs/decisions/0037-m5c-build-choices.md`.
- Change: `employees/{models,operations,rules,schemas,presenter,import_excel,router}.py`, `approvals/payloads.py`, `attendance/{calendar,compute,
  read_service,detail_service,explain,schemas,router}.py`, `reports/{data,router,service}.py`, `regularisations/service.py`, `jobs/` (daily job),
  `qr_cards` revoke kind, `notifications` kinds, `scripts/make_fake_data.py`, `face_memory_check.py`.
- Reuse: `employees/operations.py` transfer and stale-marking helpers, plant-history pattern, the M5 notification service, qr_cards revoke service,
  approvals flow (kind registry), `ensure_fresh`, `Page`/`PageParams`, the existing report rate limits and audit, `tests/clock_helpers.py` (`frozen_at`),
  the golden table and S-42 memory-check method.

## Dependencies
None. XlsxWriter (BSD), fpdf2 (LGPL), openpyxl (MIT), pypdfium2 and Hypothesis (test only) are already in the project.

## Models and effort per slice (asked again before each slice)
A, C (data rules, constraints, gate behaviour) and the security/compliance review: Opus + high. D, E: Opus + medium. F and G: Sonnet + medium.
A fresh session per slice; the Status section is the handoff.

## Verification (every AC has a test or a check)
- AC-1–3, 6–12: slices D and E API tests (+ Hypothesis, EXPLAIN check, read-back of Excel/PDF); AC-5: memory check of a one-year export.
- AC-4, 8, 12: report tests in E. AC-13–25: slice C tests, including the real gate paths (card refused `QR_REVOKED`, face and code refused, phone
  `PHONE_FACE_NOT_READY`) and the enrolment flow that re-enables punching (also one Playwright test).
- AC-26–32: dropped with slice B.
- AC-33: `npm run i18n:check`; AC-34: `responsive.spec.ts` + wording check; AC-35: the existing RLS test.
- Manual (after the PR, on the lead's laptop): convert a test worker, enrol the face, punch at the gate; open the one-year Excel and the PDF.
- Coverage floors stay (backend 84, frontend 84).

## Risks and notes
- `AttendanceCalendar` change (type per day) touches the core calculation: do slice A first and keep the golden table green at every commit.
- The enrolment gap (spec rule 16) loses attendance until the Super Admin enrols: F-87 and the urgent notification reduce it; corrections fill it.
- A long range on Render Free depends on the recompute budget; the design needs no more memory on a bigger server.
- Do not commit `docs/decisions/0030*` and `0031*` untracked files (never `git add -A`).

## Status (kept updated after every slice)
- 2026-11-04: spec and plan approved. No code written yet. Next: slice A (type history), then B, C, D, E; design gate A can start in parallel.
- Open (spec §14, proposed values kept): Q6 report limits, Q10 type-history backfill from the joining date, Q11 "not yet computed" days for non-admins, Q12 Plant Head sees earlier temporary days.
- 2026-11-04 (team, after approval): dropped slice B (no overtime for permanent), F-91, F-88, the design-gate mock-ups and the overtime-hiding step of slice F. Spec and extras list updated.
