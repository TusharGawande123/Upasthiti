# M4 design gate C: admin screens for location, offline and flagged punches

Status: **for review by Anuradha / Tushar** · ui-designer · 28/10/2026
Spec: `docs/specs/M4-anti-proxy-offline.md` §4.7 (attendance devices page, health monitor+, offline badge F-36, alert F-46, readiness),
§4.9 (punch log), §4.10 (dashboard, F-48), §4.11 (settings), §7 rules 15, 17, 18 (status, settings table, code names).
Look: the approved admin "Steel & Signal" look. `tokens.css`, `m3.css`, `gc.css` are copied **unchanged** from `docs/design-refs/m3/gate-c/`;
`shell.js` is that file extended (offline badge, sidebar count, "Needs review" entry, alert banner, phone menu, device sample data);
everything new is in `m4c.css`. Inter, Lucide 0.469 icons. Static HTML with made-up data (plants K134, K135, PC1, PC2, SPI, TP1, X280;
people Sunita Jadhav, Vijay Salunke, ...). **No photo of any person.** "Today" in the mockup is Wednesday 28/10/2026. No application code,
spec or decision file was touched.

## How to open
Open `index.html` in Chrome (needs internet for Inter and Lucide) or run `python -m http.server 8770` in this folder. A state is the URL hash,
e.g. `01-devices.html#drawer-offline`; add `?shot` before the `#` to hide the state tag.
Screenshots: `screenshots/NN-screen-state-WIDTH.png`, every state at **360 x 800, 768 x 1024 and 1280 x 800** (174 files; full page, except
dialogs and the phone menu which are viewport only; palette PNGs, largest 317 KB). Automatic check on every capture: no sideways page scroll at
360, 768 or 1280 (a table scrolls inside its own card), no script errors. Tooling is a Playwright script in the session scratchpad using
`e2e/node_modules`, outside the repo.

| File | States (hash) | Spec |
|---|---|---|
| `01-devices.html` | default · filter-offline · corporate-head · plant-head · empty · loading · error · drawer-online · drawer-offline · drawer-needs-location · drawer-sending · drawer-corporate-head · revoke-waiting · revoke-clean | 4.7 |
| `02-shell.html` | default · two-offline · banner-hidden · all-online · plant-head · corporate-head · menu-open | 4.7 (F-36, F-46, F-17) |
| `03-punch-log.html` | default · filter-flagged · filter-offline · filter-empty · corporate-head · plant-head · loading · export · detail-edge · detail-travel · detail-offline-unproven · detail-offline-ok · detail-stale · detail-sync-conflict · detail-too-old · detail-reviewed-no · detail-approved · detail-ch · detail-ph | 4.9 |
| `04-dashboard.html` | default · attention · all-clear · digest-earlier · digest-oldest · plant-head · corporate-head · loading · error | 4.10 |
| `05-settings.html` | default · gps-raised · margin-raised · alert-error · refresh-error · save-reason · corporate-head · plant-head · loading | 4.11 |

## Wording and roles
Every text people read says "attendance device"; "kiosk" appears only in comments and code names (`kiosk_offline_after_minutes` is not shown
to people: the settings screen shows plain labels). Super Admin sees everything. Corporate Head and Plant Head see flags, review results and
device status as read-only text and badges (no Review buttons, no "Switch off", no "Add"). The Corporate Head sees the offline **badge** but
never the amber alert banner and never the map in the device drawer (a short lock line explains it). The Plant Head sees the alert and the map for
their own plant only.

## 1. Attendance devices (`01-devices.html`, `/admin/kiosks`)
- **Layout:** title, one primary action (Super Admin: "Add an attendance device"), a status filter row (All, Online, Offline, Needs location,
  Switched off, Waiting for pairing, each with a count), then one card with the table and a "Live · updates every 30 s" note.
- **Status chips (icon + words + a second cue, never colour alone):** Online = green, wifi icon and a slowly pulsing dot; Offline since 08:12 =
  amber, crossed wifi; Needs location = amber with a **dashed** border, crossed pin; Sending saved punches (12) = blue, spinning refresh icon;
  Switched off = grey, power-off; Waiting for pairing = white with a dashed grey border, hourglass.
- **Columns:** device (name, plant code, type), status, last contact, last punch, saved punches waiting (count + "oldest 08:01", "–" for 0),
  last sync, location (±m + inside / edge / outside with icon), app version, Details. The first column is sticky; at 1280 the table scrolls
  inside its card because 9 columns do not fit next to the sidebar. Below 768 each device is a card with the same facts.
