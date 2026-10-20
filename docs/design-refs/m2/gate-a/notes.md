# M2 design gate A: QR cards (admin screens)

Status: **for the team to review** · ui-designer · 20/10/2026
Spec: `docs/specs/M2-qr-attendance.md` (approved), `docs/decisions/0009-m2-spec-audit.md` (the earlier decisions that are back in
force: a card works only at the employee's own plant, the plant is printed on the card, only the Super Admin issues, revokes and
prints, cards only for QR-method employees, Corporate Head and Plant Head are read-only).

These are static HTML mockups with fake data (invented people, codes such as T-2041, plants K134 / X280 / TP1, contractor
"Shree Manpower Services"). They are not app code. They reuse the approved M1 look: `tokens.css` ("Steel & Signal", Inter, safety
yellow only as decoration), the admin shell (`shell.css`, `shell.js`: sidebar, top bar with plant filter, user menu, Ctrl+K box) and the
M1 gate B/C/D component styles (`bc.css`, `d.css`, copied unchanged). New in M2: `m2.css`, `m2.js` and the seven screens.

## How to open

Open `index.html` in Chrome (needs internet for Inter, the Tailwind CDN and Lucide), or run `python -m http.server 8765` in this folder.
States are URL hashes, as in M1. Add `+ph` (Plant Head, plant X280) or `+ch` (Corporate Head) to any state, for example
`01-qr-cards.html#loading+ph`. `#plant-head` and `#corporate-head` also work on their own. Screenshots (1440 px wide, full page; dialogs and
the Ctrl+K palette at 1440 × 900) are in `screenshots/`.

## Screens, states and the spec sections they cover

| File | States (hash) | Spec |
|---|---|---|
| `01-qr-cards.html` | default · selected · empty · loading · error · no-match · ending-soon · bulk-result · plant-head · corporate-head | §2.1, §4.6, §7 rules 1 and 3, §4.12 (link target of the dashboard card) |
| `02-test-cards.html` | default · new · empty · plant-head · corporate-head | §4.6 (tab "Test cards"), F-27, §7 rule 1 |
| `03-employee-card-panel.html` | active · none · face-employee · face-switched · reprint · revoked · expired · history · read-only · read-only+ph | §4.7, §7 rule 3 |
| `04-dialogs.html` | issue · issue-replace · issue-done · revoke · revoke-error · change-end · change-end-today · change-end-extend · bulk-issue · bulk-issue-result · bulk-revoke · print · print-error · print-too-many | §4.8, §4.9, §4.6, §5.1 errors |
| `05-card-layouts.html` | one page (real PDF output: employee card, long name, test card, A4 sheet) | §4.9, FR-14 |
| `06-dashboard-and-search.html` | default · plant-head · palette · palette-actions (+ph, +ch) · palette+ph · palette-other-plant+ph | §4.12 (F-33), §4.13, §5.6 |
| `07-import-result.html` | done · approved · confirm · issued · corporate-head · no-qr | §4.12 (F-38), §5.7, §7 rule 3 |

Screenshot names follow `NN-screen-state.png`, for example `01-qr-cards-selected.png`; `index.html` lists every state.

## What each screen shows (layout, colours, motion, states)

All colours come from the approved tokens; nothing new was added. Motion is the M1 set (fade up 8 px, dialog scale-in 240 ms, bulk bar
slides up, toast, skeleton shimmer), all inside `prefers-reduced-motion: no-preference`.

### 01 QR cards
- **Layout:** page title and one-line description, tabs "Employees (361)" and "Test cards (4)" (Super Admin only), then one card with two
  filter rows, the table, and a footer "Showing 1–14 of 361 · Page 1 of 8 · 50 per page". The default view is QR-method employees plus anyone
  who already has a card.
- **Table columns:** Employee (name over code) · Type and punch method · Plant · Contractor · Card serial · State · Valid until · Printed
  (count and last date). Type and punch method share one column to avoid a sideways scroll at 1440 px.
