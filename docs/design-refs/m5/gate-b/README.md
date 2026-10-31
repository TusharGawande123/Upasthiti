# M5 Gate B: attendance screens of the admin website (mockups)

Mockup only (static HTML/CSS/JS, fake data, invented names and codes, no photos). Spec: `docs/specs/M5-attendance-reports.md` sections 4.3 to 4.7, rules 9, 12, 15; decision 0036 line 8 (grace only at the start; an OUT before the shift end is an early exit). Look: Steel & Signal, Inter, icon + word + colour, light, en-IN (DD/MM/YYYY, 24 h, "7 h 45 m"). Text says "attendance device", never "kiosk".

Source: `index.html?s=<screen>&shot` (+ `app.js`, `m5b.css`, `shell.css`, `tokens.css` copied from M4 gate B). Screens: list, list-today, list-loading, list-empty, list-error, register, employee, swap, drawer-sa, drawer-head, corrections, corrections-decided, corrections-mine, approvals, approvals-head, dialog, dialog-sa, dialog-warn, wizard, wizard-done. PNGs are `<name>-{360,768,1280}.png` (360 px shots are 2x). No screen scrolls sideways (checked by script at all 3 widths); tables scroll inside their card.

## PNG list
| Screen | Files (prefix) |
|---|---|
| 1 Attendance list | `01-attendance-list` (29/10, all statuses), `-today` (In progress rows), `-loading`, `-empty`, `-error` |
| 2 Monthly register | `02-register` (360 px: employee list, one opens a month card) |
| 3 Employee Attendance tab | `03-employee-attendance`, `03-employee-shift-swap` (dialog) |
| 4 Day drawer | `04-day-drawer-super-admin` ("Correct"), `04-day-drawer-plant-head` ("Ask for a correction", review reason hidden) |
| 5 Corrections | `05-corrections-pending` (Super Admin, one card with the reject box open), `05-corrections-decided` (Reverse), `05-corrections-mine` (Plant Head, Withdraw), `05-punch-approvals-super-admin`, `05-punch-approvals-plant-head` (reasons hidden), `05-correction-dialog-plant-head`, `-super-admin`, `-warning` (too near a punch, send disabled), `05-bulk-wizard-preview`, `05-bulk-wizard-done` (Reverse the whole batch) |

Dialogs and drawers are bottom sheets or full width on 360 px; their body scrolls inside, the buttons stay at the bottom (the dialog PNGs show the top part only).

## Layout notes
- List: title + "Monthly register" and "Download daily muster"; amber banner "12 days to decide" + "Show them"; filter card (date with arrows, plant, status, search; second row type, department, category, contractor, shift; chips Has exceptions / Corrected with counts); tolerance line "Office 09:00-17:00: On time until 09:30. Leave from 17:00."; table (employee with shift and plant, status chip, IN, OUT, Hours with "7 h 20 m of 8 h", Late, Early exit, Overtime, Marks, "Open day"); marks legend; paging. Below 768 px each row is a card with IN / OUT / Hours tiles and a 48 px "Open day" button.
- Register: month picker + plant picker; sticky name column and header, 31 day cells (48 px high, code text), then 12 total columns; fade and hint "Scroll sideways inside this card"; legend with all 11 codes and the dash; corrected day = black dot. Phone: list of employees, expanded one shows a month card of chips and a totals grid.
- Employee tab: month calendar (code + IN-OUT), totals card, corrections and leave list, shift-swap card (Super Admin: "Work another shift on one day", "Cancel the swap"), 12 month calendars with a code in every square (1 column on phone, 2 on tablet, 2 beside the totals on desktop).
- Drawer (right sheet 580 px, full screen on 360): header with previous / next day, rules box, role line, status chips, 9 result tiles, "Explain this day" (numbered sentences from the server), timeline with icon + word (First IN, Last OUT, Extra punch, Not used for this day, Flagged, Saved offline, reviews, corrections with state), sticky footer buttons.
- Corrections: tabs Pending (count) / Decided / Punch approvals / My requests (heads only); request cards with kind badge, requested times, reason, requested by, Before -> After panels (server result), Approve / Reject (reason 3-300) or Withdraw. "Correct many people" button in the header.
- Wizard (5 steps: Plant and day, What to add, People, Reason, Preview; up to 200 people): preview shows counts (46 change, 3 skipped, 49 chosen), table or cards of before -> after, skipped rows with code (CORRECTION_NEAR_PUNCH, ON_LEAVE); Super Admin button "Create 46 corrections and approve all" (heads: "Send 46 requests"); done screen with batch card and "Reverse the whole batch" (reason required).

