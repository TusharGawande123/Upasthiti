# M2 design gate C: punch log, photos, gate notices, kiosks, settings, poster (admin screens)

Status: **approved by Anuradha on 21/10/2026** (answers at the end) · ui-designer · 21/10/2026
Spec: `docs/specs/M2-qr-attendance.md` §4.10 (punch log), §4.11 (gate notices), §4.12 (kiosks, settings, poster), §5.3 to §5.5,
§7 rules 1, 11, 12, 13, 20, 21, §9. Role rules used here (they override older text): photos ("View photo", "Compare") and the dark-photo
mark are **Super Admin only**; the Corporate Head and the Plant Head see the photo state as text only. A Plant Head sees punches made at
kiosks of their own plant; a card of a person of another plant shows "Card of another plant" with no name and no code. The kiosk "online"
badge and the storage usage meter are **not** in M2 (pending Tushar) and are not drawn.

These are static HTML mockups with fake data (invented people such as Sunil More T-2041, Asha Kale T-2060, Ravi Shinde T-3050; plants K134,
X280, TP1; kiosks "K134 main gate", "TP1 gate", "X280 gate"). Every "punch photo" is a neutral grey placeholder with a silhouette and the
label "SAMPLE · not a real photo". They are not app code. They reuse the approved look unchanged: `tokens.css`, `shell.css`, `shell.js`,
`bc.css`, `d.css`, `d.js`, `d-extra.js`, `m2.css` (copied from gate A). New in gate C: `c.css`, `c.js` (shell patch, reason texts, photo
placeholder), `punches.js`, `kiosks.js` and the six screens. "Today" in the mockups is Tuesday 20/10/2026, about 10:05 IST.

## How to open

Open `index.html` in Chrome (needs internet for Inter, the Tailwind CDN and Lucide), or run `python -m http.server 8767` in this folder.
States are URL hashes, as in gates A and B. Add `+ph` (Plant Head Sameer Joshi, plant X280) or `+ch` (Corporate Head Vikram Deshmukh) to any
state, for example `01-punch-log.html#loading+ph`; `#plant-head` and `#corporate-head` also work alone. Screenshots (1440 px wide, full
page; dialogs at 1440 × 900) are in `screenshots/`, named `NN-screen-state.png`.

Tooling in this folder (mockup only): `shoot.mjs` takes every screenshot with the repo's Playwright (`node shoot.mjs`, or `node shoot.mjs 03`
for one screen); `compress_png.py` turns them into 256-colour PNGs (run from `backend/` with `uv run python ../docs/design-refs/m2/gate-c/compress_png.py`)
so the folder stays at about 5 MB; `render_poster.py` renders the real poster (from `backend/`: `PYTHONPATH=. uv run python ../docs/design-refs/m2/gate-c/render_poster.py`).

## Screens, states and the spec sections they cover

| File | States (hash) | Spec |
|---|---|---|
| `01-punch-log.html` | default · auto-refresh · past-day · empty · loading · error · export-too-large · plant-head · corporate-head | §4.10, §5.3, §7 rules 1, 4, 21, §9 |
| `02-photo-dialogs.html` | view · view-dark · view-loading · purged · not-available · storage-unavailable · compare · compare-none | §4.10 (F-29, F-31), §5.3, §8, §9 |
| `03-notices.html` | list · new · new-filled · new-errors · new-all-plants · edit · end-now · edit-ended · empty · plant-head · new+ph · corporate-head | §4.11, §5.4, §7 rules 1, 11, §9 |
| `04-kiosks.html` | list · sound-off · plant-tab · plant-head · corporate-head · plant-tab+ph · plant-tab+ch | §4.12, §5.5, §7 rules 1, 13 (F-1, F-27) |
| `05-settings.html` | editing (retention lowered) · range-error · save-reason · corporate-head · plant-head | §4.12, §7 rules 4, 12, §9 |
| `06-plant-detail.html` | Super Admin (K134) · plant-head (X280) · corporate-head | §4.12, §5.5, §7 rules 1, 20 (F-34) |

