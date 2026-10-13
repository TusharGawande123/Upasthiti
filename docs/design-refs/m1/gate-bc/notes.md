# M1 design gates B and C – setup, plants, geofence, shifts, kiosks, kiosk pairing

Status: **Draft for the lead's review** (13/10/2026) · ui-designer
Spec: `docs/specs/M1-foundation.md` §4.3–4.9, §7 rules 5, 7, 9, 16, 17, §9; decision 0005.
Builds on gate A (approved): `../gate-a/tokens.css`, `../gate-a/shell.css` and `../gate-a/shell.js`
are loaded by relative path and **not changed**. New shared pieces live in `bc.css` (tabs,
readiness rows, empty states, read-only banner) and `plant.js` (plant header + the Plant Head
view of the shell).

Static HTML mockups with fake data; not app code. Plant codes, names and addresses are the
client's real business info from `backend/app/modules/org/client_plants.py`; every person, count,
time, kiosk and map shape is invented. The site address is the placeholder `upasthiti.example`.

## How to open

From `docs/design-refs/m1/` run `python -m http.server 8777` and open
`http://127.0.0.1:8777/gate-bc/<file>`. Internet is needed (Google Fonts, Tailwind CDN, Lucide,
Leaflet, OpenStreetMap tiles, qrcode-generator). Each state is a URL hash. Note: changing only the
hash does not reload the page; press F5 after changing it.

| Screen | File | States (add to the URL) | Screenshots (`screenshots/`) |
|---|---|---|---|
| B1 Setup wizard (F-5) | `B1-setup-wizard.html` | (none) 3 of 5 done, step 2 open · `#start` fresh install · `#done` all done | `B1-setup-wizard*.png` |
| B2 Plants list | `B2-plants.html` | (none) 7 plants · `#empty` · `#loading` · `#error` | `B2-plants*.png` |
| B3 Plant detail | `B3-plant-detail.html` | (none) Overview + F-17 readiness · `#plant-head` · `#departments` · `#categories` · `#kiosks`; combine with `+`, e.g. `#categories+plant-head` | `B3-plant-*.png` |
| B4 Geofence editor | `B4-geofence.html` | (none) editing v2 · `#invalid` shape crosses itself · `#history` preview v1 · `#none` no geofence · `#plant-head` read-only | `B4-geofence-*.png` |
| B5 Shifts tab + form | `B5-shifts.html` | (none) table · `#edit` Night shift (ends next day) · `#add` defaults · `#same-times` error · `#plant-head` | `B5-shifts*.png` |
| C1 Kiosks list | `C1-kiosks.html` | (none) 4 kiosks · `#revoke` · `#empty` | `C1-kiosks*.png` |
| C2 Add-kiosk dialog | `C1-kiosks.html` | `#add` step 1 · `#no-geofence` · `#code` code + QR + live countdown · `#paired` · `#expired` | `C2-*.png` |
| C3 Kiosk pairing (`/kiosk`) | `C3-kiosk-pairing.html` | (none) not paired · `#prefilled` (from QR) · `#code-wrong` · `#locating` · `#paired` · `#code-expired` · `#locked` · `#location-off` · `#gps-weak` · `#outside` · `#unsupported` · `#revoked` | `C3-portrait-<state>.png` (1080×1920) and `C3-pc-<state>.png` (1366×768) |

Admin screenshots: 1440×900. 54 PNGs, each under 300 KB. The "State:" caption is a mockup helper
(hidden on the kiosk screenshots).

## Screen notes

### B1 Setup wizard (`/admin/setup`, Super Admin)
- **Layout:** page head + "Close the wizard"; left a sticky card with a progress bar and a
  vertical stepper (5 steps); right the open step.
- **Step marks:** done = green filled circle with ✓ + "Done" badge; open now = **safety-yellow
  circle with its number** (ink text on yellow, 10:1) on a soft blue row; partly done = amber
  "3 of 7" badge; not started = dashed circle + "To do". Screen readers get "Done / Open now /
  Not done" text.
- **Step 2 panel** lists all 7 plants with "Geofence set ✓" or "No geofence ✗" and a "Draw
  geofence" link per plant, "Skip for now" and a primary "Draw for PC1 →" (next missing plant).
  Every link goes to the real screen; progress is worked out from data (nothing stored).