- **State chips (always icon + word, own shape):** ○ No card (dashed outline) · ● Active (green) · ⏳ Not yet valid (blue, calendar-clock) ·
  ⚠ Ends soon (amber) · ⌛ Expired (dark outline, timer-off) · ⊘ Revoked (red). The separate amber badge "Reprint needed (card shows K134)"
  sits under the chip, so a card can be "Active" and "Reprint needed" at the same time.
- **Filters:** search (code, name or card serial), Plant, Type, Punch method, Contractor, Category, State, Printed, and a toggle "Reprint needed".
- **#selected:** dark bulk bar "5 selected · Issue cards · Print cards (A4) · Revoke cards" (same pattern as the M1 employees list). A small
  white hint card above the bar explains what each button will do with this mixed selection: "3 get a new card, 2 skipped (1 already has a card,
  1 punches by face)", "2 of 5 have a card to print, at most 200", "2 active cards will be revoked". Skipped rows are never an error.
- **#bulk-result:** a green panel at the top of the table "37 cards issued. 3 skipped: they already have a card." with the skipped list
  (code, name, existing serial) and the button "Print the 37 new cards (A4)", plus a toast.
- **#empty:** "No cards yet. Select employees and press Issue cards." with a second line and buttons (see question 1).
- **#plant-head / #corporate-head:** no checkboxes, no bulk bar, no print button, no Test cards tab. A grey "Read-only" banner says why:
  "Only the Super Admin issues, prints and revokes cards, because a printed card works like a key to the gate." The Plant Head sees only X280
  (fixed plant badge instead of the plant filter, sidebar and search say X280); the Corporate Head sees all plants.

### 02 Test cards
Super Admin: an info note "A test card checks a gate kiosk, not a person", a table (serial T…, label, state, made by and on, last used at which
kiosk, printed count) and per-row **Print** and **Revoke** buttons (disabled for a revoked card), "New test card" in the card header and a small
dialog (label required). **Decision: the tab is hidden** for the Corporate Head and the Plant Head. Showing it read-only would invite the question
"why can't I print this?" for something they never use (a test card is handed to the guard by the Super Admin, spec US-15). If one of them opens
the link anyway, they get a plain "Only the Super Admin can open this page" page (`FORBIDDEN`) with a button to the QR cards list.

### 03 Card panel on the employee page
A "QR card" card next to the existing M1 "Employee" side card. It contains the state chip, optional banner, the real printed-card thumbnail (only
for Sunil More, because the real image shows him), a key-value list (serial, valid from, valid until with "in 181 days", issued by and on, printed
count and date, plant on the card, "At the kiosk": Accepted at K134 only / Rejected at every gate / Rejected: punches by face) and the action
row **Print card · Change end date · Issue new card · Revoke** (Super Admin only, Revoke is red and right-aligned). "See punches" is visible for
all roles. Card history is a collapsed row ("2 earlier cards") that opens to a table (serial, issued, valid until, state, revoked on and by, kind
and reason).
- **#none:** big "Mahesh has no QR card yet" with one button, Issue card. **#face-employee:** a short note, no button.
- **#face-switched:** amber banner "Revoke this card: the kiosk rejects it now." with a Revoke card button, and "At the kiosk: Rejected: punches by face".
- **#reprint:** amber banner "Reprint needed. Card shows K134; Sunil More is now at TP1. The card still works. Reprint it when convenient." with
  Print card; the thumbnail caption says "As printed: plant K134".
- **#revoked:** red banner with date and who, no Print, only **Issue new card**. **#expired:** blue banner, **Change end date** becomes the
  main button. **#read-only:** a grey footer "Only the Super Admin can print, change or revoke cards." instead of buttons (Corporate Head sees Sunil
  More; `#read-only+ph` shows Rutuja Salunkhe of X280).

