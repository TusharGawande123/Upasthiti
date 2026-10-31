# M5 design gate A: live dashboard and emergency muster (mockups)

Spec: `docs/specs/M5-attendance-reports.md` 4.1, 4.2 and 7 rule 17. Mockup only: static HTML with fake data (`data.js`, invented names, plant K134 at 09:02, Wednesday 28/10/2026). No app code touched.
Look: Steel & Signal, Inter, icon + word + colour, light, en-IN (DD/MM/YYYY, 24 h, `7 h 45 m`). `tokens.css`, `m3.css`, `gc.css`, `shell.js` are copied from `m4/gate-c` (shell.js: two menu entries added, top-bar plant filter removed because M5 puts the picker on the page); everything new is `m5.css`.
No component code is copied from outside libraries (tiles and cards are drawn by hand in the shadcn style); Lucide icons (ISC) as before.

Open `dashboard.html#state` or `muster.html#state` in Chrome (needs internet for Inter and Lucide); add `?shot` before `#` to hide the state tag and freeze animation. Re-render all: `node docs/design-refs/m5/gate-a/shoot.mjs`.
PNGs in `screenshots/`: `NN-screen-state-WIDTH.png` at 360, 768 and 1280 px, full page. Checked by script: no sideways page scroll at 360, 768 or 1280 (the muster table is a card list at 360 and scrolls inside its card if needed).

| Screen | File | States (hash) |
|---|---|---|
| 1 Dashboard, one plant | `dashboard.html` | default, stale, loading, picker-open, demo, not-started, no-employees, plant-head, menu-open |
| 2 Dashboard, All plants | `dashboard.html` | all-plants, all-plants-demo, all-plants-loading |
| 3 Emergency muster | `muster.html` | default, search, loading, offline, empty, all-plants, plant-head, demo, picker-open, print |

Also `screenshots/03-muster-print-a4-page1.png`: the print sheet at real A4 size (794 x 1123 px).

## Layout
**Dashboard.** Title, date, plant picker (right; full width on a phone), live line "Updated 09:02 · refreshes every 30 seconds" with a pulsing green dot. Tiles grid: 4 columns (1280), 3 (768), 2 (360). Order: Inside now (hero, 2 wide, big number, permanent/temporary bar), Expected today, Arrived, Late, Not arrived yet, On leave, Off today, Exceptions, Days to decide (wide, with chips). Then two cards (Temporary workers on site per contractor with bars, "No contractor" last; Shifts today), then "Devices, checks and set-up" (the kept M1-M4 cards). Each tile is one link to the attendance list with the matching filter. "On outside work: 3" is a small line in the hero (rule 17 amendment).
**All plants.** Table, plant code opens that plant, Inside now emphasised, tinted total row. Below 768 px: cards, Total card first. A plant without a start date shows a grey "Not started" row or card. Demo row: dashed amber "Demo" badge, not in the total.
**Muster.** Big title with siren icon, plant picker, blue note, control card (count 72 px "214 people inside", list time, Print primary and Download PDF, both 64 px high), search (52 px), list (table from 768, cards at 360), footer "Showing 14 of 214" with Show more. All plants: one collapsible block per plant with its count.
**Print (A4 portrait, black and white).** Heading "Emergency muster · plant", list time, big count, roll-call line (done by / time / assembly point), tick box column, department heading rows with counts ("continued" when a department breaks over a page), footer with printed time and "Page n of N".