## Proposed i18n keys (en-IN)
| Key | Text |
|---|---|
| attendance.title | Attendance |
| attendance.subtitle | One row for every person and day, worked out by the server from the punches. |
| attendance.toolsRegister / attendance.downloadMuster | Monthly register / Download daily muster |
| attendance.decideBanner.title | {{count}} days to decide |
| attendance.decideBanner.text | Short-hours days wait for a decision. Set each one to Present, Half-day or Absent. |
| attendance.decideBanner.show | Show them |
| attendance.filter.date / plant / status / search | Date / Plant / Status / Code or name |
| attendance.filter.type / department / category / contractor / shift | Type / Department / Category / Contractor / Shift |
| attendance.filter.exceptions / corrected / clear | Has exceptions / Corrected / Clear filters |
| attendance.tolerance | {{shift}} {{start}}-{{end}}: On time until {{onTime}}. Leave from {{leave}}. |
| attendance.status.present / half_day / short_hours / absent / incomplete / leave / weekly_off / holiday / worked_off_day / in_progress | Present / Half-day / Short hours / Absent / Incomplete / Leave / Weekly off / Holiday / Worked on off day / In progress |
| attendance.inProgress.inside / notArrived / left | Inside since {{time}} / Not arrived yet / Left at {{time}} |
| attendance.col.employee / in / out / hours / late / earlyExit / overtime / marks | Employee / IN / OUT / Hours / Late / Early exit / Overtime / Marks |
| attendance.hoursOf | {{worked}} of {{shift}} |
| attendance.mark.corrected / pending / flagged / extra / exceptions | Corrected / Correction pending / Flagged punch, not checked yet / Extra punches / {{count}} exception |
| attendance.openDay | Open day |
| attendance.showing | Showing {{shown}} of {{total}} people |
| attendance.empty.title / text | No attendance for these filters / Nobody matches the date and filters you chose. Try another date, or clear the filters. |
| attendance.error.title / text | The list could not be loaded / Check your internet connection and try again. Nothing was changed. |
| attendance.register.title / subtitle | Monthly register / One cell for every person and day. Open a cell to see the day. |
| attendance.register.month / correctedDot / scrollHint | Month / A black dot means the day was corrected. / Scroll sideways inside this card to see all 31 days and the month totals. The name stays in place. |
| attendance.register.total.* | Present days, Half-days, Short-hours days, Absent, Leave paid / unpaid, Weekly offs, Holidays, Worked on off days, Incomplete, Worked hours, Overtime hours, Late count |
| attendance.register.legend / legend.none | Legend / No result (future day or not employed) |
| attendance.code.P / HD / SH / A / INC / PL / UL / WO / H / WO-W / H-W | Present / Half-day / Short hours / Absent / Incomplete (OUT missing) / Paid leave / Unpaid leave / Weekly off / Holiday / Worked on a weekly off / Worked on a holiday |
| attendance.employee.last12 / last12Hint | Last 12 months / Each square has its register code, so colour is never the only cue. |
| attendance.employee.corrections / monthTotals | Corrections and leave / Month totals |
| attendance.swap.title / button / cancel / date / shift / reason | Work another shift on one day / Work another shift on one day / Cancel the swap / Date (today or later) / Shift (same plant) / Reason |
| attendance.swap.line | Swapped to {{shift}} on {{date}} |
| attendance.day.window | Punches from {{from}} to {{to}} count for this day. |
| attendance.day.result.* | IN (first), OUT (last), Worked, Worked for the status, Payable, Late, Early exit, Overtime |
| attendance.explain.title | Explain this day |
| attendance.explain.late / outAtEnd / statusSum / noOvertime | IN {{time}}: {{min}} minutes late (on time until {{until}}). / OUT {{time}}, at the shift end. / Worked for the status {{worked}} of {{shift}}, so {{status}}. / No overtime: you left at the shift end. |
| attendance.explain.source | Worked out by the server, the same way as the list and the register. |
| attendance.timeline.title / firstIn / lastOut / extra / notUsed / offline / counts / flagged | Timeline / First IN: starts the hours / Last OUT: ends the hours / Extra punch: not used for the hours / Not used for this day / Saved offline, sent {{time}} / Counts / Flagged: {{reason}} |
| attendance.timeline.reviewApproved | Approved as OUT |
| attendance.timeline.reasonHidden | Reason: only the Super Admin can see it |
| attendance.day.roleSuper / roleHead | You are the Super Admin: you can correct this day directly. / You are the Plant Head: you can ask for a correction. The Super Admin decides. |
| attendance.day.correct / ask / openPunchLog | Correct / Ask for a correction / Open in punch log |
| corrections.title / subtitleSuper / subtitleHead | Corrections / Requests from the Plant Heads and the Corporate Head wait here for your decision. / Ask for a change to a day. The Super Admin decides. |
| corrections.tab.pending / decided / approvals / mine | Pending / Decided / Punch approvals / My requests |
| corrections.kind.add_punch / add_in_out / ignore_punch / set_status | Add a punch / Add IN and OUT / Ignore a punch / Set the status |
| corrections.kind.*.hint | One missing IN or OUT / Both are missing, for example a gate outage / Hide a wrong punch / Present, Half-day or Absent |
| corrections.kind.ignoreDisabled | This day has no punches to ignore. |
| corrections.state.pending / approved / rejected / withdrawn / reversed | Pending / Approved / Rejected / Withdrawn / Reversed |
| corrections.before / after / serverResult | Before / After / Day result worked out by the server |
| corrections.approve / reject / withdraw / reverse | Approve / Reject / Withdraw / Reverse |
| corrections.rejectReason / rejectConfirm | Why is it rejected? (shown to the requester) / Reject this request |
| corrections.reasonRange | 3 to 300 characters |
| corrections.askedBy / waiting | Asked by {{name}} / Waiting for the Super Admin |
| corrections.dialog.titleSuper / titleHead | Correct this day / Ask for a correction |
| corrections.dialog.what / in / out / nightHint / reason / preview | What do you want to do? / IN: date and time / OUT: date and time / For a night shift the OUT can be on the next day. / Reason / Preview of the day |
| corrections.dialog.infoSuper / infoHead | You are the Super Admin: this takes effect at once and is saved in the audit log. / The Super Admin decides. Nothing changes until it is approved. |
| corrections.dialog.save / send | Save the correction / Send the request |
| corrections.warn.nearPunch | A counted punch exists at {{time}}, {{min}} minutes away. A correction this close to a real punch is not allowed. Choose a different time. |
| corrections.approvals.title / hidden | Punch approvals / Reasons are only for the Super Admin |
| corrections.approvals.approved / notAccepted | Approved / Not accepted |
| corrections.bulk.button / title | Correct many people / Correct many people |
| corrections.bulk.step.plantDay / what / people / reason / preview | Plant and day / What to add / People / Reason / Preview |
| corrections.bulk.willChange / willSkip / chosen | people will change / will be skipped / chosen, up to 200 allowed |
| corrections.bulk.skipped | Skipped |
| corrections.bulk.createSuper / sendHead | Create {{count}} corrections and approve all / Send {{count}} requests |
| corrections.bulk.done / reverseBatch / reverseWarn | {{count}} corrections made and approved / Reverse the whole batch / Reversing the batch undoes all {{count}} corrections at once. You must give a reason, and it is saved in the audit log. |
| corrections.skipReason.CORRECTION_NEAR_PUNCH / ON_LEAVE | A counted punch is 2 minutes from this time / On paid leave that day |

