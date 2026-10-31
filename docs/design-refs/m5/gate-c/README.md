# M5 design gate C: setup, reports and alert screens of the admin website

Status: **for review by Anuradha / Tushar** · ui-designer · 31/10/2026 (mockup "today" = Saturday 31/10/2026)
Spec: `docs/specs/M5-attendance-reports.md` §4.8 to 4.14, 4.17 and §7 rules 16, 18 to 21. Decisions: 0034, 0036 (line 1 rule versions with a date,
line 7 leave reasons for the Super Admin only, line 8 grace only at the start, line 9 early OUT). No application code, spec or decision file was touched.

## How to open
Open any `NN-name.html` in Chrome (needs internet for Inter and Lucide) or run `python -m http.server 8771` in this folder. A state is the URL hash,
e.g. `01-leave.html#add-dialog`; add `?shot` before the `#` to hide the state tag.
Screenshots: `screenshots/NN-screen-state-WIDTH.png`, every state at **360 x 800, 768 x 1024 and 1280 x 800** (full page; dialogs, the bell panel and the
phone menu are viewport only), plus the two A4 poster PNGs (`09-poster-*-a4.png`, 1588 x 2246). 287 PNGs, palette-reduced (largest 400 KB).
Automatic check on every capture: **no sideways page scroll at 360, 768 and 1280** (tables scroll inside their card), no script errors.
Look: `tokens.css`, `m3.css`, `gc.css`, `m4c.css` are copied **unchanged** from `docs/design-refs/m4/gate-c/`; `shell.js` is extended (bell, new menu entries);
everything new is `m5c.css`. Sidebar gains: Attendance, Corrections, Leave, Holidays, group "Insights" (Punctuality, Reports, Notifications with unread count).
Below 1280 px the search box is an icon and below 1024 px the plant filter is hidden, so the bell fits on a 360 px top bar (the word mark is dropped below 480 px).
Tooling: a Playwright script in the session scratchpad using `e2e/node_modules`, outside the repo.

## Files and states (hash)
| File | Screen | States |
|---|---|---|
| `01-leave.html` | Leave `/admin/leave` | default · filtered · add-dialog · add-dialog-weekly-off · add-dialog-date-error · add-dialog-overlap · cancel-dialog · empty · filter-empty · loading · error · corporate-head · plant-head · menu-open |
| `02-holidays.html` | Holidays `/admin/holidays` | default · add-dialog · add-dialog-plants · add-dialog-error · cancel-dialog · year-empty · loading · error · corporate-head · plant-head |
| `03-plant-details.html` | Plant page, Details tab: weekly off + start date | default · weekly-off-dialog · weekly-off-error · start-date-dialog · start-date-error · upcoming-change · loading · error · corporate-head · plant-head |
| `04-shift-form.html` | Shifts tab and shift form | list · form-default · form-helper · form-new · form-live-change · form-night · form-error · form-future-date · form-history · saved-poster · corporate-head · plant-head · loading · error |
| `05-reports.html` | Reports `/admin/reports` | default · building · busy · too-large · range-error · rate-limit · done · plant-head · corporate-head · loading · error |
| `06-punctuality.html` | Punctuality `/admin/insights/punctuality` | default · group-category · group-shift · group-weekday · range-error · empty · loading · error · plant-head · corporate-head |
| `07-notifications.html` | Bell, dropdown, `/admin/notifications`, "My email alerts" | bell-open · bell-empty · bell-loading · bell-error · page-default · page-filtered · page-unread-only · page-empty · page-filter-empty · page-loading · page-error · page-email-on · email-alerts · email-alerts-not-set-up · corporate-head · plant-head |
| `08-settings.html` | Settings: cards Attendance, Alerts, gate screen lines | default · changed · range-error · cross-check-error · save-reason · email-set-up · corporate-head · plant-head · loading · error |
| `09-poster.html` | A4 gate poster with "Your shift times" box (spec 4.17) | default (3 shifts) · six-shifts (6 shifts + "and 2 more") |

