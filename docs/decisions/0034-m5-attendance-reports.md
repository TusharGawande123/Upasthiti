# 0034 – M5 decisions: attendance processing, dashboards, reports

Date: 2026-10-30 · Decided by: Tushar Gawande (project lead), in chat, after a phone call with the client
(Sheet Shapers) · Status: Accepted. Details: docs/specs/M5-attendance-reports.md (Approved).
Decision numbers: 0030 is reserved for the M4 real-device results, 0031 is unused (skipped).

## Order of milestones
1. **M5 is built before M4b** (optional phone punching). The lead chose this order. CLAUDE.md §7 keeps M4b
   in the list; it comes after M5.

## Lead's decisions in chat (morning of 2026-10-30)
2. **Weekly off and holidays:** one weekly off per plant for everyone (default Sunday) plus a holiday
   calendar kept by the Super Admin (all plants or chosen plants). No staggered weekly offs for now.
3. **Missing OUT:** the day is "Incomplete (OUT missing)": worked minutes and overtime are 0 until a
   correction is approved.
4. **Night shift:** the attendance day is the shift START date. A punch belongs to a day by `punch_time`
   (never `server_received_at`), in IST, inside a window around the shift (setting).
5. **Corrections (regularisation):** a Corporate Head or a Plant Head (own plant) requests one with a
   reason; the Super Admin approves or rejects (reason on reject) or corrects directly with a reason.
   Originals never change; corrections are separate append-only audited rows, shown with the M4 punch approvals.
6. **Leave:** simple paid / unpaid leave entry by the Super Admin. No balances, no approval workflow.
7. **Test data:** only DEMO plants (code starts with DEMO) are left out of reports, dashboard, headcount
   and muster by default. A per-employee "Test" flag (F-68) was offered and **rejected**.
8. **Live dashboard:** refreshed every 30 seconds by polling, not SSE (Render Free: 512 MB and sleep).
   SRS FR-33 changes accordingly.

## Client call (same day, replaces earlier ideas about pairs, grace and overtime)
9. **One IN and one OUT per shift** for permanent and temporary workers. Worked time = first IN to last OUT.
   No summing of IN-OUT pairs.
10. **Grace 30 minutes** at both ends (setting per shift): shift 09:00 to 17:00, IN until 09:30 is on time
    and OUT from 16:30 is not early. Within grace counts as the shift start / end for the status.
11. **Status of permanent employees:** worked for status >= shift length = Present; >= the shift's
    half-day limit (`half_day_min`) = Half-day; below it = **Short hours** (a separate status, decided by
    the Super Admin through a correction); no counting punch on a working day = Absent. There is no
    `full_day_min`. Temporary workers have hours and overtime only, no half-day, no Short hours.
12. **Overtime** starts right after the shift ends and counts only if it is at least 2 hours
    (`overtime_min_minutes`, default 120, per shift). Old `ot_after_min` (it held 480, "after 8 worked
    hours") is dropped; the migration records the old values in the audit log.
13. **M7 dependency:** the salary run refuses to start while undecided Short-hours or Incomplete days exist
    in the period. Temporary workers are paid from the shift start (early arrival is not paid); time after
    the shift end below the 2-hour minimum is not paid.

## Lead's answers to the open questions (same day)
14. **Mid-shift punches:** once a counted OUT closes the shift day, a further punch in the same shift is
    refused with the new code `SHIFT_ALREADY_CLOSED` ("Your shift is already closed. Please visit the plant
    office."); the Super Admin may approve it in "Needs review". "Too soon to OUT" stays at 30 minutes
    (`min_minutes_before_out`), so nobody is marked OUT by accident after IN.
15. **Work on a weekly off or holiday:** the normal overtime rule applies (2 hours minimum).
16. **Email:** the in-app bell is the channel. Email (F-7, F-65) works only when SMTP variables are set;
    otherwise it is silently off.
17. **Retention:** the lead's view is 1 year, to be confirmed with the client. M5 builds NO automatic
    deletion. Registers are commonly kept 3 to 5 years, so the client's advisor confirms at the M6 handover
    before any deletion is ever built.
18. **Gate poster:** shows, from each shift's settings, "on time until ... leave from ..." and "One IN and
    one OUT per shift". No fixed times: the admin sets the shifts.

## Extras (list: accepted-extras.md)
Approved: F-4, F-7, F-9, F-26, F-58, F-59, F-60, F-61, F-62, F-65, F-28, F-37 (default off), F-2 (default
off, privacy-safe: no name), S-39 to S-43. Later: F-56, F-57, F-63, F-64, F-66, F-67, F-8, F-16, F-12, F-44,
S-44, S-25. Rejected: F-68.