- **Fresh install (`#start`):** step 1 empty state with "Add Sheet Shapers' 7 plants" + "Add a
  plant" + "Skip for now". **Done (`#done`):** celebration card, "Go to the dashboard".
- The sidebar "Setup wizard x of 5" counter follows the same numbers.

### B2 Plants list (`/admin/plants`)
- 4 summary tiles (active plants, with geofence "3 of 7", kiosks, employees) then the table:
  Code (bold, code font features), Name with the address line, Status (✓ Active), Geofence
  (✓ "Set · v3" / ✗ "Not set"), Kiosks ("1 active · 1 waiting" / "– None"), Employees
  (right-aligned, Indian grouping), open chevron. The whole row opens the plant.
- **Empty:** dot-grid illustration, "No plants yet", the 7 codes as chips, "Add Sheet Shapers'
  7 plants" (idempotent: "Safe to press twice") and "Add a plant". Loading = skeleton rows +
  skeleton tiles. Error = red alert + "Try again".

### B3 Plant detail (`/admin/plants/:id`)
- **Header:** breadcrumb, a steel-blue **code tile "TP2"** with the yellow signal dot (reuses the
  logo idea), name, ✓ Active, address; "Edit details" + "⋯" (deactivate) for the Super Admin.
- **Tabs** (shadcn Tabs, line style): Overview · Geofence ✓ · Departments 3 · Shifts 2 ·
  Categories 4 · Kiosks 0 – the counts and the ✓ give status before opening a tab.
- **Overview = F-17 readiness card:** a 3/5 progress ring, "Not ready · 2 left" (amber, icon +
  words), then five rows with round icons: ✓ Geofence (v2 · polygon · margin 25 m), ✓ Shifts,
  ✓ Categories, **✗ Kiosk at the gate** with a primary "Add kiosk" button, ○ Employees "0
  active" with "Add employees". Right column: plant details + counts, and a small geofence
  preview linking to the map.
- **Plant Head view (`#plant-head`):** the user is "Sunil More, Plant Head · TP2" (fake); the
  top-bar plant filter becomes a fixed "TP2 … 🔒" chip; Setup wizard, Approvals and Users leave
  the sidebar; a grey "🔒 Read-only" banner explains what they can and cannot do; every edit
  button is gone **except "Add kiosk"**, because a Plant Head manages their plant's kiosks
  (decision 0005).