All rows, cards and chips wrap and use no fixed widths for text, so longer Marathi or Hindi strings fit.

## Colours (tokens.css, Steel & Signal)
Ink `#0e1726`, muted text `#4a5567` (7.5:1), primary `#1f3a93`, page `#f5f6f8`, card `#fff`. Status pairs (text on soft background, each with icon + word or code):
| Status | Code | Icon | Text / background |
|---|---|---|---|
| Present | P | circle-check | `#04694b` / `#e6f5ee` |
| Half-day | HD | contrast | `#8f5300` / `#fff3d6` |
| Short hours | SH | hourglass | `#8a3a00` / `#ffe9d6` |
| Absent | A | circle-x | `#b42318` / `#fdecea` |
| Incomplete | INC | circle-help, dashed edge | `#5b2c91` / `#f1e9fb` |
| Leave | PL, UL | calendar-heart | `#1a3282` / `#eaeefb` |
| Weekly off | WO | moon | `#4a5567` / `#eef1f5` |
| Holiday | H | sun | `#5a4a00` / `#fbf3cf` |
| Worked on off day | WO-W, H-W | briefcase | `#0b5560` / `#e0f3f5` |
| In progress | (none) | loader, white with primary edge | `#1f3a93` / `#fff` |
Request states: Pending blue, Approved green, Rejected red, Withdrawn grey, Reversed amber, each with its own icon. Corrected = black dot / pencil icon. The "12 days to decide" banner uses the Short-hours orange family. The small register and heatmap codes (10 to 11 px) are a visual aid on top of the readable tables and the day drawer; they are never the only cue (code letters inside).