## Roles (all screens)
Super Admin edits. Corporate Head and Plant Head read: add/cancel/edit buttons are not drawn (not just disabled) and a blue "View only" strip says why.
Plant Head sees own plant only (plant field fixed with a lock, K134 in the mockups). **Leave reason and cancel reason are shown only to the Super Admin**
(decision 0036 line 7): the Reason column disappears for the others and the strip explains it. Holiday names and cancel reasons are shown to everyone.
Reports: Corporate Head all plants, Plant Head own plant. The corrections report note says review reasons are only in the Super Admin's file.

## Colours (Steel & Signal tokens, nothing new except where stated)
Ink `#0e1726` (18:1 on white), muted text `#4a5567` (7.5:1), primary `#1f3a93` (10.1:1), page `#f5f6f8`, card `#fff`, hairline `#dde2ea`, input border `#868fa0` (3.3:1).
Success `#04694b` on `#e6f5ee` (6.7:1) · warning `#8f5300` on `#fff3d6` (6.2:1) · danger `#b42318` on `#fdecea` (6.6:1) · signal yellow `#f5b700` only as decoration
(active nav bar, "Today" badge with dark text). Body text on the admin is 14 to 16 px with dark ink; the AAA 7:1 aim holds for ink and muted text.
New in M5 (all from the tokens): **Paid** = green badge + rupee icon; **Unpaid** = white badge with dashed amber edge + circle-slash icon; **Cancelled** = grey dashed badge + ban icon
+ strikethrough text; **Urgent** notification = white badge with 1.5 px red edge, siren icon, the word "Urgent" and a red left bar (unread blue bar for normal ones);
**below 90 % on time** = amber bar with hatching, a "▼" mark and the word "Below 90%" in the table; poster shift box = steel-blue header with white 16 pt text.
Status is never colour alone: every state has icon + word, and a second cue (dashed edge, strikethrough, hatching, ▼, left bar).

## Components and sources
No component was copied from a library; everything is plain HTML and CSS on the existing tokens (shadcn/ui look-alike patterns already approved in M1 to M4).
Icons: Lucide 0.469 (ISC licence, free). Font: Inter (SIL OFL, free). Charts: inline SVG here, Recharts in the build. Motion (reduced-motion safe): `anim-fade-up`,
`anim-scale-in` dialogs, shimmer skeletons, switch knob slide; the bell badge does not animate. Nothing needs to be added to `docs/decisions/ui-component-sources.md`.

---