- **Departments / Categories:** simple tables (name, employees, ✓ Active, Rename · Deactivate),
  an inline "Add" row at the bottom, and a collapsed "Inactive (n)" group ("nothing is
  deleted"). Default categories carry a "Default" tag.
- **Kiosks tab, empty:** "No kiosk at this gate yet" + "Add kiosk" + "Read the kiosk setup
  guide".

### B4 Geofence editor (Geofence tab)
- **Map:** Leaflet 1.9.4 with OpenStreetMap tiles, centred on MIDC Waluj (19.8405 N, 75.2215 E),
  zoom 17, metric scale bar; attribution "© OpenStreetMap contributors" always visible
  bottom-right (tile licence). The shape on the map is invented.
- **Tools** (top-left floating card, icon + word each): Draw polygon · Draw circle · Edit shape
  (pressed) · Delete shape (red). In the app: Leaflet-Geoman free with its toolbar hidden and
  these buttons calling its API, so the look stays ours.
- **Shape:** solid steel-blue line + 16 % fill; the **margin** is drawn as a dashed outline
  (legend top-right: "Geofence line" / "Margin 25 m (still inside)"). Edit mode shows white
  square corner handles and small midpoint dots; a dark hint pill: "Drag a corner to move it ·
  click a dot to add one · Esc finish".
- **Side panel (380 px):** Shape card (type, corners, area "17,850 m²", "Allowed 100 m² – 2 km²
  ✓"), "Save as a new version" card (Margin field with "metres" unit and 0–200 help, optional
  reason for the audit log, "Not saved · 1 corner moved" badge, Discard, **Save new version**),
  Version history (v2 Current/In use, v1 with "Preview").
- **Invalid (`#invalid`):** shape and corners turn red, a pulsing red "!" marks the crossing
  point with the label "Lines cross here"; the panel shows "✗ Not valid" and the §9 message
  "The shape is not valid: the shape crosses itself." + how to fix; Save is disabled ("Fix the
  shape first"). Same pattern for "too small / too large" (GEOFENCE_TOO_SMALL / _TOO_LARGE).
- **History preview:** v1 drawn in blue, current in grey dashes, banner "Previewing version 1
  (read-only) · Back to current"; save card hidden.
- **None:** map on MIDC Waluj with a centred card "No geofence yet" + Draw polygon / Draw circle.
- **Read-only:** no tools, no save card, banner "Only the Super Admin can change the geofence".

### B5 Shifts tab + form
- **Table:** Shift (General has "Default"), Time with a sun / moon icon and the duration, a blue
  **"Ends next day"** badge on the night shift, Late after, Half-day limit, Overtime after,
  Employees, ✓ Active, Edit + "⋯".
- **Form dialog:** name; start and end as big **24-hour segmented time fields** (HH : MM, "IST"
  suffix); then the **live sentence card** (`aria-live="polite"`): "Night shift: starts 19:00,
  ends next day at 07:00 (12 h 00 min)." with three lines (late after 19:10, half-day limit,
  overtime after 8 h 00 min "at each employee's own rate"), and a **24-hour band** that shows
  the shift on a 00–24 line, wrapping past midnight. Fields: Grace (min), Half-day limit (min,
  with "= 4 h 00 min"), Overtime after (h + min). Info note: changes apply from today; no
  overtime rate here.
- **Start = end:** red end field + "Start and end cannot be the same." (§9), sentence replaced by
  "Choose an end time that is different from the start.", Save disabled.

### C1 Kiosks list (`/admin/kiosks`)
- Columns: Kiosk (device icon phone / PC / tablet, name, OS · browser), Plant (code + name),
  Status (✓ **Active** green · ⧗ **Waiting for pairing** amber with "Code ends in 06:12" · ⊘
  **Revoked** grey with date and who), Location at pairing ("± 18 m" with a small accuracy bar
  and "Inside the geofence" / "Inside · from Wi-Fi"), Paired on (date over time), Last seen
  (pulsing green dot + "2 min ago", then the time). Revoked rows are muted and show the reason.
- Waiting rows have a "New code" button (it replaces the old code). Row menu: Rename, Revoke.
- **Revoke dialog:** `alertdialog`, red ⊘ icon, "The device stops working at once", required
  reason (error "Write a reason. It is saved in the audit log.").

### C2 Add-kiosk dialog
- **Step 1:** plant list (plants without a geofence are disabled with "✗ No geofence"; a Plant
  Head sees only their plant) + kiosk name → "Make pairing code". Choosing a plant without a
  geofence shows "Draw this plant's geofence first." with a "Draw geofence" link (§9).
- **Code:** two numbered (yellow) steps – "1 open https://upasthiti.example/kiosk" (Copy link),
  "2 type this code" – the **6 digits in large boxes (3 + 3 grouping)** with a Copy button, a
  **countdown ring "09:41 left"** (live), and the **QR of the pairing link** (F-18) "Or scan
  with the gate device". A waiting bar with a pulsing dot: "Waiting for the device… Checking
  every 3 seconds. The device must be at the TP2 gate with location switched on."
- **Paired:** green circle with a drawn tick, "Paired ✓", Status / Location ± 22 m inside /
  Device / Paired on; "Add another kiosk" and "Done".
- **Expired:** digits struck through and greyed, QR faded, ring empty "00:00", amber "This code
  has expired." and a primary "Make a new code".

### C3 Kiosk pairing screen (`/kiosk`, gate device)
A different, calmer, bigger layout with the same palette. **Safety yellow is used more** (top
hazard stripe, active digit box ring, note icon tile, numbered step dots, the "Allow" highlight)
but **never as text colour**: ink sits on yellow (10:1).
- **Frame:** 12 px yellow/ink hazard stripe; top bar with the logo (64 px), "Upasthiti / Gate
  kiosk · Sheet Shapers" and a **status chip** (icon + word: ◌ Not paired, ⌖ Pairing…, ✓
  Paired, ✗ Not paired, ⊘ Switched off); footer "Need help? Ask the plant office." + version.