## States
- Loading: shimmer skeleton rows under the tolerance line (list); drawer and dialog show skeleton tiles (same shimmer; not drawn separately); "Preview" shows a spinner in its box while the server works.
- Empty: list "No attendance for these filters" with "Clear filters"; corrections tabs "No requests waiting" (same state block); register "No employees for this plant and month".
- Error: list state with wifi-off icon, error code and "Try again"; forms show the field error under the field and `errors.<CODE>` from the server; the warning dialog shows the blocked preview and a disabled send button.
- Roles: Super Admin corrects directly and decides; Corporate Head and Plant Head ask (own plant for Plant Head); M4 review reasons are hidden from the heads (lock tag); leave reasons shown only to the Super Admin (decision 0036 line 7).

## Accessibility and motion
44 px minimum controls, 48 px primary buttons, visible 2 px focus ring, status never by colour alone (icon + word or code), dialogs and drawer are `role="dialog"` with a close button and previous / next day, registered cells and squares are buttons with an aria-label (name, day, code, corrected), dashes have `aria-label="none"`. Motion: sheet slides in 320 ms, dialog scales in 240 ms, shimmer and the In progress icon spin only under `prefers-reduced-motion: no-preference`.

## Components and sources (all free; log in docs/decisions/ui-component-sources.md at build time)
shadcn/ui Table, Tabs, Dialog, Sheet, Badge, Select, Calendar-style grid, Toast (MIT); Lucide icons (ISC) via unpkg for the mockup; Inter (SIL OFL); TanStack Table for the list and register; Motion for sheet and dialog transitions. No paid component and no copied artwork; the layout habits follow the existing admin pages and the M4 gate B mockups.