### 04 Dialogs (Super Admin only; M1 dialog style)
- **Issue:** valid from (today), valid until (default today + 6 months − 1 day, helper button "+6 months"), optional note. **Replace** adds the
  amber alert "The current card C000123 will stop working at once." **Done:** green ring, "Card C000456 issued", dates, **Print now** (opens a new tab).
- **Revoke:** red alert "The card stops working at every gate immediately.", four choice cards (Lost, Damaged, Left the company, Other), reason (3+
  characters; the error state shows "Write at least 3 characters."). The danger button is red, Cancel is the neutral button.
- **Change end date:** new date, shortcuts "End today" and "Extend by 6 months", reason. Info "No reprint is needed. The end date is not printed
  on the card." The **End today** state warns "The card still works until 23:59 tonight (IST). To stop it right now, use Revoke instead." (question 2).
- **Bulk issue:** two tiles (3 will get a card, 2 skipped), a per-person result table with icon + word, valid until, reason. **Result:** "37 cards issued"
  with the skipped table and "Print the 37 new cards (A4)". **Bulk revoke:** red alert, tiles/table (3 revoked, 1 skipped: already revoked), kind + reason.
- **Print:** two choice cards "A4 sheets of 10" (1 sheet for 8 cards) and "One card per page" (85.6 × 54 mm, 8 pages), "Print at most 200 cards at a time",
  "Opens in a new tab", Open PDF. **Print error:** lists the revoked serials (`QR_CARD_REVOKED`) with "Print the other 6". **Too many:** 238 selected, `PRINT_TOO_LARGE`.

### 05 Card layouts
The four real PNGs (rendered from the actual PDF code) with numbered call-outs: (1) plant name and plant code printed (SRS FR-14), (2) name and code in big
letters, (3) contractor line, (4) issue date only, **no end date printed**, so it can be extended without reprinting, (5) card serial, (6) vector QR at
error-correction level Q, (7) privacy line. Plus long name and long contractor handling, the test card ("TEST – NOT AN ID CARD"), and the A4 sheet notes
(10 cards, cut marks, order by plant, contractor, code, at most 200 per print). Design note: the card stays black on white on purpose (office printers,
scanning in shop-floor light).

### 06 Dashboard, sidebar badge, Ctrl+K
Super Admin dashboard: the new card "Cards ending soon: 12 in the next 14 days" (amber edge, big number, warning icon + words, button "Review these 12 cards"
→ `01-qr-cards.html#ending-soon`), and the sidebar "QR cards" item with a blue count badge 12 (annotated in the mockup only). The Plant Head dashboard has no such
card or badge (the count endpoint is Super Admin only; a grey note explains). Ctrl+K: typing `C000123` shows **"C000123 · Sunil More · K134"** with
"Employee T-2041 · … QR card active until 19/04/2027" and an Active chip. With nothing typed, one "Commands" group by role: Super Admin: Issue QR card…, Print
QR cards…, QR cards, Punch log, Gate notices, New gate notice; Plant Head: QR cards, Punch log, Gate notices, New gate notice (own plant); Corporate Head: QR cards,
Punch log, Gate notices. A Plant Head who types a serial of another plant gets "No results" (search is scoped like the lists).

### 07 Import result (F-38)
After a Super Admin import: the M1 result ("352 created", Permanent 38 / Temporary 314) plus a blue "Next step: ID cards" box and the button **"Issue and print cards for
these 314 employees"**; the 38 face employees are named as left out. `#approved` is the same after the Super Admin approves a Corporate Head's import request.
`#confirm` is the dialog (314 get cards, 38 skipped, valid until, reason). `#issued` is the follow-up confirmation: "314 cards issued" and **two print parts**, because
one print can have at most 200 cards (question 4). `#corporate-head` (sent for approval) shows no card button, only a note. `#no-qr` (file with face employees only) shows
"No QR cards are needed for this file."

## Design decisions