- **Not paired:** "Pair this device" (≈65 px portrait / 46 px PC), the 6 digit boxes (≈150 px
  wide portrait) with a blinking caret and a yellow ring on the active box, the "Location is
  needed once – press Allow" note, a 3 × 4 keypad (keys 108 px portrait / 77 px PC; Clear, 0,
  Back with icon + word), and the big Pair button ("Type all 6 digits" while incomplete).
  Portrait = one column; PC (landscape) = code on the left, keypad on the right.
- **From QR (`#prefilled`):** "Code filled in from the QR" tag, all 6 digits, Pair enabled.
- **Wrong code:** boxes turn red and shake once, red alert "This code is not right. Check the
  code on the admin screen." (§9 `kiosk.pair.codeInvalid`), error tone.
- **Finding location:** radar rings around a location pin, the live **"± 35 m"** in ~130 px
  numbers, a meter with the "± 50 m needed" mark, and a checklist (✓ Code typed · ✓ Location
  good enough · ◌ Checking with the server…), "waits up to 20 s".
- **Paired:** big green ✓ (drawn), "Paired", **"Paired to K134 – Sheet Shapers India Pvt Ltd
  (K-134)"**, a "Main gate phone · location ± 18 m" chip, the **live IST clock** (server time,
  ~140 px) with "IST · Tuesday, 13/10/2026 · server time", and "Attendance starts in a later
  update. Keep this screen open". Success chime in the app.
