# M5 – Attendance processing, corrections, live dashboard and reports: Specification

Status: Approved (lead, 2026-10-30) · Author: spec-writer · Date: 2026-10-30
Amended 2026-10-31 by M4b, lead approved: §7 rules 17, 19 and 29 leave "Outside plant" phone INs out of
"inside now", the muster, the still-inside alert and the gate count (docs/specs/M4b-phone-punch.md §7 rule 22).
Lead's answers: all §14 questions and every §12 row were answered by the lead (Tushar Gawande) in chat
on 2026-10-30 and are written into §2, §7, §8, §10 and §12; §14 has no open question.
Decisions: the lead's M5 decisions of 2026-10-30 (Tushar Gawande, in chat) are written as rules in
§7 and are not re-opened here. **Later the same day the lead phoned the client (Sheet Shapers) and
replaced the rules for worked time, grace, half-day and overtime: one IN and one OUT per shift for
everyone, grace 30 minutes, overtime from the shift end and only from 2 hours, one weekly off per plant
(§7 rules 7–11, 23).** They will be recorded as **decision 0034** (`docs/decisions/0034-m5-attendance-reports.md`,
written on the milestone branch when this spec is approved). Decision 0030 is reserved for the M4
real-device results; 0031 is unused (skipped). **M5 is built before M4b** (lead's choice, decision 0034).
Related: docs/SRS.md (FR-28, FR-29, FR-30, FR-31, FR-32, FR-33, FR-34, FR-35, FR-40, FR-41; NFR-01,
NFR-03, NFR-04, NFR-06, NFR-07, NFR-09), docs/architecture.md §6, §7 (Attendance tables),
docs/specs/M1-foundation.md §7 rule 1 (roles), docs/specs/M4-anti-proxy-offline.md §7 rules 5–7 (punch
time, counted punches, reviews), docs/decisions/0005, 0025, 0027, 0028, 0029 (item D), 0032, 0033,
0034 (new), docs/decisions/accepted-extras.md (F-4, F-7, F-9, F-26), CLAUDE.md §1, §5, §6, §10, §11.

> Write in simple, clear English. No application code. The gate attendance device is the only punch
> channel (phone punching is M4b). **Wording rule (decision 0013):** every text people read says
> "attendance device", never "kiosk"; code, API paths and database names keep "kiosk". M5 adds **one
> new gate refusal** (`SHIFT_ALREADY_CLOSED`, §7 rule 24), three small approved gate lines (F-28, F-37,
> F-2, §4.16) and new poster text (§4.17); no new gate screen layout.

## 1. Problem and goal
M2–M4 record every punch and decide whether it counts, but nobody can yet answer the questions
Sheet Shapers really asks every day:
1. **Who is inside each plant right now, who is late, who did not come?** (live headcount, safety).
2. **How long did each person work, was it a full day, a half-day, and how much overtime?** The
   punches are single events; nothing turns them into one attendance day, and night shifts cross
   midnight.
3. **A forgotten OUT or a broken gate device breaks the day.** There is no correction path with a
   reason and an approval, and the original punches must never change (Labour Codes).
4. **No registers.** The client needs a daily muster, a monthly attendance register and the hours
   of each temporary worker per contractor, in Excel and PDF.

M5 delivers:
- **attendance days**: counted punches (only through `punches/counting.py`) plus approved
  corrections become one row per person per day (the **first counted IN to the last counted OUT** of
  the shift, including night shifts); late arrival, early exit, Present (full shift) / Half-day / Short
  hours / Absent, worked minutes and overtime for permanent employees; hours (first IN to last OUT) and
  overtime for temporary workers;
- **one IN and one OUT per shift at the gate:** once a counted OUT has closed a person's shift day, a
  further punch in the same shift day is refused (`SHIFT_ALREADY_CLOSED`, "Your shift is already
  closed. Please visit the plant office."); the next shift day works normally;
- **weekly off per plant, a holiday calendar and simple leave entry** (Super Admin);
- **corrections (regularisation)**: the Corporate Head or a Plant Head (own plant) asks, the Super
  Admin approves or rejects; the Super Admin may also correct directly; append-only and audited, shown
  together with the M4 punch approvals;
- **live dashboard** per plant and for all plants (refreshed every 30 s), and the **emergency muster
  list** (printable, works from the last loaded list);
- **reports** in Excel and PDF: daily muster, monthly attendance register, hours per temporary worker
  per contractor, late / early exit / overtime, exceptions, rejected punches, corrections log;
- the approved extras **F-4** still-inside safety alert, **F-7** notification centre with optional
  SMTP email, **F-9** punctuality analytics, **F-26** emergency muster list.

**Done means (SRS §11 M5 exit criteria):** on the deployed site, with the fake data of
`make_fake_data` and the worked examples of §7 rule 22 entered as punches: (a) the register of a month
shows exactly the statuses, minutes and overtime of the examples, also for a night shift; (b) a
Plant Head requests a missing OUT, the Super Admin approves it, and the day changes from "Incomplete"
to "Present" while the original punches and the audit trail stay; (c) the dashboard shows who is inside
now within 30 seconds of a punch; (d) all seven reports download as Excel and PDF with plant, period,
generated at (IST) and generated by; (e) a demo plant (code starting with `DEMO`) appears nowhere in
these screens and files unless the Super Admin switches on "Show demo plants".

## 2. Scope

**In scope:**
1. **Attendance processing** (FR-28, FR-29, FR-30): the attendance day rules of §7 rules 4–13 (day
   window around the shift, night shifts by shift start date, one IN and one OUT per shift, extra
   punches ignored for hours, late, early exit, half-day, short hours, worked minutes, overtime,
   temporary workers by hours, missing OUT = "Incomplete").
1b. **Gate rule "shift already closed"** (lead, 2026-10-30, §7 rule 24): a new anti-proxy rule right
    after the IN/OUT and cool-down rule, for card and face punches, online and at offline sync; new
    reason code `SHIFT_ALREADY_CLOSED` with gate, punch-log and error texts; approvable by the Super
    Admin in "Needs review" like other rejections that name an employee. The existing "too soon to
    OUT" rule (`min_minutes_before_out`, default 30 minutes, unchanged) gets explicit tests for card and
    face, online and offline (§10 AC-40).
2. **Stored attendance days** (§7 rule 14): an `attendance_days` table that is a **derived, recomputable
   copy**, refreshed after every punch, review, correction, leave, holiday, weekly-off or shift change,
   by a 5-minute catch-up job and by the nightly job; a report or screen recomputes any stale day it
   reads first.
3. **Shift rules** (lead decisions of 2026-10-30, as changed by the client call): a full day is the
   **full shift length**; there is **no full-day setting** and no `full_day_min` column. The Super Admin
   sets per shift: `grace_min` (default **30**, at the start and at the end), `half_day_min` (default
   240) and the new `overtime_min_minutes` (default **120**: overtime counts only from 2 hours). Overtime
   starts right at the shift end, so `ot_after_min` is **removed** (§7 rule 11). A day below the half-day
   limit gets the separate status **Short hours**, decided later by the Super Admin through a
   correction. Shift rule changes take effect from a date (`shift_rule_versions`), so past registers
   never change silently.
4. **Weekly off per plant** (decision 2): a weekly off day per plant (default Sunday), with an
   effective date; **attendance start date per plant** (days before it are not computed).
5. **Holiday calendar** (decision 2): company-wide or for chosen plants; paid or unpaid; cancel
   (never delete).
6. **Leave entry** (decision 6, FR-32): Super Admin enters employee, date range, paid / unpaid,
   reason; cancel with reason. No balances, no leave approval workflow.
7. **Corrections (regularisation)** (decision 5, FR-31): request, approve, reject, withdraw, direct
   correction by the Super Admin, reverse an approved correction; append-only tables; audited; shown
   on one screen and in one day timeline together with the M4 punch reviews.
8. **Attendance screens**: daily attendance list, monthly register, employee month (tab on the
   employee page), day timeline drawer.
9. **Live dashboard** (FR-33, decision 9): per plant and all plants, polling every 30 s (not SSE).
10. **Emergency muster** (FR-34, F-26): who is inside each plant now, printable, last list kept in the
    browser for use without connection.
11. **Reports** (FR-35): seven reports in Excel and PDF (§7 rule 18).
12. **Approved extras (in scope; approved by the lead, built in M5; §12 statuses, ACs AC-43 to AC-55):**
    - **F-4** still-inside safety alert (§7 rule 19);
    - **F-7** notification centre: the in-app bell always; email **only** when the SMTP variables are
      set (e.g. on the client's own server), otherwise silently off (§4.13, §7 rule 20);
    - **F-9** punctuality analytics (§4.12, §7 rule 21);
    - **F-26** emergency muster list (§4.2, §7 rule 17);
    - **F-58** one-day shift swap (§4.5, §7 rule 26);
    - **F-59** bulk correction after a gate outage (§4.7, §7 rule 27);
    - **F-60** attendance calendar heatmap on the employee page (§4.5, §7 rule 28);
    - **F-61** "Explain this day" sentences in the day timeline (§4.6, §7 rule 28);
    - **F-62** absence streak alert (§7 rule 20);
    - **F-65** monthly register email, only when SMTP is set (§7 rule 20);
    - **F-28** "Inside now" count on the gate idle screen (§4.16, §7 rule 29);
    - **F-37** gentle late hint at the gate, a setting, **off by default** (§4.16, §7 rule 29);
    - **F-2** privacy-safe "My month" line at the gate, a setting, off by default (§4.16, §7 rule 29);
    - tooling **S-39** golden scenario table, **S-40** midnight-IST CI run (time-machine), **S-41**
      report read-back tests, **S-42** register speed and memory check in the 512 MB container, **S-43**
      Hypothesis property tests (§11, §13).
12b. **Gate poster update** (lead, 2026-10-30): the M2 gate poster (`GET
    /api/v1/plants/{plant_id}/gate-poster.pdf`) shows, per active shift of the plant, the on-time window
    and the leave-from time generated from the shift settings, and the rule "One IN and one OUT per
    shift. After your OUT you cannot punch again in the same shift." (§4.17, §7 rule 30).
13. **Demo plants left out** (decision 8): plants whose code starts with `DEMO` are excluded from the
    dashboard, muster, attendance screens, insights, notifications and reports by default; a Super
    Admin "Show demo plants" switch includes them.
14. **Roles** (§7 rule 1): Super Admin everything; Corporate Head reads everything and may only
    request corrections; Plant Head reads own plant and may request corrections for own plant.
15. **Audit** (FR-40) of every new create, cancel, request, decision, recompute, settings change and
    report or muster download (§8.3).
16. **Settings** (§7 rule 16) and `CURRENT_MILESTONE` = 5.
17. **Raise the coverage floor** from 82% to **84%** (backend and frontend).
18. **Changes to other documents** (§15), made on the milestone branch when this spec is approved.

**Out of scope (not in M5):**
- **Salary estimate** (FR-36–FR-39): M7. M5 only provides the day statuses, paid / unpaid leave, paid
  holidays, worked minutes and overtime minutes that M7 will read. No money anywhere in M5.
- **Phone punching** and the temporary workers' phone scan (FR-43–FR-45): M4b.
- **Statutory items** (CLAUDE.md §1, §5): no statutory register forms, no PF/ESIC/PT/TDS, no
  challans, no Form 16. The registers are the company's own attendance records.
- Leave balances, leave types beyond paid / unpaid, half-day leave, leave approval workflow,
  employees applying for leave (employees never log in).
- Staggered, per-employee or rotating weekly offs: **one weekly off day per plant for everyone** (client
  call, 2026-10-30). Staggered offs come later only if the client asks (see F-16 in §12).
- Overtime pay (M7). Extras marked **Later** by the lead on 2026-10-30: F-56 month close, F-57 muster
  roll-call ticks, F-63 overtime limit warning, F-64 weekly rest check, F-66 holiday helpers, F-67 TV
  wall screen, F-8 overtime approval, F-16 roster planner, F-12 weekly digest, F-44 office-verified
  correction, S-44 nightly recompute check, S-25 storage meter.
- Any other email service than the client's own SMTP server (no paid or third-party mail API).
- Automatic deletion of attendance days, corrections or leave (§8.1 retention).
- Break logic and summing of several IN-OUT pairs: there is **one IN and one OUT per shift**; no break is
  subtracted and extra punches in between are only a note (§7 rule 7).
- **The M7 salary run's "decide Short-hours and Incomplete days first" check** is a rule for M7 (§7
  rule 23); M5 only shows the count of undecided days.
- **Any other change of the gate's IN/OUT toggle or cool-down:** the M2/M4 direction rule, the
  cool-down and `min_minutes_before_out` (default 30 minutes) stay as they are; M5 only adds the
  `SHIFT_ALREADY_CLOSED` refusal (§7 rule 24).
- Server-Sent Events (decision 9).
- A per-employee "Test" flag (offered, **rejected** by the lead, decision 8; §12).
- Any other gate screen change than the refusal text (§4.15) and the approved F-28, F-37 and F-2 lines
  (§4.16); no new gate screen layout.
- Marathi and Hindi texts (all text i18n-ready).

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | see each employee's day built from the punches that count, with late, early exit, worked time and overtime | I do not calculate attendance by hand | FR-28, FR-29 |
| US-2 | Super Admin | have night shifts (19:00–07:00) counted on the date the shift started | a night worker's day is not split in two | FR-28 |
| US-3 | Super Admin | set, per shift, the grace minutes (default 30), the half-day hours limit and the smallest overtime that counts (default 2 h); a full day = the whole shift and overtime starts at the shift end | the rules match each shift of the plant | FR-29 |
| US-3b | Super Admin | see days below the half-day limit as "Short hours" and decide each one myself with a correction | a short day is never silently paid or silently marked absent | FR-29, FR-31 |
| US-4 | Super Admin | see temporary workers' hours as first IN to last OUT of the shift (and overtime), and their payable minutes counted from the shift start | contractors' hours are clear and early arrival is not paid | FR-29 |
| US-4b | Worker at the gate | be stopped with a clear message if I punch again after my shift's OUT, and never be marked OUT by accident just after my IN | my day is not broken by a stray punch | FR-25, FR-28 |
| US-5 | Plant Head | see "Incomplete (OUT missing)" days of my plant and request the missing OUT with a reason | the day is fixed with a trail | FR-30, FR-31 |
| US-6 | Corporate Head | request a correction for any plant, and otherwise only read | I can help without changing data myself | FR-31 |
| US-7 | Super Admin | approve or reject correction requests (reason on reject), or correct directly with a reason | only one role changes attendance results | FR-31 |
| US-8 | Super Admin | see corrections and M4 punch approvals on one screen and in one day timeline | nothing is counted twice and I see the whole story | FR-27, FR-31 |
| US-9 | Super Admin | enter paid or unpaid leave for a date range | the register shows "Leave" instead of "Absent" | FR-32 |
| US-10 | Super Admin | keep a holiday calendar (all plants or chosen plants) and a weekly off day per plant | off days are not shown as absent, and work on them is visible for overtime | FR-28 |
| US-11 | Plant Head / Corporate Head / Super Admin | see who is inside, expected, late, not arrived and on leave, per plant and for all plants, refreshed every 30 s | I run the day from one screen | FR-33 |
| US-12 | Plant Head | print the list of everyone inside my plant right now, even if the connection drops during an emergency | everyone is accounted for at the assembly point | FR-34, F-26 |
| US-13 | Super Admin / Plant Head | get an alert when someone is still inside 1 hour after their shift ended | a person locked in or hurt is found | F-4 |
| US-14 | Every admin | see alerts in one bell (device offline, still inside, many rejections, correction requests and decisions) and, if I choose, by email | I do not have to watch every page | F-7, FR-41 |
| US-15 | Super Admin / Corporate Head | download the daily muster, monthly register, contractor hours, late/early/OT, exceptions, rejected punches and corrections log in Excel and PDF | I keep registers and share them with accounts and contractors | FR-35 |
| US-16 | Corporate Head | see punctuality trends per plant, department and shift | I can act on habitual lateness | F-9 |
| US-17 | Labour inspector / auditor (indirect) | see that original punches never change and every correction has a reason, a requester and an approver | the records are trustworthy | FR-40 |
| US-18 | Super Admin | keep demo plants out of real numbers, and look at them only when I switch them on | test data never pollutes the registers | decision 8 |

## 4. Screens and UX (light, modern, premium; English first)
The M1–M4 rules apply: states (empty, loading, error, success), en-IN formats (DD/MM/YYYY, 24-hour
times `HH:mm` in IST, Indian number grouping), icon + word + colour (never colour alone), keyboard
use, role-based hiding (the server still checks), all text from `public/locales/en/common.json`, every
screen fits **360 px and 768 px** without sideways page scrolling (wide tables scroll inside their own
card), every page reachable from the phone menu and listed in `e2e/tests/responsive.spec.ts`.
Durations are shown as `7 h 45 m`; minutes in files as whole numbers and as `HH:MM`.

**Design gates** (images, approved in the plan step as in M2–M4): **Gate A** dashboard and muster
(§4.1, §4.2); **Gate B** attendance list, register, day timeline, corrections (§4.3–§4.7); **Gate C**
leave, holidays, weekly off, shift form, reports, punctuality, notifications, settings cards
(§4.8–§4.14). Links are added here once approved.

**New pages and phone menu entries** (all also in `responsive.spec.ts`):
| Path | Menu label | Who sees it |
|---|---|---|
| `/admin` (dashboard, replaced) | Dashboard | all three roles |
| `/admin/muster` | Emergency muster | all three roles |
| `/admin/attendance` | Attendance | all three roles |
| `/admin/attendance/register` | Monthly register (under Attendance) | all three roles |
| `/admin/corrections` | Corrections | all three roles (Super Admin decides) |
| `/admin/leave` | Leave | all three roles (Super Admin edits) |
| `/admin/holidays` | Holidays | all three roles (Super Admin edits) |
| `/admin/reports` | Reports | all three roles |
| `/admin/insights/punctuality` | Punctuality | all three roles |
| `/admin/notifications` | Notifications (also the bell) | all three roles |

The employee page gains an **Attendance** tab (`/admin/employees/:id?tab=attendance`); the plant page
gains **weekly off and attendance start date** (Details tab) and the shift form gains new fields.

### 4.1 Dashboard (`/admin`)
- **Top:** plant picker ("All plants" for the Super Admin and Corporate Head; a Plant Head sees only
  their plant, no picker), today's date, "Updated 09:02 · refreshes every 30 seconds". Polling pauses
  while the browser tab is hidden and resumes (with an immediate fetch) when it is shown.
- **Tiles** (one plant): Inside now (with "of which temporary: N"), Expected today, Arrived, Late,
  Not arrived yet, On leave, Off today (weekly off / holiday), Exceptions, and **Days to decide**
  ("5 days to decide: 3 Short hours, 2 Incomplete", this month; the count M7 will wait for, §7 rule
  23). Each tile links to
  the attendance list with the matching filter.
- **Temporary workers on site** card: inside now per contractor (contractor name, count), "No
  contractor" row last.
- **Shift strip:** one line per shift of the day: "General 07:00–19:00 · 112 expected · 108 arrived ·
  6 late" (helps plants with day and night shifts).
- **All plants** view: a table (cards on a phone) with one row per plant: Inside now, Expected,
  Arrived, Late, Not arrived, On leave, Exceptions, and a total row.
- **Kept M1–M4 cards** (devices, to check, digest, cards ending soon, face enrolment) move below the
  live part.
- **States:** loading skeleton; a failed refresh keeps the last numbers with a yellow line "Could not
  refresh at 09:03. Showing numbers from 09:02." (`dashboard.live.stale`); empty plant (no employees):
  "No employees at this plant yet." A plant whose attendance start date is not set shows "Attendance
  has not started at this plant yet" with a link to set it (Super Admin).
- **Demo switch** (Super Admin only): in the plant picker menu, "Show demo plants" (remembered in the
  browser per user). When on, a small "Demo plants shown" chip stays visible on every M5 page.

### 4.2 Emergency muster (`/admin/muster`, F-26, FR-34)
- Big title "Emergency muster", plant picker (or "All plants"), count "214 people inside" per plant,
  time of the list "List of 09:02:15", a big **Print** button (browser print with a print stylesheet:
  A4, plant heading, page numbers, a tick box column for the roll call) and **Download PDF**.
- List per plant: employee code, name, type (Permanent / Temporary), category, department, contractor,
  IN time, attendance device name. Sorted by department, then name. Search box.
- **Without connection:** the page keeps the last list it loaded (§7 rule 17). The top shows a red
  line with icon: "No connection. This is the list of 09:02. People who punched since then are
  missing." (`muster.offline`). Print still works.
- A short note under the title: "The list shows people whose last punch is IN. Visitors and people who
  did not punch are not on it." (`muster.note`).
- Empty: "Nobody is inside right now." Loading: skeleton rows.

### 4.3 Attendance list (`/admin/attendance`)
- Filters: date (default today), plant, status (Present, Half-day, Short hours, Absent, Incomplete,
  Leave, Weekly off, Holiday, Worked on off day, In progress), type, department, category, contractor, shift,
  "Has exceptions", "Corrected", search (code or name).
- One row per employee: code, name, shift, status chip (icon + word), IN, OUT, worked, shift hours
  worked (permanent: the §7 rule 9 "worked for status" measure, e.g. "7 h 20 m of 8 h"), late, early
  exit, overtime, marks ("Corrected" pencil icon, "Correction pending" clock icon, "Flagged punch" flag
  icon, "Extra punches" note icon, exception count). On a phone each row becomes a card.
- The table head shows the shift tolerance in plain words for the chosen shift: "On time until 09:30.
  Leave from 16:30." (`attendance.tolerance`).
- Click a row → day timeline drawer (§4.6).
- Today's rows show **In progress** while the day is open (§7 rule 8): "Inside since 07:04" or "Not
  arrived yet".
- Buttons: "Download daily muster" (Excel / PDF, the §7 rule 18 report for that date and plant).

### 4.4 Monthly register (`/admin/attendance/register`)
- Month picker (default this month), plant picker (one plant; "All plants" only in the download).
- Grid: rows = employees (code, name, type), columns = days 1–31 with short codes (§7 rule 15 legend:
  P, HD, SH, A, INC, PL, UL, WO, H, WO-W, H-W, "–"), then totals: Present days, Half-days, Short-hours
  days, Absent, Leave
  (paid / unpaid), Weekly offs, Holidays, Worked on off days, Incomplete, Worked hours, Overtime hours,
  Late count. A corrected cell shows a small dot with a tooltip "Corrected" (also in files, §7 rule 18).
- Sticky first column and header; the grid scrolls inside its card. On a phone: a list of employees,
  each opening a month card (calendar of chips) instead of the grid.
- Legend at the bottom. Download Excel / PDF. Click a cell → day timeline drawer.

### 4.5 Employee page: Attendance tab
- Month picker; a calendar of the month with status chips; month totals as in the register; list of
  corrections and leave of the month; "Request correction" (Corporate Head, Plant Head own plant) or
  "Correct" (Super Admin) per day.
- **Calendar heatmap (F-60):** the last 12 months as small day squares, colour **plus** the register
  code inside each square (never colour alone), a legend, keyboard-reachable squares that open the day
  drawer. On a phone the 12 months stack as month rows (no sideways page scroll).
- **One-day shift swap (F-58, Super Admin):** "Work another shift on one day" button: date (today or
  later), shift of the same plant, reason (3–300). The day then uses that shift's rules; the list shows
  "Swapped to Night on 05/11/2026 by …" with **Cancel** (before the day starts, reason required).

### 4.6 Day timeline drawer (one employee, one day)
- Header: name, code, date, plant, shift used with its rules ("Office 09:00–17:00 (8 h = full day) ·
  on time until 09:30, leave from 16:30 · half day 4 h · overtime from 17:00 when it is 2 h or more"),
  the day window ("Punches from 05:00 on 29/10 to 05:00 on 30/10 count for this day").
- **Result:** status chip, IN (first), OUT (last), worked, worked for status ("7 h 20 m of 8 h"), late,
  early exit, overtime, payable time, exceptions with plain text (`attendanceExceptions.<CODE>`).
- **"Explain this day" (F-61):** 2–5 short plain sentences built by the server from the same result
  (never computed again in the browser), e.g. "IN 09:40: 40 minutes late (on time until 09:30). OUT
  17:00. Worked for the status 7 h 20 m of 8 h, so Half-day. No overtime: you left at the shift end."
  Each sentence is a translation key with values (`attendance.explain.<kind>`), so Marathi and Hindi can
  be added later.
- **Timeline** in time order, one line each, icon + word:
  - punches: time, IN/OUT, attendance device, method (card / face), "Saved offline", decision
    (accepted / flagged / rejected), whether it **counts** (from `counting.py`), "First IN" / "Last
    OUT" marks on the two punches that give the hours, "Extra punch: not used for the hours" on the
    others, and "Not used for this day" when a correction ignores it;
  - M4 reviews: "Approved as OUT by <Super Admin> 30/10 10:12" (reason visible to the Super Admin
    only, as in M4, decision 0028 item 4);
  - corrections: kind, times, requested by, reason, state (pending / approved / rejected / withdrawn /
    reversed), decided by, decision reason;
  - leave, holiday, weekly off lines;
  - "Punch of the next day's window counted here (OUT after midnight)" for a carry-over OUT (§7 rule 6).
- Buttons: **Request correction** (Corporate Head; Plant Head for own plant) or **Correct** (Super
  Admin), opening the correction dialog with the right kinds for this day (§7 rule 12).
- Photos are not shown here; the Super Admin has a link "Open in punch log" per punch (M2 rules).

### 4.7 Corrections (`/admin/corrections`)
- Tabs: **Pending** (Super Admin: all; others: their own and, read-only, those of their scope),
  **Decided**, **Punch approvals** (read-only list of M4 `punch_reviews` with action approved or not
  accepted in the period, linking to "Needs review" for the Super Admin; Corporate Head and Plant Head
  see action and direction without the reason), **My requests** (Corporate Head, Plant Head).
- Row: employee, date, kind, requested time(s), reason, requested by, requested at, state.
- Super Admin actions: **Approve** (shows the day result "before → after" computed by the server),
  **Reject** (reason 3–300 required). Requester action: **Withdraw** (pending only).
- Super Admin on an approved correction: **Reverse** (reason required), which adds a reversing
  correction (§7 rule 12).
- Sidebar badge: pending count (Super Admin).
- **Bulk correction after a gate outage (F-59):** button "Correct many people" (Super Admin: direct;
  Corporate Head: requests for any plant; Plant Head: requests for own plant). Steps: plant and date →
  kind (`add_punch` IN, `add_punch` OUT or `add_in_out`) and time(s) → choose people (search, filter by
  department or shift, or "everyone expected that day without an IN") → one reason → **preview** table
  (each person's day before → after, and who will be skipped with the reason code, e.g.
  `CORRECTION_NEAR_PUNCH`) → confirm. Up to 200 people per batch. The batch can be **reversed as a
  whole** by the Super Admin (reason required).
- Correction dialog: kind (radio), time inputs (date + time; the date defaults to the day, may be the
  next day for a night shift or a carry-over OUT), reason (3–300, required), a live preview of the
  new day result (server preview endpoint), and warnings (e.g. "A counted punch exists at 17:02, 3
  minutes away").

### 4.8 Leave (`/admin/leave`)
- List with filters (plant, month, employee, paid / unpaid, active / cancelled); columns: employee,
  from, to, days counted (working days only), paid / unpaid, reason, entered by, state.
- Super Admin: **Add leave** dialog (employee search, from, to, paid / unpaid, reason), **Cancel**
  (reason required). Others: read-only.
- The dialog shows "4 working days; 01/11 is a weekly off and is not counted as leave".

### 4.9 Holidays (`/admin/holidays`) and weekly off
- Year picker; list by date: date, weekday, name, plants ("All plants" or plant codes), paid / unpaid,
  state. Super Admin: **Add holiday** (date, name 2–80 characters, all plants or chosen plants, paid
  default yes), **Cancel** (reason). Others read-only.
- **Weekly off** and **Attendance start date** on the plant page (Details tab): "Weekly off: Sunday
  (from 01/11/2026)", change dialog with weekday and "from" date (today or later); attendance start
  date (Super Admin; once days exist it can only move later, §7 rule 3).

### 4.10 Shift form (plant page, Shifts tab) additions
- Fields: start, end, **grace minutes** (default 30, at the start and at the end), **half-day hours**
  (h + min), **smallest overtime that counts** (minutes, default 120), **"These rules apply from"**
  date (today or later; default today). The old field "overtime starts … minutes after the shift ends"
  is removed (overtime always starts at the shift end). No full-day field: the shift length is the full
  day (shown read-only: "Full day: 8 h").
- Helper text that updates live, in plain words (example 09:00–17:00, grace 30, half day 4 h,
  overtime minimum 2 h): "On time until 09:30. Leave from 16:30. Arrive by 09:30 and leave from 16:30
  = full day (8 h). Later or earlier than that = the real hours count. Half-day from 4 h. Below 4 h =
  Short hours (you decide the day with a correction). Overtime: from 17:00, only when you stay 2 h or
  more." (`shiftForm.tolerance`, `shiftForm.overtimeHint`)
- History list: "Rules from 01/11/2026: … · Rules from 23/10/2026: …".

### 4.11 Reports (`/admin/reports`)
- One card per report (§7 rule 18) with a short sentence, the period picker it needs (day, month or
  range), plant picker (and contractor for the contractor report), and **Excel** / **PDF** buttons.
- While a file is built: button spinner, "Building the file… large months can take up to 30
  seconds." Errors use the `errors.<CODE>` texts.

### 4.12 Punctuality (`/admin/insights/punctuality`, F-9)
- Period (last 30 days default, up to 92 days), plant, group by (department, category, shift,
  weekday).
- Cards: on-time %, late arrivals, average late minutes, early exits. Charts (Recharts): weekly on-time
  % line; bar per group; weekday pattern. Table: "Most late arrivals" (top 10: code, name, late count,
  total late minutes) linking to the employee's month.
- Note: "Permanent employees on working days only. Temporary workers have no late rule."

### 4.13 Notifications (F-7)
- Bell in the top bar with an unread count (polled every 60 s with the existing shell poll); a panel
  with the latest 10; "See all" → `/admin/notifications` (list with kind filter, read / unread, "Mark
  all as read").
- Each item: icon + word, plant, short text, time, link (e.g. "2 people still inside 1 hour after
  shift end at K134 → open the list").
- **My email alerts** (profile menu): on / off per kind (including the monthly register email, F-65);
  only for users with an email address. **When the SMTP variables are not set** (the free tiers), email
  is silently off: the switches are hidden and the page and the settings card say "Email is not set up
  on this server. Alerts are shown in the bell." (`notifications.emailNotSetUp`). The bell always
  works.

### 4.14 Settings cards
New cards "Attendance" and "Alerts" with the keys of §7 rule 16; the "Attendance device screen" card
gains the three F-28 / F-37 / F-2 switches (§4.16). The email card shows "Send a test email" (Super
Admin) only when SMTP is set, otherwise "Email is not set up on this server".

### 4.15 Gate screen: "shift already closed"
- Uses the existing M2/M3 rejection screen (red, icon + word, text at least 24 px, the rejection tone,
  no name spoken): title "Shift already closed", message "Your shift is already closed. Please visit
  the plant office.", and "For the admin: SHIFT_ALREADY_CLOSED" (decision 0006). Keys
  `kiosk.punch.SHIFT_ALREADY_CLOSED.title`, `.message`, `.next`.
- Offline: the gate shows the usual "Saved – will be confirmed"; the refusal happens at sync and the
  punch appears as rejected in the punch log and in "Needs review".
- Admin texts: `punchReasons.SHIFT_ALREADY_CLOSED` = "Shift already closed (punch after the day's OUT)"
  (punch log, Needs review, Excel export, rejected-punch report); `errors.SHIFT_ALREADY_CLOSED` = "This
  person's shift is already closed for this day."

### 4.16 Gate screen: approved small lines (F-28, F-37, F-2)
All three are plain text lines on existing screens (no new screen), at least 24 px, from the
translation file, **never spoken** by the gate voice, never with a name, and each has a Super Admin
setting (§7 rule 16).
- **F-28 "Inside now" (idle screen):** a small line under the clock: "Inside now: 214" (the plant's
  inside-now count of §7 rule 17, sent with the 60-second heartbeat answer). Hidden while the gate is
  offline (an old number could mislead). Setting `kiosk_show_inside_count` (default **on**).
- **F-37 gentle late hint (result screen after an accepted IN):** "You are 40 minutes late today."
  only for a permanent employee whose IN is beyond the shift grace. Setting `kiosk_late_hint` (default
  **off**). Never shown for an offline punch (the server decides at sync).
- **F-2 "My month" (result screen after an accepted online punch):** "This month: 18 days present".
  Privacy-safe: no name, no code, no other numbers; shown only for the normal result time
  (`kiosk_result_seconds`, 4 s) and gone with the result screen; not printed, not spoken, not stored on
  the device. "Days present" = days of the current calendar month (IST) on which the person has a
  counted IN (today included). Setting `kiosk_show_month_line` (default **off**: the Super Admin
  switches it on after telling the workers; people standing behind could read it).
- **Bundle budget:** the three lines add only small text components and three optional answer fields;
  estimated **under 1.5 kB gzip** for the gate page (texts live in the translation file, not in the
  bundle). The gate budget stays **65 kB gzip**; the plan measures it with `npm run size` before and
  after. Only if the measured headroom is then below 1.5 kB is the budget raised, by at most 2 kB, with
  a decision line (the current gate size could not be measured while writing this spec).

### 4.17 Gate poster (M2 F-34) update
- The A4 poster of a plant gains a box "Your shift times", generated from the plant's **active
  shifts** and their current rules (never fixed text): one line per shift, e.g. "Office 09:00–17:00:
  on time until 09:30, leave from 16:30." and "Night 19:00–07:00: on time until 19:30, leave from
  06:30." (start + grace, end − grace).
- A rule line: "One IN and one OUT per shift. After your OUT you cannot punch again in the same shift."
  and "Please visit the plant office if your shift is closed by mistake."
- Words: "attendance device", never "kiosk"; text sizes as the M2/M4 poster (body at least 14 pt,
  headings larger); at most 6 shifts listed (then "and N more shifts: ask the plant office").
- The poster shows the date it was made ("Shift times as on 30/10/2026"); when a shift's times or grace
  change, the save message says "Shift times changed. Print the gate poster again." with a link to it
  (nothing new is stored).
- **Gate notice (optional, F-25):** the notice editor gains a "Use shift times" button that fills a
  notice with the same lines; nothing is shown automatically.

## 5. API contract
Conventions as M1–M4: REST under `/api/v1`, JSON, error format
`{ "error": { "code", "message", "details" } }`, pagination `?page=&page_size=` returning
`{ items, page, page_size, total }`, Origin check on every write, plant scope inside each query,
out-of-scope single records → `NOT_FOUND`. Each code is the translation key `errors.<CODE>`.
Times in the API are ISO 8601 UTC; **attendance dates** are plain `YYYY-MM-DD` (the IST date of the
day, §7 rule 4). `include_demo=true` is honoured only for the Super Admin (ignored for other roles; a
Plant Head whose own plant is a demo plant always sees it).

### 5.1 Attendance
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/attendance/daily | all roles in scope | `date` (required), `plant_id?`, `status?`, `type?`, `department_id?`, `category_id?`, `contractor_id?`, `shift_id?`, `has_exceptions?`, `corrected?`, `q?`, `include_demo?`, page | page of `{ employee: { id, code, name, type, department, category, contractor }, day }` where `day` = §5.6 Day object | `VALIDATION_FAILED`, `ATTENDANCE_DATE_INVALID` |
| GET | /api/v1/attendance/register | all roles in scope | `month` (`YYYY-MM`), `plant_id` (required), `type?`, `department_id?`, `q?`, page (default page_size 100) | `{ month, plant, days_in_month, items: [ { employee, days: [ { date, code, is_corrected, has_exceptions } ], totals: §5.6 Totals } ] , page, page_size, total }` | `VALIDATION_FAILED`, `NOT_FOUND` |
| GET | /api/v1/attendance/employee/{id} | all roles in scope (Plant Head: days at own plant only) | `month` | `{ employee, days: [ Day ], totals, leave: [ … ], corrections: [ … ] }` | `NOT_FOUND` |
| GET | /api/v1/attendance/employee/{id}/day/{date} | all roles in scope | – | `{ day: Day, explanation: [ { key, values } ] (F-61), shift_swap?: { id, shift, reason }, shift_rules: { shift_id, name, start_time, end_time, crosses_midnight, shift_length_min, grace_min, half_day_min, overtime_min_minutes, effective_from }, window: { start, end }, timeline: [ TimelineItem ], allowed_correction_kinds: [ … ], can_request: bool, can_correct: bool }` | `NOT_FOUND`, `ATTENDANCE_DATE_INVALID` |
| GET | /api/v1/attendance/undecided | all roles in scope | `date_from`, `date_to` (≤ 92 days), `plant_id?`, `include_demo?` | `{ short_hours: n, incomplete: n, plants: [ { plant, short_hours, incomplete } ] }`: the number of closed days whose status is Short hours (no decision yet) and Incomplete. M7 refuses to start its salary run while either count is above 0 (§7 rule 23); M5 shows it on the dashboard and the attendance list ("12 days to decide: 9 Short hours, 3 Incomplete") | `VALIDATION_FAILED`, `REPORT_RANGE_TOO_LONG` |
| POST | /api/v1/attendance/recompute | Super Admin | `{ plant_id?, employee_id?, date_from, date_to }` (at most 62 days) | `202 { days_marked }` (days are marked stale and recomputed by the catch-up job; screens recompute on read) | `RECOMPUTE_RANGE_TOO_LONG`, `VALIDATION_FAILED` |

**TimelineItem** = one of `{ kind: "punch", punch_id, punch_time, direction, decision, counts: bool, role: "first_in"\|"last_out"\|"extra"\|null (extra = counts at the gate but is not used for the hours), ignored_by_correction_id?, kiosk: { id, name }, method, was_offline, carry_over: bool }`,
`{ kind: "review", punch_id, action, direction?, reviewed_by: { id, name }, reviewed_at, reason? (Super Admin only) }`,
`{ kind: "correction", correction_id, correction_kind, direction?, in_time?, out_time?, status_value?, punch_id?, state, reason, requested_by, requested_at, decided_by?, decided_at?, decision_reason? }`,
`{ kind: "leave", leave_id, is_paid, reason }`, `{ kind: "holiday", holiday_id, name, is_paid }`, `{ kind: "weekly_off" }`.

### 5.2 Corrections (regularisation)
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/regularisations | all roles in scope | `state=pending\|approved\|rejected\|withdrawn\|reversed`, `mine?`, `plant_id?`, `employee_id?`, `date_from?`, `date_to?` (≤ 92 days), page | page of Correction (`{ id, employee, attendance_date, kind, direction?, in_time?, out_time?, status_value?, punch_id?, reverses_id?, reason, requested_by, requested_at, is_direct, state, decision?: { action, reason?, decided_by, decided_at } }`) | `VALIDATION_FAILED` |
| GET | /api/v1/regularisations/summary | all roles in scope | – | `{ pending, mine_pending }` (sidebar badge) | – |
| POST | /api/v1/regularisations/preview | Super Admin; Corporate Head; Plant Head (own plant) | the create body | `200 { before: Day, after: Day, warnings: [ { code, details } ] }` (nothing stored) | as create |
| POST | /api/v1/regularisations | Super Admin (direct, approved at once); Corporate Head (any plant); Plant Head (employee's plant on that date = own plant) | `{ employee_id, attendance_date, kind: "add_punch"\|"add_in_out"\|"ignore_punch"\|"set_status", direction? ("in"\|"out", add_punch), in_time?, out_time? (UTC ISO; add_punch / add_in_out), punch_id? (ignore_punch), status_value? ("present"\|"half_day"\|"absent", set_status; this is how the Super Admin decides a Short-hours day), reason (3–300) }` | `201 { correction }` (Super Admin: state approved) | `CORRECTION_NOT_ALLOWED`, `CORRECTION_KIND_NOT_FOR_TEMPORARY`, `CORRECTION_TIME_OUTSIDE_DAY`, `CORRECTION_TIME_IN_FUTURE`, `CORRECTION_TOO_OLD`, `CORRECTION_DUPLICATE`, `CORRECTION_NEAR_PUNCH`, `CORRECTION_PUNCH_NOT_COUNTED`, `ATTENDANCE_DAY_NOT_ACTIVE`, `ATTENDANCE_DATE_INVALID`, `VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND` |
| POST | /api/v1/regularisations/{id}/approve | Super Admin | `{ note? (≤ 300) }` | `200 { correction }` | `CORRECTION_NOT_PENDING` (409), `CORRECTION_NO_LONGER_VALID` (409, `details.reason_code`), `NOT_FOUND` |
| POST | /api/v1/regularisations/{id}/reject | Super Admin | `{ reason (3–300) }` | `200 { correction }` | `CORRECTION_NOT_PENDING`, `VALIDATION_FAILED`, `NOT_FOUND` |
| POST | /api/v1/regularisations/{id}/withdraw | the requester | – | `200 { correction }` | `CORRECTION_NOT_PENDING`, `FORBIDDEN`, `NOT_FOUND` |
| POST | /api/v1/regularisations/{id}/reverse | Super Admin | `{ reason (3–300) }` | `201 { correction }` (a new approved row with `reverses_id`) | `CORRECTION_NOT_APPROVED` (409), `CORRECTION_ALREADY_REVERSED` (409), `NOT_FOUND` |
| POST | /api/v1/regularisations/bulk/preview | as create (Plant Head: own plant only) | `{ plant_id, attendance_date, kind: "add_punch"\|"add_in_out", direction?, in_time?, out_time?, employee_ids: [uuid] (1–200), reason (3–300) }` | `200 { items: [ { employee, before: Day, after: Day \| null, skip_code? } ], will_create, will_skip }` (F-59; nothing stored) | `VALIDATION_FAILED`, `FORBIDDEN` |
| POST | /api/v1/regularisations/bulk | as create | the preview body | `201 { batch_id, created: n, skipped: [ { employee_id, code } ] }`: one correction row per person (`batch_id` set; Super Admin: approved at once; others: pending, decided one by one or with "Approve all" in the batch view); people who fail a check are skipped, never half-created | as create + `BULK_TOO_LARGE` (more than 200) |
| POST | /api/v1/regularisations/batches/{batch_id}/approve-all · /reverse | Super Admin | `{ note? }` / `{ reason (3–300) }` | `200 { approved: n, failed: [ { id, code } ] }` / `201 { reversed: n }` | `NOT_FOUND`, `VALIDATION_FAILED` |
| GET | /api/v1/punch-approvals | all roles in scope | `date_from`, `date_to` (≤ 92 days), `plant_id?`, page | page of `{ punch_id, punch_time, employee, action, direction?, reviewed_by, reviewed_at, reason? (Super Admin only) }` (latest reviews with action approved or not accepted; read-only view of M4 data) | `VALIDATION_FAILED` |

### 5.3 Leave, holidays, weekly off, plant start date, shifts
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/leave | all roles in scope | `plant_id?`, `employee_id?`, `month?`, `is_paid?`, `state=active\|cancelled`, page | page of `{ id, employee, from_date, to_date, working_days, is_paid, reason, created_by, created_at, cancelled?: { by, at, reason } }` | – |
| POST | /api/v1/leave | Super Admin | `{ employee_id, from_date, to_date, is_paid, reason (3–300) }` | `201 { leave }` | `LEAVE_RANGE_INVALID` (to before from, more than 92 days, outside employment), `LEAVE_OVERLAPS` (409, `details.leave_id`), `VALIDATION_FAILED` |
| POST | /api/v1/leave/{id}/cancel | Super Admin | `{ reason (3–300) }` | `200 { leave }` | `LEAVE_NOT_ACTIVE` (409), `NOT_FOUND` |
| GET | /api/v1/holidays | all roles in scope | `year`, `plant_id?`, `state?` | list of `{ id, date, name, is_paid, all_plants, plants: [ { id, code } ], created_by, cancelled? }` (Plant Head: all-plant holidays + own plant) | – |
| POST | /api/v1/holidays | Super Admin | `{ date, name (2–80), is_paid (default true), all_plants: bool, plant_ids?: [uuid] (required when all_plants is false, at least 1) }` | `201 { holiday }` | `HOLIDAY_EXISTS` (409: an active holiday already covers that date for one of the plants), `HOLIDAY_DATE_INVALID` (more than 1 year back or 2 years ahead), `VALIDATION_FAILED` |
| POST | /api/v1/holidays/{id}/cancel | Super Admin | `{ reason (3–300) }` | `200 { holiday }` | `HOLIDAY_NOT_ACTIVE`, `NOT_FOUND` |
| GET | /api/v1/employees/{id}/shift-swaps | as employees read (scope) | `date_from?`, `date_to?` | list of `{ id, date, shift: { id, name }, reason, created_by, created_at, cancelled?: { by, at, reason } }` (F-58) | `NOT_FOUND` |
| POST | /api/v1/employees/{id}/shift-swaps | Super Admin | `{ date (today IST or later), shift_id (active shift of the employee's plant on that date), reason (3–300) }` | `201 { swap }` | `SHIFT_SWAP_INVALID` (past date, other plant, inactive shift, same as the assigned shift, employee not active on that date), `SHIFT_SWAP_EXISTS` (409: an active swap already exists for that date) |
| POST | /api/v1/shift-swaps/{id}/cancel | Super Admin | `{ reason (3–300) }` | `200 { swap }` | `SHIFT_SWAP_STARTED` (409: the day's window has begun), `SHIFT_SWAP_NOT_ACTIVE`, `NOT_FOUND` |
| GET | /api/v1/attendance/employee/{id}/year | all roles in scope (Plant Head: days at own plant) | `to_month` (`YYYY-MM`, default this month) | `{ months: [ { month, days: [ { date, code, is_corrected } ] } ] }` (12 months; F-60) | `NOT_FOUND` |
| GET | /api/v1/plants/{id}/weekly-off | as plant setup read | – | `{ current: { weekday (1 Monday – 7 Sunday), effective_from }, history: [ … ] }` | `NOT_FOUND` |
| POST | /api/v1/plants/{id}/weekly-off | Super Admin | `{ weekday (1–7), effective_from (today IST or later) }` | `201 { weekly_off }` | `WEEKLY_OFF_DATE_INVALID`, `VALIDATION_FAILED` |
| PATCH | /api/v1/plants/{id} | Super Admin (M1) | **additive** `attendance_start_date` (date) | M1 plant + `attendance_start_date` | **new** `ATTENDANCE_START_INVALID` (§7 rule 3) |
| GET/POST | /api/v1/plants/{id}/shifts | as M1 | **changed fields:** `grace_min` default now **30** (0–120); **new** `overtime_min_minutes` (0–480, default **120**; 0 = every overtime minute counts); **removed** `ot_after_min` (ignored when an old client still sends it; no longer returned); `half_day_min` must be below the shift length | items gain `shift_length_min` (read-only), `overtime_min_minutes`, `rules_from` (date of the current rule version), `upcoming_rules?`; lose `ot_after_min` | as M1 + `SHIFT_DAY_LIMITS_INVALID` |
| PATCH | /api/v1/shifts/{id} | Super Admin (M1) | **additive** `rules_effective_from` (date, today IST or later, default today), `overtime_min_minutes`; a change of start, end, grace, half day or overtime minimum adds a rule version | as M1 | as M1 + `SHIFT_DAY_LIMITS_INVALID`, `SHIFT_RULE_DATE_INVALID` |
| GET | /api/v1/shifts/{id}/rule-versions | as plant setup read | – | list of versions | `NOT_FOUND` |

### 5.4 Dashboard, muster, insights
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/dashboard/live | all roles in scope | `plant_id?` (absent = all plants in scope), `include_demo?` | `{ generated_at, date, plants: [ { plant: { id, code, name, is_demo }, attendance_started: bool, inside_now, inside_temporary, expected, arrived, late, not_arrived, on_leave, off_today, exceptions, undecided: { short_hours, incomplete }, by_contractor: [ { contractor: { id, name } \| null, inside } ], shifts: [ { shift: { id, name, start_time, end_time }, expected, arrived, late } ] } ], totals: { … same numbers } }` (polled every 30 s; replaces the SRS `/dashboard/live (SSE)`) | – |
| GET | /api/v1/muster | all roles in scope | `plant_id?`, `include_demo?` | `{ generated_at, plants: [ { plant, count, people: [ { employee: { id, code, name, type, category, department, contractor }, in_time, kiosk: { id, name } } ] } ] }` | – |
| GET | /api/v1/muster.pdf | all roles in scope | as above | PDF (`Content-Disposition: attachment; filename="upasthiti-muster-<PLANT or ALL>-<YYYYMMDD-HHMM>.pdf"`) | `TOO_MANY_REQUESTS` |
| GET | /api/v1/insights/punctuality | all roles in scope | `date_from`, `date_to` (≤ 92 days), `plant_id?`, `group_by=department\|category\|shift\|weekday` | `{ on_time_percent, arrivals, late_count, average_late_min, early_exit_count, weekly: [ { week_start, on_time_percent } ], groups: [ { key, label, arrivals, late_count, on_time_percent, average_late_min } ], top_late: [ { employee, late_count, late_min } ] (10) }` | `REPORT_RANGE_TOO_LONG`, `VALIDATION_FAILED` |

### 5.5 Reports
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/reports/{kind}.{format} | all roles in scope (Plant Head: own plant; "all plants" only Super Admin and Corporate Head) | `kind` = `daily-muster` \| `register` \| `contractor-hours` \| `late-early-overtime` \| `exceptions` \| `rejected-punches` \| `corrections`; `format` = `xlsx` \| `pdf`; `plant_id?` (absent = all plants in scope), `date` (daily-muster), `month` (register, contractor-hours), `date_from` + `date_to` (others, ≤ 31 days), `contractor_id?` (contractor-hours), `include_demo?` | the file; name `upasthiti-<kind>-<PLANT or ALL>-<period>.<format>` (no names in the file name) | `REPORT_KIND_UNKNOWN` (404), `REPORT_RANGE_TOO_LONG`, `REPORT_TOO_LARGE` (413: PDF over 3,000 rows; choose one plant or Excel), `REPORT_BUSY` (429: one report at a time per user), `TOO_MANY_REQUESTS` (more than 20 files in 10 minutes per user), `FORBIDDEN`, `VALIDATION_FAILED` |

### 5.6 Shared objects
**Day** = `{ date, plant: { id, code }, shift: { id, name } | null, employee_type, day_kind: "working"|"weekly_off"|"holiday", status: "open"|"present"|"half_day"|"short_hours"|"absent"|"incomplete"|"leave"|"weekly_off"|"holiday"|"not_employed", code (register code, §7 rule 15), open_state?: "inside"|"not_arrived"|"left" (open days only), first_in, last_out, worked_min (first IN to last OUT), payable_min (from the shift start or the later first IN, up to the shift end, or up to the last OUT when overtime counts, §7 rule 10), status_min (permanent: "worked for status", §7 rule 9; null for temporary), shift_length_min, extra_punch_count, late_min, early_exit_min, overtime_min, leave?: { id, is_paid }, holiday?: { id, name, is_paid }, exceptions: [CODE], is_corrected, pending_corrections, uses_unchecked_flag: bool, computed_at }`.
**Totals** = `{ present, half_day, short_hours, absent, incomplete, leave_paid, leave_unpaid, weekly_off, holiday, worked_on_off_day, worked_min, overtime_min, late_count, late_min, early_exit_count }`.

### 5.7 Notifications
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/notifications | any admin | `unread?`, `kind?`, page | page of `{ id, kind, severity, plant?: { id, code, name }, text_key, params, link, created_at, resolved_at?, read: bool }` (only notifications of the user's scope, §7 rule 20) | – |
| GET | /api/v1/notifications/unread-count | any admin | – | `{ unread }` | – |
| POST | /api/v1/notifications/{id}/read · /notifications/read-all | any admin | – | `204` | `NOT_FOUND` |
| GET/PUT | /api/v1/me/notification-preferences | any admin | `{ email_enabled: bool, email_kinds: [kind] }` | the preferences + `email_configured: bool`, `has_email: bool` | `EMAIL_ADDRESS_MISSING` (409), `VALIDATION_FAILED` |
| POST | /api/v1/notifications/test-email | Super Admin | – | `202` | `EMAIL_NOT_CONFIGURED` (409), `EMAIL_SEND_FAILED` (502), `EMAIL_ADDRESS_MISSING` |

### 5.8 Changed endpoints (additive)
| Method | Path | Change |
|---|---|---|
| GET | /api/v1/settings | the new keys of §7 rule 16 |
| GET | /api/v1/plants/{id}/readiness | additive `attendance_start_set: bool`, `weekly_off_set: bool` (always true after the migration) |
| GET | /api/v1/audit | new actions of §8.3 (filters unchanged) |
| POST | /api/v1/punch/kiosk · /punch/kiosk/code · /kiosk/sync (per item) | new rejection `decision: "rejected"`, `reason_code: "SHIFT_ALREADY_CLOSED"` (§7 rule 24); the answer shape is unchanged (an old gate shows its generic rejection text until it reloads; S-27 self-update) |
| POST | /api/v1/punch/kiosk · /punch/kiosk/code (accepted answers, online only) | **additive, optional** `gate_lines: { late_minutes?: int (F-37: only when `kiosk_late_hint` is on, permanent employee, IN beyond grace), month_days_present?: int (F-2: only when `kiosk_show_month_line` is on) }`; never a name; never in offline sync answers |
| POST | /api/v1/kiosk/heartbeat · GET /kiosk/me | **additive** `inside_now: int \| null` (F-28: the plant's inside-now count; null when `kiosk_show_inside_count` is off) and `kiosk_settings.screen: { show_inside_count, late_hint, show_month_line }` |
| GET | /api/v1/plants/{plant_id}/gate-poster.pdf | M2 endpoint; the PDF gains the shift-times box and the one-IN-one-OUT rule (§4.17); no new parameter |
| GET | /api/v1/punches/{id}/review-context | for a `SHIFT_ALREADY_CLOSED` punch the approve `suggestion.direction` is **"out"** (§7 rule 24) and `related` lists the OUT that closed the day |

Common errors for all endpoints: as M1 (`NOT_AUTHENTICATED`, `FORBIDDEN`, `ORIGIN_NOT_ALLOWED`,
`VALIDATION_FAILED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`).

## 6. Data model changes
Conventions as M1–M4: UUID `id`, `created_at` / `updated_at` `timestamptz` (UTC), constraint names per
the M0 convention. The last migration is `0018_kiosk_heartbeats`, so M5 starts at **0019**. **Every new
table gets, in the migration that creates it, `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY deny_all ON <name> FOR ALL USING (false) WITH CHECK (false)`**, no grants to anon; every
new trigger function has `SET search_path = ''`; `tests/test_row_level_security.py` covers every new
table. No database view is created (as M4).

**Never deleted:** `punches`, `punch_reviews`, `audit_logs` (as M4), and the new `regularisations`,
`regularisation_decisions`, `shift_rule_versions`, `plant_weekly_offs` (append-only triggers refuse
UPDATE, DELETE, TRUNCATE). `leave_records`, `holidays` and `shift_swaps` are cancelled, never deleted (cancel columns
are set once; a trigger refuses DELETE and any UPDATE other than setting the cancel columns from
empty). `attendance_days` rows are **derived data**: updated in place by the calculation, never
deleted (a day that no longer applies becomes `not_employed`). The only rows deleted by design are
`notifications` (and their reads and deliveries) older than `notification_keep_days`: alerts, not
attendance, audit or employee records.

**Migration `0019_shift_rule_versions_and_plant_attendance`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `shifts` (change) | + `overtime_min_minutes` (int, not null, default 120); **drop `ot_after_min`**; **no `full_day_min`** (the full day is the shift length) | check `overtime_min_minutes BETWEEN 0 AND 480`; check `grace_min BETWEEN 0 AND 120` (replaces the old limit 240); the existing check `minutes_positive` is rewritten without `ot_after_min`. "`half_day_min` below the shift length" is checked in the service (it depends on the times; `SHIFT_DAY_LIMITS_INVALID`). **Data step:** every existing shift gets `grace_min` **30** (it was 10 by default) and `overtime_min_minutes` **120**; the old `ot_after_min` (480 = "after 8 worked hours", never used by any calculation) is dropped because overtime now always starts at the shift end (= 0); one audit row `shift.rules_migrated` per shift with before and after (`grace_min 10 → 30`, `ot_after_min 480 → removed (0)`, `overtime_min_minutes → 120`) |
| `shift_rule_versions` (new) | shift_id (FK), effective_from (date), start_time, end_time (time), crosses_midnight (bool), grace_min, half_day_min, overtime_min_minutes (int), created_by (FK users null: null = migration), created_at | unique `(shift_id, effective_from)`; same checks as `shifts`; append-only trigger; RLS + `deny_all`. **Backfill:** one version per existing shift, `effective_from` = the IST date of the shift's `created_at` |
| `plants` (change) | + `attendance_start_date` (date null) | – (null = attendance not started; no days computed) |
| `plant_weekly_offs` (new) | plant_id (FK), weekday (smallint 1–7, ISO: 1 Monday … 7 Sunday), effective_from (date), created_by (FK users null), created_at | unique `(plant_id, effective_from)`; check weekday 1–7; append-only trigger; RLS + `deny_all`. **Backfill:** Sunday (7) for every plant from the IST date of its `created_at`. New plants get a Sunday row in the plant-creation transaction |

`shifts` keeps the **current** values (what the M1 screens show); the calculation always reads the
version effective on the attendance date (§7 rule 4). **Defaults for new shifts:** `grace_min` 30,
`half_day_min` 240 (unchanged), `overtime_min_minutes` 120. Code to change: backend `plants_service`
(`DEFAULT_GRACE_MIN` 10 → 30, `DEFAULT_OT_AFTER_MIN` 480 removed, new `DEFAULT_OVERTIME_MIN_MINUTES`
120), the org schemas and router (field `ot_after_min` removed, `grace_min` default 30), and the
frontend shift form defaults in `features/plants/shifts-tab.tsx` and `use-plants.ts` (grace 10 → 30,
`overtimeAfter` 480 field removed, new "smallest overtime" field 120) and the shift tests that use 480.

**Migration `0020_holidays_and_leave`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `holidays` | date (date), name (text 2–80), is_paid (bool, default true), all_plants (bool), created_by (FK users), created_at, cancelled_at (timestamptz null), cancelled_by (FK users null), cancel_reason (text null) | check cancel columns all null or all set; check name length; index `(date)`; cancel-only trigger; RLS + `deny_all` |
| `holiday_plants` | holiday_id (FK), plant_id (FK) | unique `(holiday_id, plant_id)`; rows only when `all_plants` is false; append-only; RLS + `deny_all` |
| `leave_records` | employee_id (FK), from_date, to_date (date), is_paid (bool), reason (text 3–300), created_by (FK users), created_at, cancelled_at, cancelled_by, cancel_reason | check `to_date >= from_date`; check `to_date - from_date <= 91`; check cancel columns together; index `(employee_id, from_date)`; cancel-only trigger; RLS + `deny_all`. "No overlap with another active leave" is checked in the service with the employee row locked (`SELECT … FOR UPDATE`) |

**Migration `0021_regularisations`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `regularisations` | employee_id (FK), attendance_date (date), kind (`add_punch` / `add_in_out` / `ignore_punch` / `set_status` / `reverse`), direction (`in`/`out` null), in_time, out_time (timestamptz null), punch_id (FK punches null), status_value (`present`/`half_day`/`absent` null), reverses_id (FK regularisations null), reason (text 3–300), requested_by (FK users), requested_at (timestamptz), is_direct (bool: made by the Super Admin, approved in the same transaction), batch_id (uuid null: the F-59 bulk batch it belongs to) | checks per kind: `add_punch` ⇒ direction and exactly one of in_time (direction in) / out_time (direction out); `add_in_out` ⇒ in_time and out_time and `out_time > in_time`; `ignore_punch` ⇒ punch_id; `set_status` ⇒ status_value; `reverse` ⇒ reverses_id and `is_direct`; other columns null; partial unique `(reverses_id) WHERE reverses_id IS NOT NULL`; index `(employee_id, attendance_date)`; index `(requested_at DESC)`; partial index `(batch_id) WHERE batch_id IS NOT NULL`; append-only trigger; RLS + `deny_all` |
| `regularisation_decisions` | regularisation_id (FK, **unique**: one decision per request), action (`approved` / `rejected` / `withdrawn`), reason (text null; required 3–300 for rejected), note (text null ≤ 300), decided_by (FK users), decided_at | check reason for rejected; append-only trigger; RLS + `deny_all` |

**State of a correction** (computed, never stored): no decision row → `pending`; decision `approved` →
`approved`, or `reversed` when an approved `reverse` row points at it; `rejected`; `withdrawn`.

**Migration `0022_attendance_days`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `attendance_days` | employee_id (FK), attendance_date (date), plant_id (FK: the employee's plant on that date), shift_id (FK null), shift_rule_version_id (FK null), employee_type (`permanent`/`temporary`), day_kind (`working`/`weekly_off`/`holiday`), status (`open`/`present`/`half_day`/`short_hours`/`absent`/`incomplete`/`leave`/`weekly_off`/`holiday`/`not_employed`), leave_record_id (FK null), holiday_id (FK null), first_in, last_out (timestamptz null: the first counted IN and the last counted OUT used), extra_punch_count (smallint, default 0: counted punches that are not used for the hours), worked_min (first IN to last OUT, whole minutes), payable_min (int, default 0: from max(first IN, shift start) to the shift end, or to the last OUT when overtime is counted, §7 rule 10), status_min (int null: "worked for status", permanent only, §7 rule 9), shift_length_min (int null), late_min, early_exit_min, overtime_min (int, default 0), exceptions (text[] default '{}'), is_corrected (bool), uses_unchecked_flag (bool), calc_version (smallint), stale (bool, default true), computed_at (timestamptz null) | unique `(employee_id, attendance_date)`; index `(plant_id, attendance_date)`; partial index `(attendance_date) WHERE stale`; checks: minutes ≥ 0; status and day_kind known; `status <> 'incomplete' OR (worked_min = 0 AND overtime_min = 0 AND payable_min = 0)`; `payable_min <= worked_min`; `overtime_min <= payable_min`; `overtime_min = 0 OR payable_min > 0`; `employee_type = 'permanent' OR (status NOT IN ('half_day', 'short_hours') AND late_min = 0 AND early_exit_min = 0 AND status_min IS NULL)`; `status_min IS NULL OR status_min <= shift_length_min`; `first_in IS NULL OR last_out IS NULL OR last_out > first_in`; RLS + `deny_all`. No DELETE in code; a migration test checks there is no delete path (grep test as for punches) |

**Migration `0023_notifications`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `notifications` | kind (`device_offline` / `still_inside` / `many_rejections` / `correction_requested` / `correction_decided` / `incomplete_days` / `review_digest` / `absence_streak` (F-62) / `monthly_register` (F-65)), severity (`info`/`warning`/`urgent`), plant_id (FK null), target_user_id (FK users null: for personal notices like "your request was approved"), text_key, params (jsonb: counts, plant code, times, ids; **no names**), subject_ids (uuid[]: employee or kiosk ids, names are fetched on read in the reader's scope), dedupe_key (text, unique), created_at, resolved_at (null) | index `(created_at DESC)`; index `(plant_id, created_at DESC)`; RLS + `deny_all` |
| `notification_reads` | notification_id (FK), user_id (FK), read_at | unique `(notification_id, user_id)`; RLS + `deny_all` |
| `notification_deliveries` | notification_id (FK), user_id (FK), channel (`email`), state (`sent`/`failed`), attempted_at, error_code (text null) | unique `(notification_id, user_id, channel)` (never two emails for one alert); RLS + `deny_all` |
| `users` (change) | + `email_alerts_enabled` (bool default false), + `email_alert_kinds` (text[] default '{}') | – |

**Migration `0024_shift_swaps`** (F-58)
| Table | Columns | Keys / constraints |
|---|---|---|
| `shift_swaps` | employee_id (FK), swap_date (date), shift_id (FK shifts), reason (text 3–300), created_by (FK users), created_at, cancelled_at, cancelled_by, cancel_reason | partial unique `(employee_id, swap_date) WHERE cancelled_at IS NULL`; check cancel columns together; index `(employee_id, swap_date)`; cancel-only trigger (no DELETE, no other UPDATE); RLS + `deny_all` |

**Settings (no migration; `settings/definitions.py`):** the new keys of §7 rule 16, including the gate
screen switches `kiosk_show_inside_count`, `kiosk_late_hint`, `kiosk_show_month_line` and
`absence_streak_days`.

**Size estimate (Supabase Free 500 MB):** `attendance_days` ≈ 650 people × 365 days ≈ 237,000 rows a
year × about 220 bytes with indexes ≈ **50 MB a year** (on top of punches, about 160 MB a year, M2/M4
estimate). Corrections, leave, holidays: under 1 MB a year. Notifications: kept 90 days, under 2 MB.
The storage meter idea (S-25) becomes more useful; see §12.

## 7. Business rules

1. **Role permission matrix (M5 rows; extends M1 §7 rule 1 and M2–M4).**

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK |
   |---|---|---|---|---|
   | Attendance list, register, employee month, day timeline | all | all (read) | own plant (read) | – |
   | Request a correction | – (corrects directly) | all plants | own plant (employee's plant on that date) | – |
   | Withdraw own pending request | – | own requests | own requests | – |
   | Approve / reject a request; direct correction; reverse | ✔ | – | – | – |
   | Corrections list, punch approvals list | all | all (read; review reasons hidden) | own plant (read; review reasons hidden) | – |
   | Leave: add, cancel | ✔ | read | own plant read | – |
   | Holidays: add, cancel | ✔ | read | read (all-plant + own plant) | – |
   | Weekly off, attendance start date, shift rules (incl. half day) | edit | read | own plant read | – |
   | One-day shift swap (F-58) | ✔ | read | own plant read | – |
   | Bulk correction (F-59) | direct; approve all; reverse batch | request (all plants) | request (own plant) | – |
   | Calendar heatmap (F-60), "Explain this day" (F-61) | all | all | own plant | – |
   | Gate lines (F-28, F-37, F-2) and poster shift times | settings: edit | read | read; poster download own plant (M2) | shown on own plant's device |
   | Dashboard, muster (screen and PDF) | all | all | own plant | – |
   | Reports (Excel, PDF) | all, incl. all plants | all, incl. all plants | own plant | – |
   | Punctuality insights | all | all | own plant | – |
   | Notifications (bell, page) | all kinds, all plants | read: device offline, still inside, many rejections, incomplete days (all plants) | same kinds, own plant; plus own request decisions | – |
   | Own email alert preferences | ✔ | ✔ | ✔ | – |
   | Test email; recompute a date range; "Show demo plants" | ✔ | – | – | – |
   | Settings (new M5 keys) | edit | read | read | – |

   New capabilities in `permissions.py`: `VIEW_ATTENDANCE` (SA all, CH all, PH own plant),
   `REQUEST_CORRECTIONS` (CH all, PH own plant), `DECIDE_CORRECTIONS` (SA), `MANAGE_LEAVE` (SA),
   `MANAGE_HOLIDAYS` (SA), `VIEW_REPORTS` (SA all, CH all, PH own plant), `RECOMPUTE_ATTENDANCE` (SA),
   `SHOW_DEMO_PLANTS` (SA). Weekly off and shift rules reuse `EDIT_PLANT_SETUP`. The server decides
   the correction path from the role (Super Admin = direct; others = request), never from a client flag.
   A Plant Head's scope for a day is the **employee's plant on that date** (plant history, F-20), so a
   transferred employee's old days stay with the old plant.

2. **Counted punches: one source of truth** (decisions 0025, 0029 D; lead decision 5). The attendance
   calculation reads punches **only** through `punches/counting.py`:
   - `accepted` counts; `flagged` counts unless its latest review is "not accepted"; `rejected` counts
     only when its latest review is "approved", with the review's direction and **the review's
     employee** (an approved punch that names nobody counts for the person in its approval);
     `needs_code` never counts.
   - The stored (or approved) direction is used as it is; M5 never re-decides IN/OUT of a punch.
   - M5 adds **bulk** functions to `counting.py` (same conditions, many employees at once, e.g.
     `counted_for_employees(employee_ids, start, end)` returning punch, direction and the counted
     employee id), so the dashboard and a month of a plant need a few queries, not one per person.
     A test runs the single and bulk functions on the same data and requires equal results.
   - A flagged punch that is not yet checked is used and the day gets `uses_unchecked_flag` (a flag
     icon on screens; listed in the exceptions report).
   - Self-test cards (F-27) never write a counted punch (M2), so they never reach attendance.

3. **Which days exist.** For employee E and date D (IST calendar date):
   - D must be on or after E's `joined_on`, on or before `left_on` (if left), and on or after the
     `attendance_start_date` of E's plant on D. Otherwise the day is `not_employed` (no row is made,
     or an existing row becomes `not_employed`; shown "–").
   - The plant on D comes from `employee_plant_history`; the shift from an active **one-day shift swap**
     on D (F-58, rule 26) if there is one, else from `shift_assignments`; the shift rules from
     `shift_rule_versions` (latest `effective_from` ≤ D).
   - `attendance_start_date` (per plant, Super Admin): set when the plant really starts using the
     attendance devices. Until it is set, the plant has no attendance days, its dashboard says
     "Attendance has not started", and plant readiness shows it. Once days exist it may only move
     **later** (`ATTENDANCE_START_INVALID` for an earlier date than the current one when days exist);
     days before the new date become `not_employed`.
   - Days in the future are never stored; today is `open` until it closes (rule 8).

4. **Day kind: holiday, weekly off or working** (lead decision 2).
   - **Holiday:** an active holiday on D that is for all plants or lists E's plant on D.
   - **Weekly off:** D's ISO weekday equals the plant's weekly off effective on D (latest
     `plant_weekly_offs.effective_from` ≤ D). Default Sunday.
   - A holiday on the weekly off day is a **holiday** (one status per day).
   - Otherwise **working**.
   - Weekly-off changes apply from today or a later date (`WEEKLY_OFF_DATE_INVALID` for a past date),
     so past registers do not change. Holidays may be added for past dates (e.g. a sudden closure);
     this recomputes those days and is audited.

5. **Day window** (lead decision 4). The attendance day of a shift is the **date the shift starts**.
   Punches are placed by `punch_time` (never `server_received_at`), converted to IST.
   - Let *N* = `attendance_window_before_hours` (setting, default **4** h, range 1–8), *S(D)* = start
     time of E's shift rules on D.
   - **Window of D** = from **D at S(D) − N** up to (not including) **D+1 at S(D+1) − N**, where S(D+1)
     uses the shift of D+1. Windows of one person follow each other without gaps or overlaps, so every
     punch belongs to exactly one day.
   - Example (Office 09:00–17:00, N = 4): day 29/10 = 29/10 05:00 to 30/10 05:00.
   - Example (Night 19:00–07:00, N = 4): day 29/10 = 29/10 15:00 to 30/10 15:00. A worker who comes
     19:00 on 29/10 and leaves 07:00 on 30/10 has **one day: 29/10**.
   - Shift change between D and D+1: the old day ends where the new day starts. If that leaves the old
     day's window ending less than 1 hour after its shift end, the day gets exception
     `SHIFT_CHANGE_SHORT_DAY` and the shift-change dialog warns before saving.

6. **Building the event list of a day.**
   1. Take E's counted punches (rule 2) with `punch_time` in the window of D.
   2. Remove punches ignored by an approved, not reversed `ignore_punch` correction of D.
   3. Add the times of approved, not reversed `add_punch` / `add_in_out` corrections of D as IN / OUT
      events (marked "corrected").
   4. **Carry-over OUT:** if, after steps 1–3, the last event of D is an IN, and the first event of the
      window of D+1 is an **OUT** less than `open_in_max_hours` (M2 setting, 20 h) after that IN, that
      OUT belongs to D and is left out of D+1. (The server already decided it was an OUT because the IN
      was open, M2 §7 rule 6.) Example: Office shift, IN 29/10 10:00 (late), long overtime, OUT 30/10
      05:30 (19 h 30 m later, after the 05:00 window end) → the OUT counts for 29/10. This rule is
      unchanged for night shifts.
   5. Sort by time. Equal times: IN before OUT.

7. **One IN and one OUT per shift** (FR-28; client call of 2026-10-30, for permanent **and** temporary
   workers). The client says a worker punches once in at about the start and once out at about the
   end, so there is **no summing of pairs and no break logic**. From the sorted events of rule 6:
   - **first_in** = the earliest IN. **last_out** = the latest event, when it is an OUT that comes
     after first_in.
   - **Worked time** is *first_in* to *last_out* (rule 9).
   - **Missing OUT:** when the latest event is an IN (even if an earlier OUT exists), the person is
     still inside as far as the records say → **Incomplete (OUT missing)** (rule 8).
   - **Missing IN:** OUT events and no IN at all → **Incomplete (IN missing)**, exception
     `OUT_WITHOUT_IN`; never Absent (Absent means no counting punch, rule 9).
   - **Extra punches** = every counted event other than first_in and last_out. Since the gate refuses a
     punch after the day's OUT (rule 24), they are **rare** and come only from: a `SHIFT_ALREADY_CLOSED`
     (or other) rejection that the Super Admin later approves in "Needs review", and offline punches
     that arrive after newer ones (M4 `SYNC_ORDER_CONFLICT`). They are **ignored for hours, status, late,
     early exit and overtime** and shown as a note: the day gets `extra_punch_count` and the information
     exception `EXTRA_PUNCHES` ("1 extra punch was not used for the hours"). The note appears in the
     timeline ("Extra punch") and in the exceptions report as a **Note**, and is not counted in the
     dashboard "Exceptions" tile.
   - At the gate: a second punch less than `min_minutes_before_out` (30 minutes) after the IN is
     refused `OUT_TOO_SOON` (M2, unchanged), so a worker is never marked OUT by accident just after the
     IN; the first punch after that is the OUT; any punch after that OUT in the same shift day is
     refused `SHIFT_ALREADY_CLOSED` (rule 24).

8. **Open, closed and incomplete days** (lead decision 3, FR-30).
   - A day is **open** while now (server time) is before its window end, or while the carry-over of
     rule 6.4 is still possible (an open IN younger than `open_in_max_hours`). Open days show
     `open_state`: `inside` (the latest event is an IN), `left` (an IN and then an OUT) or `not_arrived`
     (no event). Open days are not counted as absent or incomplete yet.
   - When the day closes and the latest event is an IN (no OUT after it), the day is **Incomplete (OUT
     missing)**, exception `OUT_MISSING`: it counts as present for headcount history (it appears in
     "Arrived" and in the muster history), but **worked minutes and overtime are 0**, even if an
     earlier OUT exists, until an approved correction completes it. Late arrival is still shown.
   - The exceptions report and the dashboard "Exceptions" count list incomplete days; the Plant Head
     and Corporate Head are asked to request the missing OUT (F-7 notification `incomplete_days`, once
     a day per plant).

9. **Worked time, grace, late, early exit and the status of permanent employees on a working day**
   (client call of 2026-10-30; lead decisions of the same day). Notation: *S* = shift start, *E* = shift
   end (on D+1 for a shift that crosses midnight), *g* = the shift's `grace_min` (default **30**, the
   same at the start and at the end), *L* = shift length = *E* − *S*, *H* = `half_day_min`.
   Office 09:00–17:00 → L = 480 min; Night 19:00–07:00 → L = 720 min. **The shift length is the full
   day**; there is no full-day setting.
   - **Worked minutes** *W* (stored, shown everywhere, input for M7) = *last_out* − *first_in*, whole
     minutes cut down. Nothing is subtracted for breaks, and extra punches in between do not change it.
     Early arrival is part of *W* (see the status rule for what it does not do).
   - **Grace in plain words** (shown on admin screens, §4.3, §4.6, §4.10): "On time until *S*+*g*.
     Leave from *E*−*g*." Example 09:00–17:00, g = 30: "On time until 09:30. Leave from 16:30."
   - **Late arrival:** *first_in* later than *S*+*g* (to the second) → **Late**; late minutes =
     *first_in* − *S* (the whole delay from the shift start, cut down). IN 09:30:00 is on time; IN
     09:30:01 is late 30. Beyond grace the delay is counted from *S*, not from *S*+*g*.
   - **Early exit** (complete days only): *last_out* earlier than *E*−*g* (to the second) → **Early
     exit**; minutes = *E* − *last_out*. OUT 16:30:00 is not early; OUT 16:29:59 is early 31 minutes.
   - **Worked for status** *WS* (used only to choose Present / Half-day / Short hours; accepted by the
     lead on 2026-10-30, who also used it as the model for temporary workers' payable minutes):
     1. Start point *A* = *S* when *first_in* ≤ *S*+*g* (an IN inside grace counts as the shift start;
        **arriving before *S* also counts from *S***, so early arrival neither helps nor hurts the
        status); otherwise *A* = *first_in* (the real minutes count).
     2. End point *B* = *E* when *last_out* ≥ *E*−*g* (an OUT inside grace before the end counts as the
        shift end; staying after *E* does not add to the status); otherwise *B* = *last_out*.
     3. *WS* = *B* − *A*, whole minutes cut down, never below 0 and never above *L*.
     - Examples (09:00–17:00, g = 30): IN 09:25 / OUT 17:00 → *A* 09:00, *B* 17:00 → *WS* 480 (a full
       day, though *W* is 455); IN 09:40 / OUT 17:00 → *A* 09:40 → *WS* 440 (7 h 20 m of 8 h);
       IN 09:00 / OUT 16:20 → *B* 16:20 → *WS* 440; IN 09:25 / OUT 16:35 → both inside grace → *WS* 480.
   - **Status** of a complete day (rule 7):
     - *WS* = *L* → **Present** (full day);
     - *H* ≤ *WS* < *L* → **Half-day**;
     - *WS* < *H* → **Short hours** (a separate status: not Absent, not Half-day, not Present). The Super
       Admin decides such a day later with a `set_status` correction (present, half-day or absent, rule
       12); until then it is listed in the exceptions report, counted in the dashboard "Exceptions" and
       in the "undecided Short-hours days" count that M7 reads (rule 23).
     - Late and early exit beyond grace therefore usually make the day a Half-day (the real minutes
       count); they are also reported as Late / Early exit.
   - **Absent** = no counting punch at all on a closed working day, no leave, not a holiday or weekly
     off (with leave → **Leave**, rule 12).
   - Shift limits: `0 ≤ half_day_min < L` and `0 ≤ grace_min ≤ 120` (`SHIFT_DAY_LIMITS_INVALID`),
     checked when a shift is saved and when its times change.

10. **Temporary workers** (client call: one IN and one OUT per shift for them too).
    - **Hours** = *W* = *first_in* to *last_out* (rule 9, whole minutes), stored and shown as the raw
      time inside. No break logic. No worked-for-status, no half-day, no short hours, no late, no early
      exit, no grace rule.
    - **Payable minutes** *P* (lead, 2026-10-30): **paid time counts from the shift start, not from an
      earlier IN, and stops at the shift end unless overtime is counted.**
      - start = max(*first_in*, *S*) (arriving after *S* counts from the real IN; no grace for payment);
      - end = *last_out* when the day has overtime (rule 11: at least `overtime_min_minutes` after *E*),
        otherwise min(*last_out*, *E*);
      - *P* = end − start, whole minutes cut down, never below 0.
      - So time after the shift end that does **not** reach the 2-hour minimum is **not paid** (T4);
        when overtime is reached, *P* runs to the last OUT and **includes** the overtime minutes; M7 pays
        *P* − OT at the hourly rate and OT at the overtime rate (never twice).
    - *P* is stored as `attendance_days.payable_min` for **every** employee (also permanent ones, same
      formula, for information); M7 reads it for temporary workers and never recomputes it. It is shown
      next to the hours: "Hours 9 h 30 m · payable 8 h 00 m (09:00–17:00)". Incomplete days have *P* 0.
    - Status on a working day: complete day → **Present** (with its hours, however short); no counting
      punch → **Absent**; latest event an IN, or only OUTs → **Incomplete** (hours 0).
    - **Overtime** by the same rule as everyone (rule 11), using the shift of the worker.

11. **Overtime** (client call of 2026-10-30; replaces "overtime after N minutes").
    - **Overtime starts right at the shift end** *E*. **No grace applies to overtime.**
    - Let *C* = *last_out* − max(*E*, *first_in*), whole minutes cut down (only when *last_out* is after
      *E*). Normally *first_in* is before *E*, so *C* = *last_out* − *E*; the max only matters for
      someone who first comes in after the shift end.
    - Let *m* = the shift's **`overtime_min_minutes`** (default **120**: overtime counts only from
      2 hours).
    - **Overtime minutes** = *C* when *C* ≥ *m*, else **0**. Once the minimum is met, the **whole**
      amount from the shift end counts (not only the part above the minimum). *m* = 0 counts every
      minute after the shift end.
    - Examples (Office 09:00–17:00, m = 120): OUT 18:50 → *C* 110 → OT **0**; OUT 18:59 → 0; OUT
      19:00 → *C* 120 → OT **120**; OUT 19:10 → *C* 130 → OT **130** (2 h 10 m, counted from 17:00).
    - Only **complete** days earn overtime (an incomplete day has 0). OUT before the shift end has none.
    - **Setting design (per shift, not company-wide, and `ot_after_min` removed):**
      - `overtime_min_minutes` is a field of the **shift** (and of its rule versions), edited by the
        Super Admin in the shift form. Why per shift: the client said each shift sets its own overtime
        rule (follow-up answers, Q5); a night shift may differ; and because shift rules are versioned
        by date, an old register never changes when the number changes. A company-wide setting would
        change past days at the next recompute.
      - `ot_after_min` ("minutes after shift end before overtime starts") is **removed**: with overtime
        starting at the shift end it would always be 0, and two overtime numbers on one form would only
        confuse. The migration records its old value 480 in the audit log (§6). If the lead prefers to
        keep the column at 0, nothing else in this rule changes.
    - **Worked on a weekly off or a holiday** (lead, 2026-10-30: the **normal** overtime rule applies):
      - status Present with day kind weekly off / holiday, shown as **"Worked on weekly off"** /
        **"Worked on holiday"** (register codes WO-W / H-W);
      - hours *W* = first IN to last OUT; payable *P* as rule 10 (from the shift start of the
        employee's shift on that date);
      - overtime **only by the normal rule**: from the shift end of that date, and only when it is at
        least `overtime_min_minutes` (2 h). Example: Sunday IN 10:00, OUT 14:00 → hours 4 h, OT 0;
        Sunday IN 09:00, OUT 19:30 → hours 10 h 30 m, OT 150 (19:30 − 17:00);
      - no late, early exit, half-day, short-hours or grace rule; M7 decides how off-day hours are paid
        (it can see the day kind);
      - incomplete on such a day → Incomplete, 0.
    - Overtime is shown in minutes and `HH:MM`; no rounding in M5 (rounding rules belong to M7 if the
      client asks). No overtime approval in M5 (F-8 is Later).

12. **Leave, corrections and their effect** (lead decisions 5, 6).
    - **Leave:** on a working day with no events → status **Leave** (paid or unpaid, register PL / UL).
      Weekly offs and holidays inside a leave range keep their own status and are not leave days.
      Events on a leave day → the status comes from the events and the day gets exception
      `PUNCHES_ON_LEAVE` (the leave record stays; the Super Admin decides whether to cancel it).
      Overlapping active leave for one employee is refused (`LEAVE_OVERLAPS`). Range at most 92 days,
      inside the employment dates. Leave may be entered for future dates.
    - **Correction kinds:**
      - `add_punch` (a missing IN or OUT at a time);
      - `add_in_out` (IN and OUT times: a whole day without punches, e.g. the gate device was broken; this
        is also the "office-verified" case, see F-44 in §12);
      - `ignore_punch` (a counted punch is not used for this day, e.g. a wrong early IN made while
        passing the gate that would stretch the hours; the punch still exists and still counts for IN/OUT
        decisions at the gate);
      - `set_status` (permanent employees only: present, half-day or absent; **the way the Super Admin
        decides a Short-hours day**, and also e.g. official duty outside the plant without punches;
        worked minutes and overtime are not changed by it);
      - `reverse` (Super Admin only: cancels an approved correction; made directly).
    - **Validation** (on request and again on approval):
      - the day exists (rule 3), is not in the future, and is not `open` for `set_status`;
      - times are not in the future and lie inside the day's window, except an OUT that may go up to
        the open IN + `open_in_max_hours` (carry-over); else `CORRECTION_TIME_OUTSIDE_DAY`;
      - an added time within `punch_cooldown_minutes` of a counted punch or another approved added time
        of the same person → `CORRECTION_NEAR_PUNCH` (the punch already covers it);
      - `ignore_punch` needs a punch that counts for E in that day (`CORRECTION_PUNCH_NOT_COUNTED`);
      - `set_status` for a temporary worker → `CORRECTION_KIND_NOT_FOR_TEMPORARY`;
      - the same kind with the same values already pending for that day → `CORRECTION_DUPLICATE`;
      - requests (Corporate Head, Plant Head) only for days up to `correction_request_max_days` back
        (default 31) → `CORRECTION_TOO_OLD`; the Super Admin has no age limit (after joining).
      - On approval the checks run again against the current day; a failure gives
        `CORRECTION_NO_LONGER_VALID` with the reason code, and the Super Admin rejects it instead.
    - **Apply order:** approved corrections of a day are applied in approval time order: ignores first,
      then added events, then first IN / last OUT (rules 6–7), then `set_status` last (the latest wins).
    - **Never double:** if an M4 approval later makes a rejected punch count close to an added time
      (within the cool-down), the day gets the note `POSSIBLE_DOUBLE_ENTRY`; the first IN and the last
      OUT are used as usual, so hours are never counted twice. The timeline shows both, so the Super
      Admin can reverse one.
    - **Append-only:** a request is never edited; the requester withdraws and asks again. Every request,
      decision, withdrawal and reversal writes an audit row in the same transaction.
    - **Notifications:** a new request notifies the Super Admins; a decision notifies the requester.

13. **Super Admin direct correction.** Same kinds and checks, reason required; stored as a request
    with `is_direct` and an `approved` decision by the same user in one transaction; audit
    `attendance_correction.direct`.

14. **Stored attendance days: when they are computed** (design choice, why below).
    - **One pure function** `compute_attendance_day(inputs, now) → result` with no database access:
      inputs = shift rules, window, events, leave, holiday, weekly off, employee type, corrections;
      `now` is passed in. All rules 5–12 live there. Tests call it directly with fixed dates.
    - A **loader** gathers the inputs (bulk queries; counting via `counting.py`) and a **writer** upserts
      the row with `stale = false`, `calc_version`, `computed_at`.
    - **Marking stale** (in the same transaction as the cause, one cheap upsert per affected day):
      a counted punch decision or an M4 review (days D−1 and D of its punch time: carry-over), a
      correction decision or reversal, leave add / cancel (its range), holiday add / cancel (that date,
      its plants), weekly-off or shift-rule version (from its date for the plant / shift), shift
      swap added or cancelled (that date and the day before: windows), shift assignment, plant transfer, marked left / reactivated, joined date edited (from the earliest
      changed date), attendance start date changed, and the setting `attendance_window_before_hours`
      (the last 62 days of all plants).
    - **Recomputing:** (a) right after the response, the request recomputes the days it marked
      (FastAPI background task, so the punch answer stays under 2 s, NFR-01); (b) a **5-minute
      catch-up job** recomputes stale rows (batches of 500) and runs once at start-up (Render sleeps);
      (c) the **nightly job** (00:05 IST) closes the previous day: it creates rows for every active
      employee for each date since the last closed date (catching up after a sleep) and recomputes
      them; (d) **every read** (screens, reports, insights) first recomputes the stale or old-version
      rows in its range (so a screen is never wrong, only slower). Changing `ATTENDANCE_CALC_VERSION` in
      code makes every row "old" and the catch-up job recomputes them.
    - **Why stored, not computed on every read:** a monthly register of a plant (up to 650 people × 31
      days) and the punctuality analytics would otherwise rebuild about 20,000 days from punches on
      every click, which is too slow on Render Free (0.1 CPU, 512 MB). Storing makes reads a simple
      indexed query, and reports are consistent with the screens. Because the true records (punches,
      reviews, corrections, leave, holidays, rule versions) are append-only, any row can be rebuilt at
      any time; the recompute tool (§5.1) and the self-check idea (S-44) rely on that.
    - **What is not stored:** the live numbers (inside now, muster) are computed on read from counted
      punches (rule 17), because they must be exact to the second.

15. **Register codes** (screens and files; translation keys `attendance.codes.<CODE>`):
    | Code | Meaning |
    |---|---|
    | P | Present (permanent: the whole shift, grace forgiven; temporary: a complete day) |
    | HD | Half-day (permanent) |
    | SH | Short hours (permanent: less than the half-day limit; waits for the Super Admin's decision) |
    | A | Absent (no counting punch on a working day) |
    | INC | Incomplete (OUT missing, or IN missing) |
    | PL / UL | Paid leave / Unpaid leave |
    | WO / H | Weekly off / Holiday |
    | WO-W / H-W | Worked on weekly off / Worked on holiday (hours shown; overtime only by the normal 2-hour rule) |
    | – | Not employed or before the attendance start date |
    Open days (today) show "IN" (inside), "OUT" (left) or "…" (not arrived) on screens only; files
    never contain open days unless the period includes today, where they are marked "Day not finished".

16. **Settings** (Super Admin edits; others read; `CURRENT_MILESTONE` = 5).
    | Key | Group | Default | Range | Used for |
    |---|---|---|---|---|
    | `attendance_window_before_hours` | attendance | 4 h | 1–8 | rule 5 |
    | `correction_request_max_days` | attendance | 31 days | 1–92 | rule 12 (requests only) |
    | `still_inside_alert_minutes` | alerts | 60 min | 15–240 | F-4, rule 19 |
    | `rejection_alert_count` | alerts | 10 | 3–100 | many rejections alert (FR-41) |
    | `rejection_alert_minutes` | alerts | 30 min | 5–240 | the time span of that count |
    | `email_alerts` | alerts | `off` | `on` / `off` | rule 20 (has no effect and is shown as "Email is not set up" while the SMTP variables are unset) |
    | `notification_keep_days` | alerts | 90 days | 30–365 | purge of old notifications |
    | `absence_streak_days` | alerts | 3 working days | 2–10 | F-62, rule 20 |
    | `kiosk_show_inside_count` | kiosk_screen | `on` | `on` / `off` | F-28, rule 29 |
    | `kiosk_late_hint` | kiosk_screen | `off` | `on` / `off` | F-37, rule 29 |
    | `kiosk_show_month_line` | kiosk_screen | `off` | `on` / `off` | F-2, rule 29 |
    Not in the settings table (they belong to one plant or one shift): weekly off and attendance start
    date (plant); **grace (`grace_min`, default 30), half day (`half_day_min`, default 240) and the
    smallest overtime (`overtime_min_minutes`, default 120)**, edited by the Super Admin per shift in
    the shift form and saved as shift rule versions (the full day is the shift length, never a
    setting; `ot_after_min` is removed). Existing keys used by M5: `open_in_max_hours`,
    `punch_cooldown_minutes`, `min_minutes_before_out` (the gate's earliest OUT after an IN; see §14
    question 1). Cross-check: `attendance_window_before_hours`
    must be below 24 − the longest shift length of any active shift (`SETTING_INVALID`, so a window
    cannot start before the previous shift ended).

17. **Inside now, dashboard and muster** (FR-33, FR-34, decision 9).
    - **Inside now** = active employees (not left) whose latest counted punch (rule 2) within the last
      `open_in_max_hours` is an **IN**, at the plant of that punch. Computed on read in one bulk query.
      **Amended 2026-10-31 by M4b (lead approved):** an IN whose punch carries the flag `OUTSIDE_PLANT`
      (phone punch outside every plant fence) is **not** inside any plant: it is left out of "Inside now"
      and the muster. The dashboard shows a small line **"On outside work: N"** (same bulk query, no extra
      list; a named "On outside work" muster section is F-81, Later). For a phone punch made inside a plant
      fence, "the plant of that punch" is the plant where the person stands (`punches.location_plant_id`,
      M4b §7 rule 22).
    - **Expected today** = active employees of the plant whose today's day kind is working and who are
      not on leave today (for all of today's shifts). **Arrived** = expected with a counted IN in
      today's window. **Late** = arrived permanent employees past shift start + grace. **Not arrived
      yet** = expected, no IN, and their shift start + grace has passed (later shifts are "Shift not
      started" and not counted). **Exceptions** = yesterday's incomplete days + undecided Short-hours
      days + days with an unchecked flagged punch (Super Admin) + pending corrections of the plant.
    - **Polling:** the dashboard fetches every **30 seconds** (TanStack Query `refetchInterval`), not
      SSE: Render Free has 512 MB and sleeps, and long-lived connections would keep it awake and use
      memory per open tab (lead decision 9). The answer for one plant is built in under 500 ms on the
      server (§10 AC-27).
    - **Muster:** the same "inside now" list with names; sorted by department, then name. **Cached
      copy:** the muster page stores the last list in the browser (localStorage, key per user, with
      its time) for at most **12 hours**; it is removed at logout and when older than 12 hours. Without
      connection the page shows the cached list with its time (FR-34 "works from cached data"). No
      other M5 page caches personal data in the browser.
    - Each muster PDF download writes audit `muster.download` (plant, count, no names).

18. **Reports** (FR-35). All are built from `attendance_days` (after rule 14 (d)) and, for the punch
    reports, from `punches` through `counting.py` and `punch_reviews`.
    | Kind | Period | Content (one row per…) |
    |---|---|---|
    | `daily-muster` | one day | employee: code, name, type, department, category, contractor, shift, status, IN (first), OUT (last), worked (first IN to last OUT), worked for status (permanent), late, early exit, overtime, extra punches, marks |
    | `register` | one month | employee × days grid with codes (rule 15) + totals; a corrected cell carries "*" and the legend says "* corrected: see the corrections log" |
    | `contractor-hours` | one month | temporary worker grouped by contractor: days present, incomplete days, total hours (each day = first IN to last OUT), overtime hours (only days with 2 h or more after the shift end, rule 11), per-day hours columns; subtotal per contractor; "No contractor" group last. **No rates, no money** |
    | `late-early-overtime` | ≤ 31 days | permanent employee-day with late, early exit or overtime > 0 (temporary: overtime only); totals per employee |
    | `exceptions` | ≤ 31 days | Short-hours day not yet decided, or day with an exception (`OUT_MISSING`, `OUT_WITHOUT_IN`, `PUNCHES_ON_LEAVE`, `SHIFT_CHANGE_SHORT_DAY`) or an unchecked flagged punch; with plain-English text. The information notes `EXTRA_PUNCHES` and `POSSIBLE_DOUBLE_ENTRY` are listed in a separate "Notes" section of the same report |
    | `rejected-punches` | ≤ 31 days | rejected punch: time (IST), plant, attendance device, method, reason text (`punches/reasons.py`), employee if named, review state (approved / not accepted / none). No photos, no coordinates, no scores |
    | `corrections` | ≤ 31 days | correction request and decision, reversals, **and** M4 punch approvals / not-accepted reviews: employee, date, what changed, reason, requested by, decided by, times. (Review reasons only in the Super Admin's file) |
    - **Every file** (first rows of Excel, header of every PDF page): "Sheet Shapers – Upasthiti",
      report title, plant (code and name, or "All plants"), period, **generated at** (DD/MM/YYYY HH:mm
      IST), **generated by** (name and role), filters used, "Demo plants included" when they are, and a
      PDF footer "Page x of y". Excel: one sheet per plant for "all plants" files plus a "Summary"
      sheet; frozen header row; dates as real dates, minutes as numbers plus `HH:MM` text columns.
    - **Excel safety:** every text cell is written as a string (never a formula); text starting with `=`,
      `+`, `-`, `@` is written as text (no formula injection). XlsxWriter in constant-memory mode.
    - **PDF:** fpdf2 with the bundled Inter font (M2), A4 landscape for the register and contractor
      hours, A4 portrait otherwise; at most 3,000 rows (`REPORT_TOO_LARGE`; Excel has no such limit).
    - **Limits:** one report at a time per user (`REPORT_BUSY`), 20 files in 10 minutes per user, a
      30-second time budget per file (then `INTERNAL_ERROR` with a log line; the plan measures real
      times, AC-30).
    - Every download writes audit `report.download` (kind, format, plant, period, row count; no names).

19. **Still-inside safety alert (F-4).** The 5-minute alert job finds, per plant, people whose day has
    an open IN and whose shift end (+ `still_inside_alert_minutes`, default 60) has passed. It creates
    one `still_inside` notification per plant per shift day (dedupe key plant + date + shift),
    severity urgent, text "2 people are still inside K134, 1 hour after the shift ended", link to the
    muster filtered to them; the count is updated while open and the notification is resolved when
    nobody is left. Overtime workers legitimately inside also appear (the alert asks to check, it
    accuses nobody). Recipients: Super Admin, Corporate Head (read), the plant's Plant Head.
    **Amended 2026-10-31 by M4b (lead approved):** a day whose open IN is an `OUTSIDE_PLANT` punch is not
    part of this alert (the person is not inside a plant).

20. **Notification centre and email (F-7, FR-41).**
    - Kinds and triggers: `device_offline` (the M4 F-46 rule, now also stored, one per device
      outage), `still_inside` (rule 19), `many_rejections` (at one attendance device, at least
      `rejection_alert_count` rejected punches (not counting `COOLDOWN_ACTIVE`, decision 0027 item 3)
      within `rejection_alert_minutes`), `incomplete_days` (07:00 IST, yesterday's incomplete days per
      plant), `review_digest` (Super Admin, 07:00 IST, the M4 F-48 numbers), `correction_requested`
      (Super Admins), `correction_decided` (the requester), **`absence_streak`** (F-62: at 07:00 IST, a
      permanent employee whose last `absence_streak_days` (3) closed working days are all **Absent**,
      i.e. no counting punch and no leave; Short-hours, Incomplete, leave, weekly-off and holiday days
      are not absences and break the streak; one notification per person per streak, plant scope),
      **`monthly_register`** (F-65: on the 2nd of each month at 07:00 IST, "The register of October 2026
      is ready", per plant, with a link to the download).
    - Generated by the 5-minute alert job (also at start-up) and inline for the correction kinds;
      dedupe keys make repeats harmless.
    - **Who sees what:** by role and plant scope (rule 1), computed on read; names are looked up on
      read in the reader's scope, never stored in the notification.
    - **The bell is the main channel** (lead, 2026-10-30). **Email** happens only when the server has the
      SMTP variables (§8.2, e.g. on the client's own server), the setting `email_alerts` is `on`, and the
      user switched email on for that kind and has an email address. **With the SMTP variables unset**
      (the free tiers) email is **silently off**: nothing is queued, nothing is logged as an error, the
      switches are hidden and the screens say "Email is not set up on this server". No other email
      service is ever used. Email text is short and **has no personal names or codes**: "Upasthiti: 2
      people still inside K134 at 18:00. Open https://…/admin/muster". Sent once per user per
      notification (`notification_deliveries` unique); failures are logged (`email.failed`, no address
      in the log) and not retried more than 3 times.
    - **Monthly register email (F-65), SMTP only:** users who switched it on get the previous month's
      **register (Excel) of the plants in their scope** as an attachment on the 2nd (one email per
      plant; Plant Head: own plant only; demo plants never). The file is the same as the `register`
      report (rule 18) with "generated by: Upasthiti (scheduled)"; above 5 MB the email carries only the
      link. Each sending writes audit `report.emailed` (kind, plant, month, number of recipients; no
      addresses). The email body warns: "The file contains personal data. Keep it on company computers."
    - Notifications older than `notification_keep_days` are deleted by the nightly job.

21. **Punctuality analytics (F-9).** From `attendance_days` of **permanent** employees on **working**
    days with an IN: on-time % = days not late ÷ days with an IN; average late minutes over late days;
    weekly series (Monday-start weeks); group by department, category, shift or weekday; top 10 late.
    Demo plants excluded by default; range ≤ 92 days.

22. **Worked examples** (all IST; these are also the golden test cases, S-39).
    Shift **Office** 09:00–17:00 (L = 480 min = the full day), grace 30, half day 240 (4 h), smallest
    overtime 120 (2 h); window N = 4 h (05:00 to 05:00 the next morning). Shift **Night** 19:00–07:00
    (crosses midnight, L = 720), grace 30, half day 240, smallest overtime 120; window 15:00 to 15:00.
    Plant weekly off Sunday. 30/10/2026 is a Friday; 31/10 Saturday; 01/11 Sunday; 02/11 Monday. *W* =
    worked (first IN to last OUT); *WS* = worked for status (rule 9). On time until 09:30; leave from
    16:30.

    **Permanent employees, Office shift, Friday 30/10 unless stated**
    | # | Events | Result |
    |---|---|---|
    | E1 | IN 09:25, OUT 17:00 | IN inside grace counts as 09:00: *WS* 480 → **Present** (a full day); late 0; early exit 0; *W* 7 h 35 m (455); OT 0 |
    | E2 | IN 09:00, OUT 17:00 | *WS* 480 → **Present**; *W* 480 |
    | E3 | IN 09:30:00, OUT 16:30:00 (both exactly on the grace edge) | *WS* 480 → **Present**; late 0; early exit 0; *W* 420 |
    | E4 | IN 09:40, OUT 17:00 | Beyond grace, real minutes count: *A* 09:40, *WS* 440 (**7 h 20 m of 8 h**) → **Half-day**; **late 40**; *W* 440; OT 0 |
    | E5 | IN 09:00, OUT 16:20 | *B* 16:20, *WS* 440 → **Half-day**; **early exit 40**; *W* 440 |
    | E6 | IN 08:40, OUT 17:00 (arrives early) | Counts from 09:00: *WS* 480 → **Present**; *W* 8 h 20 m (500); OT 0 (overtime only after 17:00) |
    | E7 | IN 09:00, OUT 12:50 | *WS* 230 < 240 → **Short hours** (not Absent, not Half-day); early exit 250; waits for the Super Admin's `set_status` |
    | E8 | IN 09:00, OUT 13:00 | *WS* 240 = the half-day limit → **Half-day** |
    | E9 | IN 09:00, OUT 18:50 (**1 h 50 m** after the shift end) | **Present**; *W* 590; *C* 110 < 120 → **OT 0** |
    | E10 | IN 09:00, OUT 19:10 (**2 h 10 m** after the shift end) | **Present**; *W* 610; *C* 130 ≥ 120 → **OT 130 (2 h 10 m, counted from 17:00)** |
    | E11 | IN 09:00, OUT 19:00, and the same with OUT 18:59 | OUT 19:00: *C* 120 → OT 120; OUT 18:59: *C* 119 → OT 0 |
    | E12 | IN 09:02; OUT 12:30 (stepped out, 3 h 28 m after the IN, so a real OUT); punches at 13:00 and 17:05 | The 13:00 and 17:05 punches are **refused `SHIFT_ALREADY_CLOSED`**. Day = 09:02–12:30: *W* 208, *WS* 210 → **Short hours**. The Super Admin approves the 17:05 punch as OUT in "Needs review": last OUT 17:05, the 12:30 OUT becomes **1 extra punch** (note) → *W* 483, *WS* 480 → **Present**; OT 0 |
    | E13 | IN 09:02, no OUT | **Incomplete** (OUT missing); *W* 0; OT 0; late 0; counts as present for headcount history. After an approved `add_punch` OUT 17:05: **Present**, *W* 483, OT 0 |
    | E14 | IN 09:00, OUT 17:00; punch 30/10 20:00; punch 31/10 09:00 | 20:00 is in the same shift day → **refused `SHIFT_ALREADY_CLOSED`** ("Your shift is already closed. Please visit the plant office."); 30/10 stays **Present**; the 31/10 09:00 punch is in the next day's window (from 05:00) → **accepted as IN** |
    | E14b | IN 09:00, punch 09:29 | **Refused `OUT_TOO_SOON`** (less than 30 minutes after the IN); the day keeps its IN; a punch at 09:30 or later would be the OUT |
    | E15 | no counting punch, no leave | **Absent** |
    | E16 | **Sun 01/11** (weekly off): IN 10:00, OUT 14:00 | **WO-W** (worked on weekly off); *W* 240; payable 240; **OT 0** (normal rule: OUT before 17:00); no late |
    | E16b | **Sun 01/11**: IN 09:00, OUT 19:30 | **WO-W**; *W* 630; *C* 150 ≥ 120 → **OT 150** (normal rule, from 17:00) |
    | E17 | **Tue 10/11** = holiday "Plant foundation day" (all plants, paid), no punches | **Holiday (H)** |
    | E18 | Paid leave Sat 31/10 – Mon 02/11, no punches | 31/10 **PL**; 01/11 **WO** (not a leave day); 02/11 **PL** → 2 leave days |
    | E19 | IN 29/10 10:00, OUT 30/10 05:30 (19 h 30 m later, after the 05:00 window end) | Carry-over: the OUT belongs to 29/10; *W* 1170; late 60; *WS* 420 (*A* 10:00, *B* 17:00) → **Half-day**; *C* 750 → OT 750; 30/10 has no `OUT_WITHOUT_IN` |
    | E20 | IN 09:00 and OUT 17:00 online; an offline punch made at 16:00 is synced after 17:00 | At sync the 16:00 punch sees only the IN before it → OUT, **flagged `SYNC_ORDER_CONFLICT`** (M4; not `SHIFT_ALREADY_CLOSED`, which looks only at punches before its own time). Day: last OUT 17:00 used, the 16:00 OUT is **1 extra punch**; **Present**; *W* 480; `uses_unchecked_flag` until the Super Admin confirms |
    | E21 | Rejected punch 09:04 (face did not match), approved in M4 as IN for this employee; OUT 17:00 | Counts through `counting.py` (decision 0029 D); 09:04 is inside grace → *WS* 480 → **Present**; *W* 7 h 56 m (476); late 0 |

    **Permanent employees, Night shift (19:00–07:00), day 29/10**
    | # | Events | Result |
    |---|---|---|
    | N1 | IN 29/10 18:55, OUT 30/10 07:00 | **One day: 29/10** (the shift start date); *WS* 720 → **Present**; *W* 12 h 05 m (725); late 0; OT 0 |
    | N2 | IN 29/10 19:25, OUT 30/10 07:00 | 19:25 is inside grace → not late; *WS* 720 → **Present**; *W* 695 |
    | N3 | IN 29/10 19:45, OUT 30/10 07:00 | **Late 45**; *A* 19:45, *WS* 675 (11 h 15 m of 12 h) → **Half-day** |
    | N4 | IN 29/10 19:00, OUT 30/10 09:20 | **Present**; *W* 860; *C* 140 (2 h 20 m after 07:00) ≥ 120 → **OT 140** |
    | N5 | A punch at 30/10 14:59, and one at 30/10 15:00 | 14:59 belongs to day 29/10; 15:00 starts day 30/10 |

    **Temporary workers, Office shift, Friday 30/10** (hours *W* = first IN to last OUT; payable *P* from
    the shift start; no half-day, no short hours, no late)
    | # | Events | Result |
    |---|---|---|
    | T1 | IN 09:00, OUT 17:00 | **Present**; hours **8 h 00 m** (480); payable 480; OT 0 |
    | T2 | IN 09:00, OUT 12:00 | **Present**; hours **3 h 00 m** (180); payable 180; no short-hours status |
    | T3 | IN 08:30 (early), OUT 19:30 | **Present**; hours **11 h 00 m** (660, shown); *C* 150 ≥ 120 → **OT 150 (2 h 30 m)**, so payable runs to the last OUT: **payable 10 h 30 m (630, 09:00–19:30)**; M7: 480 normal + 150 overtime |
    | T4 | IN 09:00, OUT 18:30 | Hours 9 h 30 m (570); *C* 90 < 120 → OT 0, so payable stops at the shift end: **payable 8 h 00 m (480, 09:00–17:00)**; the 90 minutes after 17:00 are **not paid** |
    | T5 | IN 09:20 (late, no grace for payment), OUT 17:00 | Hours and payable **7 h 40 m (460)**; no late mark for temporary workers |
    | T6 | IN 08:45 (early), OUT 18:00 | Hours 9 h 15 m (555); OT 0 (*C* 60); **payable 480 (09:00–17:00)**: both the early 15 minutes and the 60 minutes after the end are unpaid |

23. **Hand-over to M7: Short-hours and Incomplete days must be decided first** (lead, 2026-10-30).
    This is a **rule for the M7 salary estimate, not built in M5**:
    - The M7 salary run for a plant and month **refuses to start** (a clear error, planned name
      `SALARY_UNDECIDED_DAYS`, with the two counts in `details`) while any **undecided day** exists in
      that period:
      - a closed day whose status is still **Short hours** (no approved `set_status` correction has
        decided it as present, half-day or absent); or
      - a closed day whose status is still **Incomplete** (OUT missing or IN missing; no approved
        correction has completed it).
    - **What M5 provides:** the statuses, the corrections that decide them, the count of undecided
      Short-hours and Incomplete days per plant and period (`GET /attendance/undecided`, §5.1), the
      dashboard line "N days to decide (Short hours: x, Incomplete: y)" and the exceptions report.
      Nothing in M5 blocks anything.
    - M7 gets the final day statuses, paid / unpaid leave, paid holidays, worked minutes (raw), payable
      minutes (temporary workers' paid time from the shift start) and overtime minutes from
      `attendance_days`; it never reads punches.

24. **Gate rule "shift already closed"** (lead, 2026-10-30: the client wants only one IN and one OUT per
    shift). New rule file `app/antiproxy/rules/shift_closed.py`, server side, for every employee type.
    - **When it refuses:** the punch's direction (decided by `check_in_out`, M2/M4 §7 rule 5) is **IN**,
      and the employee's latest counted punch before this punch's time (`counting.py`, as `check_in_out`
      already loads it) is an **OUT**, and the counted IN that this OUT closed lies in the **same
      attendance day** as this punch. "Attendance day" = the window of rule 5 (shift start date, *N*
      hours before the shift start, the employee's shift rules on that date), using **`punch_time`**
      (the proven offline time for offline punches). Then: **REJECT `SHIFT_ALREADY_CLOSED`**.
    - Why "the IN that this OUT closed": with the carry-over of rule 6.4, an OUT at 05:30 that closed
      yesterday's day lies in today's window; it must not block today's IN.
    - **Where in the rule order** (M4 §7 rule 2; inserted right after the IN/OUT, cool-down and
      `OUT_TOO_SOON` rule, before the flag rules):
      - card: `read_card` → `kiosk_location` → `check_snapshot` → `check_qr_credential` →
        `check_in_out` (cool-down `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`, direction) → **`shift_closed`** →
        `impossible_travel` → `two_devices` → (offline only) `offline_time`;
      - face: request checks and face worker → `kiosk_location` → `FACE_RULES` → `check_in_out` →
        **`shift_closed`** → `impossible_travel` → `two_devices` → (offline only) `offline_time`;
      - the code path (`/punch/kiosk/code`) runs the same chain after the 1:1 match.
      - A double scan within the cool-down still gets `COOLDOWN_ACTIVE` first (it is checked earlier).
    - **Online and offline:** the same rule runs at sync with the item's punch time. An offline punch
      whose time is **after** the closing OUT in the same day is rejected at sync. An offline punch whose
      time is **before** a later-stored OUT is not affected by this rule (it only looks at counted
      punches before its own time) and keeps the M4 behaviour: an OUT with `SYNC_ORDER_CONFLICT` flag, or
      `COOLDOWN_ACTIVE`, as before. Unproven offline times use the clamped time of M4 §7 rule 8, as for
      every other rule. Punch rows already stored never change.
    - **Next shift day:** an IN whose time is in the next day's window is accepted normally (e.g. OUT
      30/10 17:00, IN 31/10 09:00 → IN; the Office window of 31/10 starts at 05:00).
    - **Speed:** one extra small query (the IN before the last OUT) and the shift-rule lookup; within
      NFR-01 (2 s); measured with the existing load test.
    - **Gate and texts:** §4.15. Reason code also in `punches/reasons.py`, the Excel export and the
      rejected-punch report.
    - **Review (M4):** the rejection names the employee, so the Super Admin **may approve** it in "Needs
      review" (M4 §7 rule 7, with a reason). The approve dialog **suggests OUT** (usual case: the person
      punched OUT by mistake earlier and this is the real end of the shift) and shows the OUT that closed
      the day. An approved punch counts with the chosen direction through `counting.py`; the attendance
      day still uses **first IN and last OUT** (rule 7): an approved OUT later than the closing OUT
      becomes the new last OUT and the earlier OUT becomes an extra punch (E12); an approved IN after the
      closing OUT makes the latest event an IN, so the day becomes Incomplete until a correction or
      another approval (the dialog warns about this).
    - **"Too soon to OUT" stays:** `min_minutes_before_out` (default **30** minutes, range 2–240,
      unchanged, lead's choice): a punch less than 30 minutes after a counted IN is refused
      `OUT_TOO_SOON` for card and face, online and offline (at sync with the punch time), so a worker is
      never marked OUT by accident just after the IN. M5 adds explicit tests for all four paths (AC-40).

25. **Retention: nothing is deleted in M5** (lead, 2026-10-30). The lead's view is to keep attendance
    records **1 year**, to be confirmed with the client later. M5 builds **no automatic deletion** of
    attendance days, punches, reviews, corrections, leave, holidays, shift swaps or the audit log
    (CLAUDE.md §5: never hard-delete attendance records). See §8.1 for why 1 year must be confirmed
    before any deletion is ever built.

26. **One-day shift swap (F-58).** The Super Admin moves one employee to another active shift **of the
    same plant** for one date (today or later), with a reason. For that date the swap replaces the
    shift assignment everywhere: day window (rule 5; the window of the day before ends where the swap
    day's window starts, so `SHIFT_CHANGE_SHORT_DAY` can apply), grace, half day, overtime, the
    still-inside alert, the dashboard's expected numbers and the gate rule of rule 24. A swap can be
    cancelled (reason) only before its day's window starts (`SHIFT_SWAP_STARTED`). One active swap per
    person per date. Audit `shift_swap.create`, `shift_swap.cancel`. Leave, holidays and weekly offs are
    unchanged by a swap (a swap on a weekly off makes it a "worked on weekly off" day only if the person
    punches).

27. **Bulk correction after a gate outage (F-59).** One request creates one ordinary correction row per
    person (same kinds, checks and approval path as rule 12; the Super Admin's are direct), sharing a
    `batch_id` and the reason. Limits: one plant, one date, 1–200 people. Every person is checked
    separately; anyone who fails a check (e.g. `CORRECTION_NEAR_PUNCH` because they did punch) is
    **skipped and listed**, never half-created; the preview shows exactly this before saving. "Approve
    all" (Super Admin) approves the pending rows of a batch one by one (each re-checked, failures listed);
    "Reverse batch" adds one `reverse` row per approved correction of the batch. Audit:
    `attendance_correction.bulk_request` / `.bulk_direct` (batch id, count, kind, plant, date) plus the
    usual per-row audit lines.

28. **Calendar heatmap (F-60) and "Explain this day" (F-61).** Both are read-only views of
    `attendance_days` and the day timeline; the explanation sentences are built on the server from the
    computed result (one translation key per sentence kind: late, on time, early exit, worked for
    status, overtime reached / not reached, payable time for temporary workers, extra punches, carry-over,
    corrected), so the text always matches the numbers. No new calculation.

29. **Gate lines (F-28, F-37, F-2).** Server-made numbers only; the gate never computes them.
    - F-28: `inside_now` = the plant's inside-now count of rule 17, added to the heartbeat / `/kiosk/me`
      answer when `kiosk_show_inside_count` is on. **Amended 2026-10-31 by M4b (lead approved):**
      `OUTSIDE_PLANT` INs are not counted (rule 17).
    - F-37: `late_minutes` = rule 9 late minutes of an accepted online IN of a permanent employee on a
      working day, only when beyond grace and `kiosk_late_hint` is on.
    - F-2: `month_days_present` = number of IST dates in the current calendar month with a counted IN of
      the person (`counting.py`), today included, only when `kiosk_show_month_line` is on. It is a count
      of punches, not of statuses (statuses may still change by corrections).
    - None of them is sent for a rejected punch, a self-test card or an offline item. All three are
      shown without a name, not spoken and not stored on the device (§4.16).

30. **Gate poster shift times** (lead, 2026-10-30). The M2 poster PDF lists every **active** shift of
    the plant with its **current** rules: "<name> <start>–<end>: on time until <start + grace>, leave
    from <end − grace>." (times in 24-hour IST; a night shift's end time is the next morning), plus the
    one-IN-one-OUT rule text of §4.17. Nothing is hard-coded; a shift change shows "Print the gate
    poster again" in the save message. Gate notices (F-25) get an optional "Use shift times" filler.

## 8. Security, privacy and compliance

### 8.1 Privacy and DPDP (Act 2023, Rules 2025); IT Act §43A
- **Data touched:** attendance results (times, minutes, statuses) of named employees; leave (paid /
  unpaid and a reason written by the Super Admin; the reason must not contain medical details: the
  dialog says "Do not write health details"); correction reasons; notification counts. **No face
  data, photos, coordinates, match scores, phone numbers or pay rates** appear in any M5 screen, file
  or email.
- **Purpose:** attendance records, wages input (M7), safety (muster, still-inside). No new purpose.
- **Minimisation:** reports carry code, name, type, department, category, contractor and the
  attendance fields only. Emails carry no names or codes. File names carry no names.
- **Retention (lead, 2026-10-30; §7 rule 25):** the lead's view is **1 year**, to be confirmed with the
  client. M5 builds **no automatic deletion** of attendance days, punches, reviews, corrections, leave,
  holidays or shift swaps. Attendance and muster registers under the Labour Codes and the Factories
  Act (and the state rules under them) are **commonly kept for 3 to 5 years**, so 1 year must be
  confirmed with the client's HR or legal advisor at the **M6 handover** before any deletion is ever
  built. Muster cache in the browser: 12 hours, removed at logout. Notifications: 90 days (setting;
  alerts, not records).
- **Gate lines (F-28, F-37, F-2):** no name or code is ever shown; the month line and the late hint are
  off by default and shown only for the normal result time; nothing is spoken or stored on the device.
- **Monthly register email (F-65):** only through the client's own SMTP server, only to admins who
  switched it on, only their plant scope; audited; the body carries the personal-data warning.
- **Downloads:** every report and muster PDF download is audited (who, what, when; no names in the
  audit line). The Reports page says "Files contain personal data. Keep them on company computers."
  (`reports.privacyNote`).

### 8.2 Security
- **Role checks** per endpoint with the new capabilities (rule 1); plant scope in every query (a
  Plant Head's scope for a day = the employee's plant on that date); out-of-scope single records →
  `NOT_FOUND`.
- **Server decides the correction path** from the role (CLAUDE.md §5 rule on Corporate Head changes
  applies by analogy: a Corporate Head can never change attendance directly).
- **Concurrency:** approve / reject lock the regularisation row (`SELECT … FOR UPDATE`, no update);
  the unique decision row makes a second decision fail with `CORRECTION_NOT_PENDING`; leave entry locks
  the employee row; the recompute of one day runs under a per-employee advisory lock so two workers
  never write the same row at once.
- **Excel formula injection** prevented (rule 18). PDF text is plain (no HTML).
- **Gate rule `SHIFT_ALREADY_CLOSED`** (rule 24) is decided only by the server from counted punches and
  the server's punch time; the gate never decides it. Like every rejection it writes a punch row
  (append-only) and is visible in the punch log and "Needs review"; the gate answer carries only the
  code (no times of the earlier OUT, no name).
- **Rate limits:** reports (rule 18), muster PDF (10 per 10 minutes per user), recompute (5 per hour),
  test email (3 per hour).
- **New environment variables (all optional; email is off without them):** `SMTP_HOST`, `SMTP_PORT`
  (default 587), `SMTP_USERNAME`, `SMTP_PASSWORD` (never logged or shown), `SMTP_FROM`,
  `SMTP_SECURITY` (`starttls` default, or `ssl`; plain is refused when `APP_ENV` is production). Sent
  with Python's standard `smtplib` (no new package). `.env.example` gets the names with empty values.
- **Logs:** never names, codes, reasons or email addresses in log lines of the calculation, alerts or
  email; counts and ids only.

### 8.3 Audit (FR-40) – new actions
`leave.create`, `leave.cancel`, `holiday.create`, `holiday.cancel`, `plant.weekly_off_set`,
`plant.attendance_start_set`, `shift.rules_version_added`, `shift.rules_migrated` (migration),
`attendance_correction.request`, `attendance_correction.approve`, `attendance_correction.reject`,
`attendance_correction.withdraw`, `attendance_correction.direct`, `attendance_correction.reverse`,
`attendance.recompute`, `report.download`, `muster.download`, `settings.update` (existing),
`notification.test_email`, `user.email_alerts_changed`, `shift_swap.create`, `shift_swap.cancel`,
`attendance_correction.bulk_request`, `attendance_correction.bulk_direct`,
`attendance_correction.batch_approve_all`, `attendance_correction.batch_reverse`, `report.emailed`.
Before/after values as M1; correction and leave
reasons are hidden from roles that may not see them (as decision 0028 item 4 for review reasons: the
Corporate Head and Plant Head see correction reasons of their scope, because they request them, but
never M4 review reasons).

### 8.4 Labour Codes and record keeping
- The Code on Wages 2019 and the OSH Code 2020 expect employers to keep attendance / muster records and
  hours of work. M5 keeps: every punch (append-only, M2–M4), every review (M4), every correction
  request and decision (append-only, M5), leave and holidays (cancel, never delete), shift rule
  versions (so a past day is always computed with the rules of that day), and the audit log.
- The register marks corrected cells and the corrections log report lists who changed what and why.
- M5 does not claim to produce statutory forms (out of scope); the compliance-auditor reviews the
  report headers and the retention wording before approval.

## 9. Edge cases and error handling
Admin keys: `errors.<CODE>` (API errors), `attendanceExceptions.<CODE>` (day exceptions),
`attendance.codes.<CODE>`, `notifications.<kind>.*`. `npm run i18n:check` enforces every new code.
One new gate (attendance device) message: `kiosk.punch.SHIFT_ALREADY_CLOSED.*` (§4.15), plus
`punchReasons.SHIFT_ALREADY_CLOSED` and `errors.SHIFT_ALREADY_CLOSED`.

| Case | Expected behaviour | Error code | Message (English, i18n key) |
|---|---|---|---|
| Latest event of a closed day is an IN (no OUT after it) | Incomplete; worked and OT 0; exception; daily notification to the plant | – | "OUT missing. Ask for a correction." (`attendanceExceptions.OUT_MISSING`) |
| IN still open, day not closed (today) | Open, "Inside since 09:02"; not incomplete yet | – | `attendance.open.inside` |
| OUT after midnight for a day shift (long overtime into the night) | Carry-over rule 6.4 when within `open_in_max_hours` | – | timeline: `attendance.timeline.carryOver` |
| OUT events and no IN on the day | Incomplete (IN missing); not used for hours | – | "IN missing. Ask for a correction." (`attendanceExceptions.OUT_WITHOUT_IN`) |
| Punch after the day's OUT in the same shift day (card or face, online or at offline sync) | Refused at the gate; punch row stored as rejected; approvable by the Super Admin (suggestion OUT) | `SHIFT_ALREADY_CLOSED` | Gate: "Shift already closed. Your shift is already closed. Please visit the plant office." (`kiosk.punch.SHIFT_ALREADY_CLOSED.*`); admin: "Shift already closed (punch after the day's OUT)" (`punchReasons.SHIFT_ALREADY_CLOSED`) |
| Second punch less than 30 minutes after the IN (card or face, online or offline) | Refused as before (M2); the IN stays | `OUT_TOO_SOON` | existing `kiosk.punch.OUT_TOO_SOON.*` |
| Worker called back in the evening after the OUT (e.g. an emergency job) | Refused `SHIFT_ALREADY_CLOSED`; the Super Admin approves the later punch as OUT (it becomes the last OUT, overtime by the normal rule) or adds a correction | `SHIFT_ALREADY_CLOSED` | as above |
| More than one IN or OUT counted on the day (only after an approval, or an offline punch synced late, M4 `SYNC_ORDER_CONFLICT`) | First IN and last OUT used; the others are **extra punches**: ignored for hours, status and overtime; a note, not an error | – | "1 extra punch was not used for the hours." (`attendanceExceptions.EXTRA_PUNCHES`) |
| Temporary worker arrives before the shift start | Hours shown from the real IN; payable minutes from the shift start | – | "Payable from 09:00." (`attendance.payableFrom`) |
| IN within grace (09:25 on a 09:00 shift) | Not late; counts as the shift start for the status | – | "On time until 09:30." (`attendance.tolerance`) |
| IN or OUT beyond grace (IN 09:40, OUT 16:20) | Late / Early exit; the real minutes count for the status | – | "Late 40 minutes." (`attendance.late`), "Left 40 minutes early." (`attendance.early`) |
| Overtime of 1 h 50 m when the minimum is 2 h | Overtime 0 (the minimum is not reached); at 2 h 10 m the whole 2 h 10 m counts | – | "Overtime counts only from 2 h after the shift end." (`attendance.overtimeMinimumHint`) |
| Worked for status < half day (3 h 50 m with a 4 h limit) | Status Short hours (not Absent, not Half-day); in exceptions until the Super Admin sets present / half-day / absent with a correction | – | "Short hours: less than half a day. The Super Admin decides this day." (`attendance.codes.SH`) |
| Late or early beyond grace | Usually Half-day (real minutes below the shift length) | – | "Half-day: 40 minutes of the shift missing." (`attendance.halfDayReason`) |
| Punches on a leave day | Status from punches; exception | – | "Punches on a leave day. Check the leave." (`PUNCHES_ON_LEAVE`) |
| Punches on weekly off / holiday | WO-W / H-W; hours = first IN to last OUT; overtime only by the normal rule (from the shift end, at least 2 h) | – | `attendance.codes.WO-W` |
| Holiday on the weekly off day | Holiday | – | – |
| Flagged punch not yet checked used in a day | Counted; flag icon; exceptions report | – | "Uses a flagged punch not yet checked." |
| Flagged punch later "not accepted" | Day recomputed without it (may become Incomplete) | – | – |
| Rejected punch approved in M4 for someone the punch row does not name | Counts for the approved person (counting.py) | – | – |
| Correction time near a counted punch | Refused | `CORRECTION_NEAR_PUNCH` | "A counted punch already exists at 17:02, 3 minutes away." |
| Correction time outside the day window | Refused | `CORRECTION_TIME_OUTSIDE_DAY` | "This time belongs to another day. Choose a time between 05:00 on 29/10 and 05:00 on 30/10." |
| Correction time in the future | Refused | `CORRECTION_TIME_IN_FUTURE` | "The time cannot be in the future." |
| Request older than 31 days (CH/PH) | Refused | `CORRECTION_TOO_OLD` | "Corrections can be requested for the last 31 days. Ask the Super Admin." |
| Plant Head requests for another plant's employee (or a day at another plant) | Refused | `NOT_FOUND` / `CORRECTION_NOT_ALLOWED` | "You can request corrections only for your plant." |
| Corporate Head tries to approve | Refused | `FORBIDDEN` | `errors.FORBIDDEN` |
| Same pending request twice | Refused | `CORRECTION_DUPLICATE` | "The same correction is already waiting." |
| `set_status` for a temporary worker | Refused | `CORRECTION_KIND_NOT_FOR_TEMPORARY` | "Temporary workers are counted by hours; add the IN and OUT instead." |
| `ignore_punch` on a punch that does not count | Refused | `CORRECTION_PUNCH_NOT_COUNTED` | "This punch does not count, so there is nothing to ignore." |
| Approve after the day changed (a real OUT arrived) | Refused | `CORRECTION_NO_LONGER_VALID` | "The day has changed since the request. Reject it or ask again." |
| Two Super Admins decide at once | Second gets 409 | `CORRECTION_NOT_PENDING` | "Someone already decided this request." |
| Reverse twice | Refused | `CORRECTION_ALREADY_REVERSED` | "This correction was already reversed." |
| Day before joining / after leaving / before attendance start | No day; requests refused | `ATTENDANCE_DAY_NOT_ACTIVE` | "This person has no attendance day on this date." |
| Date not a real date / far future | Refused | `ATTENDANCE_DATE_INVALID` | "Choose a valid date, not in the future." |
| Overlapping leave | Refused | `LEAVE_OVERLAPS` | "Leave already exists for part of these dates." |
| Leave range > 92 days or outside employment | Refused | `LEAVE_RANGE_INVALID` | "Leave can be up to 92 days, inside the employment dates." |
| Cancel a cancelled leave | Refused | `LEAVE_NOT_ACTIVE` | "This leave is already cancelled." |
| Holiday already on that date for a chosen plant | Refused | `HOLIDAY_EXISTS` | "There is already a holiday on 10/11/2026 for K134." |
| Holiday too far back / ahead | Refused | `HOLIDAY_DATE_INVALID` | "Choose a date within the last year or the next two years." |
| Weekly off from a past date | Refused | `WEEKLY_OFF_DATE_INVALID` | "The new weekly off can start today or later." |
| Shift rules from a past date | Refused | `SHIFT_RULE_DATE_INVALID` | "New shift rules can start today or later. Use corrections for past days." |
| Half-day limit not below the shift length (e.g. 8 h on an 8 h shift), grace over 120 minutes, or shift times changed so that a limit no longer fits | Refused | `SHIFT_DAY_LIMITS_INVALID` | "Half-day hours must be less than the shift length (8 h) and grace at most 120 minutes." |
| Old client still sends `ot_after_min` when saving a shift | Field ignored; the response no longer has it | – | – |
| Attendance start moved earlier when days exist | Refused | `ATTENDANCE_START_INVALID` | "The attendance start date can only move later once days exist." |
| Shift change leaves a very short day | Warning on save; exception on that day | – | `SHIFT_CHANGE_SHORT_DAY` |
| Employee transferred mid-month | Days before the transfer stay with the old plant (register, scope) | – | – |
| Employee marked left on 15th | Days after the 15th "–"; open IN before leaving → Incomplete | – | – |
| Report period too long | Refused | `REPORT_RANGE_TOO_LONG` | "Choose at most 31 days (one month for the register)." |
| PDF too large | Refused | `REPORT_TOO_LARGE` | "Too many rows for a PDF. Choose one plant or download Excel." |
| Second report while one is being built | Refused | `REPORT_BUSY` | "Your previous file is still being built. Please wait." |
| Recompute range too long | Refused | `RECOMPUTE_RANGE_TOO_LONG` | "Recalculate at most 62 days at a time." |
| Dashboard refresh fails | Last numbers kept, yellow line | – | `dashboard.live.stale` |
| Muster without connection | Cached list with its time; print works | – | `muster.offline` |
| Muster cache older than 12 h | Removed; "No saved list" | – | `muster.noCache` |
| Render asleep at 00:05 IST | Nightly job runs at start-up and closes every missed day | – | – |
| Test email without SMTP | Refused | `EMAIL_NOT_CONFIGURED` | "Email is not set up on this server." |
| SMTP rejects / port blocked | Logged; notification still in the bell | `EMAIL_SEND_FAILED` | "The email could not be sent. The alert is still in the bell." |
| Email alerts on without an email address | Refused | `EMAIL_ADDRESS_MISSING` | "Add an email address to your account first." |
| Demo plant data | Hidden unless the Super Admin switch is on | – | chip `demo.shown` |
| Clock edge: tests run at 23:59 or 00:01 IST | No effect: tests pass `now` and fixed dates (§11) | – | – |
| SMTP variables unset (free tiers) | Email silently off: switches hidden, no error logged, bell works | – | "Email is not set up on this server. Alerts are shown in the bell." (`notifications.emailNotSetUp`) |
| Shift swap for a past date, another plant's shift, the same shift or a person not active that day | Refused | `SHIFT_SWAP_INVALID` | "Choose today or a later date and another shift of this plant." |
| Second swap for the same person and date | Refused | `SHIFT_SWAP_EXISTS` | "This person already works another shift on that day." |
| Cancel a swap after its day started | Refused | `SHIFT_SWAP_STARTED` | "This day has already started. Use a correction instead." |
| Cancel a cancelled swap | Refused | `SHIFT_SWAP_NOT_ACTIVE` | "This shift swap is already cancelled." |
| Bulk correction for more than 200 people | Refused | `BULK_TOO_LARGE` | "Choose at most 200 people at a time." |
| Some people in a bulk correction fail a check | They are skipped and listed; the others are created | per person (e.g. `CORRECTION_NEAR_PUNCH`) | "38 corrections made, 2 skipped." (`corrections.bulk.result`) |
| Gate offline (F-28) | "Inside now" line hidden | – | – |
| Gate lines when switched off | Nothing extra shown or sent | – | – |
| Plant with more than 6 active shifts (poster) | First 6 listed, then "and N more shifts: ask the plant office" | – | `poster.moreShifts` |
| Register file over 5 MB for the monthly email (F-65) | Email carries the link only | – | – |

## 10. Acceptance criteria (Given / When / Then)
Dates are fixed (30/10/2026 is a Friday). "Office" and "Night" are the shifts of §7 rule 22.
- **AC-1 (E1–E15, E20)** Given the Office shift and the punches of examples E1–E15 and E20, when the
  days are computed with `now` = 31/10/2026 12:00 IST, then status, worked for status, late, early exit,
  worked, extra punches and OT equal rule 22.
- **AC-2 (night, N1–N4)** Given the Night shift, when IN 29/10 18:55 and OUT 30/10 07:00 are counted,
  then exactly one day exists, 29/10, Present, worked 725, OT 0; 30/10 has no event from them; IN 19:25
  is not late and is Present; IN 19:45 gives late 45 and Half-day; OUT 30/10 09:20 gives OT 140.
- **AC-3 (window, N5)** Given N = 4, a punch at 29/10 04:59 belongs to 28/10 and one at 05:00 to 29/10
  (Office); for Night, 30/10 14:59 belongs to 29/10 and 15:00 to 30/10.
- **AC-4 (carry-over, E19)** Given IN 29/10 10:00 and OUT 30/10 05:30, then the OUT is part of 29/10
  (worked 1170, OT 750), and 30/10 has no `OUT_WITHOUT_IN`; given OUT 30/10 06:10 (20 h 10 m later), it
  is **not** carried over.
- **AC-5 (temporary, T1–T6)** Given T3 (IN 08:30, OUT 19:30), then hours = 660, OT = 150, payable = 630
  (09:00–19:30), no late, no half-day; T2 is Present with 180 and has no Short-hours status; T4 has OT 0
  and payable 480 (stops at 17:00); T5 has hours and payable 460; T6 has payable 480.
- **AC-5b (one IN, one OUT)** Given any day with several counted punches (after approvals or an
  offline order conflict), then hours always equal last OUT minus first IN (never a sum of pieces); a
  day whose latest counted event is an IN is Incomplete even when an earlier OUT exists; a day with only
  OUTs is Incomplete (IN missing).
- **AC-6 (thresholds)** Given the 480-minute Office shift and half day 240, then worked for status 480 =
  Present, 479 = Half-day, 240 = Half-day, 239 = **Short hours**, and a working day with no counting
  punch = Absent; there is no `full_day_min` anywhere (column, API, setting or screen).
- **AC-6b (grace, 30 minutes)** On the 09:00–17:00 shift: IN 09:30:00 / OUT 16:30:00 = Present, not late,
  not early; IN 09:25 / OUT 17:00 = Present; IN 09:30:01 = late 30 and Half-day (*WS* 479); OUT 16:29:59
  = early exit 31 and Half-day; IN 09:40 / OUT 17:00 = Half-day with *WS* 440 (7 h 20 m); IN 08:40 /
  OUT 17:00 = Present (early arrival counts from 09:00).
- **AC-6c (Short hours decided)** Given E7 (Short hours), when the Super Admin applies `set_status`
  half-day with a reason, then the day shows HD with the corrected mark and leaves the exceptions
  report and the undecided count; a Corporate Head's request for it waits for approval.
- **AC-6d (undecided count, M7 hand-over)** Given three Short-hours days and one Incomplete day in a
  month, then `GET /attendance/undecided` returns `short_hours` 3 and `incomplete` 1, the dashboard shows
  "4 days to decide: 3 Short hours, 1 Incomplete", and after the Super Admin decides one Short-hours day
  and completes the Incomplete day the counts are 2 and 0. (M5 never blocks anything; the M7 refusal
  for either kind is tested in M7.)
- **AC-7 (late)** Given grace 30, IN 09:30:00 is on time and IN 09:30:01 is late 30 minutes (counted
  from 09:00); a Night IN at 19:30:00 is on time.
- **AC-8 (overtime minimum)** Given `overtime_min_minutes` 120 on the Office shift: OUT 18:50 → OT 0
  (E9); OUT 18:59 → 0; OUT 19:00 → 120; OUT 19:10 → 130 (the whole amount from 17:00, E10, E11); an
  incomplete day → 0; given the minimum changed to 0 from a later date, every minute after 17:00
  counts from that date only; no grace is applied to overtime (OUT 17:20 → 0 because 20 < 120, and with
  minimum 0 it would be 20, not 0).
- **AC-9 (incomplete, E13)** Given E13, then the day is Incomplete with worked 0 and OT 0, it counts in
  "Arrived" history, it is in the exceptions report, and a Plant Head of that plant sees the
  `incomplete_days` notification the next morning.
- **AC-10 (weekly off, E16, E16b)** Given Sunday weekly off, then E16 is WO-W with hours 240 and OT 0,
  and E16b is WO-W with hours 630 and OT 150 (the normal 2-hour rule from 17:00); a Sunday with no
  punches is WO, never Absent; one weekly off per plant (no per-employee weekly off exists in the API or
  the screens).
- **AC-11 (holiday, E17)** Given a holiday for all plants on 10/11, then every employee without punches
  is H; given a holiday only for plant B, plant A's employees are working.
- **AC-12 (leave, E18)** Given paid leave 31/10–02/11, then 31/10 PL, 01/11 WO, 02/11 PL; the leave
  list says 2 working days; punches on 02/11 make it Present with `PUNCHES_ON_LEAVE`.
- **AC-12b (shift form and migration defaults)** The shift form defaults are grace 30, half day 4 h,
  smallest overtime 120 and no "overtime starts after" field; saving half day equal to the shift length
  or grace 121 gives `SHIFT_DAY_LIMITS_INVALID`; the form shows "On time until 09:30. Leave from 16:30.".
- **AC-13 (counting)** Given a flagged IN, then the day uses it and `uses_unchecked_flag` is true; when
  the Super Admin marks it "not accepted", then the day is recomputed without it within one request.
- **AC-14 (approved rejected punch, E21)** Given a rejected face punch that names nobody and an M4
  approval as IN for employee X, then X's day uses it and nobody else's does.
- **AC-15 (single source)** Given random mixes of accepted, flagged, rejected, reviewed and
  `needs_code` punches, the bulk counting function and the single-employee function return the same
  counted punches and directions.
- **AC-16 (request → approve)** Given an Incomplete day at K134, when the K134 Plant Head requests
  `add_punch` OUT 17:05 with a reason and the Super Admin approves, then the day becomes Present, the
  punches table is unchanged (row count and contents), two audit rows exist (request, approve), the
  register cell shows "corrected" and the corrections log report lists both people.
- **AC-17 (reject)** Given a pending request, when the Super Admin rejects with a reason, then the day
  is unchanged and the requester gets a `correction_decided` notification with the reason.
- **AC-18 (roles)** A Corporate Head can request for any plant but `approve`, `reject`, `reverse`,
  leave, holidays, weekly off and shift rule changes return `FORBIDDEN`; a Plant Head gets `NOT_FOUND`
  for an employee of another plant and `CORRECTION_NOT_ALLOWED` for a day the employee spent at another
  plant.
- **AC-19 (direct and reverse)** Given the Super Admin adds `add_in_out` 09:00–17:00 directly with a
  reason, then it is approved at once (`is_direct`); when reversed with a reason, the day returns to the
  earlier result and both rows stay.
- **AC-20 (append-only)** UPDATE and DELETE on `regularisations`, `regularisation_decisions`,
  `shift_rule_versions` and `plant_weekly_offs` fail with the trigger error; DELETE on `leave_records`
  and `holidays` fails; cancel works once.
- **AC-21 (validation)** Each error of §9 for corrections is returned for its case (one test each).
- **AC-22 (punch approvals together)** Given an M4 approval and a correction on the same day, then the
  day timeline and the corrections screen show both, and the Corporate Head sees the approval without
  its reason.
- **AC-23 (shift rule versions)** Given Office rules changed from 05/11 (end 16:00, half day 300, grace
  15), then days up to 04/11 keep 09:00–17:00, grace 30 and half day 240 after a full recompute, and
  05/11 onwards use a 420-minute full day, grace 15 and half day 300.
- **AC-24 (migration)** Given a database at `0018` with shifts whose `grace_min` is 10 and `ot_after_min`
  is 480, when migrated, then every shift has `grace_min` 30 and `overtime_min_minutes` 120, the column
  `ot_after_min` is gone (an old client that still sends it is ignored), no `full_day_min` exists, one
  rule version per shift, an audit row `shift.rules_migrated` per shift (before and after values), and
  each plant a Sunday weekly off; every new table has RLS and `deny_all`.
- **AC-25 (stale and recompute)** Given a punch is accepted, then its days are marked stale in the same
  transaction and recomputed after the response; given the background step failed, the next read of
  that day recomputes it first; given `ATTENDANCE_CALC_VERSION` changes, the catch-up job recomputes old
  rows.
- **AC-26 (nightly catch-up)** Given the server slept from 29/10 22:00 to 01/11 09:00, when it starts,
  then days 29/10, 30/10 and 31/10 exist for every active employee (Absent / WO / H / Leave as
  applicable).
- **AC-27 (dashboard)** Given 650 fake employees and a day of punches, the live answer for one plant
  takes under 500 ms and for all plants under 1.5 s on the local test database; a new punch shows in
  "Inside now" on the next 30-second refresh (e2e with a shortened interval in test mode).
- **AC-28 (muster offline)** Given the muster page loaded once, when the network is cut (Playwright
  offline), then the list and its time still show with the offline line, and Print opens; after logout
  the cached list is gone.
- **AC-29 (reports)** For each of the seven kinds, Excel and PDF download for one plant and (Super
  Admin / Corporate Head) all plants; every file contains plant, period, generated at (IST) and
  generated by; a Plant Head gets only own-plant data; a name `=HYPERLINK(...)` appears as text, not
  as a formula.
- **AC-30 (report size)** The register of a 650-employee month builds as Excel in under 20 s and as PDF
  in under 30 s inside the 512 MB container, peak memory under 450 MB (CI `docker` job).
- **AC-31 (demo)** Given plant `DEMO1` with punches, then the dashboard, muster, attendance lists,
  insights, notifications and reports leave it out; with "Show demo plants" (Super Admin) it appears
  with the chip; for a Corporate Head `include_demo=true` changes nothing.
- **AC-32 (F-4)** Given an open IN on the Office shift and `now` = 18:00:01 (one hour after the shift end), then one `still_inside` notification
  exists for that plant; at 18:05 it is not duplicated; after the OUT it is resolved.
- **AC-33 (F-7 email)** Given SMTP variables pointing at a fake SMTP server in tests and a user with
  email alerts on, then one email is sent per notification, with no names or codes in it; a failure is
  logged without the address and the notification stays in the bell.
- **AC-34 (F-7 rejections)** Given 10 rejected punches (not `COOLDOWN_ACTIVE`) at one device within 30
  minutes, then one `many_rejections` notification appears for that plant.
- **AC-35 (F-9)** Given a month of fake data, the punctuality numbers equal a hand count on a small
  fixture (5 employees × 10 days).
- **AC-36 (responsive)** All new pages of §4 and the drawer and dialogs fit 360 px and 768 px without
  sideways page scrolling and are reachable from the phone menu (`responsive.spec.ts`); axe finds no
  serious issue.
- **AC-37 (i18n)** `npm run i18n:check` passes with every new `errors.*`, `attendanceExceptions.*`,
  `attendance.codes.*` and `notifications.*` key, and `kiosk.punch.SHIFT_ALREADY_CLOSED.*`,
  `punchReasons.SHIFT_ALREADY_CLOSED`, `errors.SHIFT_ALREADY_CLOSED`; the gate text ends with "Please
  visit the plant office."; no text people read says "kiosk".
- **AC-38 (time pinning)** The attendance test suite passes when the machine clock is set to 23:59 IST
  and to 00:01 IST (CI runs it once with a faked start time, §11).
- **AC-39 (shift already closed, E12, E14)** Given a counted IN 30/10 09:00 and OUT 30/10 17:00 on the
  Office shift, then a punch at 30/10 20:00 is rejected `SHIFT_ALREADY_CLOSED` for **card and face**,
  **online and at offline sync** (the offline item's proven time is 20:00); the gate shows "Your shift
  is already closed. Please visit the plant office."; a punch at 31/10 09:00 is accepted as IN. Night
  shift: OUT 30/10 07:00 closes day 29/10, a punch at 30/10 14:59 is rejected and one at 30/10 19:00
  (day 30/10) is accepted. A carry-over OUT 30/10 05:30 of day 29/10 does **not** block an IN at 30/10
  09:00. An offline punch whose time is before an already-stored closing OUT is not rejected by this
  rule (E20: flagged `SYNC_ORDER_CONFLICT` as in M4). A double scan within the cool-down still gets
  `COOLDOWN_ACTIVE`. The rule runs after `check_in_out` and before `impossible_travel` (order test).
- **AC-40 (too soon to OUT, all paths)** Given a counted IN at 09:00 and `min_minutes_before_out` 30,
  then a punch at 09:29 is rejected `OUT_TOO_SOON` and a punch at 09:30 is accepted as OUT, for card and
  face, online and offline (offline: the sync decides by the proven punch time, not the sync time).
- **AC-41 (review of a closed-shift punch, E12)** Given E12, when the Super Admin opens the 17:05
  rejected punch in "Needs review", then the suggested direction is OUT and the closing 12:30 OUT is
  shown; after approving it as OUT with a reason, the day becomes Present with last OUT 17:05, 1 extra
  punch and *W* 483; approving it as IN instead makes the day Incomplete (the dialog warned).
- **AC-42 (payable minutes)** For every employee, `payable_min` = (last OUT if overtime is counted,
  else min(last OUT, shift end)) − max(first IN, shift start), never below 0, and 0 when incomplete;
  `overtime_min` ≤ `payable_min` ≤ `worked_min`; T3 gives 630, T4 480, T6 480; OUT 18:59 on the Office
  shift gives payable 480 and OUT 19:00 gives 600.
- **AC-43 (email off without SMTP)** Given no SMTP variables, then no email is attempted, no error is
  logged, the email switches are hidden, the settings card and "My email alerts" say "Email is not set
  up on this server", and every alert still appears in the bell; given the variables (fake SMTP in
  tests), emails are sent as AC-33.
- **AC-44 (F-58 shift swap)** Given an Office employee swapped to Night for 05/11, then day 05/11 uses
  the Night window and rules, the gate rule of rule 24 and the dashboard's expected count use Night for
  that day, 06/11 is Office again, and cancelling after the 05/11 window started gives
  `SHIFT_SWAP_STARTED`.
- **AC-45 (F-59 bulk)** Given the gate of K134 was down 08:00–10:00 on 30/10 and 40 people are chosen with
  `add_punch` IN 09:00, of whom 2 already have a counted IN at 08:58, then the preview shows 38 to create
  and 2 skipped (`CORRECTION_NEAR_PUNCH`); a Plant Head's batch is 38 pending requests; "Approve all"
  approves them; "Reverse batch" adds 38 reverse rows; all rows share one `batch_id` and are audited.
- **AC-46 (F-60)** The employee page shows 12 months of day squares with colour and code; each square
  opens the day drawer; at 360 px the months stack without sideways scrolling.
- **AC-47 (F-61)** For E4 the explanation says the IN was 40 minutes late (on time until 09:30), the
  worked time for the status was 7 h 20 m of 8 h and the day is a Half-day; for E9 it says the 1 h 50 m
  after 17:00 did not reach the 2-hour overtime minimum; every sentence is a translation key.
- **AC-48 (F-62)** Given a permanent employee Absent on 3 working days in a row (a Sunday between them
  does not break the streak), then one `absence_streak` notification appears for that plant; a
  Short-hours or leave day breaks the streak.
- **AC-49 (F-65)** With SMTP set and the switch on, on 02/11/2026 07:00 IST each recipient gets one email
  per plant in scope with the October register (Excel) and the personal-data warning; a Plant Head gets
  only their plant; demo plants are never sent; `report.emailed` is audited; without SMTP nothing is
  sent and the bell shows "The register of October 2026 is ready".
- **AC-50 (F-28)** With the setting on, the idle gate screen shows "Inside now: N" equal to the
  dashboard's inside-now count of that plant after the next heartbeat; while offline the line is hidden;
  with the setting off the field is null and nothing is shown.
- **AC-51 (F-37)** With `kiosk_late_hint` on, an online IN at 09:40 (Office, permanent) shows "You are 40
  minutes late today." with no name and no voice; at 09:25 nothing is shown; a temporary worker never
  sees it; with the setting off (the default) nothing is shown or sent.
- **AC-52 (F-2)** With `kiosk_show_month_line` on, an accepted online punch shows "This month: 18 days
  present" (fixture with 18 dates having a counted IN) for the result time only, without name or code,
  not spoken; offline, rejected and self-test punches show nothing; with the setting off (the default)
  nothing is sent.
- **AC-53 (gate budget)** `npm run size` passes with the gate budget of 65 kB gzip after F-28, F-37 and
  F-2 (or with a raise of at most 2 kB recorded in a decision line).
- **AC-54 (poster)** Given a plant with Office (09:00–17:00, grace 30) and Night (19:00–07:00, grace 30),
  the gate poster PDF (read back with pypdfium2) contains "Office 09:00–17:00: on time until 09:30, leave
  from 16:30.", "Night 19:00–07:00: on time until 19:30, leave from 06:30." and "One IN and one OUT per
  shift. After your OUT you cannot punch again in the same shift."; it says "attendance device", never
  "kiosk"; after changing the grace to 15 the next poster says "on time until 09:15".
- **AC-55 (no deletion)** No M5 code path or job deletes rows of `attendance_days`, `regularisations`,
  `regularisation_decisions`, `leave_records`, `holidays` or `shift_swaps` (code search test, as for
  punches); only `notifications` older than `notification_keep_days` are deleted.

## 11. Test plan
- **Unit (pytest):** `compute_attendance_day` with every row of §7 rule 22 as a table-driven test
  (S-39) plus AC-3 to AC-8 edge minutes and seconds; first IN / last OUT with extra punches (several
  INs and OUTs, OUT before the first IN, only OUTs, equal times); carry-over; incomplete; leave / holiday / weekly-off precedence; shift-change window; rule versions;
  report header builder; Excel string escaping; notification dedupe keys; register codes.
- **Anti-proxy (pytest):** `shift_closed` rule unit tests (same day, next day, night shift, carry-over
  OUT, IN before a stored OUT) and engine tests through the real card, face, code-path and sync paths
  with fixed punch times (AC-39); `OUT_TOO_SOON` on the same four paths (AC-40); rule-order test;
  review suggestion and approval effect (AC-41); `punchReasons` / Excel words test extended with the new
  code.
- **API (pytest + httpx):** every endpoint of §5 with each role (AC-18), scope by plant on date, all §9
  error codes (AC-21), append-only triggers (AC-20), migration test from `0018` (AC-24), RLS test for
  every new table, stale marking and recompute (AC-25, AC-26), counting single vs bulk (AC-15), report
  contents read back with openpyxl and pypdfium2 (already test dependencies) (AC-29), fake SMTP with
  the standard library (AC-33), demo exclusion (AC-31).
- **Time pinning (lesson of PR #34):** no test may depend on the real time of day. The calculation,
  alert job and nightly job take `now` as an argument; API tests set the clock through the app's
  `utc_now` / `today_ist` seam (the existing time module) to fixed instants; fixtures use fixed dates
  (October–November 2026), never "today". **S-40 (approved):** time-machine freezes the clock where a
  seam is not enough, and a CI step runs the attendance, alert and gate-rule tests once more with the
  clock started at 23:59:30 IST and once at 00:00:30 IST (AC-38).
- **Approved tooling:** **S-39** the worked examples of §7 rule 22 (E, N and T tables) live in one data
  file (`backend/tests/attendance_cases.yaml` or `.json`) read by a table-driven pytest, so the spec
  table and the tests cannot drift; **S-41** every report kind and the gate poster are read back
  (openpyxl, pypdfium2) and their headers, totals and a few cells checked (AC-29, AC-54); **S-42** a 650 ×
  31 register is built inside the 512 MB container in the CI `docker` job and fails above 450 MB or 30 s
  (AC-30); **S-43** Hypothesis property tests of `compute_attendance_day` and the gate rule (worked =
  last OUT − first IN; worked for status ≤ shift length; OT is 0 or ≥ the minimum; OT ≤ payable ≤
  worked; incomplete ⇒ 0; an extra punch between first IN and last OUT never changes the result; a
  punch after a closing OUT in the same day is always refused by rule 24).
- **Approved extras:** pytest for shift swaps, bulk corrections, the absence streak, the monthly
  register email (fake SMTP) and the gate answer fields with each setting on and off; Vitest for the
  heatmap, the explanation list, the bulk dialog and preview, the three gate lines (shown, hidden
  offline, not spoken) and "Email is not set up"; Playwright: the gate idle screen shows "Inside now"
  after a punch, and the poster download (AC-43 to AC-55).
- **Frontend (Vitest):** dashboard tiles and stale line, polling pause on hidden tab, muster cache
  (write, read, 12-hour expiry, logout clear), register grid and phone cards, timeline items, correction
  dialog kinds per role and type, leave dialog working-day count, shift form helper text, report card
  errors, bell count. Fake timers with fixed dates.
- **End-to-end (Playwright, headed locally):** (0) gate: card IN, card OUT after the minimum, a third
  card scan shows "Your shift is already closed. Please visit the plant office."; (1) punch → dashboard
  "Inside now" changes; (2) Plant Head
  requests a missing OUT, Super Admin approves, register shows Present; (3) leave and holiday entry show
  in the register; (4) muster offline (AC-28); (5) download each report once (file arrives, size > 0);
  (6) `responsive.spec.ts` gains the pages of §4.
- **Performance:** AC-27 locally; AC-30 in the CI `docker` job (extend `face_memory_check` or add an
  `attendance_memory_check` script).
- **Manual:** print the muster on a real printer (A4); open the Excel files in Excel and LibreOffice;
  read one month of the register of a real plant with the Plant Head; check one SMTP email if the
  client gives an SMTP server (see §14).
- **Coverage floor** 84% (backend and frontend).

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** nothing in this section is built until the project lead approves it. Each row is
asked in chat as a simple choice. Approved rows are copied into §2, §10 and docs/decisions/.
**The lead (Tushar Gawande) answered every row in chat on 2026-10-30** (status column). Approved rows
are in §2 item 12 with AC-43 to AC-55.

Not re-proposed (decided earlier): F-10, F-11, F-13, F-14, F-21, F-22, F-24, F-32, F-42, F-45, F-47,
F-49–F-52, S-13, S-14, S-16, S-19, S-21, S-34, S-35, S-37. Later items that belong to M5 are offered
again below (F-2, F-8, F-12, F-16, F-28, F-37, F-44). Highest earlier IDs: F-55, S-38; new IDs start
at F-56 and S-39.

### 12.1 Already approved for M5 (in scope, §2 item 12)
| # | Suggestion | Why it helps | Milestone | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| F-4 | Still-inside safety alert (no OUT 1 h after shift end) | Finds a person locked in or hurt; safety | M5 | S | Low (overtime workers also listed; text asks to check) | Approved 2026-10-12, in scope (§7 rule 19) |
| F-7 | Alerts / notification centre: in-app bell; email only when the SMTP variables are set | One place for every alert; email for people away from the screen on the client's own server | M5 | M | Low (email silently off on the free tiers) | Approved 2026-10-12; confirmed 2026-10-30 as "bell only, email only with SMTP set" (§7 rule 20) |
| F-9 | Punctuality analytics | Shows habitual lateness per department, shift and weekday | M5 | M | Low | Approved 2026-10-12, in scope (§7 rule 21) |
| F-26 | Emergency muster list | Everyone accounted for at the assembly point (FR-34) | M5 | S | Low | Approved 2026-10-13, in scope (§7 rule 17) |

### 12.2 Product features (new and re-offered)
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-56 | **Month close:** the Super Admin closes a month of a plant after checking it; later corrections to a closed month need a second confirmation, are listed as "after close", and the register PDF of a closed month is stamped "Closed on … by …" | Registers given to accounts or M7 salary never change silently; a clean monthly routine | M5 (or M7) | M | Low | Later (2026-10-30) |
| F-57 | **Roll-call ticks on the muster:** at the assembly point, tap each person found ("Safe"); the remaining list shows who is missing; ticks stay on that device only, a summary line is audited | Turns the muster into a working roll call in a real emergency | M5 | S | Low | Later (2026-10-30) |
| F-58 | **One-day shift swap:** move one employee to another shift for one date (e.g. covering a night) without changing the assignment | Today a one-day swap means two shift changes and a broken day | M5 | M | Low–Medium (more inputs to the day) | **Approved 2026-10-30**, in scope (§7 rule 26, AC-44) |
| F-59 | **Bulk correction after an outage:** "The attendance device of K134 was down 08:00–10:00; add IN 08:00 for these 40 people" from a paper list, as requests (Plant Head) or direct (Super Admin), one reason for all | A broken gate creates dozens of identical requests; this makes it one step | M5 | M | Medium (wrong bulk = many wrong days; preview and reverse-all needed) | **Approved 2026-10-30**, in scope (§7 rule 27, AC-45) |
| F-60 | **Attendance calendar heatmap** on the employee page (12 months, colour + code) | See a person's pattern at a glance in reviews and disputes | M5 | S | Low | **Approved 2026-10-30**, in scope (§7 rule 28, AC-46) |
| F-61 | **"Explain this day" sentence** in the timeline: "IN 09:40 (40 min late; on time until 09:30). OUT 17:00. Worked 7 h 20 m of 8 h, so Half-day." or "OUT 19:10: 2 h 10 m after 17:00, so overtime 2 h 10 m." | Plant Heads and workers trust numbers they can read; fewer disputes | M5 | S | Low | **Approved 2026-10-30**, in scope (§7 rule 28, AC-47) |
| F-62 | **Absence streak alert:** notification when a permanent employee is **Absent** (no counting punch, no leave; Short-hours and Incomplete days are not absences) 3 working days in a row (setting) | Early follow-up on a person who may have left or be ill | M5 | S | Low | **Approved 2026-10-30**, in scope (§7 rule 20, AC-48) |
| F-63 | **Overtime limit warning:** a setting "overtime hours per quarter" (value typed by the client's advisor); the dashboard and OT report warn when someone passes 80% / 100% (it adds up the counted overtime minutes of §7 rule 11, so only days with 2 h or more after the shift end count) | Helps stay inside the overtime limits of the factory rules; the app only warns and never gives legal advice | M5 | S | Low (the limit is a typed setting, not a legal claim) | Later (2026-10-30) |
| F-64 | **Weekly rest check:** warn when someone has a complete day (first IN to last OUT) on 7 or more days in a row with no weekly off or holiday between them | Weekly rest is a common factory rule; catches it before an inspection | M5 | S | Low | Later (2026-10-30) |
| F-65 | **Scheduled monthly register email:** on the 2nd of each month the previous month's register (Excel) is emailed to chosen admins (only when SMTP is set) | Accounts get the file without anyone remembering | M5 | M | Medium (personal data by email; works only with the client's SMTP; attachment size) | **Approved 2026-10-30**, in scope, only when SMTP is set (§7 rule 20, AC-49) |
| F-66 | **Holiday list helpers:** "Copy last year's holidays" and paste-from-Excel for the calendar | Setting up a year takes one minute | M5 | S | Low | Later (2026-10-30) |
| F-67 | **All-plants wall screen (TV mode):** a full-screen read-only dashboard for the corporate office that rotates through plants, large numbers, no names | Management sees all seven plants at a glance | M5 | S–M | Low (read-only session on a shared screen: no names shown) | Later (2026-10-30) |
| F-68 | **Per-employee "Test" flag** to hide test people from reports | Was offered as an alternative to demo plants | M5 | S | Medium | **Rejected 2026-10-30 by the lead** (decision 8: only DEMO plants are left out; recorded in decision 0034) |
| F-28 | "Inside now" count on the gate screen idle view (a number only, no names) — re-offered (Later since M2) | Guards and workers see the count; useful at shift change | M5 | S | Low (a number only) | **Approved 2026-10-30**, in scope (§4.16, §7 rule 29, AC-50) |
| F-37 | Gentle late hint at the gate ("You are 40 minutes late today"; shown only beyond the 30-minute grace), **off by default** — re-offered (Later since M2) | Self-correcting punctuality without a supervisor | M5 | S | Medium (shown to people behind; off by default) | **Approved 2026-10-30**, in scope, setting default off (§4.16, §7 rule 29, AC-51) |
| F-44 | Office-verified punch: an `add_in_out` / `add_punch` correction can carry "verified at the plant office by <name>" and the time of the visit — re-offered (Later since M3) | Clean record for a person with no evidence (card lost, face failed) | M5 | S | Low | Later (2026-10-30) |
| F-2 | "My month" line at the gate after a punch ("This month: 18 days present") — re-offered (Later since M0); made privacy-safe: no name or code, result time only, not spoken, not stored, setting off by default | Workers see their own record; fewer office visits | M5 | S | Low–Medium (people behind could read one number) | **Approved 2026-10-30**, in scope (§4.16, §7 rule 29, AC-52) |
| F-8 | Overtime approval: the overtime of a day (only days with 2 h or more after the shift end earn any, §7 rule 11) counts for M7 only after the Plant Head or Super Admin approves it — re-offered (Later since M0) | Stops unplanned overtime from becoming pay | M5 or M7 | M | Medium (another workflow) | Later (2026-10-30) |
| F-12 | Weekly digest email (headcount, late, incomplete days, corrections per plant) — re-offered (Later since M0); now possible with F-7 email | Management summary without logging in | M5 | S | Low (counts only, no names) | Later (2026-10-30) |
| F-16 | Shift roster planner (who works which shift next week, rotating weekly offs) — re-offered (Later since M0) | Plants with night rotation; would also be the place for staggered weekly offs **if the client ever asks** (today: one weekly off per plant for everyone, client call 2026-10-30) | M6+ | L | Medium (large) | Later (2026-10-30) |

### 12.3 Tooling and engineering
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| S-39 | **Golden scenario table:** the worked examples of §7 rule 22 live in one data file (YAML or JSON) read by pytest; adding a case = adding a row; the spec table and the tests cannot drift | Attendance maths is the heart of M5; the client can read the cases | M5 | S | Low | **Approved 2026-10-30** (§11) |
| S-40 | **time-machine** (MIT, dev only) to freeze the clock in tests, plus a CI run at 23:59 and 00:01 IST | Ends the "breaks just after midnight" flakes for good (PR #34) | M5 | S | Low (dev only) | **Approved 2026-10-30** (§11, AC-38) |
| S-41 | **Report read-back tests:** every generated Excel and PDF is opened again (openpyxl, pypdfium2 — already test dependencies) and its header, totals and a few cells are checked | Catches broken files before the client does | M5 | S | Low | **Approved 2026-10-30** (§11, AC-29, AC-54) |
| S-42 | **Register performance check** in the CI `docker` job: a 650 × 31 register built inside the 512 MB container, fails above 450 MB or 30 s | Keeps reports inside Render Free as the code grows | M5 | S | Low | **Approved 2026-10-30** (§11, AC-30) |
| S-43 | **Property tests for the day calculation** (Hypothesis, MPL-2.0, dev only; S-36 was Later in M4, now narrowed to the first-IN / last-OUT rule): random punch sets and corrections must keep invariants (worked = last OUT − first IN, worked for status ≤ shift length, OT is 0 or ≥ the minimum, OT ≤ worked, incomplete ⇒ 0 worked and 0 OT, adding an extra punch between first IN and last OUT never changes the result) | Ordering bugs hide in rare orders | M5 | S | Low | **Approved 2026-10-30** (§11, §13.1) |
| S-44 | **Nightly self-check:** the nightly job recomputes a random sample of 200 stored days in memory and logs (counts only) any difference with the stored row | Proves the stored copy matches the rules; finds a missed "stale" trigger | M5 | S | Low | Later (2026-10-30) |
| S-25 | Storage and database usage meter (pending Tushar since M2) — re-offered: `attendance_days` adds about 50 MB a year | Shows when Supabase Free (500 MB) gets close, long before it fails | M5 | S | Low | Later (2026-10-30) |

## 13. Dependencies and risks

### 13.1 Dependencies to add
No new runtime package is needed. All free.
| Package | Version | Licence | Reason |
|---|---|---|---|
| XlsxWriter, openpyxl, fpdf2 (backend) | already installed | BSD-2-Clause, MIT, LGPL-3.0 | Excel and PDF reports; openpyxl reads files back in tests |
| smtplib, email (backend) | Python standard library | PSF | Optional SMTP email (F-7) |
| Recharts, TanStack Table, TanStack Query (frontend) | already installed | MIT | Charts (F-9), register grid, 30-second polling |
| pypdfium2 (backend, tests) | already a test dependency | Apache-2.0 / BSD-3-Clause | Read generated PDFs back in tests |
| time-machine (backend, dev/test only) | latest 2.x | MIT | S-40 (approved): freeze the clock in tests; midnight-IST CI run |
| hypothesis (backend, dev/test only) | latest 6.x | MPL-2.0 | S-43 (approved): property tests of the day calculation and the gate rule; never in the Docker image |

### 13.2 Risks
| Risk | Effect | Mitigation |
|---|---|---|
| **Render Free may block outgoing SMTP ports** (25, 465, 587) for free web services | No email on the free tier | Decided (lead, 2026-10-30): the bell is the channel; email (F-7, F-65) works only when SMTP variables are set, e.g. on the client's own server; otherwise silently off |
| Gate page grows with F-28, F-37, F-2 | Gate budget (65 kB gzip) exceeded | Small text lines only (estimated under 1.5 kB); measured with `npm run size`; raise at most 2 kB with a decision line (AC-53) |
| Records kept only 1 year | Labour-law registers may need 3–5 years | No deletion is built in M5; the period is confirmed with the client's advisor at the M6 handover (§8.1) |
| A missed "stale" trigger | A stored day shows an old result | Every read recomputes stale rows; recompute tool; nightly self-check (S-44) |
| Long report on 0.1 CPU | Request timeout | Limits (31 days, PDF 3,000 rows), one at a time per user, constant-memory Excel, AC-30 measurement |
| Render sleeps; alert job does not run at night | Still-inside alert late | Keep-alive workflow; job runs at start-up; dashboard polling keeps it awake while watched; the muster is always computed live |
| Wrong shift rules entered | Wrong statuses for many people | Rule versions from today only; helper text with the example; recompute after a fix; corrections for the past |
| `ot_after_min` held the old meaning "after 8 worked hours" (480) and the old grace was 10 | Existing values would give wrong overtime and lateness | Migration drops `ot_after_min`, sets grace 30 and the overtime minimum 120 for every shift, with an audit line per shift (before and after); the Super Admin checks each shift (release note); the M1 shift tests and form defaults (480, 10) are updated |
| A worker punches at lunch (an OUT after 30 minutes) and is then refused `SHIFT_ALREADY_CLOSED` for the rest of the day | The day shows Short hours or Half-day until fixed | Gate text sends the worker to the plant office; the Super Admin approves the real end-of-shift punch as OUT (suggested) or adds a correction; the gate poster explains "one IN, one OUT" (§4.17); `OUT_TOO_SOON` still protects the first 30 minutes |
| Workers legitimately called back after their OUT | Refused at the gate | Super Admin approval in "Needs review" (overtime then by the normal rule) |
| Muster cache on an admin's browser | Names on a shared PC | 12-hour limit, removed at logout, only on the muster page |
| Tests depending on the time of day | Flaky CI after midnight IST | `now` passed in, fixed dates, CI run at 23:59 / 00:01 IST (AC-38) |

## 14. Open questions for the team
Answered by the lead on 2026-10-30 and applied above: one IN and one OUT per shift with the new gate
refusal `SHIFT_ALREADY_CLOSED` and `min_minutes_before_out` kept at 30 minutes (§7 rule 24); work on an
off day uses the normal 2-hour overtime rule (§7 rule 11); a temporary worker's paid time counts from
the shift start (`payable_min`, §7 rule 10); the M7 run waits for both Short-hours and Incomplete days
(§7 rule 23). Earlier answers: grace 30, overtime from the shift end, one weekly off per plant
(staggered offs only if the client asks, F-16). Final answers of 2026-10-30: email only through the
client's SMTP when its variables are set, otherwise the bell only (§7 rule 20); retention 1 year in the
lead's view, no deletion built, to be confirmed with the client's advisor at the M6 handover (§7 rule
25, §8.1); gate poster shows the shift times and the one-IN-one-OUT rule (§4.17, §7 rule 30); time
after the shift end below the 2-hour minimum is not paid (§7 rule 10).

**None open.** (A follow-up for the M6 handover, not a blocker: the client's advisor confirms the
retention period before any deletion is ever built.)

## 15. Changes to other documents (made on the milestone branch when this spec is approved)
- **docs/decisions/0034-m5-attendance-reports.md:** the lead's decisions of 2026-10-30 (M5 before M4b;
  weekly off + holidays; missing OUT; night shift by start date and window; corrections; leave; DEMO
  plants only, per-employee Test flag rejected; polling not SSE) **and the client call of the same day:
  one IN and one OUT per shift for everyone (worked = first IN to last OUT, extra punches ignored),
  grace 30 minutes at both ends, full day = shift length (no `full_day_min`), half-day limit per shift,
  below it "Short hours" decided by the Super Admin before the M7 run, Absent = no counting punch,
  overtime from the shift end and only from `overtime_min_minutes` (120), `ot_after_min` removed, one
  weekly off per plant**, and the lead's §14 answers of the same day (gate refusal
  `SHIFT_ALREADY_CLOSED` with Super Admin approval, `min_minutes_before_out` stays 30, off-day overtime
  by the normal rule, temporary payable minutes from the shift start, M7 waits for Short-hours and
  Incomplete days), plus any later §14 answers.
- **docs/specs/M4-anti-proxy-offline.md (note) and SRS FR-25:** rule order gains `shift_closed` after
  the IN/OUT, cool-down and `OUT_TOO_SOON` rule, for card, face, code path and sync; new reason code
  `SHIFT_ALREADY_CLOSED` (approvable; suggestion OUT). **architecture §3/§4:** the same rule order.
- **docs/specs/M1-foundation.md (note only) and docs/architecture.md §7 (`shifts` row):** shift field
  `ot_after_min` removed, `overtime_min_minutes` added, `grace_min` default 30; `shift_rule_versions`
  added. The approved M1 shift API changes as described in §5.3 (an old client's `ot_after_min` is
  ignored).
- **docs/decisions/accepted-extras.md:** an "M5" section with the §12 answers of 2026-10-30
  (Approved: F-4, F-7 (bell; email only with SMTP), F-9, F-26, F-58, F-59, F-60, F-61, F-62, F-65 (SMTP
  only), F-28, F-37 (default off), F-2 (privacy-safe, default off), S-39, S-40, S-41, S-42, S-43; Later:
  F-56, F-57, F-63, F-64, F-66, F-67, F-8, F-16, F-12, F-44, S-44, S-25; Rejected: F-68).
- **docs/decisions/0034:** also the final answers: email only with SMTP set; retention 1 year (lead's
  view, to be confirmed; no deletion built; registers commonly kept 3–5 years); poster shift times;
  payable time stops at the shift end unless overtime is reached.
- **CLAUDE.md §4** (before the M5 PR): time-machine (MIT) and hypothesis (MPL-2.0), dev/test only.
  **§10:** the optional SMTP variables and the gate-screen settings.
- **SRS FR-28–FR-30:** day window, night shift by start date, carry-over, one IN and one OUT per shift
  (first IN to last OUT, extra punches ignored), incomplete = 0 minutes; FR-29: grace 30 minutes
  forgiven at both ends, full day = shift length, half-day limit per shift, below it "Short hours"
  (Super Admin decides), Absent = no counting punch, overtime from the shift end only from 2 h;
  temporary workers by hours (first IN to last OUT) only. **FR-37/FR-39 (M7):** the salary run refuses to
  start while undecided Short-hours days exist in the period (§7 rule 23).
- **SRS FR-31:** "Corporate Head or Plant Head (own plant) requests; Super Admin approves, rejects or
  corrects directly; append-only; shown with M4 punch approvals".
- **SRS FR-32:** simple paid / unpaid leave by the Super Admin; no balances.
- **SRS FR-33:** "updated in real time (SSE)" → "refreshed every 30 seconds by polling (Render Free;
  decision 0034)".
- **SRS FR-35:** add late / early exit / overtime, exceptions and corrections log to the list (the
  rejected-punch report stays).
- **SRS FR-41:** SMTP optional; notification centre (F-7).
- **SRS §5.b:** `/regularisations` identity "supervisor / HR" → "Corporate Head / Plant Head request,
  Super Admin decides"; `/dashboard/live (SSE)` → polling; new paths of §5 (`/attendance/*`,
  `/regularisations/*`, `/punch-approvals`, `/leave`, `/holidays`, `/plants/{id}/weekly-off`,
  `/shifts/{id}/rule-versions`, `/muster`, `/insights/punctuality`, `/reports/{kind}.{format}`,
  `/notifications/*`).
- **docs/architecture.md §6:** attendance processing = stale marking + background recompute + 5-minute
  catch-up + nightly close (rule 14); alert job every 5 minutes. **§7:** new tables of §6
  (`shift_rule_versions`, `plant_weekly_offs`, `holiday_plants`, `regularisation_decisions`,
  notifications tables), `attendance_days` columns, `holidays` without `plant_id` (all plants or
  `holiday_plants`).
- **CLAUDE.md** (before the M5 PR, lead approves the diff): tick M5; settings and SMTP variables in §10;
  M5 rule "attendance days only from `counting.py` + approved corrections"; note that M4b comes after
  M5.
