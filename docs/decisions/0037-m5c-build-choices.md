# 0037 – M5c: date range, temporary to permanent conversion (decisions and build choices)

Date: 2026-11-04 · Decided by: Anuradha (for the team), Tushar Gawande informed · Status: Accepted. Spec:
docs/specs/M5c-range-and-conversion.md, plan: docs/plans/M5c-range-and-conversion-plan.md. **Changes of earlier
decisions are marked "to confirm with Tushar".**

## What the team decided after the client visit of 2026-11-03
1. **Date range** of attendance: all employees as an employee x day grid on screen for up to 93 days, as Excel
   or PDF for up to one year of one plant; one employee day by day for up to 366 days, on screen and as Excel or
   a print-friendly PDF.
2. **Temporary to permanent conversion**: the Super Admin converts at once (or plans a day up to 60 days ahead);
   a Corporate Head's conversion waits for the Super Admin (approvals inbox); a Plant Head cannot. Same employee
   id and code. The contractor and the hourly rate stop (kept in the type history); the QR card is revoked
   (record kept); the person punches by face and **cannot punch until the Super Admin has enrolled their face**
   (the gap is filled by manual corrections). The effective date may be from the 1st of the previous month up to
   60 days ahead. Single conversion only (no bulk). No reverse conversion. Only the Super Admin is notified.
3. **Dropped after the plan was approved** (2026-11-04): no overtime for permanent employees (slice B: permanent
   employees keep today's overtime and the conversion does not clear the overtime rate), the conversion preview
   (F-88), the conversion history report (F-91) and the design-gate mock-up images (**to confirm with Tushar: an
   exception to the rule "mock-up approved before frontend code", for this milestone only; Tushar was told**).
4. Hosting (own server instead of Render) is NOT part of M5c; the team decides it later.

## Build choices (one line each)
5. **Type history** (`employee_type_history`, migration 0031): one row per period with the type, contractor and
   rates of that period; backfilled from `joined_on` for everyone (open question 10 of the spec, to check with the
   client). `employees.type` stays "the type today". The calendar (`AttendanceCalendar.type_on`), corrections,
   the day drawer and the reports read the type of each date, so a conversion never changes old months.
6. **The type changes only through a conversion**: editing `type` on the employee form or in a change request is
   refused (`VALIDATION_FAILED`, field `type`). Contractor and rate edits go into the row of today.
7. **Planned conversion**: a future date is stored at once as a later `permanent` history row; the daily job
   applies it (card revoked, notice sent) and is safe to repeat. Cancelling empties that row (closed before its own
   start) and opens the temporary row again; nothing is deleted. A person who left before the day is not converted
   and the job writes an audit line.
8. **A Corporate Head's request is tried first inside a rolled-back savepoint** with `AuditContext.dry_run`, so no
   notice and no email goes out for a request that is only being tried.
9. **The daily job revokes the card in the name of the user who planned the conversion** (a card revoke needs a
   user id; the audit actor stays `system`).
10. **Notification `conversion_face_pending`** (urgent, Super Admin only, no name, deduplicated by employee and
    day); the email text names only the plant.
11. **Range reads** reuse the stored `attendance_days`. A request recomputes at most 3,000 employee-days or about
    8 seconds, newest days first, and answers `preparing.pending_days`; the screens ask again every 5 seconds. A
    download is never built from half-ready days: `ATTENDANCE_PREPARING` (409), and the reports page asks again by
    itself. The register-range answer has `days` with `date` and `weekday` only (no `day_kind`).
12. **Range files**: the Excel register has a Summary sheet and one grid per month and is written in XlsxWriter's
    low-memory mode into a temporary file in batches of 100 people (`reports/streaming.py`, S-50), sent from disk
    and removed. The PDF is refused above 3,000 rows (people x months). File names contain the plant or employee
    code, never a name; every download writes the usual `report.download` audit row.
13. **Presets** (F-82): last 7 days, last 30 days, this month, last month, this quarter. **Print sheet** (F-89):
    the PDF of one employee. **Convert and enrol** (F-87): after a conversion the dialog offers "Enrol face now".

## Review fixes (security, compliance, code quality, text reviews of 2026-11-04)
14. The range reads can be asked for only a few at a time (a small number of recomputes at once; the rest answer
    with what is ready and `preparing`); the open days follow the same budget.
15. The one-employee download audit row also holds the employee code; unfinished temporary files older than 15
    minutes are removed by the daily job; a 409 `ATTENDANCE_PREPARING` is not counted against the 20 files in 10
    minutes.
16. The conversion dialog tells the Super Admin that the QR card is the way back if the person does not agree to a
    face scan (consent stays free). **Open for the client's HR / legal:** that "no face, no punch" until the
    enrolment is acceptable, and the daily reminder F-86 (marked Later) while enrolment is pending.

## Known limits (not built)
- The register's type filter uses the type of today, not of each day.
- A real peak-memory check of a one-year export in the 512 MB container (S-52 was not approved); the batches of
  100 people and the temporary file are tested.
- A larger split of `RegisterPage` and `_register_xlsx` (code-quality nice-to-have).