- **Drawer** (side sheet, full screen on a phone): reason line (amber for Offline and Needs location, blue for Sending), Facts, Health,
  Last 7 days, Last position and the fence, footer "Switch off this attendance device" (Super Admin).
  - **Health monitor+:** 2-column tiles. Battery: bar + % + "Charging / Not charging", or a dashed battery + "Not reported" with the reason
    ("This browser does not share battery information." / "A PC on mains power."). Camera: Working / Not working. Storage: free and used.
    Offline saving: "Ready" (green) or "Off" (amber, "Not enough storage: the browser has less than 250 MB free.", S-38). App version.
  - **7-day timeline:** one bar per day (00 to 24 h), online = solid green, offline = grey **hatched**, the shift 07:00 to 19:00 outlined with a
    dashed blue band, per-day % at the right, legend, and the summary line "Online 96% of shift time this week" (green; amber below 95%). Each row
    has an `aria-label` with the offline times for screen readers. Today's bar stops at 08:26.
  - **Map:** a drawing (the real page reuses Leaflet + OpenStreetMap, decision 0014): fence, 25 m margin ring (dashed amber), last position dot,
    accuracy circle, a hatched "Neighbouring plant" to show why the margin matters in MIDC Waluj; caption "Last position: inside the fence /
    at the edge / outside" with metres and report time.
- **Revoke dialog:** M1 style dialog. With waiting punches an amber box: "12 punches are still waiting on this attendance device. If you
  switch it off now, they are lost. Wait until it shows 0 if you can." + oldest time + "If the device is lost or stolen, switch it off now."
  Revoking stays allowed. With 0 waiting only a plain line. Cancel is the left button, "Switch off now" is red.
- **Empty:** icon, "No attendance devices yet", 3 steps and "Add an attendance device" (Super Admin) or a read-only sentence. **Loading:**
  6 skeleton rows. **Error:** red alert + "Try again". **filter-offline:** an info strip "Showing only attendance devices that are offline" +
  "Show all" (the target of the top-bar badge link).
- **Motion:** pulsing dot, spinning refresh icon, sheet slide-in 260 ms, dialog scale-in 240 ms, all inside `prefers-reduced-motion: no-preference`.
- **Accessibility:** status chips have words; filter buttons are `aria-pressed`; touch targets 44 px; table headers are real `th`.

## 2. Shell (`02-shell.html`)
- **Top-bar badge:** amber pill "1 attendance device offline" (plural "2 attendance devices offline"); below 768 px it shortens to "1 offline"
  (still icon + number; full text in `aria-label`). Hidden when all are online. Links to the devices page filtered Offline.
- **Sidebar:** the "Attendance devices" entry gets a small amber count chip with a warning icon (icon + number). I also added the
  "Needs review" entry with a dark amber count (Super Admin only), because spec 4.8 asks for it and the badge in M4 shares the same group.
- **Alert banner (F-46):** full-width amber bar under the top bar on every admin page, 5 px amber left edge, crossed-wifi icon, the spec text with
  the name and time in bold, buttons "View" and "Hide". Two or more offline: the first is named and "and 1 more is offline" is added. After "Hide"
  (state banner-hidden) a small info line shows what happened; the badge stays. Not shown to the Corporate Head. Below 768 the buttons go full width.
- **Plant readiness card:** one card per plant with the older lines (guess, see Q4) and two new lines marked "New": "Attendance device online"
  (Yes / Offline) and "Location good" (Inside / Not good / Unknown) each with icon + word + a reason line; header badge "Ready for the gate" or
  "Needs attention".
- **Phone menu:** the same entries as the sidebar in a left sheet, so the count is reachable on a phone.

## 3. Punch log (`03-punch-log.html`, `/admin/punches`)
- **Result column** ("Result, flags and review", replaces the separate Direction column): `✓ IN` / `OUT` / `Rejected`, then the amber **⚑ Flagged**
  badge (white with an amber 1.5 px border and a flag icon), then the review mark ("To check" dashed grey, "Confirmed" green, "Not accepted"
  red, "Approved as IN" green), then the flag text(s) with the code in small grey. Flagged rows have an amber left edge (rejected rows keep red).
- **Time column:** the punch time; offline rows add the grey badge "Saved offline, sent 09:02" (hourglass).
- **Chips:** added "⚑ Flagged n" (amber) and "Saved offline n" (grey hourglass). **Filters:** a second row "New filters": Flagged, Saved offline,
  Review. Empty result has its own state.
