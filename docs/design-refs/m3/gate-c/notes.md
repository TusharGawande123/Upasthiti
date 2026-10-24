# M3 design gate C: punch log, settings, dashboard, Ctrl+K, gate poster, privacy page

Status: **for review by Anuradha / Tushar** · ui-designer · 24/10/2026
Spec: `docs/specs/M3-face-attendance.md` §4.11 to §4.14, §5.5, §7 rule 13, §8.1, AC-24, AC-30, AC-36 to AC-38, AC-40. Plan step 26.
Look: unchanged "Steel & Signal" (`tokens.css` is the M2 / gate B file, byte for byte), `m3.css` and `shell.js` copied from gate B (the
shell only gained a configurable active menu item), new styles in `gc.css`. Inter, Lucide 0.469 icons, status always icon + word.
Static HTML with made-up names and codes (Sunita Jadhav EMP-0312, Vijay Salunke EMP-0123, Ramesh Patil EMP-0457, plants K134, K135,
PC1, PC2, SPI, TP1, X280). **No photo of any person**: photo slots are grey hatched boxes with an image icon. No app code;
`frontend/` and `backend/` are untouched.

## How to open
Open `index.html` in Chrome (needs internet for Inter and Lucide), or `python -m http.server 8768` in this folder. A state is the URL
hash, e.g. `01-punch-log.html#detail-code`; add `?shot` before the `#` to hide the state tag.
Screenshots: `screenshots/NN-screen-state-WIDTH.png` for **every state at 360, 768 and 1280 px** (126 files, full page; the reason dialog
of settings is viewport-only because the dialog is the point) plus `05-poster-k134-a4.png` and `05-poster-long-name-a4.png` (A4 at
1.5x, 1191 x 1684 px). All PNGs are 256-colour palette PNGs, largest 199 KB.
**Sideways overflow check:** every capture was tested with `document.documentElement.scrollWidth <= innerWidth`: **no failure** (one
4 px overflow of the dashboard empty state at 360 was found and fixed: the footer button may now wrap).
Tooling (kept outside the repo, in the session scratchpad): a Playwright script using `e2e/node_modules` (same approach as M2
`shoot.mjs`) and the M2 `compress_png.py` approach.

| File | States (hash) | Spec |
|---|---|---|
| `01-punch-log.html` | default · filter-asked · filter-no-face · filter-method · corporate-head · plant-head · loading · detail-face · detail-code · detail-code-failed · detail-needs-code · detail-qr-no-face · detail-ch · detail-ph · detail-loading | 4.11, 5.5, AC-24, AC-37 |
| `02-settings.html` | default · no-report · threshold-lowered · floor-error · save-reason · privacy-empty · from-consent · privacy-editing · corporate-head · plant-head · loading | 4.12, 7 rule 13, 8.1, AC-30 |
| `03-dashboard.html` | default · empty · plant-head · corporate-head · engine-starting · engine-failed · loading · error | 4.13, AC-36, AC-40 |
| `04-palette.html` | default · typed · picking · picking-results · plant-head · corporate-head | 4.13, AC-36 |
| `05-poster.html` | k134 · long-name | 4.14, 8.1 |
| `06-privacy.html` | default · contact-missing | 8.1 (SPDI Rule 4) |

## 1. Punch log (`01-punch-log.html`, `/admin/punches`)
- **Layout:** the real M2 page (`punches-page.tsx`) with additions only: header text now says "by card or by face"; chips; filter bar;
  count bar; table; pager. Header note becomes "No photos or scores in the file" (the export carries neither).
- **Chips** (the real `Chip`, still the filters): Accepted IN, Accepted OUT, Rejected, Dark photos (Super Admin), **Asked for code n**
  (all roles, amber, keyboard icon), **No face in photo n** (Super Admin only, neutral, dashed circle). Under them a quiet text line
  "Accepted by: 286 face · 6 code · 157 card" from the new summary counts (`face_accepted`, `code_accepted`; card = the rest). Small
  extra, read-only text (not buttons).
- **Filters:** new select **Method** (Method: any / Face / Face, by code / Card → `method`, `match_mode=code`); **Result** gains the
  option "Asked for code" (`asked_for_code=true`); "No face in photo" is the Super Admin chip (`no_face_photo=true`). Device and Reason
  as M2.