Screenshots (45 states + 2 poster thumbnails + `poster.pdf`):
`01-punch-log-{default, auto-refresh, past-day, empty, loading, error, export-too-large, plant-head, corporate-head}.png` ·
`02-photo-dialogs-{view, view-dark, view-loading, purged, not-available, storage-unavailable, compare, compare-none}.png` ·
`03-notices-{default, new, new-filled, new-errors, new-all-plants, edit, end-now, edit-ended, empty, plant-head, new-plant-head, corporate-head}.png` ·
`04-kiosks-{default, sound-off, plant-head, corporate-head, plant-tab, plant-tab-plant-head, plant-tab-corporate-head}.png` ·
`05-settings-{default, range-error, save-reason, corporate-head, plant-head}.png` ·
`06-plant-detail-{default, plant-head, corporate-head}.png` · `poster-k134.png`, `poster-x280.png`, `poster.pdf` (real output of
`app/modules/printing/poster_pdf.py`).

## What each screen shows (layout, colours, motion, states)

All colours come from the approved tokens; the few new pairs are in the contrast table. Motion is the approved set (fade up 8 px, dialog
scale-in 240 ms, toast, skeleton shimmer) plus two small ones (new-row fade-in, live dot blink), all transform/opacity only and all inside
`prefers-reduced-motion: no-preference`.

### 01 Punch log (`/admin/punches`)
- **Head:** title, one-line description, and **Export day (.xlsx)** with the note "No photos in the file" (every role that sees the list).
- **Day summary chips** (GET `/punches/summary`): ⇥ *Accepted IN* n, ⇤ *Accepted OUT* n, ⊗ *Rejected* n, and for the Super Admin only ☾ *Dark photos* n.
  Each chip is a toggle button: pressing it filters the table (Rejected = `decision=rejected`, Dark photos = `dark_only`). This replaces a separate
  "Dark photos only" button, which did not fit the filter row at 1440 px. A line "Rejected because:" lists `rejected_by_reason` as small chips
  ("4 Already punched (scanned again too soon)", "3 Card of another plant" …); each one sets the Reason filter.