- **Actions:** Super Admin gets a flag-icon button "Review" on rows that are still to check (opens the review panel of §4.8); everyone gets Details.
  Cards on a phone have text buttons.
- **Detail panel additions:** *Time* (two tiles "Punch time" and "Received by the server" with the delay; green line "Time proof: anchored to
  server time" or amber "Time not proven (device restarted while offline)"), *Flags* (one card per flag with the plain text, the longer help text
  and the code), *Location* (edge distance, reading age; related punch with speed for `IMPOSSIBLE_TRAVEL`), *Review* (To check / Confirmed /
  Not accepted with who, when, reason and "This punch no longer counts as IN/OUT."), footer "Open in Needs review" (Super Admin). Other roles
  see "Only the Super Admin reviews flagged punches."
- **Export dialog:** lists the existing columns and the four new ones, "Punch time", "Saved offline", "Flags", "Review" (marked New).
- **Flag texts (new keys `punchReasons.<CODE>` and `_help`):** see the list below.

## 4. Dashboard (`04-dashboard.html`)
- **"To check: 7 flagged punches":** big amber number, one sentence ("The oldest is from 25/10/2026"), primary button "Open Needs review". Zero:
  green check, "To check: nothing", "Every flagged punch has been looked at. Well done." Super Admin only.
- **"Attendance devices":** three tiles (Online / Offline / Need location) with icon, word and a big number, each linking to the filtered list;
  below, one line per offline or needs-location device; footer repeats "6 online · 1 offline · 0 need location" as text. A zero tile is grey.
  All roles in their scope; the Plant Head sees "Attendance devices at K134".
- **Daily review digest (F-48, Super Admin):** "Yesterday (27/10/2026)" with date arrows (back disabled at 7 days), table with one row per
  plant: Flagged, Rejected (names an employee), Still to check, Device offline during shifts ("2 h 10 min" with an icon, or "No offline time").
  Non-zero numbers are links. Total row. A quiet day shows a green "A quiet day..." strip. Phone: one card per plant with badges.
- States: loading skeletons, per-card error with "Try again".

## 5. Settings (`05-settings.html`)
- Two cards in the M3 pattern (header with icon, "New in M4" badge, sub-groups, one setting per row: label, help text, default and allowed
  range with the unit, input with unit). Card 1 "Location and anti-proxy": groups "Location of the device" (4), "Travel and two devices" (3),
  "Hints for the reviewer" (2). Card 2 "Offline attendance devices": "Saving on the device" (4), "Telling the office" (2). Defaults and ranges are
  from §7 rule 17. Below 768 the sub-groups are accordions.
- **MIDC Waluj warning** (amber box under the row, only when the value is raised): "Plants in MIDC Waluj are close together. A larger value may
  let a device at a neighbouring plant punch here." on the accuracy limit and the fence margin (also shown in the reason dialog).
- **Cross-check errors** in red under the field, save button disabled: "The alert time cannot be shorter than the offline time." and "The
  refresh time must be shorter than the maximum age."
- **Reason dialog:** as M3 (changed values listed, warning repeated, reason 10 to 300 characters).
- Corporate Head / Plant Head: read-only inputs and a "View only" strip.

## Deviations from the spec text
1. Result and Direction are one column ("Result, flags and review"), as in M3 where Reason was merged; the spec only says the flag sits next to IN/OUT.
2. The review mark "To check" is also shown on unreviewed flagged rows (the spec lists only the three review results). Needed so the Super Admin
   can scan the queue; other roles see "Not reviewed yet".
3. "Saved offline n" chip label (spec: "⏳ Offline n"). The word "Offline" alone could be read as "device offline"; hourglass icon kept.
4. Alert banner for two or more offline devices names the first and says "and N more": the spec gives only the single-device text.
5. The digest and "To check" card use plain words for the plants; "rejected with an employee" is the spec's own phrase.
6. Added the "Needs review" sidebar entry with its count in the shell (spec 4.8) so the sidebar is shown complete; the review screen itself
   is a different design gate.
7. Status colour: Offline and Needs location are both amber (matching the banner and badge), told apart by icon, words and a dashed border.
8. Revoke dialog: added the sentence "If the device is lost or stolen, switch it off now." under the spec's amber line.
9. Map in the drawer is a drawing; the real one is Leaflet like the fence page.