- **Table:** new column **Method** (Face = blue badge with scan-face; Card = outline badge with id-card). To fit 1280 without an inner
  scroll, the M2 **Reason column is merged into the Result column** ("Result and reason": badge, how line, reason words + code). See
  open question 3. Result lines: "By face", "By code", "Code typed, face did not match". The `needs_code` row has an amber dashed badge
  **Asked for code**, an amber left edge (rejected rows keep the red edge) and a link **"Then: By code 07:03:51"**; the follow-up row
  links back **"After: Asked for code 07:03:20"**. Employee cell: unknown faces say "Unknown face" / "Face not matched" (the API never
  names a `needs_code` or rejected face row). Photo column: "No photo · accepted face punch", "Photo of 07:03:20 · the Asked for code
  punch" (code-path row uses its `needs_code` photo, §5.5), "Photo stored" + **"No face in photo"** dashed badge (Super Admin, F-30).
  Last column: Super Admin keeps **View photo** / **Compare** (M2, audited); **every role** gets a **Details** button (panel icon).
- **Phone (< 768):** rows become cards (time, name, code · device · photo word, badges, how/reason lines, link, full-width buttons);
  chips in a 2-column grid; filters 2 columns.
- **Detail panel (new):** a right **side sheet** (shadcn Sheet = the project's Radix Dialog; 520 px; full screen on a phone). Sections:
  *Punch* (employee + Open employee, method, result + how, direction, reason, server time, device); *Steps of this punch* for code paths
  (07:03:20 Asked for code → 07:03:51 Accepted by code, each with "Open this punch"); **Face check, "Super Admin only"** tag: four score
  tiles (match score, second-best score with the gap, anti-spoof score, head turn in degrees), each with "Today's limit" and a verdict
  icon + word (Passed / Too low / Code asked / Not used), then challenge, match mode ("Whole plant (1:N)" / "Employee code (1:1)"),
  model, code tries; for code rows a box **"Code typed: EMP-0123 – face did not match"** naming that employee (green when the 1:1
  check then matched, amber "this can be a proxy attempt" when it did not); *Photo*: "No photo is kept for an accepted face punch."
  or the stored photo (grey placeholder) with **View photo** (audited) and Compare in the sticky footer.
  Corporate Head / Plant Head: same facts as text, then a grey note **"Scores, the typed code and photos are shown to the Super Admin
  only."** No score section, no photo buttons, no claimed employee for a rejected row ("Not named") - matching AC-24 (the API sends no
  `face` object to them).