- **Filters:** a day stepper (‹ Today 20/10/2026 ›, the next arrow is off on today), search "Code or name", Result, Kiosk, Reason. The plant is the
  top-bar plant filter (the kiosk's plant), as in M1.
- **Meta row:** "342 punches · newest first" and, on the right, the live hint "● Live · updates every 30 s · last 10:05:02". On a past day it says
  "Past day · the list does not update". After a refresh with new rows: "2 new punches · updated 10:05:32"; new rows get a small blue **New** tag
  under the time and a soft blue background that fades (`#auto-refresh`).
- **Table:** Time (HH:mm:ss, tabular) · Employee (name over code; "? Unknown card" when the card was not identified; "Card of another plant" with an
  eye-off icon for the Plant Head) · Direction (IN / OUT tags with icons, "–" for rejected) · Result (✓ Accepted / ⊗ Rejected chip) · Reason (short
  text over the code, e.g. "Card expired / QR_EXPIRED") · Kiosk (name over the plant code when "All plants") · Photo (as text: "Photo stored" +
  "kept until 19/12", "Photo deleted on 13/10", "No photo", "⚠ Photo not saved"). Rejected rows also have a 3 px red left edge (shape cue, the chip
  carries the meaning). Super Admin only: a ☾ **Dark photo** mark under "Photo stored" and the row buttons **View photo** and **Compare** (Compare
  only when the card is known; View photo only when the photo is stored). No thumbnails in the list (every view is audited).
- **States:** `#empty` (Super Admin with plant X280 chosen): "No punches yet today at this plant." with a second line and buttons "Open Kiosks" and
  "‹ Yesterday"; the export button is hidden when there is nothing to export. `#loading`: chip and row skeletons, `aria-busy`. `#error`: red alert
  "Could not load the punch log … Punches at the gates are not affected." with Try again. `#export-too-large`: red alert under the head "The file was
  not made. At most 5,000 punches per file. Choose one plant. (EXPORT_TOO_LARGE)" with "Choose a plant" (focuses the plant filter); the counts show a
  hypothetical very busy day (see question 1). `#past-day` (14/08/2026, older than 60 days): photos show "Photo deleted on 13/10", no photo buttons.
  `#plant-head`: X280 only, read-only banner, kiosk filter fixed to "X280 gate", first row "Card of another plant / WRONG_PLANT", no photo actions and no
  dark chip. `#corporate-head`: all plants, names visible, no photo actions, banner.

### 02 Photo dialog and Compare (Super Admin only)
- **View photo** (900 px dialog): the 320 px snapshot shown at 480 × 360 (placeholder) on the left; on the right Time (DD/MM/YYYY HH:mm:ss IST), Kiosk,
  Employee, Result + direction, Photo ("Stored · deleted automatically on 19/12/2026"); a grey note with an eye icon **"Viewing is recorded in the audit
  log."** and one purpose line ("Use this photo only to check card sharing. It is never used for face recognition and is not in any export."). Footer:
  **Compare with earlier punches**, ‹ Older / Newer › (step through the list without closing; each step is a new audited view), **Close** (primary).
- **view-dark:** dark placeholder plus an amber note "Dark photo. … Ask the plant to switch on the gate light at K134. The punch itself was decided as normal."
- **view-loading:** skeleton in the photo area and "Loading the photo…".
- **purged (410):** a striped "empty photo" box: "This photo was deleted on 13/10/2026 (kept 60 days)." + `SNAPSHOT_PURGED`; only Close.
  **not-available (404):** "No photo is available for this punch." **storage-unavailable (503):** "Photos cannot be loaded right now. Try again later." with
  Try again and "Nothing is lost: the photo stays stored until 19/12/2026". No audit note in these three (nothing was shown).
- **Compare** (1180 px): "This punch" (400 px, blue frame) next to "Earlier punches of card C000123 (3)", newest first, each with date + time, kiosk and result
  under it (one earlier punch is "Rejected · Card of another plant" at TP1: the kind of evidence the Super Admin looks for). Description: "Look for a
  different person using the same card." Note: "4 photos shown. Each photo shown is recorded in the audit log." Footer: Back to this photo · Open employee ·
  Close. **compare-none:** "No earlier photos of this card." with the 60-day reason.

### 03 Gate notices (`/admin/notices`)
- **List:** title, description, **New notice** (Super Admin, Plant Head), a tip line ("A kiosk shows at most 3 notices at once, Important ones first, and
  takes up a new notice within 2 minutes. Nothing is deleted …"). Toolbar: segmented state tabs **All 8 · Showing now 3 · Scheduled 2 · Ended 3** (icon + word +
  count), "Shown at: Any plant" filter (any plant / all-plant notices only / one plant), search. Columns: Notice (megaphone icon, or warning icon for Important)
  · Shown at (code, or 🌐 "All plants") · Level (Normal / ⚠ Important, amber text with icon) · When (IST) ("From … / To …") · State chip (🖥 Showing now green,
  📅 Scheduled blue, ◎ Ended outline + "Ended on time" or "Ended early 13/10 11:20 · Asha Rao") · Created by (name + date and time) · actions **Edit** and
  **End now** (red outline) when `can_change`. Ended rows are greyed and have no actions. Order: Showing now and Scheduled first, then Ended, newest first.
  A Marathi notice is shown as typed (`lang="mr"`, Noto Sans Devanagari loaded).
- **New / Edit form** (1120 px dialog, two columns): left **Shown at** (select: All plants or one plant; Plant Head: a locked field "X280 · your plant"),
  **Notice text** (textarea, `maxlength=200`, counter "72/200", amber "186/200 · 14 left" from 180, help "One line of plain text, shown exactly as typed.
  Marathi or Hindi works too."), **Level** (two choice cards Normal / Important), **Starts** and **Ends** (date + time inputs in IST; defaults now → today
  23:59; quick chips "Now", "Tomorrow 06:00", "Today 23:59", "Tomorrow 23:59", "+7 days"; hint "At most 90 days after the start"). Right: **live preview**
  "How it looks at the gate": the right-hand panel of the gate B scanning screen drawn at real kiosk size (24 px text, same notice styles) and zoomed to
  62 %, with the new notice in a dashed blue outline and the notices already showing at that kiosk dimmed, sorted as the kiosk sorts them (Important
  first, at most 3). Captions explain the outline, the 3-notice limit and rotation, and (all plants) that K134 is shown as an example.
- **States:** `#new` (empty, placeholder "Your notice appears here."), `#new-filled` (Important, preview on top), `#new-errors` (summary alert "Fix 2 things
  before saving. Nothing was saved." + "Write 1 to 200 characters." + "The end must be after the start, within 90 days."), `#new-all-plants` (long text),
  `#edit` (footer has **End now** on the left), `#end-now` (alert dialog: "End this notice now? It disappears from the K134 gate kiosk within 2 minutes. It stays
  in this list as Ended; nothing is deleted."; focus starts on Cancel), `#edit-ended` (`NOTICE_ENDED`: "This notice has ended. Create a new one." with
  **Copy into a new notice**; footer only Close), `#empty` ("No gate notices yet" + New notice).
- **Roles:** Plant Head sees X280 and all-plant notices; all-plant rows show "🔒 Set by the Super Admin for all plants" instead of buttons; a blue info note says
  what they can do. Corporate Head: grey read-only banner, no New button, no action column.

### 04 Kiosks: Sound switch and last self-test
The approved M1 C1 list is kept; two columns are added before the row menu: **Last self-test** ("✓ 20/10 07:58", "◌ Never tested" in amber with a dashed
icon, "–" for a kiosk waiting for pairing) and **Sound** (a shadcn Switch followed by the word and icon "🔊 On" / "🔇 Off"; "–" for a revoked kiosk). A
footer note explains Sound Off ("still shows every result, but plays no tones and no voice … company-wide switches are in Settings") and the self-test.
`#sound-off`: TP1 switched off, its row briefly highlighted, toast "Sound switched off at TP1 gate. The kiosk takes it up within 2 minutes." with Undo.
Plant Head: X280 kiosks only, switches work (own plant). Corporate Head: the word + icon without a switch, read-only banner, no row menu.
`#plant-tab`: the same columns in the plant detail Kiosks tab (plant header has the poster button).
To fit 1440 px, two small changes to the M1 list: the plant cell shows only the code (the plant name is its tooltip), and "New code" moved from a row button
into the status cell ("Code ends in 06:12 · New code"). The M1 green pulse dot next to "Last seen" is removed so nobody reads it as the pending "online"
badge (question 4).

### 05 Settings
Same layout as the approved M1 settings (group list on the left, rows with label + help, value with unit, default and range, sticky save bar, reason
dialog). The groups that M2 does not change are drawn collapsed only to keep the mockup short. **Punch rules** (badge "In use from M2"): Punch cool-down 2 min,
Earliest OUT after IN 30 min (New), Longest open IN 20 h (New), Impossible travel speed (locked, "Used from M4"). **Snapshots**: Snapshot retention 60 days
(7–365) and Dark photo limit 40 of 255. **QR cards** (New in M2): Default card validity 2 months (1–36), "Ends soon" warning 14 days (1–60). **Kiosk sound and
screen** (New in M2): Voice On/Off, Sounds On/Off (switch + word), Result screen time 4 s (2–10), Rejected screen time 6 s (3–15), and a link to the per-kiosk
switch. Default state: retention lowered 60 → 30 shows an amber alert in the row: "Lowering to 30 days also shortens the photos already stored. Photos older
than 30 days are deleted tonight at 00:05 IST and cannot be brought back. The gate posters say 'kept for 60 days': download and print them again after
saving." The help text also says what raising does. `#save-reason` repeats the consequence ("Photos older than 30 days will be deleted tonight at 00:05 IST.
This cannot be undone.") above the required reason. `#range-error`: "Use a value from 3 to 15." and the save bar says "1 needs fixing" (save off).
Read-only roles: values in grey value boxes (no inputs, no reset links, no save bar) and the banner "Read-only. Only the Super Admin changes settings."
(In the mockup the save bar is static so full-page screenshots show it at the end; in the app it stays sticky as in M1.)

### 06 Plant detail with the gate poster
The poster button **Download gate poster (A4 PDF)** ↗ sits in the plant header (all tabs) for the Super Admin (next to Edit details) and for the own Plant
Head (alone). The Overview tab also gets a **Gate poster** card with a thumbnail of the real poster page (opens the PDF), a two-line description (steps,
"NOT ACCEPTED" advice, photo notice with the current retention days, no personal data), the primary button, and "Opens the PDF in a new tab. Print it again
after the photo retention changes." The Corporate Head sees neither (not in the role matrix) and a banner says who handles it.

## Design decisions

1. **Photo state is text for everyone; only the Super Admin gets buttons.** The same column reads the same for all roles, so a Plant Head can still tell a
   worker "your photo was not saved" without seeing it.
2. **Every photo view says it is audited, at the point of viewing**, and Compare says how many views it records. View photo and Compare are separate buttons
   so the Super Admin opens only what is needed (data minimisation).
3. **The summary chips are the quick filters** (and the reason chips under them). This keeps one filter row at 1440 px and makes the numbers useful.
4. **A Plant Head never sees anything of another plant's person:** "Card of another plant" with an eye-off icon, no name, no code, no photo; the reason still shows,
   so the gate guard can be told what happened.
5. **Gate notice preview at real kiosk size** (zoomed out), not a tiny full-screen picture: the admin judges line length and the Important tag as a worker will
   see them.
6. **Nothing is deleted:** "End now" ends a notice and keeps it in the list; its dialog says so in one sentence. Lowering retention says exactly what is
   deleted and when, twice (row and save dialog).
7. **Read-only roles see the data, not disabled buttons** (gate A decision): banners say who can change it; the Plant Head's all-plant notices say
   "Set by the Super Admin for all plants" in the action cell.
8. **Status is never colour alone:** every chip has an icon and a word, rejected rows also have an edge, the switch has the word On/Off next to it, the
   counter adds "14 left".

## Open design questions (each with a recommendation)

1. **Export limit can hardly be reached.** One IST day at ~650 people gives about 1,300 accepted punches plus rejections, far below 5,000 rows, so
   `EXPORT_TOO_LARGE` only appears with a misbehaving kiosk. *Recommendation:* keep the guard and the message as built; no extra UI (the mockup shows a
   hypothetical busy day only to draw the state).
2. **Chips as filters instead of a "Dark photos only" button.** *Recommendation:* yes, as drawn (the Dark photos chip is the `dark_only` filter, Super Admin only);
   the chips get `aria-pressed`.
3. **"Older / Newer" in the photo dialog.** Stepping through photos without closing is quicker for checking a queue, but each step writes a view to the
   audit log. *Recommendation:* keep it; the audit note stays visible. Say no if every view should be a deliberate click from the list.
4. **M1 pulse dot next to "Last seen".** Removed here so it is not mistaken for the pending kiosk "online" badge (F-36). *Recommendation:* keep the plain text
   "2 min ago / Today 10:13" until Tushar decides F-36.
5. **Kiosk list width.** Adding two columns needed the plant name moved into a tooltip and "New code" moved into the status cell. *Recommendation:* accept;
   alternative is a horizontal scroll at 1440 px, which we avoided elsewhere.
6. **Default sort and tab of the notices list.** *Recommendation:* tab "All", Showing now and Scheduled first, then Ended (newest first), as drawn.
7. **Poster text when the plant name contains the code.** The real poster prints "Sheet Shapers India Pvt Ltd (K-134) · K134" (name, then code). Harmless;
   *recommendation:* leave as is.
8. **Dark photo limit unit.** The setting is an average brightness 0–255; the mockup shows the unit as "of 255". *Recommendation:* keep the unit text, help
   explains it.

## Accessibility notes

- **Contrast** (admin rule ≥ 4.5:1 for text, 3:1 for UI parts). Existing token pairs as in gate A (ink 18:1, secondary 7.5:1, status text on soft backgrounds
  5.6 to 6.7:1). New pairs in gate C:

  | Pair | Where | Ratio |
  |---|---|---|
  | `#ffffff` on `#2c3442` | Dark photo mark | 12.5:1 |
  | `#2c3442` on `#e7e9ef` | Dark photos chip icon | 10.3:1 |
  | `#ffffff` on `#1f3a93` | "New" tag on refreshed rows | 10.1:1 |
  | `#0e1726` / `#4a5567` on `#f3f6fd` | new-row background | 16.6:1 / 7.0:1 |
  | `#34404f` on `#ffffff` | "Ended" chip | 10.5:1 |
  | `#4a5567` on `#fafbfc` | meta row, kiosk notes | 7.3:1 |
  | `#0e1726` / `#4a5567` on `#f3f5f8` | notice preview side panel | 16.4:1 / 6.9:1 |
  | `#8f5300` on `#ffffff` | "Photo not saved", "Never tested", Important level | 6.2:1 |
  | `#b42318` on `#ffffff` | reason counts, End now button | 6.6:1 |
  | `#04694b` on `#e6f5ee` | Showing now chip | 6.0:1 |
  | `#8a93a3` switch track (off) on `#ffffff` | Switch outline (non-text, 3:1 rule) | 3.1:1 |
  | `#ffffff` on `rgba(14,23,38,.82)` over grey | "SAMPLE" label on placeholders | ≥ 10:1 |

  The kiosk preview uses the gate B kiosk colours unchanged (≥ 7:1, see gate B notes).
- **Never colour alone:** see decision 8.
- **Keyboard order (punch log):** sidebar → search (Ctrl+K) → plant filter → account → Export → summary chips (toggle buttons, `aria-pressed`) → reason chips →
  day stepper (‹, value, ›) → search → Result / Kiosk / Reason (listbox popovers: arrows, Enter, Esc) → table rows: View photo, Compare → pagination.
  Row buttons have full names ("View photo of the punch at 10:04:38").
- **Live updates:** the 30 s refresh never moves focus and does not announce each refresh; only "2 new punches" is announced politely (`role="status"`).
  The refresh pauses while a dialog is open and on past days. With reduced motion the new-row fade and the live-dot blink are off (the "New" tag stays).
- **Dialogs:** `role="dialog"` (photo, compare, notice form) or `alertdialog` (End now); `aria-modal`, titled by the heading; focus starts on the first field
  (form), on Close (photo) or on Cancel (End now); Esc closes and focus returns to the opening button. Placeholder images have alt text; real photos get
  "Punch photo of Sunil More, 20/10/2026 10:04:38, K134 main gate".
- **Forms:** labels on every input (date and time inputs have visually hidden labels "Starts date", "Starts time"); errors are linked with `aria-describedby`
  and `aria-invalid`, plus a summary alert; the counter is `aria-live="polite"` and should announce only at 180, 190 and 200 characters.
  Level is a `radiogroup`; Sound and Voice are `role="switch"` with `aria-checked` and an accessible name ("Sound at TP1 gate").
- **Tables:** `th scope="col"`, hidden header "Photo actions" / "Actions", loading table `aria-busy="true"`.
- **Dates and numbers:** DD/MM/YYYY, 24-hour IST, Indian grouping (5,000; 1,00,000), tabular figures; codes use the slashed-zero alternates.
- **Translations later:** no fixed-width buttons; reason texts and notice text wrap; chips wrap to a second line. Marathi notice text is marked `lang="mr"`.

## Components and sources (all free; nothing was copied from a third-party site in this gate)

| Component in the mockups | Base / source | Licence |
|---|---|---|
| Table, Badge, Button, Input, Textarea, Select, Tabs, Alert, Skeleton | shadcn/ui, https://ui.shadcn.com/docs/components | MIT |
| Dialog (photo, compare, notice form), AlertDialog (End now), RadioGroup (level choice cards) | shadcn/ui Dialog, AlertDialog, RadioGroup (on Radix UI, https://www.radix-ui.com) | MIT |
| Switch (kiosk Sound, Voice, Sounds) | shadcn/ui Switch (Radix Switch) | MIT |
| Toggle buttons (summary chips), segmented state tabs | shadcn/ui Toggle, Toggle Group, Tabs | MIT |
| Filter popovers | shadcn/ui Popover + Command | MIT |
| Date and time fields | shadcn/ui Date Picker (Calendar = react-day-picker, MIT) + native time input | MIT |
| Toast "Sound switched off …" | shadcn/ui Sonner (https://sonner.emilkowal.ski) | MIT |
| Icons (history, megaphone, image, image-off, moon, columns-2, eye, eye-off, volume-2, volume-x, badge-check, circle-dashed, printer, monitor-check, circle-stop, …) | Lucide, https://lucide.dev | ISC |
| Font | Inter, https://github.com/rsms/inter; Noto Sans Devanagari (Marathi notice), https://fonts.google.com/noto | SIL OFL 1.1 |
| Kiosk notice preview | our own gate B kiosk styles (`m2/gate-b/kiosk.css`), re-used | own |
| Photo placeholders | own inline SVG (grey gradient + silhouette), no real person | own |
| Poster thumbnail and `poster.pdf` | rendered by our own `poster_pdf.py` (fpdf2 LGPL-3.0 unmodified, Inter OFL, Lucide ISC); PNG via pypdfium2 (Apache-2.0 / BSD-3) | our output |
| Animations (fade up, scale in, new-row fade, live dot, shimmer) | own CSS now; Motion (MIT) in the build | MIT |

CDNs used only by the mockups: Tailwind CDN 3.4.16 (MIT), Lucide 0.469.0 (ISC), Google Fonts (OFL). Screenshot tooling: Playwright from `e2e/node_modules`
(Apache-2.0), Pillow (MIT-CMU) for compression. Nothing paid.

## What I could not verify

- Real devices and real snapshots: the photo dialogs use placeholders; how a real 320 px gate photo looks enlarged to 480 px (blur) was not checked.
- The live-preview zoom uses CSS `zoom` (works in Chrome/Edge and Firefox 126+); the build may prefer `transform: scale` with a measured height.
- Screen reader output was not tested with NVDA or TalkBack; the notes above are from the markup.
- The export file, the 30 s refresh and the switch round-trip are drawn, not run against the real API.
- Long translated strings (Marathi/Hindi UI) were not drawn; layouts wrap, but the punch log row height will grow.
- Screenshots were compressed to 256 colours; gradients behind dialogs may show slight banding (not in the real UI).

## Approval and answers (2026-10-21)

Design gate C was approved by Anuradha on 2026-10-21 after looking at the screenshots. Her answers:

1. **"Older / Newer" in the photo dialog:** kept. Each photo shown is its own audited view.
2. **Kiosks list:** the plant column shows the code (the name as a tooltip), "New code" moves into the status cell, and the
   M1 pulse dot next to "Last seen" is removed (so it is not read as the pending online badge, F-36).
3. **Punch log:** the day's number chips are the filters (the Dark photos chip is the dark-only filter, Super Admin only); no
   separate button.
4. **Notices list order:** Showing now and Scheduled first, then Ended; newest start first within each group.
5. The designer's other recommendations stand: keep the 5,000-row export guard, "of 255" as the dark limit unit, the poster
   subtitle as printed, the "Copy into a new notice" action after `NOTICE_ENDED`, and no poster button for the Corporate Head.