1. **Status is never colour alone:** every chip has an icon and a word, and a different outline (dashed, solid, dark) so greyscale printing still separates them.
2. **One sentence per consequence:** each dangerous dialog says what stops working and when ("stops working at every gate immediately", "will stop working at once").
3. **Read-only roles see the data but no disabled buttons.** A disabled button with a tooltip is hidden from keyboard and touch users; a visible one-line banner explains
   why instead (matches M1 gate D).
4. **The real card art is shown in the product** (panel thumbnail and the layouts page), so the Super Admin sees what will print, including the plant, before printing.
5. **Reprint is advice, not an error:** an amber badge on a card that is still "Active".
6. **Bulk actions never fail on a mixed selection:** they show what will happen first and list skipped people afterwards (spec §7 rule 3).
7. Phone width was not designed in this gate (the admin is used on office PCs; the shell shows the icon rail below 1024 px as in M1). The list table scrolls sideways if needed.

## Open design questions (each with a recommendation)

1. **Empty-state wording.** The default list already shows every QR-method employee, so "No cards yet. Select employees and press Issue cards." can only
   appear when there is nobody to select (no temporary workers imported yet). *Recommendation:* keep the spec sentence and add the second line and the two buttons
   (Import from Excel, Go to Employees), as in the mockup.
2. **"End today" is not "stop now".** By the card lifecycle rule a card ends at 23:59:59 IST of its last day, so ending it "today" lets it work until midnight.
   *Recommendation:* keep the rule, and keep the hint in the dialog that points to Revoke for an immediate stop (shown in `#change-end-today`).
3. **Test cards tab for read-only roles.** Hidden (this mockup) or shown read-only? *Recommendation:* hidden; reason in the 02 section above.
4. **More than 200 cards after an import.** Print is limited to 200 per request (spec §4.9), but the example import has 314 QR employees. *Recommendation:* after issuing,
   offer print "in parts of 200" as in `07#issued` (two buttons). No spec change; the limit stays.
5. **Ctrl+K commands "Issue QR card…" and "Print QR cards…".** Their second step (choose the employee, or choose the cards) is not drawn. *Recommendation:* "Issue QR card…" opens a
   small employee picker and then the issue dialog; "Print QR cards…" opens the QR cards list with the "Not printed" filter on. Needs a yes before the build.
6. **Plant on the card as a column.** Spec §4.6 lists "card shows plant". *Recommendation:* show it only when it differs (the "Reprint needed (card shows K134)" badge) and in the card panel
   ("Plant on the card"), not as a column, to save width. Say if you want a column.

## Accessibility notes

- **Contrast:** all admin text uses the approved pairs: ink 18:1, secondary 7.5:1, status text on soft backgrounds 5.6 to 6.7:1 (AA 4.5:1 is the admin rule). New chip colours: Expired
  text `#34404f` on white about 10:1; the dashed "No card" chip uses the secondary grey (7.5:1). The yellow signal colour is decoration only (dots on the layouts page, active-nav bar).
- **Never colour alone:** icon + word on every status; outline style differs; banners carry an icon and a bold first sentence; the "Reprint needed" badge has a printer icon and words;
  the revoked/expired/active "At the kiosk" row spells the result in words.
- **Keyboard order (QR cards list):** sidebar links → search box (Ctrl+K) → plant filter → account menu → page title → tabs (arrow keys inside the tablist) → list search → filter buttons (each opens
  a listbox: arrows, Enter, Esc) → "Reprint needed" toggle (`aria-pressed`) → Columns → table: select-all checkbox, then for each row: checkbox, then the name link → pagination → the bulk bar (it is after
  the table in the DOM; when it appears it is announced by `role="region"`, and the count is in a status message "5 selected"). Esc clears nothing by itself; the × button clears the selection.
- **Focus:** the M1 2 px ring with 2 px offset on every control. Dialogs trap focus, start on the first field (destructive dialogs start on Cancel, as shadcn AlertDialog does), close with Esc and give
  focus back to the button that opened them. The new serial in the success dialogs is plain text, readable by screen readers ("Card C000456 issued").