## Flag and status texts that need translation keys (all English, `en-IN`)
- `punchReasons.LOCATION_AT_EDGE`: "Location at the edge of the fence" (+ `_help`: "The device was just outside the drawn fence, inside the 25 m margin. This can be a normal GPS drift at the gate.")
- `LOCATION_STALE`: "Location reading was old" · `IMPOSSIBLE_TRAVEL`: "Too far from the last punch, too fast" · `TWO_DEVICES_SOON`: "Also punched at another attendance device a moment ago" · `OFFLINE_TIME_UNPROVEN`: "Time not proven (device restarted while offline)" · `OFFLINE_TOO_OLD`: "Saved too long before it was sent" · `SYNC_ORDER_CONFLICT`: "Sent out of order with another punch" (help texts are in `03-punch-log.html`, object `FLAG`).
- Review marks: "To check", "Not reviewed yet", "Confirmed", "Not accepted", "Approved as IN". Punch log: "Flagged", "Saved offline, sent {time}", "Saved offline", "New filters", "Flagged: any / only flagged", "Saved offline: any / yes / no", "Review: any", "Punch time", "Received by the server", "Time proof: anchored to server time", "Result, flags and review", "Open in Needs review", "Only the Super Admin reviews flagged punches.", "A flag does not stop the punch. It asks someone to look.", export dialog texts.
- Devices: the six status words ("Online", "Offline since {time}", "Needs location", "Sending saved punches ({n})", "Switched off", "Waiting for pairing"), column titles, "Not reported", "Working / Not working", "Offline saving: Ready / Off", "Not enough storage: the browser has less than 250 MB free.", "Online {n}% of shift time this week", "Storage kept by the browser", drawer reason lines, revoke dialog texts, empty/error texts, "No offline time".
- Shell: "{n} attendance device(s) offline", "{n} offline", alert texts (single and "and {n} more"), "View", "Hide", readiness lines and reasons.
- Dashboard: "To check: {n} flagged punches", "To check: nothing", "Attendance devices", "Need location", "Daily review digest", "Yesterday ({date})", digest column titles, "A quiet day...".
- Settings: the 15 labels, help texts and the three group titles per card, the two cross-check errors, the MIDC Waluj warning.
- Room for longer Marathi/Hindi strings: chips and badges wrap, table cells use `white-space: nowrap` only for times; labels in rows wrap; buttons keep 44 px height.

## Open questions (with my recommendation)
1. **Time column: punch time or received time?** Spec says punch time with both in the detail. Recommendation: keep punch time in the list (the day filter then matches the attendance day) and show "sent 09:02" beside it, as designed. For a punch saved 3 days ago the log of the **punch day** shows it, which can surprise: it appears on 25/10 although it arrived on 28/10 (state `detail-too-old`). Recommend a one-line hint under the day picker when new late arrivals were added to a past day.
2. **Offline vs Needs location colour.** Both amber. Recommendation: keep (amber = "act"), the dashed border and icon separate them; red stays for rejections.
3. **Settings reason per card or per save?** Designed as one reason per save (M1 behaviour). Recommendation: keep.
4. **Which older readiness lines exist** (I drew Fence drawn, Shift added, Categories added, Attendance device paired from memory of the M1 plant page). Please check the real list before building; only the two new lines are fixed by the spec.
5. **Digest scope:** "Still to check" in yesterday's row counts only that day's punches, so the total (5) can differ from the "To check: 7" card (all unreviewed days). Recommendation: keep, with the sentence "A number opens Needs review for that plant and day."
6. **Timeline for a device with no data yet** (just paired): not drawn; recommend showing "No history yet" instead of 7 empty bars.
7. **Plant Head and the alert for a plant with 2 devices:** the banner counts only that plant's devices. Recommendation: as designed.

## New dependencies and component sources
None. Everything is plain HTML/CSS in the existing token set; icons are Lucide (ISC); Inter is SIL OFL. No component was copied from a library for this gate, so `docs/decisions/ui-component-sources.md` needs no new line. Build in M4 should use shadcn Sheet, Dialog, Tabs-free segmented buttons and Details/Accordion already in the project.

## Files
`index.html`, `01-devices.html`, `02-shell.html`, `03-punch-log.html`, `04-dashboard.html`, `05-settings.html`, `m4c.css` (new), `shell.js`
(extended), `tokens.css`, `m3.css`, `gc.css` (copied unchanged), `notes.md`, `screenshots/` (174 PNGs).