- **Loading:** table skeleton rows; detail skeleton. **Error / empty:** unchanged M2 texts ("No punch matches these filters.").
- **Accessibility:** every status is badge icon + word; the amber/red row edge is backed by the badge; chips are `aria-pressed`
  toggle buttons; Details button has `aria-label="Details of the punch at 07:03:51"`; the sheet is a modal dialog with a labelled title
  and Close button (focus returns to the row's Details button); links between the two code-path rows are real links.
- **Motion:** sheet slides 32 px from the right + fade (260 ms, `--ease-out`), chips/rows no motion; all off with reduced motion.

## 2. Settings (`02-settings.html`, `/admin/settings`)
- **Face recognition card:** the existing card (group `face`) with a **report strip** at the top ("Accuracy report of 30/10/2026 (model
  buffalo_s, team test faces only)... Read the report", or grey "No accuracy report yet. These are starting values...") and **five
  sub-groups** in this order: Matching (match threshold, margin, ask-for-code floor, duplicate threshold) · Liveness and anti-spoof
  (same-person, live-face, head turn, straight face limit, head turns at the gate) · Picture quality (smallest face, sharpness,
  brightness) · Code entry and timing (threshold after a code, time for the head turn, time to type the code, code tries) · Hints (two
  re-enrol keys). All 18 keys of §7 rule 13 that are numbers.
- **Each row** = the real `SettingRow` (label, help, "Default: x · allowed a–b", input + unit, "Reset to default"), plus for the 9
  "report" keys a chip **"Report value: 0.46"** (or dashed "No report yet") and, when it differs, a text button **"Use 0.46"** (small
  extra: fills the draft, still needs Save + reason). Changed rows get a blue left edge and a "Changed" badge.
- **Warning:** when a `*_threshold` is lowered, an amber alert under the row: "**A lower threshold lets more strangers through.**
  Change only after reading the accuracy report." (spec text). It is repeated in the reason dialog.
- **Code floor rule:** typing a floor above the match threshold shows the inline error "The code-entry floor must be lower than the
  match threshold." (the spec's `SETTING_INVALID` text, checked in the browser too) and the save bar's Save is disabled.
- **Save:** the existing save bar (here drawn dark like the M2 mockup; the real one is light: keep the real one) and the existing
  `ReasonDialog` "Why are you changing these settings?", with a short list of the changes (old → new) as a small extra.
- **Collapse on a phone:** below 768 px each sub-group is an accordion (`details/summary` look, 52 px header with icon, name, "n
  settings", "n changed" badge, chevron). **Matching is open, the rest closed; a sub-group with a change opens itself.** From 768 up all
  sub-groups are open (scanning by eye is faster than clicking). No tabs: tabs hide changed values.
- **Privacy card (new group `privacy`):** two TEXT rows, a textarea each with a live counter "69 / 300 · at least 5" and "Used in the
  consent text and on the privacy notice page"; **Company address** (5–300) and **Privacy contact (grievance officer)** (5–200, filled
  with the first Super Admin). A **preview** shows how the consent sentence reads with both values marked; an empty value shows a red
  "[company address not set]". **Empty state:** "Not set" badge and the amber dashed box "**Set this before the first enrolment: the
  consent text names it.** Until it is set, the consent dialog cannot be opened (COMPANY_ADDRESS_MISSING)." Footer: link to `/privacy`
  and "Changing these texts does not change the consent already given."
- **From the consent dialog:** gate B's `privacy-missing` / `address-missing` states link to `/admin/settings#privacy`; the page then
  shows a blue banner "You came from the consent dialog of Sunita Jadhav. Set the company address, save, then go back." with **Back to
  Sunita Jadhav**, moves the Privacy card first and outlines it (state `from-consent`).
- **Read-only (Corporate Head, Plant Head):** the M1 rule: subtitle "Only the Super Admin can change them.", a blue "View only" banner,
  inputs read-only (grey), no Reset / Use buttons, report values still visible.
- **Other cards** are drawn collapsed only to keep the mockup short; the real page keeps them as they are.
- **Accessibility:** inputs have labels (`for`), the error is `aria-describedby` + `aria-invalid`, the warning is `role="alert"`,
  counters are text; accordions are keyboard toggles (Enter / Space) with the expanded state announced.

## 3. Dashboard card "Face enrolment" (`03-dashboard.html`)
- **Place:** under "Cards ending soon" (Super Admin) and above the M1 placeholder card; shown to **all three roles** (Plant Head: own
  plant). Data: `GET /face/enrolment-progress`.
- **Content:** scan-face round icon, title "Face enrolment" ("Face enrolment at K134" for a Plant Head), a hero number **"212 of 300
  enrolled"**, "71% · 88 not enrolled yet", a tile **"5 Re-enrol suggested"** (link to the list filtered Re-enrol suggested), one overall
  bar, then **one row per plant**: code + name, bar, "52 of 60", "87% · ⚠ 2 re-enrol". Footer: "Updated when you open the page." and the
  button **"See employees not enrolled (88)"** → `/admin/employees?face_state=not_enrolled`.
- **Chart rules (dataviz method):** one measure, one hue (steel blue), sorted by plant code (colour never changes with rank), every bar
  has its number in text next to it, so the bars are only a visual aid; no legend needed (single series); the row `title` gives the
  hover text; the list itself is the table view.
- **Empty:** "0 of 300 enrolled" and a dashed box "Nobody is enrolled yet" with the 3 steps (set the company address; record
  consent; enrol 5 pictures). **Plant Head:** no plant list (one plant), hero only. **Engine starting / failed** (from `/health`
  `face.state`, AC-40): blue "The face engine is starting..." or red "The face engine did not start. Face punches are switched off at
  every gate and enrolment cannot start; card punches work." The health line of the placeholder card gains a badge "Face engine ready ·
  buffalo_s" / "starting" / "not running". **Loading:** skeletons. **Error:** "The numbers could not be loaded." + Try again.
- Meter: fill `#1f3a93` on track `#e6eaf0` (8.3:1); the track itself is decoration (1.2:1 on white), the number carries the value.

## 4. Ctrl+K (`04-palette.html`)
- The real cmdk palette (`command-palette.tsx`) with new commands in the Commands group, each with a "New" tag for the first release:
  **Enrol face...** (Super Admin only; `kind: "pickEmployee"`, placeholder "Type an employee code or name"; goes to
  `/admin/employees/{id}?face=enrol`, which opens the consent dialog or the wizard as the face panel decides), **Employees not enrolled**
  and **Re-enrol suggested** (all roles; `kind: "go"` to the employees list with the face filter; hint shows the scope and the count).
- **Role rule:** commands a role cannot use are left out, not disabled (same as "Issue QR card..."): Plant Head and Corporate Head see
  only the two list commands, scoped "Your plant K134" or "All plants in your view".
- **Picker:** results show a face badge (Not enrolled / Enrolled / Re-enrol / Card) and the plant; a card employee is dimmed and still
  selectable (opens their page, where the method can be changed); a note explains it. Needs `face_state` in quick-search results (open
  question 5).

## 5. Gate poster (`05-poster.html`, A4 portrait)
Drawn in mm/pt so it maps onto `poster_pdf.py` (same 16 mm margins, ink `#0e1726`, muted `#3d4757`, yellow/ink stripes top and bottom,
0.8 mm ink boxes with 4 mm corners, Inter Regular/Bold from `printing/fonts`).

| y (mm) | Part | Text (size) | fpdf2 work |
|---|---|---|---|
| 0 / 291 | safety stripe | – | `_safety_stripe` (unchanged) |
| 16 / 31 | title + plant line | "Attendance at this gate" (30 pt); plant 16 → 14 → 12 → 11 pt wrap | unchanged (`_plant_line`) |
| 42 | heading | "Punch in one of two ways" (16 pt bold) | new `cell` |
| 51–141 | two boxes side by side (85 mm each, 5 mm gap) | **Card:** icon `id-card` 18 mm, "Card: hold your card to the camera" (17 pt bold), "Hold it still, about 20 cm from the camera." + "Then look at the camera: a photo is taken with every card punch." (13 pt). **Face:** "Face: tap Punch with face, turn your head as the arrow shows" (17 pt bold) + three picture rows (12.5 pt): blue button pictogram "Punch with face" → "Tap the blue button."; head-turn pictogram → "Turn your head as the arrow shows, then look straight."; key box "0123" → "If the screen asks, type your employee code." | new `_way_box()`; button = filled rounded rect `#1f3a93` + white `scan-face` + 8 pt white text; **new SVG `head-turn.svg`** (the gate B pose picture, ours) in `printing/icons`; key box = rounded rect + text |
| 146 | step box | `log-in` icon, "See IN or OUT on the screen" (19 pt) / "Your name and the time are shown. That is all." (13 pt) | `_step` without the number circle |
| 174 | boxed note | `octagon-x`, "If it says NOT ACCEPTED, go to the plant office." / "Do not try again and again..." (unchanged) | `_boxed_note` |
| 203–281 | privacy box | `shield-check`, "About your face and the photo" (16 pt), **"Pressing Punch with face means your face is checked."** (13.5 pt bold), then `kiosk.footer.privacy` word for word with the retention days, then "Only the Super Admin can open a photo, and every view is recorded. Face data is never shared and never sent to any AI company. Your punch times are kept as attendance records, as the law requires." and "Full privacy notice: upasthiti-chi.vercel.app/privacy" (12.5 pt) | `_boxed_note` with 3 paragraphs; the address comes from `APP_PUBLIC_ORIGIN` |
| 284 | help line | "Need help? Ask the plant office." (13 pt bold) | unchanged |

- Readable from 1 m: no text under 12.5 pt (4.4 mm tall capitals) except the 8 pt words inside the button pictogram, which only mirror
  the button. Titles 16–30 pt.
- **Removed from the M2 text:** "It is never used for face recognition" (card photos are now checked for a face, F-30; "never used to
  match faces" stays true but confuses next to the face punch) and the step numbers 1–3 (two parallel ways do not count well).
- All Lucide icons used already exist in `printing/icons` (id-card, scan-face, log-in, octagon-x, shield-check); only `head-turn.svg`
  is new. No QR code on the poster (not required; recommended to keep it off).

## 6. Privacy notice page (`06-privacy.html`, public `/privacy`)
- **Route:** a public page outside the admin shell (like `/attendance`), lazy-loaded, no login, it needs the two privacy settings and the
  retention days without a login. Recommendation: a small public `GET /api/v1/privacy-notice` returning only `company_address`,
  `privacy_contact`, `snapshot_retention_days` and the consent text version (no database read beyond settings; rate-limited like
  `/health`). Listed in `e2e/tests/responsive.spec.ts`.
- **Layout:** yellow/ink stripe, top bar (logo, "Upasthiti · Sheet Shapers · Smart Attendance", **Back** button = history back), hero
  (eyebrow "Privacy notice", h1 "Face and photo attendance at Sheet Shapers", lead, version face-consent-v1 + date), four "In short"
  tiles, then 8 sections with a 48 px icon each: What we collect · Why · How long we keep it (a two-column list: template / pictures /
  failed-punch photo 60 days / card photo 60 days / punch times / consent record) · Where it is processed (Singapore, Mumbai) · Who can
  see it · Your choice, and how to withdraw · Your rights (30 days, Data Protection Board of India) · Who to contact (bordered card:
  `privacy_contact`, then Sheet Shapers + `company_address`). Desktop: sticky "On this page" list on the left. Footer: Print this page,
  Admin login.
- **Same facts as the consent text v1** (5 pictures, encrypted template, 60 days, Singapore / Mumbai, Super Admin only, every view
  recorded, no AI company, QR card instead with no effect on job/pay/shift, withdraw by telling the plant office, 30 days, Board).
  Adds one fact from the spec: Plant Head and Corporate Head see only whether, when and how you punched.
- **Contact missing:** an amber dashed card "The contact is being set up. Until then, ask at your plant office."
- Body text 17 px at every width, line height 1.6, h2 21 px; English only, every string in the translation
  file so Marathi / Hindi can be added (no fixed widths on text). Print stylesheet hides the buttons.
- **How it is reached:** the consent dialog (link "Read the full privacy notice"), the poster (printed address), the Settings Privacy
  card, and a footer link on the admin login page. **Not** from the gate screen: tapping it would leave the full-screen attendance page.

## Contrast (WCAG, measured)
| Pair | Ratio |
|---|---|
| Ink `#0e1726` on white / on `#eef1f5` | 17.96 / 15.85 |
| Muted `#4a5567` on `#eef1f5` (role note) / on `#fafbfc` | 6.65 / 7.27 |
| Subtle `#5f6b7d` on white (defaults, ranges) | 5.40 |
| Primary `#1f3a93` on white (links, meter fill) | 10.07 |
| `#1a3282` on primary-soft (Face badge, report chip) | 9.94 |
| Warning `#8f5300` on `#fff3d6` (Asked for code badge, chip icon) | 5.59 |
| `#6b3f00` / `#5a3500` on `#fff3d6` (warnings, empty states) | 8.15 / 9.80 |
| Danger `#b42318` on `#fdecea` | 5.75 |
| Success `#04694b` on `#e6f5ee`; `#03513a` on it | 5.97; 8.32 |
| White on save bar `#0e1726` | 17.96 |
| Input border `#868fa0` on white (UI part) | 3.26 |
| Meter fill on track (UI part) | 8.34 |
| Poster: ink on yellow `#f5b700`; muted `#3d4757` on white | 9.97; 9.39 |
All text ≥ 4.5:1, UI parts ≥ 3:1; colour never alone (icon + word, dashed vs solid border for "asked"/"no face").

## Maps onto existing components
`Chip` (punches-page) · `Badge` tones + new `method` badges · `Select` · `Table` · shadcn `Sheet` (= `Dialog` from `components/ui/dialog`
with side placement; Radix, already in the project) · `Alert` · `Skeleton` · `SettingRow` (+ a text variant: `Textarea`, counter) ·
`ReasonDialog` · `Card` · cmdk `Command.Group/Item` · `poster_pdf.py` helpers. **Nothing copied from a component gallery**: no entry for
`docs/decisions/ui-component-sources.md`. Icons: Lucide (ISC), already used.

## New texts needed (English, for `common.json`; existing texts reused word for word)
- `punches`: `description` / `descriptionOwnPlant` "...by card or by face...", `readOnly*` "...open punch photos and see face scores;
  here you see the method, the result and whether a photo was saved.", `noPhotosInFile` "No photos or scores in the file",
  `columns.method` "Method", `columns.resultAndReason` "Result and reason", `method.face` "Face", `method.card` "Card",
  `result.askedForCode` "Asked for code", `how.byFace` "By face", `how.byCode` "By code", `how.codeNoMatch` "Code typed, face did not
  match", `link.after` "After: Asked for code {{time}}", `link.then` "Then: By code {{time}}", `unknownFace` "Unknown face",
  `faceNotMatched` "Face not matched", `noFaceInPhoto` "No face in photo", `photoState.noneAccepted` "No photo" / "accepted face punch",
  `photoState.fromAsked` "Photo of {{time}}" / "the Asked for code punch", `summary.askedForCode` "Asked for code", `summary.noFace` "No
  face in photo", `summary.acceptedBy` "Accepted by: {{face}} face · {{code}} code · {{card}} card", `filter.method` / `anyMethod`
  "Method: any" / `methodFace` "Face" / `methodCode` "Face, by code" / `methodCard` "Card", `details` "Details",
  `detailsFor` "Details of the punch at {{time}}".
- `punches.detail`: `punch` "Punch", `steps` "Steps of this punch", `openPunch` "Open this punch", `faceCheck` "Face check",
  `superAdminOnly` "Super Admin only", `matchScore` "Match score", `matchScoreWith` "Match score with {{code}}", `secondBest`
  "Second-best score", `gap` "Gap {{value}}", `antispoof` "Anti-spoof score (live face)", `headTurn` "Head turn", `left`/`right` "{{deg}}°
  left/right", `todaysLimit` "Today's limit: {{value}} or more", `limitAfterCode` "Today's limit after a code: {{value}} or more",
  `notUsedWithCode` "Not used when a code is typed", verdicts "Passed" / "Too low" / "Code asked" / "Not used", `challenge` "Challenge",
  `turnLeft` "Turn left ({{count}} turn)", `matchMode` "Match mode", `oneToMany` "Whole plant (1:N)", `oneToOne` "Employee code (1:1)",
  `model` "Model", `codeTries` "Code tries", `codeTyped` "Code typed: {{code}} – face did not match", `codeThenMatched` "Then checked
  against this employee only: matched.", `codeProxy` "Someone typed this employee's code, but the face was not alike enough. Check the
  photo: this can be a proxy attempt.", `noPhotoAccepted` "No photo is kept for an accepted face punch." / "The pictures were checked in
  memory and deleted at once.", `noFaceExplained` "The automatic check found no face in this card photo. The punch itself was decided as
  normal. Look at the photo: the card may have been shown without its owner.", `rolesNote` "Scores, the typed code and photos are shown
  to the Super Admin only.", `notNamed` "Not named".
- `punchReasons` (face codes, proposed words): CHALLENGE_INVALID "Head-turn check not valid", CHALLENGE_EXPIRED "Head-turn check
  expired", FRAMES_INVALID "Pictures not usable", NO_FACE "No face seen", MULTIPLE_FACES "More than one face", FACE_TOO_SMALL "Face too
  far away", FACE_QUALITY_LOW "Picture too dark or blurry", LIVENESS_FAILED "Head did not turn", SPOOF_SUSPECTED "Not a live face (photo
  or screen?)", FACE_INCONSISTENT "Pictures show different faces", NEED_EMPLOYEE_CODE "Asked for the employee code",
  FACE_NOT_RECOGNISED "Face not recognised", CODE_ENTRY_EXPIRED "Code not typed in time".
- `settings`: `groups.privacy` "Privacy" / "Shown in the face consent text and on the public privacy notice page.", `subgroups.*`
  "Matching", "Liveness and anti-spoof", "Picture quality", "Code entry and timing", "Hints", `settingsCount` "{{count}} settings",
  `changedCount` "{{count}} changed", `changed` "Changed", `reportValue` "Report value: {{value}}", `noReport` "No report yet", `useReport`
  "Use {{value}}", `reportStrip` "Accuracy report of {{date}} (model {{model}}, team test faces only). Its suggested value stands beside
  each limit." + "Read the report", `noReportStrip` "No accuracy report yet. These are starting values. The team replaces them after the
  accuracy tests; until then, leave them as they are.", `thresholdWarning` (spec text), `appliesNext` "Changes apply to the next punch at
  every plant. A face setting never changes punches already decided.", `items.company_address` / `items.privacy_contact` label + help,
  `notSet` "Not set", `setBeforeEnrolment` "Set this before the first enrolment: the consent text names it.", `addressBlocks` "Until it is
  set, the consent dialog cannot be opened (COMPANY_ADDRESS_MISSING).", `usedIn` "Used in the consent text and on the privacy notice
  page", `textCounter` "{{count}} / {{max}} · at least {{min}}", `preview` "How the consent text reads", `addressMissingInText`
  "[company address not set]", `privacyLink` "Employees read the full notice at /privacy (no login). Changing these texts does not change
  the consent already given.", `fromConsent` "You came from the consent dialog of {{name}}. Set the company address, save, then go
  back." + "Back to {{name}}", `viewOnlyFace` banner, `units.degrees` "degrees", `units.px` "px", `units.steps` "turns",
  `units.times in 30 days` "in 30 days".
- `dashboard.faceEnrolment`: title, `titlePlant` "Face enrolment at {{plant}}", descriptions, `enrolledOf` "{{done}} of {{total}}
  enrolled", `percentNot` "{{percent}}% · {{count}} not enrolled yet", `reenrol` "Re-enrol suggested", `reenrolTag` "{{count}}
  re-enrol", headers Plant / Enrolled / Count, `link` "See employees not enrolled ({{count}})", `updated` "Updated when you open the
  page.", `empty.*` (title, text, 3 steps), `engine.starting`, `engine.failed`, `error`; health badges "Face engine ready · {{model}}",
  "Face engine starting", "Face engine not running".
- `palette.face*`: "Enrol face…" / "Pick an employee, then record consent and enrol", "Employees not enrolled", "Re-enrol suggested",
  hints "Employees list, Face: Not enrolled · {{scope}} · {{count}}", scopes "Your plant {{plant}}" / "All plants in your view",
  `pickerPlaceholder` "Type an employee code or name", `pickerNote`.
- `privacy.*`: every text of `06-privacy.html` (about 45 strings).
- Poster (Python, English only as in M2): the strings in the table above.

## Points of the spec changed or not followed, and why
1. **Reason column merged into Result** in the punch log (fits 1280 px without an inner scroll; same words).
2. **Detail panel is new**: the M2 page has no punch detail; drawn as a side sheet for every role (the API detail endpoint exists).
3. **"Code typed: EMP-0123 – face did not match"** is used as the headline of every code-path detail (the 1:N face did not match,
   that is why the code was asked); a second line says whether the 1:1 check then matched.
4. **Score limits are labelled "Today's limit"**: punches do not store the thresholds in force at the time.
5. **Sub-groups are a screen mapping**: the backend keeps every key in group `face`; the frontend maps key → sub-group.
6. The help text of `face_reenrol_score_margin` in `common.json` ("fall this far below the older ones") does not match §7 rule 15
   (median below threshold + margin). Proposed: "Suggest enrolling a face again when the recent match scores are less than this far
   above the match threshold." Drawn with the current text.
7. Poster: step numbers dropped and the M2 sentence "never used for face recognition" removed (see section 5).

## Open questions (with recommendation)
1. **Where does the report value come from?** Recommendation: a nullable `report_value` on each `SettingDefinition`, filled from the
   slice D accuracy report and returned additively by `GET /settings` (+ report date and model); null shows "No report yet".
2. **Link from the `needs_code` row to its follow-up:** the API only gives `follows_punch_id` on the follow-up. Recommendation: add
   `followed_by_punch_id` to list items (additive); otherwise the link is shown only when both rows are on the same page.
3. **Merge Reason into Result in the punch log?** Recommendation: yes (no inner scroll at 1280, nothing lost).
4. **Keep the "Use 0.46" button and the change list in the reason dialog (small extras)?** Recommendation: yes; both are S, no API change.
5. **Face badges in the Ctrl+K picker** need `face_state` in the quick-search results. Recommendation: add it (additive, cheap); without
   it the picker shows no badge and the face panel explains the state after opening.
6. **Privacy address on the poster:** print `APP_PUBLIC_ORIGIN + "/privacy"` as text, no QR code (a QR code next to card QR codes at
   the gate could confuse the device and the workers); fix the `face_reenrol_score_margin` help text (point 6 above) in step 27.