- **Tables:** `th scope="col"`, row checkboxes labelled "Select Sunil More"; the loading table sets `aria-busy`; skipped lists use `role="list"`.
- **Dialogs:** `role="dialog"` or `alertdialog` (revoke, bulk revoke, print error), `aria-modal`, titled by the heading. Choice cards use `role="radiogroup"` / `role="radio"` with `aria-checked`.
- **Dates and numbers:** DD/MM/YYYY, 24-hour times in IST, Indian grouping (361, 1,00,000), tabular figures; card serials and employee codes use the slashed-zero alternates.
- **Motion:** every animation sits inside `prefers-reduced-motion: no-preference`; the skeleton shimmer stops with reduced motion.
- **Translations later:** no fixed-width buttons; badges can wrap ("Reprint needed" does); table cells can grow 30 to 40 %.

## Components and sources (all free; nothing was copied into the repo yet)

Everything here is hand-built in our tokens on the same base components as M1, so the rows for `docs/decisions/ui-component-sources.md` are the M1 ones plus these
uses. No code was copied from a third-party site in this gate.

| Component in the mockups | Base / source | Licence |
|---|---|---|
| Table, Badge, Button, Input, Textarea, Checkbox, Tabs, Alert, Skeleton | shadcn/ui, https://ui.shadcn.com/docs/components | MIT |
| Dialog and AlertDialog (issue, revoke, end date, bulk, print), RadioGroup (choice cards, print layout) | shadcn/ui Dialog, AlertDialog, RadioGroup | MIT |
| Bulk action bar (dark, floating) | same pattern as the approved M1 gate D employees list (own CSS, nothing copied) | n/a |
| Toast "37 cards issued" | shadcn/ui Sonner | MIT |
| Command palette Ctrl+K with a serial result | shadcn/ui Command (cmdk) | MIT |
| Filter buttons and the "Reprint needed" toggle | shadcn/ui Popover + Toggle | MIT |
| Skeleton rows | shadcn/ui Skeleton | MIT |
| Icons (qr-code, id-card, printer, ban, calendar-clock, timer-off, circle-dashed, triangle-alert, …) | Lucide, https://lucide.dev | ISC |
| Font | Inter, https://github.com/rsms/inter | SIL OFL 1.1 |
| Card images in `screenshots/card-*.png` | rendered by our own PDF code (fpdf2 LGPL-3.0 used unmodified, segno BSD-3-Clause, bundled Inter) | our output |
| Animations (fade up, scale in, shimmer) | own CSS now; Motion 14 (MIT) in the build | MIT |

CDNs used only by the mockups: Tailwind CDN 3.4.16 (MIT), Lucide 0.469.0 (ISC), Google Fonts (Inter, OFL). The real app bundles them.

## Approval and answers (2026-10-20)

Design gate A was approved by Anuradha on 2026-10-20 after looking at the screenshots. Her answers to the open questions:

1. **"End today"** keeps the rule: the card works until 23:59:59 IST of that day. The dialog shows the hint to use **Revoke** to stop a card at once.
2. **Ctrl+K "Issue QR card…" and "Print QR cards…":** an employee picker for Issue (then the issue dialog), and the QR cards list with the "Not printed" filter for Print.
3. **Test cards tab:** hidden for the Corporate Head and Plant Head (opening the link shows "Only the Super Admin can open this page").
4. The designer's recommendations stand: after an import with more than 200 QR employees, printing is offered in parts of 200; no separate "card shows plant" column (only the "Reprint needed" badge and the card panel); the extra line under the empty-state sentence.

Change (2026-10-20, Anuradha): the default card validity is now **2 months**. The mockups and screenshots
above still show "+6 months" and "Extend by 6 months"; the built screens show the number from the setting
("+2 months", "Extend by 2 months"). Nothing else in the design changes.