## 1. Leave (`/admin/leave`)
Layout: page head (title, one primary "Add leave", Super Admin only) → card with filters (search, plant, month; Pay: All/Paid/Unpaid; State: Active/Cancelled/All) →
table (Employee + code, Plant, From, To, Working days with the "not counted" note, Pay, Reason, Entered by, State, Cancel button). Below 768 px the table becomes cards.
Add dialog: employee, first and last day (DD/MM/YYYY), live line "4 working days. 01/11 is a weekly off and is not counted as leave.", Paid/Unpaid radio cards, reason (Super Admin only reads it).
Cancel dialog: summary, required reason (10 to 200 characters), danger button. Cancelled rows stay in the list.
Texts (keys `leave.*`):
- `leave.title` Leave · `leave.subtitle.admin` "Days a person is away, paid or unpaid. Add leave here; people do not apply for it." · `leave.subtitle.readOnly` "Leave of your plant. You can read it; the Super Admin changes it."
- `leave.add` Add leave · `leave.cancel` Cancel leave · `leave.keep` Keep leave · `leave.save` Save leave
- `leave.col.employee|plant|from|to|workingDays|pay|reason|enteredBy|state` · `leave.pay.paid` Paid · `leave.pay.unpaid` Unpaid · `leave.state.active` Active · `leave.state.cancelled` Cancelled
- `leave.notCounted` "{{what}} not counted" (examples "01/11 weekly off", "10/11 holiday") · `leave.workingDaysNote` "Working days = days that are not a weekly off or a holiday"
- `leave.preview` "{{count}} working days. {{date}} is a weekly off and is not counted as leave." (plural form needed)
- `leave.filter.search` "Employee name or code" · `leave.filter.allPlants` · `leave.filter.allMonths` · `leave.filter.clear` Clear filters
- `leave.dialog.add.title` Add leave · `.desc` "For one person, for whole days. Paid or unpaid. No approval needed." · `leave.field.firstDay` First day · `leave.field.lastDay` Last day · `leave.field.reason` Reason · `leave.reasonHint` "Only the Super Admin can read this."
- `leave.paid.hint` "Counts as a paid day" · `leave.unpaid.hint` "Does not count as paid"
- `leave.dialog.cancel.title` "Cancel this leave?" · `.desc` "The leave stays in the list as Cancelled. The attendance of those days is worked out again." · `leave.cancelReason.label` "Why is it cancelled? (required)" · `.hint` "At least 10 characters. It is saved in the audit log." · `.placeholder` "For example: she is coming to work"
- `leave.readOnly` "View only. Only the Super Admin can add or cancel leave. A leave reason can be personal, so reasons are shown to the Super Admin only."
- errors: `leave.error.dates` "The last day cannot be before the first day." · `errors.LEAVE_OVERLAP` "{{name}} already has leave from {{from}} to {{to}}. Cancel that leave first, or choose other dates." (**proposed new code, to confirm in the plan**)
States: loading = 6 skeleton rows; empty = "No leave entered yet" + explanation + Add leave (Super Admin); filter-empty = "No leave matches these filters" + Clear filters; error = "Leave could not be loaded" + Try again (`leave.state.loading|empty|filterEmpty|error`).
A11y: filters are labelled, segmented buttons use `aria-pressed`, dialogs are `role=dialog aria-modal`, radio cards `role=radio`, all controls 44 px or more, cancelled = strikethrough + badge + word.

## 2. Holidays and weekly off
Holidays (`holidays.*`): toolbar with year picker (previous / year / next) and plant filter; list grouped by month: date box (day + weekday), name, plants ("All plants" badge or codes), Paid/Unpaid, state
(Active / Past / Cancelled with reason), "Falls on the weekly off" note, Cancel (Super Admin, future days only). Add dialog: date, name (2 to 80 characters), Applies to (All plants / Chosen plants with 7-plant checklist), Pay (Paid is the default).
- `holidays.title` Holidays · `holidays.subtitle.admin` "The days the plants are closed. Weekly offs are set on each plant page." · `holidays.add` Add holiday · `holidays.cancel` Cancel · `holidays.year` Year
- `holidays.scope.all` All plants · `holidays.scope.chosen` Chosen plants · `holidays.scope.chosenCount` "{{count}} plants chosen" · `holidays.pay.paid` Paid holiday · `holidays.pay.paidHint` "Counts as a paid day" · `holidays.pay.unpaid` Unpaid holiday · `holidays.pay.unpaidHint` "Closed, but not paid"
- `holidays.state.past` Past · `holidays.fallsOnWeeklyOff` "Falls on the weekly off" · `holidays.footer` "A holiday on the weekly off stays a weekly off" · `holidays.count` "{{count}} holidays in {{year}}"
- `holidays.dialog.add.title` Add holiday · `.desc` "A day the plants are closed." · `holidays.error.name` "The name needs 2 to 80 characters."
- `holidays.dialog.cancel.title` "Cancel this holiday?" · `.desc` "The day becomes a normal working day again. Attendance for that day is worked out again." · `holidays.keep` Keep holiday
- `holidays.empty.title` "No holidays for {{year}} yet" · `.body.admin` "Add the days the plants are closed. A paid holiday counts as a paid day for everyone it covers." · `holidays.readOnly` "View only. Only the Super Admin can add or cancel a holiday." · error "The holidays could not be loaded".
Plant Head sees "all plants" holidays and those that include their plant.
Plant page Details (`plantWeekly.*`, `plantStart.*`): rows "Weekly off: Sunday from 01/04/2026" with history ("From 01/04/2026 Sunday · In force", "From 01/10/2025 Saturday · Earlier"), "Change weekly off" dialog (weekday segmented control, "Applies from" today or later, warning "From 15/11/2026 Saturday is the weekly off and Sunday becomes a working day at K134."), the **upcoming** state ("Changes to Saturday from 15/11/2026. Until then Sunday stays the weekly off." + "Upcoming" badge);
"Attendance start date: 01/10/2026" with explanation "Attendance is worked out from this day. Earlier days show no status. Once days exist, the date can only move later." and a dialog with reason (required) and the warning "Moving the date later hides 01/10 to 14/10."
- `plantWeekly.title` Weekly off · `.change` Change weekly off · `.history` History · `.inForce` In force · `.upcoming` Upcoming · `.earlier` Earlier · `.upcomingNote` "Changes to {{day}} from {{date}}. Until then {{old}} stays the weekly off." · `.pastError` "The date must be today or later. A past weekly off cannot be changed."
- `plantStart.title` "Attendance start date" · `.change` "Change start date" · `.hint` (above) · `.laterWarning` "Moving the date later hides {{from}} to {{to}}. Those days stay stored but show no status and leave the reports." · `errors.ATTENDANCE_START_INVALID` "Attendance already exists from {{date}}. The start date can only move later, not earlier."