- **Errors** (all: big icon disc + title + the §9 message + numbered next steps + one big
  action + "For the admin: <ERROR_CODE>" for support):
  `#code-expired` (⏲ amber, "Type a new code") · `#locked` "Too many tries" · `#location-off`
  (with a drawn example of the browser's location question, "Allow" highlighted) · `#gps-weak`
  "Location is not accurate enough. Turn on Wi‑Fi or move near a window, then try again." with
  a meter "Best ± 140 m / ± 50 m needed" · `#outside` "This device is not at the plant." ·
  `#unsupported` "Open this page in the latest Chrome or Edge." (no button; steps only) ·
  `#revoked` "This device has been switched off by the admin." On the PC layout the icon moves
  to the left so every state fits 1366×768 without scrolling.
- **Measured:** no text under 24 px in any state at both sizes; no scrolling; every target
  ≥ 72 px (keys, buttons); kiosk text colours are 7.4–18:1 (see Accessibility).

## Motion (Motion 14 in the app; CSS in the mockups; all inside `prefers-reduced-motion: no-preference`)
- Admin: sections fade up 8 px with a 60 ms stagger (gate A); readiness ring and wizard
  progress bar fill once (900 ms); the geofence line draws itself once; the crossing marker
  pulses; dialogs scale in from 97 %; the paired tick draws (500 ms); the pairing countdown
  ring drains live; "waiting" and "last seen" dots pulse.
- Kiosk: radar rings ripple while locating; the accuracy number rolls (NumberFlow /
  Number Ticker) as readings improve; the success disc pops (520 ms) and the tick draws; the
  wrong-code boxes shake once (420 ms); the caret blinks. **Sound** (app): short chime on
  success, low double tone on errors (Web Audio, generated, no files). With reduced motion
  everything appears in its final state; sound still plays (it is not motion).

## Accessibility
- Status is always **icon + word** (and often shape: filled vs dashed circles, strike-through
  for an expired code), never colour alone.
- Kiosk text colours (new kiosk-only tokens in `C3-kiosk-pairing.html`, gate A tokens untouched):
  `--k-muted-fg #3D4757` 9.4:1 on white / 8.7:1 on background; `--k-danger #8A1A10` 9.4:1 /
  8.2:1 on its soft fill; `--k-success #035A40` 8.3:1 / 7.4:1; `--k-warning #6B3F00` 9.0:1 /
  8.2:1; ink on yellow 10.0:1; white on primary 10.1:1. (Gate A's status colours are 6.2–6.7:1,
  fine for the admin's AA target but under the kiosk's 7:1.)
- Live regions: the shift sentence (`aria-live="polite"`), the kiosk accuracy and status chip
  (`role="status"`), errors (`role="alert"`), the countdown (`role="timer"`, not announced every
  second).
- Dialogs: `aria-modal`, labelled titles; Revoke is an `alertdialog`. Icon-only buttons have
  `aria-label`. The map has a text alternative in the panel (type, corners, area, margin).
- en-IN: DD/MM/YYYY, 24-hour IST, Indian grouping, "m²", "± 35 m".
- Translations: no fixed widths on buttons or chips; kiosk titles can wrap to two lines; the
  layout keeps ~40 % room. Devanagari fallback = Noto Sans Devanagari (gate A font stack).

## Components and sources (all free; nothing copied into the repo yet)
When a component is copied during the build it gets a row in
`docs/decisions/ui-component-sources.md`. Check each licence on the page at copy time.

| Used for | Base / source | Licence / cost |
|---|---|---|
| Tabs (plant detail), Table, Dialog, AlertDialog, Select / Command (plant picker), Input, Textarea, Badge, Alert, Skeleton, Progress, Tooltip, Sheet, Sonner | shadcn/ui – https://ui.shadcn.com/docs/components | MIT, free |
| Vertical stepper (B1) | shadcn/ui pattern; reference: Origin UI (now coss.com) "Stepper" – https://coss.com/origin | MIT, free |
| Segmented 24-hour time field (B5) | React Aria `TimeField` (24-hour, keyboard + screen reader) – https://react-spectrum.adobe.com/react-aria/TimeField.html | Apache-2.0, free |
| Pairing code boxes on the admin side | shadcn/ui Input OTP (input-otp by guilhermerodz) – https://ui.shadcn.com/docs/components/input-otp | MIT, free |
| Kiosk digit boxes + keypad | own component (no keyboard on the kiosk; large keys) | – |
| Countdown ring (C2), readiness ring (B3) | Magic UI free "Animated Circular Progress Bar" – https://magicui.design/docs/components/animated-circular-progress-bar | MIT, free (not Pro) |
| Live "± 35 m", counts | NumberFlow – https://number-flow.barvian.me or Magic UI "Number Ticker" | MIT, free |
| Locating radar | Magic UI free "Ripple" – https://magicui.design/docs/components/ripple | MIT, free |
| Copy button with tick | 21st.dev "Copy Button" by motiondotdev (gate A) | free |
| Drawn success tick | Motion `pathLength` animation (own) | MIT (Motion core, never Motion+) |
| Map | Leaflet 1.9 – https://leafletjs.com | BSD-2-Clause, free |
| Draw / edit polygon and circle | Leaflet-Geoman **free** – https://github.com/geoman-io/leaflet-geoman | MIT, free (not Geoman Pro) |
| Map tiles | OpenStreetMap standard tiles – https://www.openstreetmap.org/copyright | ODbL data; attribution required; light use under the OSMF tile policy |
| QR of the pairing link | backend `segno` SVG (approved stack); mockup only uses qrcode-generator – https://github.com/kazuhikoarase/qrcode-generator | BSD-3 / MIT, free |
| Area / buffer / self-crossing check | backend Shapely (approved stack); the editor may pre-check in the browser with Turf `kinks` + `area` – https://turfjs.org | MIT, free (optional, new dependency) |
| Icons | Lucide 0.469 | ISC, free |
| Font | Inter (+ Noto Sans Devanagari later) | SIL OFL 1.1 |

## Open questions for the lead
1. **Half-day minutes:** the form says "Half-day limit: 4 h 00 min of work". Does 240 mean
   "under 4 h worked = half day" or "at least 4 h worked = half day (else absent)"? The live
   sentence needs the exact rule (used from M5).
2. **Kiosk keypad vs on-screen keyboard:** the PC kiosk also gets the touch keypad (works with
   a mouse or a physical keyboard). OK, or show only the digit boxes on a PC?
3. **Code grouping:** the code is shown as 3 + 3 (482 913) on both sides. OK?
4. **Geofence margin drawing:** the dashed margin outline is computed in the browser (Turf
   `buffer`, a new MIT dependency) or we show the margin only as a number. Preference?
5. **Satellite view:** free satellite tiles (e.g. Esri World Imagery) would make drawing the
   boundary much easier, but their terms need checking; for now the map is OSM only and the
   wizard says "draw it on site or with a satellite map open".

## Lead's decisions (2026-10-13) – gate B/C approved
1. Half-day: at least 4 h of work is needed for a half day (less = absent).
2. PC kiosks keep the touch keypad (default, not objected).
3. Code grouping 3 + 3 stays.
4. Margin outline drawn in the browser with Turf (MIT, new dependency).
5. Kiosk error screens show the small "For the admin: <CODE>" line.
6. No satellite tiles for now (OSM only).