## Texts and proposed i18n keys
| Key | Text |
|---|---|
| dashboard.live.title | Dashboard |
| dashboard.live.plant | Plant |
| dashboard.live.allPlants | All plants |
| dashboard.live.yourPlant | Your plant |
| dashboard.live.updated | Updated {{time}} |
| dashboard.live.refreshes | refreshes every 30 seconds |
| dashboard.live.stale | Could not refresh at {{time}}. Showing numbers from {{old}}. |
| dashboard.live.tryAgain | Try again |
| dashboard.live.insideNow | Inside now |
| dashboard.live.people | people |
| dashboard.live.permanent | Permanent: {{count}} |
| dashboard.live.insideTemporary | Of which temporary: {{count}} |
| dashboard.live.outsideWork | On outside work: {{count}} |
| dashboard.live.expected, .expectedSub | Expected today, Working day, not on leave |
| dashboard.live.arrived, .arrivedSub | Arrived, {{percent}}% of expected |
| dashboard.live.late, .lateSub | Late, Permanent staff, after the grace time |
| dashboard.live.notArrived, .notArrivedSub | Not arrived yet, Shift start and grace time are over |
| dashboard.live.onLeave, .onLeaveSub | On leave, Approved leave today |
| dashboard.live.offToday, .offTodaySub | Off today, Weekly off or holiday |
| dashboard.live.exceptions, .exceptionsSub | Exceptions, Incomplete, short hours, flags, corrections |
| dashboard.live.daysToDecide, .daysToDecideText | Days to decide, {{count}} days to decide |
| dashboard.live.shortHours, .incomplete | {{count}} Short hours, {{count}} Incomplete |
| dashboard.live.decideSub | This month. Each day waits for a decision before any salary estimate. |
| dashboard.live.temporaryOnSite | Temporary workers on site |
| dashboard.live.noContractor | No contractor |
| dashboard.live.shifts | Shifts today |
| dashboard.live.shiftLine | {{name}} {{from}}-{{to}} · {{expected}} expected · {{arrived}} arrived · {{late}} late |
| dashboard.live.shiftNotStarted | Shift not started |
| dashboard.live.keptTitle | Devices, checks and set-up |
| dashboard.live.demoSwitch, .demoSwitchHint | Show demo plants, Saved in this browser. Demo plants are never in the totals. |
| dashboard.live.demoChip | Demo plants shown |
| dashboard.live.table.* | Plant, Inside now, Expected, Arrived, Late, Not arrived, On leave, Exceptions, Total |
| dashboard.live.notStartedShort | Not started |
| dashboard.live.notStarted, .notStartedText, .setStartDate | Attendance has not started at this plant yet. Live numbers begin on the attendance start date of the plant. Until then nobody is counted as late or absent. Set the start date |
| dashboard.live.noEmployees, .noEmployeesText, .goEmployees | No employees at this plant yet. Add employees or import an Excel sheet, then the numbers appear here. Go to Employees |
| muster.title | Emergency muster |
| muster.note | The list shows people whose last punch is IN. Visitors and people who did not punch are not on it. |
| muster.count | {{count}} people inside (one: 1 person inside) |
| muster.listTime | List of {{time}} (offline: List of 09:02, saved copy) |
| muster.print, muster.downloadPdf | Print, Download PDF |
| muster.offline | No connection. This is the list of {{time}}. People who punched since then are missing. |
| muster.pdfNeedsConnection | Download PDF needs a connection. Print works. |
| muster.search | Search code, name, department or contractor |
| muster.matches | {{count}} of {{total}} people match "{{query}}" |
| muster.columns.* | Code, Name, Type, Category, Department, Contractor, IN time, Attendance device |
| muster.type.permanent, .temporary | Permanent, Temporary |
| muster.showing, .showMore, .showAll | Showing {{shown}} of {{total}} people. Print and PDF include everyone. · Show {{count}} more · Show all {{count}} |
| muster.empty, .emptyText | Nobody is inside right now. When someone punches IN at an attendance device, they appear here. |
| muster.print.rollCall | Roll call done by: / Time: / Assembly point: |
| muster.print.tick, .page, .printedBy | Tick, Page {{n}} of {{total}}, printed {{time}} by {{name}} |

Room for longer Marathi/Hindi: labels wrap (no fixed widths), table headers can break onto two lines.

## Colours (all from tokens.css)
Ink `#0e1726` (18:1), muted text `#4a5567` (7.5:1), primary `#1f3a93` (10:1). Amber tone: soft `#fff3d6`, text `#7a4500` (7.3:1), edge `#e3b45a`. Danger `#b42318` (6.6:1; used for large numbers, always with icon and word). Success `#04694b`. Permanent/temporary bar: solid blue vs hatched yellow (pattern, not only colour). Offline line: 2 px red border, text `#6e140c`. Stale line: amber border, text `#5c3500`. Zero numbers `#5f6b7d` (5.4:1).
Never colour alone: every tile and chip has an icon and a word; the hatched bar has a text legend with the counts.

## States
Loading: skeleton tiles, rows and cards. Stale: yellow line with Try again; the live dot becomes a warning icon (no pulse). Empty: Not started, No employees, Nobody is inside (green check). Offline (muster): red line plus saved list time; Print stays, Download PDF is dashed and disabled with the reason. Plant Head: fixed "Your plant" label instead of the picker. Demo: chip under the title, demo row in All plants, not in the total.

## Motion
Tiles fade up with 45 ms stagger; changed numbers flash soft amber for 0.9 s on refresh and count up in the build (Motion); live dot pings every 2 s; tile hover lifts 2 px. All off with `prefers-reduced-motion`. Polling pauses while the tab is hidden (spec).

## Accessibility
Tiles are links with a full sentence label ("Late, 12. Open the list."); the live line and the muster count are `aria-live="polite"` (tiles are not, to avoid chatter every 30 s); tables have a caption and `scope`; stale and offline lines are `role="alert"`; the picker is a labelled listbox button; focus ring 3 px blue; targets 44 px or more (muster Print and PDF 64 px); the demo switch is `role="switch"`.

## Open points for the review
1. The Total row excludes demo plants (the row note says so). OK?
2. Print is A4 portrait with department heading rows (the Department column is dropped to fit); landscape is the alternative.
3. The mockup shows 14 rows then "Show more"; the real page may load all rows (214 is small) or page them.
4. The hero tile also carries "On outside work: N" (rule 17 amendment).