## 3. Shift form (`shiftForm.*`)
A wide dialog on the plant page, Shifts tab (list rows show times, full day, grace, half-day, overtime minimum and an "Edit rules" button). Fields in order: Shift name · Shift starts · Shift ends (24 h `HH:MM`, "Ends the next day" hint when end is before start) ·
**Full day** read-only (lock icon, dashed box, "Full day: 8 h", "= start to end. Not typed.") · Grace after the start (minutes, default 30, 0 to 120) · Half-day hours (h + min, default 4 h) ·
Smallest overtime that counts (minutes, default 120) · "These rules apply from" (today or later, default today) · live helper box (little timeline + five plain-word lines) · rule history list.
**Helper text follows decision 0036 line 8, which differs from spec 4.10** (no grace at the end, so "leave from" is the shift end). Office 09:00 to 17:00, grace 30, half-day 4 h, overtime 2 h:
- `shiftForm.onTime` "On time until {{time}}. Arriving up to {{time}} counts from {{start}}."
- `shiftForm.fullDay` "Full day: {{duration}}. Arrive by {{time}} and stay until {{end}}."
- `shiftForm.earlyExit` "Leaving before {{end}} is an early exit. The real hours count; there is no grace at the end."
- `shiftForm.halfDay` "Half-day from {{half}}. Below {{half}} is Short hours: you decide that day with a correction."
- `shiftForm.overtimeHint` "Overtime from {{end}}, only when you stay {{ot}} or more after the shift end."
- `shiftForm.nightNote` "This shift ends the next morning. The attendance day is the day it starts."
- `shiftForm.helperTitle` "What these times mean" · `.live` "updates as you type" · timeline legend "On time (grace)" · "Shift hours" · "Overtime counts if you stay until {{time}} or later" (bar is drawn from the typed values, with a text alternative).
- labels: `shiftForm.name`, `.start`, `.end`, `.fullDayLabel` "Full day", `.fullDayValue` "Full day: {{duration}}", `.fullDayNote`, `.grace` "Grace after the start" (+ hint "Arriving this late still counts as on time. Default 30."), `.halfDay` "Half-day hours" (hint "Worked from this long counts as a half-day. Default 4 h."), `.overtimeMin` "Smallest overtime that counts" (hint "Staying less than this after the shift end is not overtime. Default 120 (2 h)."), `.applyFrom` "These rules apply from" (hint "DD/MM/YYYY · today or later. Default today."), `.save` "Save rules", `.add` "Add shift", `.edit` "Edit shift: {{name}}", `.new` "Add a shift".
- `shiftForm.futureNote` "Starts on {{date}}. Until then the rules in force today stay. The gate poster should be printed again after that date."
- history: `shiftForm.history.title` "Rule history" · `.row` "From {{date}}" with "Grace {{grace}} min · Half-day {{half}} · Overtime from {{ot}}" and "Saved by {{name}} on {{date}}" · badges "In force", "Will apply", "Earlier" · `.footnote` "Days already worked keep the rules of their day. A new rule starts on its date and never changes the past."
- errors: `shiftForm.error.grace` "Grace can be 0 to 120 minutes." · `shiftForm.error.halfDay` "Half-day must be shorter than the full day ({{fullDay}})." (save disabled; the helper is hidden until the values are valid) · `shiftForm.savedPoster` "Shift times changed. Print the gate poster again." + link "Open the gate poster".
States: new (empty times, helper shows an invitation), night (12 h, next-morning note), live change, error, future date (note + "Will apply" row), history (scrolled to the end), read-only list (no Edit/Add), loading, error.
A11y: helper box `aria-live="polite"`; timeline has `role=img` and a full-sentence `aria-label`; the dialog body scrolls, the buttons stay in view (stacked on phones).

## 4. Reports (`reports.*`)
Layout: three plain limit tiles ("One file at a time", "20 files in 10 minutes", "PDF up to 3,000 rows"), then seven cards (2 columns at 1280, 1 column below 900 px). Every card: icon, title, one sentence, period fields (day / month / from-to), plant (fixed for Plant Head), contractor (contractor report only),
**Excel** (green outline) and **PDF** (grey outline) buttons, limit line. Footer line about audit and personal data.
- `reports.title` Reports · `reports.subtitle` "Download attendance reports as Excel or PDF. Demo plants are not included."
- `reports.limit.oneAtATime.title|body` "One file at a time" / "Wait for a file before you ask for the next one." · `reports.limit.rate` "20 files in 10 minutes" / "For each person. A file takes up to 30 seconds." · `reports.limit.pdfRows` "PDF up to 3,000 rows" / "A bigger report: use Excel, it has no row limit."
- cards `reports.kind.<kind>.title|body|limit` for `daily-muster` ("Daily muster": "Who came on one day: first IN, last OUT, hours, late, early exit and overtime." / "One day. Portrait A4 for PDF."), `register` ("Monthly register": "A month for every person: one code per day (present, absent, leave, holiday, weekly off) and totals." / "One month. The PDF is landscape A4."), `contractor-hours` ("Contractor hours": "Hours of temporary workers, grouped by contractor, with overtime hours. No rates and no money."), `late-early-overtime` ("Late, early and overtime": "Every day a permanent employee came late, left early or stayed for overtime, with totals per person." / "Up to 31 days."), `exceptions` ("Exceptions": "Days that need a look: missing OUT, short hours, unchecked flagged punches. Written in plain words."), `rejected-punches` ("Rejected punches": "Punches the attendance device refused, with the reason, the device and the method. No photos."), `corrections` ("Corrections": "Correction requests and decisions, and punch approvals from the review screen." + "Reasons written in the review screen appear only in the Super Admin's file.")
- fields: `reports.field.day|month|from|to|plant|contractor`, `reports.allContractors` "All contractors", `reports.yourPlant` "Your plant", `reports.excel` Excel, `reports.pdf` PDF, `reports.building` "Building…"
- `reports.buildingNote` "Building the file… Large months can take up to 30 seconds. Please keep this page open." (the other cards' buttons are disabled meanwhile) · `reports.done` "Downloaded {{file}} · {{rows}} rows" · toast "File downloaded."
- errors (use `errors.<CODE>` texts): `errors.REPORT_BUSY` "Another report is still being built. Please wait for it to finish, then try again." · `errors.REPORT_TOO_LARGE` "This PDF would have more than 3,000 rows. Download the Excel file, or choose one plant." · `errors.REPORT_RATE_LIMIT` (**proposed**, the 20-in-10-minutes limit; rule 18 names the limit but no code) "You have made 20 files in the last 10 minutes. Please wait {{minutes}} minutes and try again." · `reports.error.range` "That is {{days}} days. This report covers up to 31 days." · `reports.error.load` "The reports page could not be loaded".
- footer `reports.footer` "Every file shows who made it and when. Every download is saved in the audit log. The files contain personal data: keep them on company computers."
States: loading skeleton cards, error with Try again, per-card building / busy / too large / rate limit (dashed amber) / done (green) / range error (field error, buttons disabled). No empty state (the cards are always there).

## 5. Punctuality (`insights.punctuality.*`)
Layout: period (From, To, "Last 30 days" reset, up to 92 days), plant, "Group by" segmented (Department, Category, Shift, Weekday) → four KPI tiles (On time 91.4 %, Late arrivals 214, Average late 23 min, Early exits 87, each with the change against the 30 days before, arrow + word) →
weekly on-time line chart (value label on each point) and weekday columns (Monday below 90 % hatched amber with ▼) → card "By department/category/shift/weekday" with bars (value written at the end) and a table (Days with an IN, On time, Late arrivals, Average late, "Below 90%" badge) →
"Most late arrivals" top 10 table (rank, name, code, plant, late days, total late minutes, "View month" link to the employee month) → note.
- `insights.punctuality.title` Punctuality · `.subtitle` "How on time permanent employees come, by week, group and weekday." · `.last30` "Last 30 days" · `.groupBy` "Group by" · `.group.department|category|shift|weekday`
- KPIs: `.kpi.onTime` "On time" · `.kpi.late` "Late arrivals" · `.kpi.averageLate` "Average late" (`{{minutes}} min`) · `.kpi.earlyExits` "Early exits" · changes: `.delta.points` "{{value}} points than the 30 days before" · `.delta.fewer` "{{value}} fewer than before" · `.delta.longer` "{{value}} longer than before"
- charts: `.chart.weekly` "On time each week" · `.chart.weekday` "On time by weekday" · `.chart.weekStart` "Week starting (Monday)" · text alternatives list every value · `.by.<group>` "By department" etc. · `.barNote` "On time = came by shift start plus grace · below 90% is marked ▼" · `.below` "Below 90%"
- table: `.col.daysWithIn` "Days with an IN" · `.col.onTime` · `.col.lateArrivals` · `.col.averageLate` · `.top.title` "Most late arrivals" · `.top.subtitle` "Top 10 in this period" · `.col.late` "Late" · `.col.totalLate` "Total late" · `.viewMonth` "View month"
- `.note` "Permanent employees on working days only. Temporary workers have no late rule. Weekly offs, holidays and leave days are left out. Demo plants are not included."
- `.error.range` "That is {{days}} days. Choose up to 92 days." · empty `.empty.title` "No arrivals in this period" + "Punctuality needs permanent employees with an IN on working days. Try a longer period or another plant." · range state "Choose a shorter period" · error "Punctuality could not be loaded".
Colour: one hue (primary) for all on-time marks; amber only for "below 90 %", doubled by hatching, ▼ and a word. A11y: every chart has `role=img` with a sentence; all numbers are also in the tables; 360 px uses a narrower chart drawing so the labels stay 11 px or more.

## 6. Notifications (`notifications.*`)
Bell (44 px, top bar, red count badge with the number, `aria-label` "Notifications, 4 unread"): opens a panel (420 px; full width on phones) with "Notifications · 4 unread", "Mark all as read", the latest items, "See all".
Item: kind icon, **kind badge (icon + word)**, plant, text, time, action link; unread = bold text, "Unread" tag with a dot and a blue left bar; **urgent** (still inside) = "Urgent ·" badge with siren icon and a red bar. Full page: "Mark all as read" (page head), email note, filters (Kind, Plant; Show All / Unread n / Read), list, footer "kept for 90 days".
- `notifications.title` Notifications · `.subtitle` "Alerts for the plants you can see. The bell in the top bar shows the newest." · `.bell.label` "Notifications, {{count}} unread" · `.bell.none` "Notifications, none unread" · `.markAll` "Mark all as read" · `.seeAll` "See all" · `.unread` Unread · `.urgent` Urgent · `.unreadCount` "{{count}} unread"
- kinds `notifications.kind.<kind>`: `still_inside` "Still inside" · `device_offline` "Device offline" · `many_rejections` "Many rejections" · `incomplete_days` "Incomplete days" · `review_digest` "Review digest" · `correction_requested` "Correction asked" · `correction_decided` "Correction decided" · `absence_streak` "Absent 3 days" (use `{{count}}`) · `monthly_register` "Register ready"
- texts `notifications.text.<kind>`: "{{count}} people are still inside {{plant}}, 1 hour after the shift ended." · "Attendance device '{{device}}' has been offline since {{time}}. Check its power and internet." · "{{count}} punches were refused at '{{device}}' in {{minutes}} minutes. Please check the device." · "{{count}} days at {{plant}} are missing an OUT (yesterday {{date}})." · "{{count}} punches are waiting in Needs review. The oldest is {{days}} days old." · "{{name}} ({{code}}) has been absent for {{count}} working days in a row." (name looked up when read, never stored) · "{{name}} asked for a correction for {{date}} at {{plant}}." · "Your correction for {{date}} was approved by {{name}}." · "The register of {{month}} is ready."
- links `notifications.link.*`: "Open the list" · "Open attendance devices" · "Open rejected punches" · "Open Needs review" · "Open the month" · "Open the request" · "Open the correction" · "Download the register"
- filters `notifications.filter.kind` "All kinds" · `.plant` "All plants" · `.show` Show · `.all` All · `.read` Read · `notifications.footer` "{{count}} notifications · kept for 90 days" · "Newest first · times in IST"
- **email not set up** `notifications.emailNotSetUp` "Email is not set up on this server. Alerts are shown in the bell and on this page." (also in the settings card and the dialog; in all three the switches are hidden). When email is on: `notifications.emailOn` "Email alerts are on. Choose the alerts you want by email in My email alerts (account menu). Emails never contain names or codes."
- **My email alerts** dialog (`notifications.email.*`): "Choose which alerts you also want by email." · "Emails go to {{address}}. An email has no names or codes, only a short line and a link." · one On/Off switch per kind including "Monthly register by email (Excel, your plants)" · not-set-up version "Email alerts are off for everyone on this server." with Close only.
States: bell-empty "You are all caught up" ("Alerts about devices, people still inside and corrections appear here."), bell-loading skeleton, bell-error "Notifications could not be loaded" + Try again ("Check the internet. The bell tries again in a minute."), page-empty, filter-empty "No notifications match these filters" + Clear filters, loading, error.
Roles: Super Admin sees all kinds; Corporate Head read-only, no "Correction asked"; Plant Head own plant only (still inside, incomplete days, decided corrections, register).
A11y: bell is a button with `aria-expanded`; unread items have an `aria-label` starting "Unread."; the count is also text in the label; links are underlined; the bell never auto-opens or plays a sound.

## 7. Settings cards (`settings.*`; existing look)
New cards (each with a "New in this version" badge, sub-groups as accordions below 768 px, first open):
- **Attendance** (group `attendance`): "Punches counted before a shift" `attendance_window_before_hours` 4 h (1 to 8; "must be shorter than 24 hours minus the longest active shift") · "Oldest day a correction can ask for" `correction_request_max_days` 31 days (1 to 92).
- **Alerts** (group `alerts`): "Alert when people are still inside" `still_inside_alert_minutes` 60 min (15 to 240) · "Many refused punches: how many" `rejection_alert_count` 10 (3 to 100) · "Many refused punches: within" `rejection_alert_minutes` 30 min (5 to 240) · "Alert for a person who stays away" `absence_streak_days` 3 working days (2 to 10) ·
  "Keep notifications for" `notification_keep_days` 90 days (30 to 365) · **Email alerts** `email_alerts` On/Off, **replaced by the "Email is not set up on this server" note while the SMTP variables are unset**; with SMTP set it shows the switch (default Off) and "Send a test email" (Super Admin).
- **Attendance device screen** (group `kiosk_screen`): three On/Off switches, each with a dark preview of the exact line: "Inside now: 214" (default On, `kiosk_show_inside_count`) · "You are 40 minutes late today." (default Off, `kiosk_late_hint`) · "This month: 18 days present" (default Off, `kiosk_show_month_line`, amber warning "People standing behind can read it. Tell the workers before you switch it on."). Each row says "Never spoken · never shows a name".
The key names are never shown to people; the screen shows the plain labels (keys `settings.attendance.*`, `settings.alerts.*`, `settings.gate.*` with `.label`, `.help`, `.unit`).
States: changed (blue "Changed" badge, save bar "2 unsaved changes", reset link), range-error ("Allowed 1 to 8 hours."), cross-check-error ("Must be below 7 hours. The longest active shift is 17 hours (24 - 17 = 7)." plus an amber box naming the shift; the real text names the real shift), save-with-reason dialog (lists each change from to, required reason of 10 to 300 characters), email-set-up, view-only (switches and fields disabled, "View only" strip), loading, error.
Switch: 56 x 32 px track, text word with icon ("check On" / "dash Off") so it never relies on colour.

## 8. A4 gate poster (spec 4.17)
`screenshots/09-poster-default-a4.png` (3 shifts) and `09-poster-six-shifts-a4.png` (6 shifts + "and 2 more shifts: ask the plant office."). Both fit on one A4 page with the footer stripe.
What shrank so the box fits: the "two ways" boxes lost a row each (title and short steps beside small icons; heights about 55 mm instead of 90 mm); "See IN or OUT" and "NOT ACCEPTED" now share one row (about 25 mm instead of two 24 to 29 mm boxes);
the privacy text is **11 pt** (was 12.5 pt; 10.5 pt in the six-shift page, with a tighter heading and gap), its icon is smaller; title 28 pt (24 pt for six shifts). Text outside the shift box was 12.5 to 13 pt before and is now 11 to 14.5 pt.
**Please confirm with Tushar that the privacy text may be 11 pt (10.5 pt only for six shifts)**; the privacy wording itself is unchanged. The shift box keeps **14 pt body text** and 16 pt heading in both versions.
Texts (`poster.shifts.*`, generated from the plant's active shifts, never fixed): heading "Your shift times" · "Shift times as on {{date}}" · line "{{name}} {{start}}–{{end}}: on time until {{onTime}}, leave from {{end}}." (**"leave from" is the shift END** because of decision 0036 line 8; spec 4.17 still says end minus grace, to be corrected) ·
"One IN and one OUT per shift. After your OUT you cannot punch again in the same shift." · "Please visit the plant office if your shift is closed by mistake." · "and {{count}} more shifts: ask the plant office."
Page room left: about 12 mm (default) and 29 mm (six shifts), so longer Marathi or Hindi lines still fit with a font one step smaller. A shift that crosses midnight (Night 19:00–07:00) shows "leave from 07:00".
Not changed: stripes, title, plant line, the two ways and their wording, privacy wording, help line.

## Open points for the team
1. Helper text, poster and form follow decision 0036 line 8 (no grace at the end); spec 4.10 and 4.17 still show "leave from 16:30" and "grace at the end": update the spec text.
2. Two error codes are proposed here only: `LEAVE_OVERLAP` and `REPORT_RATE_LIMIT`. Rule 18 names `REPORT_BUSY` and `REPORT_TOO_LARGE` but no code for the 20-files limit.
3. The leave reason is hidden from Corporate Head and Plant Head (decision 0036 line 7); holiday and weekly-off screens show everything to all three roles.
4. Notification kind names for people ("Correction asked", "Absent 3 days") are proposals; "Absent N days" must use the setting value.
5. The 11 pt privacy text on the poster needs the lead's yes.
