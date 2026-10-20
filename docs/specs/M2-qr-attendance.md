# M2 – QR attendance at the kiosk (with snapshot): Specification

Status: Approved by Anuradha on 2026-10-20 (delegated by Tushar) · Author: spec-writer · Date: 2026-10-20
Change (2026-10-20, Anuradha): the default card validity is **2 months** instead of 6 (answer 2,
decision 0008 item 1); every "2 months" below was "6 months" in the approved text.
Answers of 2026-10-19: given in chat by Anuradha (team member), not by the lead. Where an
answer conflicts with an earlier approved decision, the spec follows the earlier decision and
the item waits for Tushar (lead): see §14.1 "Pending Tushar" and §15 "Changes".
Related: docs/SRS.md (FR-06, FR-10, FR-14–FR-17, FR-19, FR-20, FR-25 rules 1, 5, 6; NFR-01,
NFR-03, NFR-04, NFR-06, NFR-09; §8 edge cases; §11 M2 row), docs/architecture.md §3, §6, §7,
CLAUDE.md §6–§7, docs/decisions/0002, 0004, 0005, 0006, 0007, accepted-extras.md (F-1, F-6,
F-25), docs/specs/M1-foundation.md (role matrix §7 rule 1, signed kiosk requests §7 rule 6,
employee rules §7 rule 10)

> Write in simple, clear English. No application code. Kiosk is the only punch channel.

## 1. Problem and goal
Sheet Shapers has about 350 temporary workers who change often. Face enrolment is impractical
for them, so they punch with a signed QR ID card at the gate kiosk. Today M1 gives us plants,
paired kiosks and employees, but nobody can punch yet.

M2 delivers the first real attendance:
- the Super Admin issues, prints, revokes, ends and extends QR ID cards (single and bulk);
- the gate kiosk reads the card with its camera by itself (zero taps), takes a small photo
  (snapshot) and sends a signed punch; the **server** checks everything and decides accepted
  or rejected, and IN or OUT;
- the kiosk shows a big, clear result with colour + icon + word, tones and a short spoken line
  without the name (F-1);
- snapshots are encrypted, stored privately, shown only to the Super Admin through the
  backend, and deleted automatically after the retention period;
- a minimal admin punch log (today's punches per plant, photo review by the Super Admin,
  side-by-side review, Excel export);
- a gate notice board on the kiosk idle screen (F-25), kiosk self-test cards and a gate
  poster;
- the first part of the anti-proxy engine (one rule per file), so M3 and M4 rules plug in.

**Done means (SRS §11 M2 exit criteria, "first demo"):** on the deployed site, with a real
paired phone or PC kiosk, a valid card is accepted (name, IN and time shown, "Checked in"
spoken; snapshot stored), and a revoked card is rejected with its reason (`QR_REVOKED`, shown
to the worker in plain words and visible to the Super Admin in the punch log with the
snapshot).

## 2. Scope

**In scope:**
1. **QR cards** (FR-14, FR-15; decision 0005):
   - the Super Admin issues a card to an active employee **whose punch method is QR**
     (temporary workers by default; `EMPLOYEE_NOT_QR` otherwise);
   - each card has a never-reused **card serial** (`C000123`), a `valid_from` date and a
     `valid_until` date (default 2 months, a setting, editable at issue);
   - **one active card per employee:** issuing a new card revokes the old one (reason
     "Replaced by C000456") in the same step;
   - the Super Admin revokes a card at once with a reason, ends it today ("expire by hand") or
     extends it. **Issue, revoke, end, extend and print are Super Admin only** (decision 0005);
   - Ed25519-signed compact payload (§7 rule 2); the signing key comes from an environment
     variable;
   - a card works **only at the employee's current plant** (M1 §7 rule 10, SRS §8); at another
     plant's kiosk it is rejected with `WRONG_PLANT`;
   - the card shows name, code, contractor, **plant name and code**, QR, serial and issue date
     (no end date, §4.9). After a transfer the card keeps working at the new plant, and the
     list advises a reprint;
   - printable ID card PDF (fpdf2 + segno): one card at CR80 size (85.6 × 54 mm) and A4 sheets
     of 10 cards with cut marks;
   - every print is counted and audited;
   - "mark as left" (M1) now also revokes the employee's active card (FR-10).
2. **Kiosk QR punch** (FR-16, FR-17, FR-19, FR-20):
   - after pairing, `/kiosk` goes straight to the scanning screen: the camera and the QR
     scanning start by themselves, **zero taps** (SRS FR-16). A small banner "Tap once to turn
     on sound and full screen" is optional; punches work without it;
   - QR reading with the `barcode-detector` package (the browser's own detector when present,
     otherwise its WebAssembly fallback, served from our own site);
   - a 320 px wide JPEG snapshot (about 12–15 KB) taken about 0.7 s after the card is read,
     while the screen says "Look at the camera";
   - a signed `POST /api/v1/punch/kiosk` (M1 device signature headers);
   - the kiosk keeps the M1 heartbeat `GET /kiosk/me` every 60 seconds (notices, kiosk
     settings, revocation);
   - result screens: accepted IN, accepted OUT, "already punched", rejected, self-test, and
     connection problems; then automatic return to the scanning screen. No photo on the
     result screen, name + code only.
3. **Server punch pipeline** (FR-25 rules 1, 5, 6; architecture §3):
   - an `app/antiproxy/` package with `engine.py` and one rule per file; M2 adds the snapshot,
     QR-credential and cool-down rules; M4 adds kiosk GPS / geofence and impossible travel;
     M3 adds the face rules, all without changing the punch endpoint;
   - the server decides IN or OUT from the employee's last accepted punch (answers 7 and 8;
     §7 rule 6);
   - server time only; every decided punch (accepted or rejected) is stored with its reason
     code; punches are append-only and get no audit row;
   - idempotent retries (`client_punch_id`), so a network retry never makes two punches.
4. **Snapshot storage:**
   - a small storage layer in `app/core/storage.py` with two back-ends: **local disk**
     (development, tests, or the client's own server) and **Supabase Storage** (production,
     through its free REST API, private bucket, service key in Render's environment, Data API
     switched off);
   - the server checks and re-encodes every snapshot (removes any metadata), measures its
     brightness (F-31) and **encrypts it with AES-256-GCM** before storing (S-24);
   - `punch_snapshots` row with `expires_at` = taken time + `snapshot_retention_days`
     (default 60);
   - a daily purge in the existing daily job (APScheduler, `RUN_SCHEDULER`);
   - snapshots are shown **only** through an authenticated backend endpoint (never a public or
     signed storage URL), **to the Super Admin only**; every view writes an audit entry.
5. **Admin screens:**
   - **QR cards** page: employees and their card state, filters (including "Reprint needed"),
     bulk actions (Super Admin); read-only for Corporate Head and Plant Head;
   - **QR card panel** on the employee detail page (current card, history, actions);
   - **Punch log**: today's punches (or a chosen date) per plant, accepted / rejected, reason,
     photo state; the Super Admin also gets "View photo", "Compare photos" (F-29), the "dark
     photo" mark (F-31); Excel export (F-35) for every role that can see the list; refreshes
     every 30 s. Full dashboards and reports stay in M5;
   - **Gate notices** page (F-25);
   - **Settings**: the new M2 settings (§7 rule 12) become editable;
   - **Kiosks** list: per-kiosk "Sound" switch (F-1) and last self-test time (F-27);
   - **Dashboard** (M1 placeholder): a "Cards ending soon" card (F-33); the sidebar "QR cards"
     item shows the same count as a badge for the Super Admin;
   - **Gate poster** download per plant (F-34).
6. **Extras approved earlier by the lead (F-1, F-6, F-25) and extras confirmed by Anuradha on
   2026-10-19** (CLAUDE.md §11; details in §12):
   - **F-1 Voice + sound:** short tones made in the browser (Web Audio API, no sound files)
     and a short English spoken line **without the name** ("Checked in", "Checked out",
     "Already checked in", or the short reason) through the Web Speech API; on/off by
     settings and per kiosk;
   - **F-6 (M2 part):** bulk issue, bulk print, bulk revoke of QR cards (Super Admin); Ctrl+K
     entries (search by card serial, "Issue QR card", "Print QR cards", "Punch log", "Gate
     notices");
   - **F-25 Gate notice board:** short text notices with start and end time, for one plant or
     all plants (Super Admin) or the own plant (Plant Head);
   - **F-27 Kiosk test card / self-test:** a "TEST" card printed by the Super Admin; scanning
     it at any kiosk (the Plant Head or a guard) shows "Kiosk OK" (camera, server, clock) and
     creates no punch;
   - **F-29 Side-by-side photo review** in the punch log (Super Admin);
   - **F-31 Low-light hint** at the kiosk and a "dark photo" mark and count for the Super Admin;
   - **F-33 Cards ending soon** badge and dashboard card;
   - **F-34 Printable gate poster** (A4 PDF per plant: how to punch + privacy notice);
   - **F-35 Punch log Excel export** (one day, one plant or all plants in scope);
   - **F-38 "Issue and print cards" step** right after an Excel import (QR-method employees
     only).
7. **Engineering extras confirmed by Anuradha** (details in §12.1):
   - **S-22** Locust load test of the punch endpoint (Render-like container + the deployed
     backend outside working hours);
   - **S-23** print-and-scan test in CI (render the PDF, decode the QR, QR version ≤ 7);
   - **S-24** snapshot encryption before upload (`SNAPSHOT_ENCRYPTION_KEY`);
   - **S-26** kiosk error reports to the server log (no images, no payloads);
   - **S-27** kiosk self-update when a new frontend build is deployed;
   - **S-28** bundle-size check in CI and lazy-loading of the kiosk code and the QR decoder;
   - **S-29** kiosk device setup guide (`docs/kiosk-setup-guide.md`) and the screen-awake lock.
8. **Privacy and compliance work for snapshots** (DPDP; §8): notice on the kiosk screen, on the
   card and on the gate poster; purpose limitation; encryption; retention + purge; audited
   access; public-repo safety (synthetic test images only).
9. **Raise the coverage floor** from 70% to 75% (backend and frontend).
10. **Changes to other documents**, made on the milestone branch when this spec is approved:
    - **SRS FR-14:** the A4 sheet is core; the card shows name, code and plant and **no end
      date** (validity is checked on the server);
    - **SRS §5.b:** QR paths (`/qr-cards…` instead of `/qr/issue…`);
    - **SRS §8 "Duplicate punch" row:** `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`;
    - **architecture §3 and §7:**
      - payload `UPS1.<key id>.<serial>.<signature>` (no date inside, §7 rule 2);
      - snapshot taken after the card is read, then encrypted;
      - no audit row per punch;
      - the QR rule also returns `WRONG_PLANT` and `EMPLOYEE_NOT_QR`;
      - new columns and tables (`kiosk_notices`, test cards, `printed_plant_id`).
    - As in every milestone, CLAUDE.md and `.env.example` are updated on the branch before the
      PR (workflow step 7): new environment variables, the QR key command, the kiosk setup
      guide.

**Out of scope (not in M2):**
- **Kiosk GPS check on every punch, impossible travel, offline queue and signed sync, the
  kiosk health monitor and online/offline badge** (FR-21, FR-24, FR-25 rules 4 and 7, FR-26,
  FR-27): M4. Until M4, a kiosk proves its location only once, at pairing (M1). Known gap: a
  paired kiosk carried away from the gate still works in M2. The request contract already
  accepts an optional `location`, so M4 needs no contract change.
- **Flagged punches** and the exceptions / review screen: M4. M2 only accepts or rejects.
- Face enrolment, face punch, liveness (FR-11–FR-13, FR-18): M3.
- Phone punching and the changing gate QR scanned by a worker's phone (FR-43–FR-45): M4b.
- Attendance days, late / early / overtime, pairing IN with OUT, regularisation, dashboards,
  Excel/PDF reports (FR-28–FR-35): M5. The M2 punch log and its export are plain lists, not
  reports.
- QR signing key rotation tooling (the payload carries a key id so it can be added later).
- Per-plant settings (settings stay company-wide; only the kiosk sound switch is per kiosk).
- Marathi / Hindi texts and voices (English only, all text i18n-ready).
- **Later:** F-28 "inside now" counter (M5), F-30 face-in-photo check (M3), F-37 "late" hint
  (M5, off by default), F-32 employee photo on the card (privacy risk).
- **Pending Tushar (would pull a Later item forward):** S-25 storage and database usage meter
  (from F-14) and F-36 kiosk online/offline badge (from F-3). Not built in M2 unless Tushar
  approves (§14.1).
- Salary (M7) and every future-scope item in CLAUDE.md §1.

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | issue a QR card to a new temporary worker and print it on the spot | the worker can punch from their first day | FR-14 |
| US-2 | Super Admin | select 40 new workers and print all their cards on A4 sheets at once, right after the import | a weekly batch of new workers takes minutes | F-6, F-38 |
| US-3 | Super Admin | revoke a lost card at once, with a reason, and print a new one | a found card cannot be used by someone else | FR-15 |
| US-4 | Super Admin | see cards that end soon and extend or end them by hand | I stay in control of who can enter (decision 0005) | FR-15, F-33 |
| US-5 | – | *Removed (R3, pending Tushar): Plant Head printing of cards. Printing stays Super Admin only.* | – | – |
| US-6 | Temporary worker | show my card to the gate camera and see my name, IN or OUT and the time within 5 seconds, without touching anything | punching is fast at shift change | FR-16, FR-17, FR-19 |
| US-7 | Temporary worker | hear "Checked in" or a clear warning sound | I know the result even at a noisy gate, and my name is not called out | F-1 |
| US-8 | Temporary worker | be told in simple words why my card did not work and what to do next | I go to the right office instead of arguing at the gate | FR-20 |
| US-9 | Worker who scans twice by mistake | see "Already IN at 07:02" | I am not marked OUT by accident | FR-19, §8 |
| US-10 | – | *Removed (R1, pending Tushar): cards at any plant. A card works only at the employee's current plant.* | – | – |
| US-11 | – | *Removed (R5, pending Tushar): cards as a fallback for face employees.* | – | – |
| US-12 | Super Admin | see every punch of today per plant, including rejected ones with the reason and the photo, and compare photos of the same card | I can spot card sharing quickly | FR-17, FR-20, F-29 |
| US-13 | Corporate Head / Plant Head | see the punch list of all plants / my plant (text only, no photos), and export the day to Excel | I can follow attendance at the gate and run a pilot next to our old register; photos stay with the Super Admin (FR-20, FR-27) | FR-20, F-35 |
| US-14 | Plant Head | put "Helmet compulsory today" on my gate screen from 06:00 to 18:00 | all workers see important news at the gate | F-25 |
| US-15 | Plant Head / guard | scan the TEST card (printed and handed out by the Super Admin) every morning | I know the gate kiosk works before the shift arrives | F-27 |
| US-16 | – | *Removed (R7, pending Tushar): offline badge and free-tier usage meter.* | – | – |
| US-17 | Super Admin | have photos deleted automatically after 60 days and stored encrypted | we keep personal data only as long as needed and safely (DPDP) | NFR-04, S-24 |
| US-18 | Kiosk device | send only signed evidence and let the server decide | a fake kiosk or forged card can never mark attendance | FR-25 |
| US-19 | Super Admin | press Ctrl+K, type a card serial or code and open that person's card | daily card work is fast | F-6 |
| US-20 | Super Admin | see "Reprint needed (card shows K134)" after a worker moved plant | I reprint cards that show the wrong plant, while the worker keeps punching | FR-14 |

## 4. Screens and UX (light, modern, premium; English first)
The M1 general rules apply (states, en-IN formats, icon + word, keyboard, role-based hiding).
Design reference: the M2 screens are drawn and approved as images in the plan step (gates like
M1), then linked here. **Gate A (QR cards, card panel, dialogs, card layouts, dashboard card,
Ctrl+K, import result) is approved (2026-10-20, Anuradha):**
[docs/design-refs/m2/gate-a/index.html](../design-refs/m2/gate-a/index.html), screenshots in
`docs/design-refs/m2/gate-a/screenshots/`, answers in `notes.md`. **Gate B (kiosk scanning,
card read and checking, results, problem screens) is approved (2026-10-20, Anuradha):**
[docs/design-refs/m2/gate-b/index.html](../design-refs/m2/gate-b/index.html), screenshots in
`docs/design-refs/m2/gate-b/screenshots/`, answers in `notes.md`. **Gate C (punch log, photo
dialog and compare, gate notices, kiosks, settings, gate poster) is approved (2026-10-21,
Anuradha):** [docs/design-refs/m2/gate-c/index.html](../design-refs/m2/gate-c/index.html),
screenshots in `docs/design-refs/m2/gate-c/screenshots/`, answers in `notes.md`. Kiosk rules: text at least 24 px (names and IN/OUT much larger), touch
targets at least 64 px, contrast 7:1, colour + icon + word, full screen, honest connection
messages, all text from the translation file.

### 4.1 Kiosk: starting (`/kiosk`, paired device)
- **No start screen** (SRS FR-16: detection starts automatically, zero taps). After pairing,
  and after every page reload, the kiosk goes straight to the scanning screen (§4.2) and
  starts the camera and the QR scanning by itself.
- **Optional sound banner:** a small banner on the scanning screen, "Tap once to turn on sound
  and full screen". One tap turns on full screen, tones and voice, and requests the
  screen-awake lock; the banner then disappears. Punches work without the tap. Until it is
  tapped, tones, voice, full screen and the wake lock may be unavailable (browser rules); the
  screen alone shows every result. `wake_lock_failed` is reported only after the tap.
- **Camera fallback:** if a device refuses to start the camera without a user gesture, the
  scanning screen shows a large "Start camera" button instead of the camera picture; one tap
  starts it.
- Camera problems: "Camera is blocked" (with steps to allow it) or "No camera found"
  (client codes `CAMERA_BLOCKED`, `CAMERA_NOT_FOUND`), "For the admin: CODE" line.
- A device that is not paired still shows the M1 pairing screen; a revoked device shows the
  M1 revoked screen.
- The kiosk setup guide (S-29) explains how to start Chrome / Edge in kiosk mode and allow
  autoplay, so that sound and full screen also work without the banner tap where the browser
  allows it.

### 4.2 Kiosk: scanning screen
- Top bar: plant name and code, kiosk name, a connection chip (● Online / ⚠ No internet,
  based on the last request result), the live clock (IST, from server time; the kiosk only
  displays it).
- Centre: the camera preview (mirrored for the worker), with a square guide frame and the
  instruction "Show your ID card to the camera" plus a small looping illustration.
- Notice area (F-25): up to 3 current notices; "Important" ones first with an amber ⚠ icon
  and the word "Important"; long text wraps, never scrolls; more than 3, or more than fit on
  the screen (one at a time on a phone), rotate every 8 s, Important ones first in every round
  (gate B answer, 2026-10-20).
- **Low-light hint (F-31):** when the picture stays darker than the threshold for 10 s, an
  amber line "Too dark. Please switch on the gate light." appears (it hides when it is bright
  again). Punching still works.
- Footer: privacy line "A photo is taken at each card punch to stop card sharing. Kept for
  {{days}} days." and "Need help? Ask the plant office."
- Scanning runs continuously (about 5–8 checks per second), only on this screen.
- A QR code that is not an Upasthiti card (for example a UPI code) shows "This is not an
  Upasthiti ID card" for 3 s (client check only, nothing sent).
- The same card is ignored for 5 s after its result, so a card still held up does not punch
  twice.
- **Heartbeat:** `GET /kiosk/me` every 60 seconds (notices, settings, revocation).
- **Self-update (S-27):** every 5 minutes the kiosk reads the site's `version.json`; when a
  newer build exists, it reloads itself the next time it is idle for 30 s (never during a
  punch).

### 4.3 Kiosk: "look at the camera" and checking
- When a card is read: a short tick tone (if sound is on), the frame turns blue, text "Card
  read. Look at the camera" for about 0.7 s, then the snapshot is taken and sent.
- Checking: spinner + "Checking…". After 5 s without an answer: "The server is starting.
  Please wait…" (Render may be waking up, up to about 60 s). After 60 s or a network error:
  the connection error screen (§4.5).

### 4.4 Kiosk: result screens
All result screens show the server time in large digits (`HH:mm`, IST) and return to the
scanning screen by themselves. **No photo** is shown. The name is shown on screen but **never
spoken**.

| Result | Colour + icon + word | Main text | Sound + voice (F-1) | Shown for |
|---|---|---|---|---|
| Accepted IN | green, ✓ arrow-in icon, **IN** | "Welcome, {{name}}" + employee code | rising tone + "Checked in." | `kiosk_result_seconds` (4 s) |
| Accepted OUT | blue, ✓ arrow-out icon, **OUT** | "Goodbye, {{name}}" + employee code | rising tone + "Checked out." | 4 s |
| Already punched (`COOLDOWN_ACTIVE`, `OUT_TOO_SOON`) | amber, ⓘ icon, **ALREADY IN** / **ALREADY OUT** | "Already IN at 07:02. No need to punch again." (or "You can punch OUT after 07:32.") | soft tone + "Already checked in." / "Already checked out." | 4 s |
| Rejected | red, ✗ icon, **NOT ACCEPTED** | worker-safe message + next step (§9), no name | low double tone + the short spoken reason, e.g. "Card blocked. Please see the plant office." | `kiosk_reject_seconds` (6 s) |
| Self-test (F-27) | green, ✓ wrench icon, **KIOSK OK** | "Camera ✓ · Server ✓ · Clock ✓ (server time HH:mm:ss)" + kiosk name; "No attendance was recorded." | rising tone + "Kiosk test passed." | 6 s |

- Rejected screens end with a small line "For the admin: QR_REVOKED" (decision 0006). The
  detailed reason (for example the revoke reason) is never shown at the kiosk (FR-20).
- If voice is off (setting, per-kiosk switch, no English voice, or the banner not yet
  tapped), only the tones play; if sound is off or unavailable, the screen alone shows the
  result.

### 4.5 Kiosk: connection and server problems
- No internet: red ⚠ "No internet. Your punch was NOT saved. Try again in a moment."
  (`NETWORK_OFFLINE`, honest: the offline queue comes in M4).
- Server error: "Something went wrong. Try again. If it repeats, see the plant office."
  (`INTERNAL_ERROR`).
- Too many requests: "Please wait a moment and try again." (`TOO_MANY_REQUESTS`).
- Camera errors, decoder fallback, and unexpected script errors are also sent as small error
  reports (S-26; §7 rule 16), never shown as technical text to the worker.

### 4.6 Admin: QR cards page (`/admin/qr-cards`)
- Table: employee code, name, type (Permanent / Temporary), punch method, plant (current),
  contractor, card serial, state, valid until, "card shows" plant (printed plant), printed
  (count, last date).
- Card states with icon + word: ○ No card, ● Active, ⏳ Not yet valid, ⚠ Ends soon (within
  `qr_card_expiring_soon_days`), ⌛ Expired, ⊘ Revoked (only when no newer card).
- **Badge "Reprint needed (card shows K134)"** when the employee's current plant differs from
  the plant printed on the card's last print (`printed_plant_id`). The card still works. A
  filter "Reprint needed" lists them.
- Filters: plant, type, punch method, contractor, category, state, printed / not printed,
  reprint needed; search by code, name or card serial. Default view: QR-method employees and
  everyone who already has a card. 50 rows per page.
- Bulk bar (**Super Admin only**): "Issue cards" (for selected QR-method rows without an
  active card; others are skipped and listed), "Print cards (A4)" (max 200), "Revoke cards"
  (reason required).
- A separate tab **Test cards** (F-27, Super Admin only): list of TEST cards (serial `T…`,
  label, state, last used), "Make test card", "Print", "Revoke".
- Empty state: "No cards yet. Select employees and press Issue cards."
- Corporate Head: read-only, all plants. Plant Head: read-only, own plant. Neither sees print,
  issue, revoke or extend buttons (§7 rule 1).

### 4.7 Admin: QR card panel on the employee detail page
- Current card: serial, state, valid from / until, issued by and on, printed count, plant
  shown on the card; buttons (**Super Admin only**): "Print card", "Change end date",
  "Revoke", "Issue new card". Others see the panel read-only.
- Card history: all earlier cards with revoke reason and who revoked.
- **Banner when the punch method was switched from QR to face and an active card still
  exists:** "This employee now punches by face. Revoke the old card?" with a "Revoke" button
  (Super Admin). The card is not revoked automatically (decision 0005); until then it is
  rejected at the kiosk with `EMPLOYEE_NOT_QR`.
- **Banner "Reprint needed":** "Card shows K134; the employee is now at TP1. The card still
  works. Reprint it when convenient."
- Link "See punches" → punch log filtered to this employee.

### 4.8 Admin: issue / revoke / end-date dialogs (Super Admin)
- **Issue:** valid from (default today), valid until (default valid from + 2 months − 1 day,
  editable), note. If an active card exists: "The current card C000123 will stop working at
  once." Result: "Card C000456 issued" with "Print now".
- **Revoke:** reason kind (Lost, Damaged, Left the company, Other) + text (3+ characters);
  "The card stops working at the gate immediately."
- **Change end date:** new date (today or later) + reason; "End today" shortcut; "Extend by
  2 months" shortcut (the shortcut follows the default-validity setting).

### 4.9 Admin: card PDF (Super Admin)
- **Single card (CR80, 85.6 × 54 mm):**
  - "Sheet Shapers" header with the **plant name and plant code**;
  - employee name (up to 2 lines, auto-shrinks), employee code (large), contractor (if any);
  - QR (about 30 mm, vector, quiet zone kept), card serial;
  - "Issued DD/MM/YYYY". The end date is **not** printed, because it can be extended or
    shortened without reprinting; the server is the only judge of validity (own decision of
    this spec, §14.2);
  - privacy line "A photo is taken at each punch. If found, return to the plant office."
- Each print sets `printed_plant_id` to the employee's current plant.
- **A4 sheet:** 10 cards (2 × 5) with thin cut marks; order as in the selection (sorted by
  plant, contractor, code).
- **Test card:** same layout with a large "TEST – NOT AN ID CARD" band, the label and serial;
  no plant.
- Font: bundled Inter TTF (OFL), so any Unicode name prints correctly.
- File names `card-C000123.pdf`, `cards-<date>-<count>.pdf`; opened in a new browser tab.

### 4.10 Admin: punch log (`/admin/punches`)
- Header chips for the chosen day and plant: ✓ IN n, ✓ OUT n, ✗ Rejected n; the Super Admin
  also sees ◐ Dark photos n (F-31).
- Filters: date (default today, IST), plant (top-bar filter: the **kiosk's** plant), result
  (accepted / rejected), kiosk, reason code, search by employee code or name.
- Table: time (HH:mm:ss IST), employee (code, name; "Unknown card" when the card could not be
  identified), direction (IN / OUT), result with icon + word, reason (translated short text
  + code), kiosk, photo state as text ("Photo stored", "Photo deleted on DD/MM", "No photo",
  "Photo not saved"). For a `WRONG_PLANT` row the employee belongs to another plant, so the
  Plant Head sees only "Card of another plant" (no code, no name; M1 §7 rule 1: nothing of other
  plants is leaked). The Super Admin and the Corporate Head see the employee as usual.
- **Super Admin only:** a "View photo" action, a "Compare" action, and the ◐ dark-photo mark.
  Corporate Head and Plant Head see the photo state as text only, no actions (R4).
- No thumbnails in the list (every photo view is audited, §8).
- **View photo:** a dialog with the 320 px image enlarged, time, kiosk, employee, and
  "Viewing is recorded in the audit log."
- **Compare photos (F-29):** in the same dialog, a button "Compare with earlier punches"
  shows this photo next to the same card's last 3 stored photos (date, kiosk under each). Each
  photo shown writes its own audit entry.
- **Export to Excel (F-35):** button "Export day (.xlsx)" for the current filters, for every
  role that sees the list; no photos in the file.
- Auto-refresh every 30 s while the date is today. Read-only.
- Empty state: "No punches yet today at this plant."

### 4.11 Admin: gate notices (`/admin/notices`, F-25)
- List: text, plant (or "All plants"), level (Normal / ⚠ Important), starts, ends, state
  (Scheduled / Showing now / Ended), created by.
- Form: plant (Plant Head: fixed to own plant; Super Admin: any plant or "All plants"), text
  (1–200 characters, plain text, live preview as the kiosk shows it), level, start and end
  date + time (IST; default now → today 23:59). "End now" action. Nothing is deleted.

### 4.12 Admin: kiosks, settings, dashboard, poster, import
- **Kiosks list and plant kiosks tab:** "Sound" switch per kiosk (On / Off) for the Super
  Admin and the own Plant Head; last self-test time (F-27).
- **Settings:** new cards "QR cards" and "Kiosk sound and screen"; the M1 "Snapshots" and
  "Punch rules" cards become editable (§7 rule 12).
- **Dashboard (F-33):** card "Cards ending soon: 12 in the next 14 days" with a link to the
  filtered QR cards page; sidebar badge on "QR cards" for the Super Admin.
- **Gate poster (F-34):** on the plant detail page, "Download gate poster (A4 PDF)" for the
  Super Admin and the own Plant Head (the poster is not a credential): plant name, three
  simple steps with pictures (hold card → look at camera → see IN / OUT), what to do if
  rejected, and the privacy notice with the current retention days.
- **Import result (F-38):** after a Super Admin's Excel import, and on an approved import
  request, a button "Issue and print cards for these N employees". It pre-selects the
  imported employees whose punch method is QR; the others are listed as skipped.

### 4.13 Ctrl+K additions (F-6)
- Typing a card serial (`C000123`) finds the employee (scoped like the lists).
- Commands (by role): "Issue QR card…", "Print QR cards…" (Super Admin), "QR cards",
  "Punch log", "Gate notices", "New gate notice".

## 5. API contract
Conventions: as M1 (REST under `/api/v1`, JSON, error format
`{ "error": { "code", "message", "details" } }`, pagination `?page=&page_size=`, Origin check on
user writes). "Admin" means any logged-in user; rights per role are in §7 rule 1 and are
always checked on the server, with the plant scope applied inside the query. Each error `code`
is also the translation key: `errors.<CODE>` in the admin, `kiosk.punch.<CODE>.*` at the kiosk.

### 5.1 QR cards
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/qr-cards | admin, scoped by the employee's current plant | filters `plant_id, type, punch_method, contractor_id, category_id, state (none/active/not_yet_valid/expiring/expired/revoked), printed, reprint_needed, q` (code, name or serial) | page of `{ employee: { id, code, name, type, plant, contractor, category, punch_method }, card: { id, serial, state, valid_from, valid_until, print_count, last_printed_at, printed_plant, reprint_needed } \| null }` | – |
| GET | /api/v1/qr-cards/expiring-count | Super Admin | – | `200 { count, days }` (F-33) | – |
| GET | /api/v1/employees/{id}/qr-cards | admin, scoped | – | `200 { cards: [ … newest first, with issued_by, revoked_by, revoke_kind, revoke_reason ] }` | `EMPLOYEE_NOT_FOUND` |
| POST | /api/v1/employees/{id}/qr-cards | Super Admin | `{ valid_from?, valid_until?, note? }` | `201 { card, replaced_card? }` | `EMPLOYEE_LEFT`, `EMPLOYEE_NOT_QR`, `QR_VALIDITY_INVALID`, `QR_SIGNING_NOT_CONFIGURED` |
| PATCH | /api/v1/qr-cards/{id} | Super Admin | `{ valid_until, reason }` (today or later) | `200 { card }` | `QR_CARD_NOT_FOUND`, `QR_CARD_REVOKED`, `QR_VALIDITY_INVALID` |
| POST | /api/v1/qr-cards/{id}/revoke | Super Admin | `{ kind: "lost"\|"damaged"\|"left"\|"other", reason }` | `200 { card }` | `QR_CARD_NOT_FOUND`, `QR_CARD_REVOKED` |
| GET | /api/v1/qr-cards/{id}/card.pdf | Super Admin | – | `application/pdf` (one CR80 page), `Cache-Control: no-store`; audit `qr_card.print`; sets `printed_plant_id` | `QR_CARD_NOT_FOUND`, `QR_CARD_REVOKED`, `EMPLOYEE_LEFT`, `FORBIDDEN` |
| POST | /api/v1/qr-cards/print | Super Admin | `{ card_ids[] (1–200), layout: "a4_sheet"\|"single_cards" }` | `application/pdf` | `PRINT_TOO_LARGE`, `QR_CARD_REVOKED` (serials in `details`), `FORBIDDEN` |
| POST | /api/v1/qr-cards/bulk | Super Admin | `{ action: "issue", employee_ids[] (≤500), valid_until?, reason }` or `{ action: "revoke", card_ids[] (≤500), kind, reason }` | `200 { done: n, skipped: [{ employee_code, card_serial, code }], card_ids: [...] }` (all valid rows done in one transaction; skipped rows explained, e.g. `EMPLOYEE_NOT_QR`; `card_ids` = the new cards of a bulk issue, so the screen can print exactly those) | `BULK_TOO_LARGE` |
| GET · POST | /api/v1/qr-test-cards | Super Admin | `{ label (e.g. "Gate test K134") }` | list · `201 { card }` (F-27) | `QR_SIGNING_NOT_CONFIGURED` |
| POST | /api/v1/qr-test-cards/{id}/revoke | Super Admin | `{ reason }` | `200 { card }` | `QR_CARD_REVOKED` |

Notes:
- `POST …/print` is a POST because the list is in the body; it changes print counts, so the
  Origin check applies. Test cards print through the same two print endpoints.
- The PDF never leaves through a public link; the browser receives it as a normal response.
- Corporate Head and Plant Head may only call the `GET` list endpoints (read); every other
  card endpoint returns `FORBIDDEN` for them.

### 5.2 Kiosk device endpoints
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/punch/kiosk | kiosk (signed, M1 §7 rule 6) | `{ client_punch_id (uuid), method: "qr", qr_payload (string, ≤ 200 chars), snapshot_jpeg (base64, ≤ 40 KB decoded), device_time (ISO 8601, informational), location?: { lat, lon, accuracy_m } (stored, not checked until M4), app_version }` | `200 { punch_id \| null, decision: "accepted"\|"rejected"\|"self_test", direction: "in"\|"out"\|null, employee: { display_name, employee_code } \| null, server_time, reason_code: null \| CODE, message_key, voice_key, details: { last_direction?, last_punch_at?, out_allowed_from?, kiosk_name? } }` | request-level only: `DEVICE_SIGNATURE_INVALID` (401), `NONCE_REUSED` (401), `DEVICE_REVOKED` (403), `VALIDATION_FAILED` (422), `PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429), `INTERNAL_ERROR` (500) |
| GET | /api/v1/kiosk/me | kiosk (signed) | – | M1 fields **plus (additive)** `notices: [{ id, text, level, ends_at }]`, `kiosk_settings: { voice_enabled, sound_enabled, result_seconds, reject_seconds, snapshot_retention_days, dark_threshold }` | as M1 |
| POST | /api/v1/kiosk/report | kiosk (signed) | `{ kind: "camera_error"\|"decoder_fallback"\|"script_error"\|"wake_lock_failed"\|"other", message (≤ 300 chars, no payloads or images), count (1–100), app_version }` | `204` (written to the server log as a JSON line with kiosk id; not stored in the database) (S-26) | `TOO_MANY_REQUESTS` (more than 20 reports per hour per kiosk), `VALIDATION_FAILED` |

Notes:
- **Decided punches return 200**, also when rejected: a rejection is a normal business result
  that is stored, not a failed request. `reason_code` uses the same code catalogue and
  translation keys as errors (§7 rule 10).
- `employee` is filled only for accepted punches and the "already punched" rejections
  (`COOLDOWN_ACTIVE`, `OUT_TOO_SOON`), never for other rejections, including `WRONG_PLANT`
  and `EMPLOYEE_NOT_QR` (FR-20).
- `self_test` (F-27): `punch_id` is null; nothing is written to `punches`.
- **Heartbeat:** the kiosk calls `GET /kiosk/me` every **60 seconds** (the M1 call, now also
  carrying notices and kiosk settings; a revocation shows within a minute). Each call also
  updates the kiosk's `last_seen_at` (M1).
  - Render: the poll keeps the backend awake **only while a kiosk page is open**; it does not
    run when no kiosk is open, so the keep-alive cron of decision 0002 stays.
  - Render's 750 free instance hours cover 744 hours (31 days × 24 h), so even a backend that
    never sleeps fits; in practice kiosks are closed at night.
- The kiosk's self-update (S-27) reads the static `/version.json` built with the frontend every
  5 minutes; no backend endpoint is needed.
- Retrying with the same `client_punch_id` (new nonce and counter, newly signed) returns the
  stored result of the first attempt and creates nothing new (§7 rule 7).

### 5.3 Punch log, snapshots and export (admin)
"In scope" for a Plant Head = punches made at a kiosk of their plant. A Corporate Head reads
all plants; the Super Admin all plants.

| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/punches | Super Admin, Corporate Head (read), Plant Head (read, own plant) | filters `date` (IST day, default today), `plant_id` (kiosk's plant), `decision, kiosk_id, employee_id, reason_code, dark_only (Super Admin), q`; newest first | page of `{ id, server_received_at, employee: { id, code, name } \| null, plant (kiosk's), kiosk: { id, name }, method, direction, decision, reason_codes[], snapshot: { state: "stored"\|"purged"\|"upload_failed"\|"none", is_dark (Super Admin only), expires_at?, purged_at? } }` | – |
| GET | /api/v1/punches/summary | as above | `date, plant_id` | `200 { accepted_in, accepted_out, rejected, dark_photos (Super Admin only), rejected_by_reason: { CODE: n } }` | – |
| GET | /api/v1/punches/{id} | as above | – | `200 { punch (all fields above + app_version, device_time, location?) }` | `NOT_FOUND` |
| GET | /api/v1/punches/{id}/snapshot | **Super Admin only** | – | `image/jpeg` (decrypted by the server), `Cache-Control: no-store`, `Content-Disposition: inline`; writes audit `snapshot.view` | `NOT_FOUND`, `SNAPSHOT_PURGED` (410), `SNAPSHOT_NOT_AVAILABLE` (404), `STORAGE_UNAVAILABLE` (503), `FORBIDDEN` (Corporate Head, Plant Head) |
| GET | /api/v1/punches/{id}/compare | **Super Admin only** | – | `200 { current: punch, earlier: [ up to 3 punches of the same card with a stored snapshot, newest first ] }` (F-29; images are then loaded one by one through `/snapshot`, each audited) | `NOT_FOUND`, `FORBIDDEN` |
| GET | /api/v1/punches/export.xlsx | as the list | same filters as the list (one date) | `.xlsx` (max 5,000 rows; no photos); audit `punches.export` (F-35) | `EXPORT_TOO_LARGE` |

### 5.4 Gate notices (F-25)
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/notices | admin, scoped (Plant Head: own plant + all-plant notices) | filters `plant_id, state (scheduled/showing/ended)` | page of notices | – |
| POST | /api/v1/notices | Super Admin (any plant or all plants); Plant Head (own plant only) | `{ plant_id \| null, text (1–200), level: "normal"\|"important", starts_at, ends_at }` | `201 { notice }` | `NOTICE_DATES_INVALID`, `NOTICE_TEXT_INVALID`, `FORBIDDEN` |
| PATCH | /api/v1/notices/{id} | same; the notice's plant must be in scope (a Plant Head cannot change all-plant notices) | any of the fields | `200 { notice }` | `NOTICE_ENDED`, `NOTICE_DATES_INVALID` |
| POST | /api/v1/notices/{id}/end | same | – | `200 { notice }` (ends now) | `NOTICE_ENDED` |

### 5.5 Kiosks and poster
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/kiosks | as M1 | as M1 | M1 fields **plus (additive)** `last_self_test_at`, `sound_muted` (F-27, F-1) | as M1 |
| PATCH | /api/v1/kiosks/{id} | Super Admin, own Plant Head | M1 `{ name? }` **plus** `{ sound_muted? }` | `200 { kiosk }` | as M1 |
| GET | /api/v1/plants/{id}/gate-poster.pdf | Super Admin; Plant Head own plant | – | `application/pdf` A4 (F-34) | `PLANT_NOT_FOUND` |

### 5.6 Search (F-6)
`GET /api/v1/search?q=` (M1) also matches card serials (`C` + digits) and returns the
employee; no new endpoint.

### 5.7 Additive change to the M1 import endpoints (F-38)
- `POST /api/v1/employees/import?dry_run=false` (Super Admin): the commit response gains
  **`created_employee_ids`** (list of the new employees' IDs, in file order), next to the
  existing `created`; it also gains **`created_qr_employee_ids`** (the subset whose punch method
  is QR, the people who can get a card).
- The apply result of an approved import request (`POST /change-requests/{id}/approve`, and
  the stored `result` of the request) gains the same two fields.
- The field is additive; nothing existing changes. The "Issue and print cards" step uses it
  to pre-select the new employees.

Common errors for all admin endpoints: as M1 (`NOT_AUTHENTICATED`, `FORBIDDEN`,
`ORIGIN_NOT_ALLOWED`, `VALIDATION_FAILED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`).

## 6. Data model changes
Conventions as M1: UUID `id`, `created_at` / `updated_at` as `timestamptz` (UTC), constraint
names per the M0 convention, nothing hard-deleted. Existing migrations end at `0005_people`.

**Migration `0006_qr_cards`**
| Table | Columns (type) | Keys / indexes / constraints |
|---|---|---|
| `qr_credentials` | kind (`employee`/`test`), employee_id (FK employees, null only for `test`), label (text null, test cards only), card_serial (text: `C` + 6–9 digits for employee cards, `T` + 6–9 digits for test cards; from the sequence `qr_card_serial_seq`), key_id (char(1), A–Z), valid_from (date, IST), valid_until (date; test cards: far future), issued_by (FK users), issued_at (timestamptz), note (text null), revoked_at (timestamptz null), revoked_by (FK users null), revoke_kind (`lost`/`damaged`/`left`/`replaced`/`other` null), revoke_reason (text null), print_count (int, default 0), last_printed_at (timestamptz null), **printed_plant_id (FK plants, null; set at every print to the employee's current plant)**, last_used_at (timestamptz null, test cards only) | unique `card_serial`; **partial unique (employee_id) where kind = `employee` and revoked_at is null** (one active card); check `kind = 'test'` ⇔ employee_id is null; check `valid_until >= valid_from`; check revoke fields all set or all null; index (employee_id, issued_at) |

The QR payload and signature are **not stored**: Ed25519 signatures are deterministic, so the
server re-creates the same payload from serial + key whenever it prints. The payload itself
holds no plant and no date; the plant on the printed card is for people, the server checks the
employee's current plant.

**Migration `0007_punches`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `punches` | client_punch_id (uuid), kiosk_id (FK kiosk_devices), plant_id (FK plants: the kiosk's plant), employee_id (FK null), qr_credential_id (FK null), method (`qr`; `face` added in M3), direction (`in`/`out` null), decision (`accepted`/`rejected`; `flagged` reserved for M4), reason_codes (text[], empty when accepted), server_received_at (timestamptz), device_claimed_at (timestamptz null, never trusted), was_offline (bool, default false; M4), lat / lon (numeric(9,6) null), accuracy_m (numeric null), ip (inet null), app_version (text null) | unique (kiosk_id, client_punch_id); index (plant_id, server_received_at); index (employee_id, server_received_at desc) where decision = `accepted`; index (qr_credential_id, server_received_at desc) (F-29); check direction not null when accepted; **trigger refuses UPDATE and DELETE** (append-only, like `audit_logs`) |
| `punch_snapshots` | punch_id (FK punches, unique), storage_key (text: `snapshots/YYYY/MM/DD/<punch id>.bin`, no names or codes), size_bytes (int, encrypted size), width / height (int), brightness (smallint 0–255, measured by the server, F-31), is_dark (bool), taken_at (timestamptz, server time), expires_at (timestamptz), state (`stored`/`upload_failed`/`purged`), purged_at (timestamptz null) | index (expires_at) where state = `stored`; rows are never deleted (only the file is) |

Columns for M3 (match and liveness scores) and M4b (phone, outside plant) are added by their
own migrations.

**Migration `0008_kiosk_notices_and_kiosk_fields`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `kiosk_notices` | plant_id (FK null = all plants), text (text, 1–200 characters), level (`normal`/`important`), starts_at, ends_at (timestamptz), created_by (FK users), ended_at (null), ended_by (FK null) | check `ends_at > starts_at`; index (plant_id, starts_at, ends_at) |
| `kiosk_devices` (change) | + sound_muted (bool, default false), + last_self_test_at (timestamptz null) | – |

**Storage size estimate (Supabase Free: 1 GB storage, 500 MB database):**
- Snapshot target: 320 × 240 JPEG, about 12–15 KB (the kiosk lowers JPEG quality until it
  fits; the server refuses anything above 40 KB); encryption adds 28 bytes per file.
- 350 QR workers × 2 punches × about 52 working days in 60 days ≈ 36,400 snapshots × 15 KB ≈
  **0.55 GB**. Worst case, all 650 people on QR: ≈ 1.0 GB, at the free limit.
- A rough upper figure (650 × 2 × 60 days × 20 KB ≈ 1.56 GB) shows why the size target and the
  60-day retention matter. Levers if it grows: shorter retention (setting) and a smaller JPEG.
  An automatic usage meter (S-25) is pending Tushar (§14.1); until then the team checks the
  Supabase dashboard by hand.
- Database: a punch row with indexes is about 0.4 KB; 650 × 2 × 310 days ≈ 400,000 rows ≈
  160 MB per year. This is why M2 adds no audit row per punch; the M6 plan must watch the
  500 MB limit.

## 7. Business rules

1. **Role permission matrix (M2 rows; extends M1 §7 rule 1).**

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK |
   |---|---|---|---|---|
   | QR cards: list and card history | all | all (read) | own plant (read) | – |
   | QR cards: issue, revoke, end, extend, bulk issue / revoke | ✔ | – | – | – |
   | QR card PDF: print / download, bulk print; test cards: issue, revoke, print | ✔ | – | – | – |
   | Punch log, summary, Excel export (text only, no photos) | all | all (read) | own plant (read) | – |
   | View a snapshot, compare photos | ✔ | – | – | – |
   | Gate notices: create, edit, end | any plant + all plants | read | own plant | – |
   | Kiosk sound switch | ✔ | – | own plant | – |
   | Gate poster | all plants | – | own plant | – |
   | Submit a punch, self-test, error report; read own notices and kiosk settings | – | – | – | own kiosk |
   | Settings (new M2 keys) | edit | read | read | – |

   New capabilities in `permissions.py`: `VIEW_QR_CARDS`, `MANAGE_QR_CARDS` (issue, revoke,
   extend, print, bulk, test cards; Super Admin only), `VIEW_PUNCHES`, `VIEW_SNAPSHOTS` (Super
   Admin only), `EXPORT_PUNCHES`, `VIEW_NOTICES`, `MANAGE_NOTICES`, `DOWNLOAD_GATE_POSTER`.
   Out-of-scope requests return `FORBIDDEN`; single records outside the scope return
   `NOT_FOUND` (as M1).

2. **QR payload and signing.**
   - Payload text: `UPS1.<key id>.<card serial>.<signature>`, for example
     `UPS1.A.C000123.<103 characters>`.
     - `UPS1` = format version 1; `key id` = one letter (A–Z) naming the signing key;
     - signature = Ed25519 over the ASCII text `UPS1.<key id>.<card serial>`, written in
       upper-case base32 without padding (103 characters);
     - everything is upper-case letters, digits and dots, so the QR uses the compact
       alphanumeric mode: about 118 characters, QR version 7 at error correction Q (25%
       damage recovery for scratched cards). S-23 checks this on every CI run.
   - **No dates and no plant in the payload:** validity and the current plant live only in
     the database, so the Super Admin can extend or end a card without reprinting it, and a
     transferred worker's card keeps working.
   - Keys: `QR_SIGNING_KEY` (environment variable, base64url of a 32-byte Ed25519 seed,
     required in production) and `QR_SIGNING_KEY_ID` (default `A`). A command
     `uv run python -m app.scripts.make_qr_key` prints a new key for `.env`. The key is a
     secret: if it is lost, every card must be reprinted; if it leaks, cards can be forged
     (the serial must still exist, so forging only copies existing cards). It is stored in
     Render's environment and in the client's password manager at handover; never in the
     repository. Rotation tooling is out of scope (the key id makes it possible later).
   - Without `QR_SIGNING_KEY` the app still starts in development, but issuing, printing and
     QR punches return `QR_SIGNING_NOT_CONFIGURED`; in production the app refuses to start
     without it (same style as `APP_SECRET_KEY`).

3. **Card lifecycle.**
   - Issue: only for an employee with status `active` (`EMPLOYEE_LEFT` otherwise) **and punch
     method `qr`** (`EMPLOYEE_NOT_QR` otherwise; temporary workers default to QR, M1 rule 10).
     `valid_from` today to 60 days ahead (default today). `valid_until` ≥ `valid_from`, at most
     3 years after it; default `valid_from` + `qr_card_default_validity_months` (2) − 1 day.
   - One active card per employee (database rule). Issuing while a non-revoked card exists
     revokes it in the same transaction (`revoke_kind = replaced`, reason
     "Replaced by C000456").
   - Card validity is by IST calendar day: valid from 00:00 IST of `valid_from` to 23:59:59
     IST of `valid_until`.
   - States (computed, never stored): `revoked` (revoked_at set) → `not_yet_valid` →
     `expired` (after `valid_until`) → `expiring` (ends within
     `qr_card_expiring_soon_days`) → `active`.
   - Revoke: immediate, reason kind + text (3+ characters); a revoked card is never
     un-revoked (issue a new one instead).
   - Change end date: today or later (today = "expire by hand"; later = extend); not for
     revoked cards. No reprint is needed, because the end date is not printed (§4.9).
   - Print (Super Admin only): allowed for non-revoked cards of active employees and for test
     cards; each print raises `print_count`, sets `last_printed_at` and `printed_plant_id` (the
     employee's current plant).
   - **Mark as left** (M1, Super Admin) revokes the active card in the same transaction
     (`revoke_kind = left`). Reactivating an employee does not bring the old card back.
   - **Punch method switched from QR to face:** the card is **not** revoked automatically
     (decision 0005: cards are revoked by hand). The card panel shows a reminder banner
     (§4.7); until the Super Admin revokes it, the kiosk rejects the card with
     `EMPLOYEE_NOT_QR`. Switching from face to QR makes the employee eligible for a card.
   - **Plant transfer (M1 F-20):** the card keeps working. From the transfer's effective date
     the employee's current plant is the new plant, so the card works there and is rejected at
     the old plant with `WRONG_PLANT`. The printed plant no longer matches, so the QR cards list
     shows "Reprint needed (card shows K134)"; a reprint is advised, not required.
   - Bulk issue / revoke: max 500, one transaction, a reason is required, one audit entry per
     card with the same request ID; rows that cannot be done (left; not QR; already has a card
     for issue; already revoked for revoke) are skipped and listed, not failed.
   - **F-38:** the "Issue and print cards" step after an import calls the same bulk issue and
     print rules for the imported QR-method employees (using `created_employee_ids`); it is
     for the Super Admin only.

4. **Snapshot rules.**
   - Taken by the kiosk about 0.7 s after the card is read, from the same camera, 320 px
     wide (4:3 or the camera's ratio), JPEG; the kiosk lowers quality step by step until the
     file is ≤ 15 KB (minimum quality 0.4).
   - Server checks: present (`SNAPSHOT_MISSING`), decodes as a JPEG with width 160–640 and
     height 120–640 and ≤ 40 KB (`SNAPSHOT_INVALID`); decoding uses Pillow with a small pixel
     limit (no decompression bombs).
   - The server re-encodes it (quality 75, no metadata), measures its average brightness
     (0–255) and sets `is_dark` when it is below `snapshot_dark_threshold` (F-31; the photo
     is kept and the punch is decided as normal), then **encrypts** it (rule 17) and uploads
     it.
   - A snapshot is stored for every decided QR punch, accepted or rejected (including
     `WRONG_PLANT` and `EMPLOYEE_NOT_QR`), **except** the "already punched" rejections
     (`COOLDOWN_ACTIVE`, `OUT_TOO_SOON`), which carry no new evidence. Self-test scans (F-27)
     check the snapshot but never store it.
   - Upload happens before the answer, with a 5 s timeout and one retry. If storage still
     fails, the punch is still decided and saved, the snapshot row gets `upload_failed`, and a
     warning is logged: a storage outage must never stop the gate.
   - `expires_at` = `taken_at` + `snapshot_retention_days`. When the Super Admin **lowers**
     the retention, existing rows are shortened to the new period in the same save; raising
     it affects only new snapshots.
   - **Purpose limitation:** snapshots are used only by the Super Admin checking card sharing.
     They are never used for face recognition, never turned into face templates, never sent to
     any outside AI service, never exported (the Excel export has no photos).

5. **Punch pipeline (anti-proxy engine, M2 part).** `app/antiproxy/engine.py` runs the rules
   in a fixed order. Each rule gets one "punch context" (kiosk, plant, request, now, settings,
   database session) and returns **pass** or **reject with a code** (M4 adds **flag**:
   recorded, then the next rule runs). The first reject stops the chain. Order:
   1. **Device:** M1's `require_kiosk` dependency (not a rule file): signature, nonce/counter,
      kiosk active. These failures are request errors: no punch row (the kiosk cannot be
      trusted), a JSON warning log line with the request ID only.
   2. **Request shape** (in the endpoint, before the rules): method `qr`, payload length,
      body ≤ 64 KB (`PAYLOAD_TOO_LARGE`), rate limit of 60 punches per minute per kiosk
      (`TOO_MANY_REQUESTS`). Request errors, no punch row.
   3. **Kiosk location** – *M4* (`OUTSIDE_GEOFENCE`, `GPS_ACCURACY_TOO_LOW`). In M2 the
      optional location is only stored.
   4. **Rule file `snapshot.py`:** `SNAPSHOT_MISSING`, `SNAPSHOT_INVALID`.
   5. **Rule file `qr_credential.py`**, in this order:
      - payload matches the strict pattern → else `QR_FORMAT_INVALID`;
      - key id known and Ed25519 signature valid → else `QR_SIGNATURE_INVALID`;
      - serial exists → else `QR_SIGNATURE_INVALID` (a valid signature on an unknown serial
        means a leaked key; logged as an error);
      - **test card** (`T…`, not revoked): the chain stops with `self_test`; the kiosk's
        `last_self_test_at` and the card's `last_used_at` are set; audit `kiosk.self_test`
        (actor = kiosk); no punch row (F-27);
      - card not revoked → `QR_REVOKED`; today ≥ `valid_from` → `QR_NOT_YET_VALID`;
        today ≤ `valid_until` → `QR_EXPIRED`;
      - employee status `active` → `EMPLOYEE_INACTIVE`;
      - employee punch method `qr` → `EMPLOYEE_NOT_QR`;
      - employee's **current plant** (`employees.plant_id`) = the kiosk's plant →
        `WRONG_PLANT` (SRS §8; M1 §7 rule 10).
   6. **Rule file `cooldown.py`:** cool-down and IN/OUT (rule 6).
   7. **Impossible travel** – *M4*.
   - The engine and every rule file are small and pure, so each rule is unit-tested on its
     own; M3 adds `rules/face_*.py` and M4 adds `rules/geofence.py` and
     `rules/impossible_travel.py` without changing the endpoint.

6. **IN / OUT decision and cool-down** (FR-19; server time only; the employee row is locked
   for the decision so two kiosks cannot decide at the same moment). Let *last* be the
   employee's last **accepted** punch (it may be at the old plant right after a transfer):
   1. If *last* is less than `punch_cooldown_minutes` (default 2) ago → reject
      `COOLDOWN_ACTIVE` ("Already IN at 07:02").
   2. Else if *last* is an IN less than `min_minutes_before_out` (default 30) ago → reject
      `OUT_TOO_SOON` ("Already IN at 07:02; OUT after 07:32").
   3. Else if *last* is an IN less than `open_in_max_hours` (default 20) ago → **OUT**.
      This covers night shifts across midnight (IN 19:00, OUT 07:05 next day = 12 h).
   4. Otherwise (no punch yet, last was OUT, or the IN is older than 20 h, i.e. a forgotten
      OUT) → **IN**. The old IN stays without an OUT; M5 marks that day incomplete.
   - The decided direction is stored on the punch and never changed. M5 pairs punches into
     attendance days with the shift rules; it reads punches, it does not rewrite them.

7. **Idempotency and retries.** `client_punch_id` is a random UUID made by the kiosk for each
   scan. A second request with the same `(kiosk, client_punch_id)` returns the stored result
   and creates nothing. The kiosk retries a failed request once automatically (new nonce and
   counter) before showing the connection error. `NONCE_REUSED` makes the kiosk re-sign and
   retry once.

8. **What a punch stores.** Accepted and rejected (after rule 5.2) punches get a `punches`
   row: kiosk, kiosk's plant, server time, employee and card (when identified), direction
   (accepted), reason codes (rejected), device time (informational only), optional location,
   IP (logs only, never proof), app version. **Never stored:** the QR payload text, the
   signature, the device's own idea of the result. Device time is never used for any decision.

9. **Kiosk behaviour rules.**
   - **Zero-tap start (SRS FR-16):** after pairing and after every reload the kiosk starts the
     camera and the scanning by itself. The sound banner is optional (§4.1); a "Start camera"
     button appears only if the browser refuses the camera without a gesture.
   - Scans only on the scanning screen; one punch at a time; ignores the same payload for 5 s
     after a result.
   - Client-side format check `UPS1.` prefix: other QR codes are ignored with a short
     message and nothing is sent.
   - The camera stream stays in the browser; only the single snapshot is sent. No image is
     stored on the device (the M4 offline queue will change this and must re-check privacy).
   - The QR decoder WebAssembly file is served from our own site (never a public CDN), and the
     kiosk code and decoder are loaded only on `/kiosk` (S-28).
   - **Heartbeat:** the kiosk calls `GET /kiosk/me` every **60 seconds** (notices, settings,
     revocation) and reads `/version.json` every 5 minutes (S-27).
   - Low-light hint (F-31): the kiosk measures the brightness of a small preview frame once a
     second; below `snapshot_dark_threshold` for 10 s → hint shown. This is only a hint; the
     server measures the stored photo itself.
   - Screen-awake lock (S-29): requested after the optional banner tap and again whenever the
     page becomes visible; a failure after the tap is reported (S-26) and the setup guide
     explains the device power settings.

10. **Reason code catalogue (M2).** Every code has an English worker message, a next step, a
    short spoken line and an admin text, stored as translation keys
    (`kiosk.punch.<CODE>.title`, `.message`, `.next`, `.voice`; `punchReasons.<CODE>` for the
    admin), so Marathi / Hindi need no code change.
    - Kiosk-only codes (never sent by the server): `CAMERA_BLOCKED`, `CAMERA_NOT_FOUND`,
      `NETWORK_OFFLINE`, `SERVER_WAKING`, `QR_NOT_UPASTHITI`, `BROWSER_NOT_SUPPORTED` (M1).
    - Server decision codes: `SNAPSHOT_MISSING`, `SNAPSHOT_INVALID`, `QR_FORMAT_INVALID`,
      `QR_SIGNATURE_INVALID`, `QR_REVOKED`, `QR_NOT_YET_VALID`, `QR_EXPIRED`,
      `EMPLOYEE_INACTIVE`, `EMPLOYEE_NOT_QR`, `WRONG_PLANT`, `COOLDOWN_ACTIVE`,
      `OUT_TOO_SOON`, `QR_SIGNING_NOT_CONFIGURED`.
    - Messages are in §9.

11. **Gate notices (F-25).** Plain text 1–200 characters, trimmed, no HTML (shown as text,
    never as markup); level `normal` or `important`; `starts_at` < `ends_at`, `ends_at` at
    most 90 days after `starts_at`; a notice shows on a kiosk when its plant matches (or it is
    an all-plants notice) and now is between start and end (and it has not been ended). Max 3
    shown at once: important first, then the newest start. Ended or past notices stay in the
    list (audited, never deleted). Text typed in Marathi or Hindi is shown as typed (the
    browser picks a system font). A kiosk learns about a new notice within 2 minutes (60 s
    heartbeat).

12. **Settings (company-wide; `CURRENT_MILESTONE` = 2): 11 rows = 2 existing settings that
    become editable + 9 new ones.**

    | Key | Default | Range | Group |
    |---|---|---|---|
    | `punch_cooldown_minutes` | 2 | 1–30 | punch (existing, now editable) |
    | `snapshot_retention_days` | 60 | 7–365 | snapshots (existing, now editable) |
    | `min_minutes_before_out` | 30 | 2–240 | punch (new) |
    | `open_in_max_hours` | 20 | 12–24 | punch (new) |
    | `snapshot_dark_threshold` | 40 | 10–120 (brightness 0–255) | snapshots (new, F-31) |
    | `qr_card_default_validity_months` | 2 | 1–36 | cards (new) |
    | `qr_card_expiring_soon_days` | 14 | 1–60 | cards (new, F-33) |
    | `kiosk_voice_enabled` | on | on / off | kiosk (new, F-1) |
    | `kiosk_sound_enabled` | on | on / off | kiosk (new, F-1) |
    | `kiosk_result_seconds` | 4 | 2–10 | kiosk (new) |
    | `kiosk_reject_seconds` | 6 | 3–15 | kiosk (new) |

    On/off values use the existing `allowed_values` mechanism (`"on"`, `"off"`), so no new
    setting type is needed. The settings `storage_limit_mb`, `database_limit_mb`,
    `usage_warning_percent` and `kiosk_offline_after_minutes` of the first draft are removed
    with S-25 and F-36 (pending Tushar).

13. **Voice and sound (F-1).**
    - Tones are generated in the browser with the Web Audio API (no audio files): success =
      two rising notes, "already" = one soft note, reject = two low notes.
    - Speech uses the browser's Web Speech API with an `en-IN` voice (else any `en` voice),
      preferring voices that run on the device. **The name is never spoken**, so no personal
      data goes to any online voice.
    - Spoken lines come from translation keys: `kiosk.voice.in` ("Checked in."),
      `kiosk.voice.out` ("Checked out."), `kiosk.voice.alreadyIn` / `alreadyOut`,
      `kiosk.voice.selfTest`, and `kiosk.punch.<CODE>.voice` for rejections (for example
      "Card blocked. Please see the plant office.").
    - Off when `kiosk_voice_enabled` / `kiosk_sound_enabled` is off, the kiosk's `sound_muted`
      is on, or the browser has not yet allowed sound (banner not tapped).

14. **Storage configuration.**
    - `STORAGE_BACKEND` = `local` or `supabase`. Development and tests: `local`, folder
      `STORAGE_LOCAL_DIR` (default `backend/.storage/`, git-ignored).
    - **In production** the app requires `STORAGE_BACKEND`, `QR_SIGNING_KEY` and
      `SNAPSHOT_ENCRYPTION_KEY`. When `STORAGE_BACKEND=supabase`, it also requires
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SNAPSHOT_BUCKET`. A missing variable stops the
      app with "Missing required setting: NAME" and never prints a value (M1 behaviour).
      Render's disk is wiped at every deploy, so on Render it must be `supabase`; `local` is
      meant for the client's own server with a real disk.
    - Supabase: `SUPABASE_SERVICE_KEY` (secret, only in Render's environment), bucket
      `SNAPSHOT_BUCKET` (suggested name `punch-snapshots`, **private**). The Supabase **Data
      API is switched off** for the project (we use plain Postgres). Calls: upload, download
      and delete objects through the Storage REST API with timeouts; only plain object
      storage, no Supabase-only features (portability, decision 0002).
    - The storage layer has three operations: save bytes under a key, read bytes by key,
      delete a list of keys. Callers never see which back-end is used.

15. **Daily purge** (added to `app/jobs/daily.py`, runs at 00:05 IST and at start-up, safe to
    repeat): in batches of 500, for snapshots with state `stored` and `expires_at` < now,
    delete the files, then set state `purged` and `purged_at`. A batch whose delete fails is
    left for the next run (logged). Rows with `upload_failed` older than the retention are
    marked `purged` too. The job reports how many it purged in its log line.

16. **Kiosk error reports (S-26).** Allowed kinds only (§5.2); message ≤ 300 characters; the
    kiosk adds counts instead of sending the same error repeatedly; max 20 reports per hour per
    kiosk (`TOO_MANY_REQUESTS`); written to the server's JSON log with kiosk id, plant and
    app version; never stored in the database and never containing QR payloads, images or
    names.

17. **Snapshot encryption (S-24).** AES-256-GCM with the key from `SNAPSHOT_ENCRYPTION_KEY`
    (base64url, 32 bytes; required in production; a key id letter is stored in front of the
    file so a later key change stays possible). Each file = key id + 12-byte random nonce +
    ciphertext + tag; the punch ID is the additional authenticated data, so a file cannot be
    swapped onto another punch. The server decrypts only to serve `/snapshot`. A lost key
    makes stored photos unreadable (they expire within the retention period anyway); the key
    goes to the client's password manager at handover.

18. **Usage meter (S-25).** *Removed from M2, pending Tushar (R7, §14.1).* Rule number kept so
    the numbering of the first draft stays stable.

19. **Kiosk online badge (F-36).** *Removed from M2, pending Tushar (R7, §14.1).* Rule number
    kept. (The M1 `last_seen_at` column keeps being updated by every signed request; only the
    badge and alert logic are removed.)

20. **Gate poster (F-34).** One A4 page per plant, generated with fpdf2: plant name (the poster
    is per gate), three steps with simple pictures (Lucide icons, ISC, embedded as vector
    drawings), "If it says NOT ACCEPTED, go to the plant office", and the privacy notice with
    the current `snapshot_retention_days`. No personal data.

21. **Punch log export (F-35).** One IST day; same filters and scope as the list; columns:
    date, time, plant (kiosk), employee code, name, kiosk, direction, result, reason code,
    reason text, photo state; no photos and no IP or location. Cell values starting with `=`,
    `+`, `-`, `@` are written as text (spreadsheet injection, M1 rule 12). Max 5,000 rows
    (`EXPORT_TOO_LARGE`). Audit `punches.export` (filters, row count).

## 8. Security, privacy and compliance
- **Role checks per endpoint:** the M1 dependency + the new capabilities (§7 rule 1); plant
  scope inside each query; tests call every new endpoint with every role.
- **Kiosk trust:** every punch is signed by the device key (M1 §7 rule 6); the signature
  covers the whole body, including the QR payload and the snapshot, so neither can be swapped
  in transit. The kiosk's own idea of the result is never sent or used. Server time only.
- **Forgery and card sharing:** card payloads are Ed25519-signed; the serial must exist;
  revoked / expired / wrong plant / wrong punch method are checked on the server. Remaining
  risk: a photocopy or phone photo of a real card works like the card (at the employee's own
  plant). Mitigation: snapshot at every punch, cool-down and the 30-minute IN→OUT gap,
  side-by-side review (F-29, Super Admin), M4 impossible travel, later F-10 buddy-punch
  detection.
- **Card PDFs are credentials:** Super Admin only (decision 0005); `Cache-Control: no-store`;
  every print audited with the serials; the payload is never stored, logged or shown as text.
- **Snapshots:**
  - private bucket, **encrypted before upload** (§7 rule 17); the browser never gets a
    storage URL; the backend streams the decrypted image after the role check;
  - **only the Super Admin** can view photos and the compare view (M1 matrix, SRS FR-20 /
    FR-27); Corporate Head and Plant Head get `FORBIDDEN` and see the photo state as text;
  - every view, including each photo in the compare view, writes `snapshot.view` (actor,
    punch, employee, plant, time, IP);
  - the list shows no thumbnails, so only deliberate views happen;
  - the server re-encodes images (strips metadata) and limits size and pixels;
  - retention + purge (§7 rules 4 and 15); purpose limitation (§7 rule 4);
  - test data: only synthetic images (generated colour patterns, no faces); `.storage/` is
    git-ignored; no real photo ever enters the public repository.
- **Supabase key:** `SUPABASE_SERVICE_KEY` is powerful. It lives only in Render's
  environment, is never sent to the browser, and the Supabase Data API (PostgREST) is
  switched off, so the key can only reach Storage in practice. Checked by hand at deploy time.
- **Voice privacy:** names are never spoken.
- **Logs:** QR payloads, snapshots, signatures, keys and storage keys are never logged; punch
  log lines carry the punch ID, decision and reason code only; kiosk error reports carry no
  personal data (§7 rule 16).
- **Request size:** 64 KB limit on the punch endpoint, checked before the body is read.
- **New environment variables:** `QR_SIGNING_KEY` (required in production),
  `QR_SIGNING_KEY_ID`, `SNAPSHOT_ENCRYPTION_KEY` (required in production), `STORAGE_BACKEND`
  (required in production), `STORAGE_LOCAL_DIR`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SNAPSHOT_BUCKET` (the last three required when `STORAGE_BACKEND=supabase`). Added to
  `.env.example` with comments; values are never printed (M1 rule).
- **Audit entries (same transaction as the change):** `qr_card.issue`, `qr_card.revoke` (also
  from mark-as-left, with the same request ID), `qr_card.update_validity`, `qr_card.print`
  (serials, layout), bulk actions (one entry per card, shared request ID),
  `qr_test_card.issue` / `.revoke`, `kiosk.self_test` (actor = kiosk), `snapshot.view`,
  `punches.export`, `notice.create`, `notice.update`, `notice.end`, `kiosk.update` (sound
  switch), `settings.update` (existing). **Punches get no audit row:** the punch table is
  itself append-only.
- **DPDP Act 2023 / Rules 2025:**
  - **Personal data touched:** employee name, code, plant, contractor (on the card and at the
    kiosk); the snapshot (a photo of a person: personal data, not a biometric template);
    punch times and kiosk.
  - **Purpose and lawful use:** attendance and prevention of proxy punching, for employment
    (a legitimate use under the Act); stated in the notice.
  - **Notice:** kiosk screen line, the line on the card, and the gate poster (F-34). Full
    privacy notice page in M6 (FR-42).
  - **Minimisation:** 320 px image only, no metadata, no face templates from snapshots, no
    photo on the ID card (F-32 is Later), no name spoken aloud.
  - **Security:** encryption at rest by us (S-24) on top of the provider's.
  - **Retention:** snapshots 60 days (setting) then deleted; punches kept as attendance
    records (Labour Codes). Data requests (access / erasure) in M6.
  - **Processor:** Supabase (Mumbai region) stores the encrypted files; the handover notes
    record it for the client's privacy register.
- **IT Act §43A:** reasonable security: encrypted private storage, TLS, role checks, audit,
  secrets in environment only.
- **Labour Codes:** punches are never edited or deleted (database trigger); corrections come
  later as separate regularisation records (M5).
- **Compliance-auditor and security-reviewer** are asked to review this spec (snapshot
  handling and encryption, card PDFs, key handling) before approval.

## 9. Edge cases and error handling
Kiosk messages show title + message + next step and the "For the admin: CODE" line on
rejections (decision 0006). Keys: `kiosk.punch.<CODE>.*`; admin keys `errors.<CODE>`.

| Case | Expected behaviour | Error code | Kiosk/user message (English, i18n key) |
|---|---|---|---|
| Valid card, first punch of the day | accepted IN, snapshot stored | – | "Welcome, {{name}}"; voice "Checked in." `kiosk.punch.accepted.in` |
| Valid card, 9 h after IN | accepted OUT | – | "Goodbye, {{name}}"; voice "Checked out." `kiosk.punch.accepted.out` |
| Same card scanned again within 2 min | rejected (stored, no snapshot) | `COOLDOWN_ACTIVE` | "Already {{direction}} at {{time}}. No need to punch again." `kiosk.punch.COOLDOWN_ACTIVE` |
| Scanned again 10 min after IN | rejected (stored, no snapshot) | `OUT_TOO_SOON` | "Already IN at {{time}}. You can punch OUT after {{outTime}}." `kiosk.punch.OUT_TOO_SOON` |
| Night shift: IN 19:00, scan 07:05 next day | accepted OUT (12 h < 20 h) | – | `kiosk.punch.accepted.out` |
| Forgot OUT yesterday; scan 24 h after the IN | accepted IN; yesterday stays incomplete (M5) | – | `kiosk.punch.accepted.in` |
| Card used at another plant's gate | rejected, snapshot stored, no name on the kiosk | `WRONG_PLANT` | "This card is for another plant. Please see the plant office." `kiosk.punch.WRONG_PLANT` |
| Employee transferred, effective date reached; card used at the new plant | accepted; list shows "Reprint needed (card shows K134)" | – | normal result |
| Employee transferred; card used at the old plant after the effective date | rejected | `WRONG_PLANT` | as above |
| Transfer effective tomorrow; card used at the new plant today | rejected until the effective date | `WRONG_PLANT` | as above |
| Employee's punch method is face, card still active | rejected, snapshot stored, no name | `EMPLOYEE_NOT_QR` | "This card cannot be used for punching. Please see the plant office." `kiosk.punch.EMPLOYEE_NOT_QR` |
| Revoked card | rejected, snapshot stored | `QR_REVOKED` | "This card is blocked. Please see the plant office." `kiosk.punch.QR_REVOKED` |
| Card past its end date | rejected | `QR_EXPIRED` | "This card has expired. Please see the plant office." `kiosk.punch.QR_EXPIRED` |
| Card before its start date | rejected | `QR_NOT_YET_VALID` | "This card is not active yet. Please see the plant office." `kiosk.punch.QR_NOT_YET_VALID` |
| Card extended after printing | keeps working; no reprint (end date not printed) | – | – |
| Employee marked as left (card revoked by the same action) | rejected | `QR_REVOKED` | as above |
| Employee left but card somehow active (data repair case) | rejected | `EMPLOYEE_INACTIVE` | "This card cannot be used. Please see the plant office." `kiosk.punch.EMPLOYEE_INACTIVE` |
| Employee marked as left earlier the same day, scans OUT | rejected; fixed later in M5 (advice in the user guide: mark as left after the last shift) | `QR_REVOKED` | as above |
| Forged or edited QR (bad signature) | rejected, no employee, snapshot stored (evidence) | `QR_SIGNATURE_INVALID` | "This card is not valid. Please see the plant office." `kiosk.punch.QR_SIGNATURE_INVALID` |
| `UPS1.` QR that is damaged or cut | rejected | `QR_FORMAT_INVALID` | "The card could not be read. Hold it still, about 20 cm from the camera." `kiosk.punch.QR_FORMAT_INVALID` |
| Other QR (UPI, product) | ignored, nothing sent | `QR_NOT_UPASTHITI` (client) | "This is not an Upasthiti ID card." `kiosk.punch.QR_NOT_UPASTHITI` |
| TEST card scanned (F-27) | "KIOSK OK" screen; no punch row; last self-test updated | – | "Kiosk OK. No attendance was recorded." `kiosk.punch.selfTest` |
| Revoked TEST card | rejected like any revoked card, but no punch row and no snapshot | `QR_REVOKED` | as above |
| Card held up continuously | one punch; same payload ignored for 5 s | – | – |
| Phone photo / photocopy of a real card | treated as the card (cannot be told apart); snapshot + compare view are the evidence | – | – |
| Snapshot missing (camera froze after the scan) | rejected | `SNAPSHOT_MISSING` | "The photo could not be taken. Stand in front of the camera and try again." `kiosk.punch.SNAPSHOT_MISSING` |
| Snapshot too big, not a JPEG, or wrong size | rejected | `SNAPSHOT_INVALID` | same message, `kiosk.punch.SNAPSHOT_INVALID` |
| Very dark gate | punch decided as normal; photo marked dark; kiosk shows the low-light hint after 10 s | – | "Too dark. Please switch on the gate light." `kiosk.lowLight` |
| Supabase Storage down or slow (> 5 s, after 1 retry) | punch decided and saved; snapshot `upload_failed`; log warning; punch log shows "Photo not saved" | – | normal result |
| `SNAPSHOT_ENCRYPTION_KEY` wrong after a change (old files) | photo cannot be decrypted → shown as not available; logged as an error | `SNAPSHOT_NOT_AVAILABLE` | "No photo is available for this punch." `errors.SNAPSHOT_NOT_AVAILABLE` |
| Network down at the kiosk | not saved, honest message; offline queue in M4 | `NETWORK_OFFLINE` (client) | "No internet. Your punch was NOT saved. Try again in a moment." `kiosk.punch.NETWORK_OFFLINE` |
| Render asleep (cold start) | "server is starting" after 5 s; up to 60 s; then the connection error | `SERVER_WAKING` (client) | "The server is starting. Please wait…" `kiosk.punch.SERVER_WAKING` |
| Answer lost after the server saved the punch | kiosk retries with the same `client_punch_id`; same result; no duplicate | – | normal result |
| Two kiosks scan the same card at the same second | the employee row lock makes one decide first; the other gets `COOLDOWN_ACTIVE` or `WRONG_PLANT` | – | as above |
| New frontend deployed while a kiosk is open | kiosk reloads itself when idle 30 s (S-27); never during a punch | – | – |
| Kiosk revoked while running | next punch or 60 s heartbeat gets 403; kiosk shows the revoked screen | `DEVICE_REVOKED` | M1 `kiosk.revoked` |
| Kiosk's key lost (browser data cleared) | 401; pairing screen | `DEVICE_SIGNATURE_INVALID` | M1 `kiosk.notPaired` |
| Kiosk floods punches (bug or attack) | 61st punch in a minute refused | `TOO_MANY_REQUESTS` | "Please wait a moment and try again." `kiosk.punch.TOO_MANY_REQUESTS` |
| Kiosk floods error reports | 21st report in an hour refused; kiosk stops sending until the next hour | `TOO_MANY_REQUESTS` | – |
| Body larger than 64 KB | refused before reading | `PAYLOAD_TOO_LARGE` | "The photo was too large. Try again." `kiosk.punch.PAYLOAD_TOO_LARGE` |
| Camera permission denied / no camera | scanning screen explains how to fix; error report sent | `CAMERA_BLOCKED` / `CAMERA_NOT_FOUND` (client) | "Camera is blocked. Allow the camera for this site." `kiosk.punch.CAMERA_BLOCKED` · "No camera found. Connect a camera." `kiosk.punch.CAMERA_NOT_FOUND` |
| Browser refuses the camera without a tap | large "Start camera" button; one tap starts it | – | "Start camera" `kiosk.startCamera` |
| Sound banner not tapped | punches work; tones, voice, full screen and wake lock may be unavailable; screen shows every result | – | banner `kiosk.soundBanner` "Tap once to turn on sound and full screen" |
| Wake lock refused after the tap | kiosk keeps working; error report `wake_lock_failed`; setup guide covers power settings | – | – |
| Kiosk clock wrong by hours | no effect (server time only); the clock on screen comes from the server | – | – |
| `QR_SIGNING_KEY` missing (development) | issue / print / QR punch refused | `QR_SIGNING_NOT_CONFIGURED` | "Cards are not set up on the server. Tell the admin." `kiosk.punch.QR_SIGNING_NOT_CONFIGURED` |
| Issue a card to an employee whose punch method is face | refused | `EMPLOYEE_NOT_QR` | "This employee punches by face. Change the punch method to QR first." `errors.EMPLOYEE_NOT_QR` |
| Issue a card to a left employee | refused | `EMPLOYEE_LEFT` | M1 `errors.EMPLOYEE_LEFT` |
| End date before start, or > 3 years | refused | `QR_VALIDITY_INVALID` | "Choose an end date on or after the start date, within 3 years." `errors.QR_VALIDITY_INVALID` |
| Revoke / print / change a revoked card | refused | `QR_CARD_REVOKED` | "This card is already revoked. Issue a new card." `errors.QR_CARD_REVOKED` |
| Plant Head or Corporate Head tries to issue, revoke, extend or print | refused | `FORBIDDEN` | M1 `common.readOnly` |
| Print more than 200 cards at once | refused | `PRINT_TOO_LARGE` | "Print at most 200 cards at a time." `errors.PRINT_TOO_LARGE` |
| Bulk issue where 3 of 40 already have a card | 37 issued, 3 skipped and listed | – | "37 cards issued. 3 skipped: they already have a card." `qrCards.bulkResult` |
| Photo older than the retention period | 410 | `SNAPSHOT_PURGED` | "This photo was deleted on {{date}} (kept {{days}} days)." `errors.SNAPSHOT_PURGED` |
| Photo never saved | 404 | `SNAPSHOT_NOT_AVAILABLE` | "No photo is available for this punch." `errors.SNAPSHOT_NOT_AVAILABLE` |
| Compare: card has no earlier stored photos | dialog shows only the current photo and "No earlier photos of this card." | – | `punches.compareNone` |
| Storage unreachable when viewing | 503 | `STORAGE_UNAVAILABLE` | "Photos cannot be loaded right now. Try again later." `errors.STORAGE_UNAVAILABLE` |
| Corporate Head or Plant Head opens a photo or compare | 403 | `FORBIDDEN` | M1 `common.readOnly` |
| Export over 5,000 rows | refused | `EXPORT_TOO_LARGE` | "Too many rows. Choose one plant or add a filter." `errors.EXPORT_TOO_LARGE` |
| Notice end before start, or > 90 days | refused | `NOTICE_DATES_INVALID` | "The end must be after the start, within 90 days." `errors.NOTICE_DATES_INVALID` |
| Notice empty or > 200 characters | refused | `NOTICE_TEXT_INVALID` | "Write 1 to 200 characters." `errors.NOTICE_TEXT_INVALID` |
| Edit an ended notice | refused | `NOTICE_ENDED` | "This notice has ended. Create a new one." `errors.NOTICE_ENDED` |
| Retention lowered from 60 to 30 days | existing photos older than 30 days are purged at the next run | – | settings toast "Older photos will be deleted tonight." |
| Browser has no English voice | tones only, no error | – | – |

## 10. Acceptance criteria (Given / When / Then)
Core:
- **AC-1** Given an active temporary worker whose punch method is QR and who has no card, when
  the Super Admin issues a card with the defaults, then a card `C…` exists, valid from today
  until today + 2 months − 1 day, and `qr_card.issue` is audited; the same request by a
  Corporate Head or Plant Head returns `FORBIDDEN`; given an employee whose punch method is
  face, then issuing returns `EMPLOYEE_NOT_QR`.
- **AC-2** Given a worker with active card C000001, when the Super Admin issues a new card,
  then C000001 is revoked with kind `replaced`, the new card is the only active one, and the
  database refuses a second active card even if two requests arrive together.
- **AC-3** Given a card, when its payload is built twice, then both are identical, match the
  pattern `UPS1.A.C\d{6,9}.[A-Z2-7]{103}`, verify with the public key, and changing any
  character makes verification fail.
- **AC-4** Given a card, when the single-card PDF is downloaded by the Super Admin, then it is
  one CR80 page with name, code, contractor, **plant name and code**, serial and issue date,
  **no end date**, and a QR that decodes to the card's payload; the A4 layout with 12 cards
  gives 2 pages (10 + 2); every print raises `print_count`, sets `printed_plant_id` to the
  employee's current plant, and is audited.
- **AC-5** Given a Plant Head of TP1 and a Corporate Head, when they open the QR cards list,
  then the Plant Head sees TP1 employees only and the Corporate Head all plants, read-only;
  when either calls issue, revoke, change-end-date, single print, bulk print, bulk issue or
  test-card endpoints, then each returns `FORBIDDEN`.
- **AC-6** Given an employee with an active card, when the Super Admin marks them as left,
  then the card is revoked with kind `left` in the same transaction and both audit entries
  share one request ID.
- **AC-7** Given a paired kiosk that has just loaded `/kiosk`, when no one taps anything, then
  the camera and the scanning start by themselves; when an active card of an employee of that
  plant is shown, then within 5 s (on the warmed-up deployed site) the kiosk shows the green
  **IN** screen with the name, code and server time; if the sound banner was tapped, it also
  plays the success tone and says "Checked in." (no name); the server has one accepted punch
  with direction `in` and a stored, encrypted snapshot whose `expires_at` is 60 days later.
- **AC-8** Given that IN, when the same card is shown 1 minute later, then `COOLDOWN_ACTIVE`
  ("Already IN at …", amber) with no new snapshot; at 10 minutes `OUT_TOO_SOON`; at 9 hours
  an accepted **OUT** (blue).
- **AC-9** Given an IN at 19:00, when the card is shown at 07:05 the next day, then OUT; given
  an IN 24 hours earlier without an OUT, then IN.
- **AC-10** Given a revoked card, when it is shown at the kiosk, then the red "NOT ACCEPTED"
  screen shows "This card is blocked. Please see the plant office." and "For the admin:
  QR_REVOKED", no name is shown, and the punch log shows the rejected punch with reason
  `QR_REVOKED` and a snapshot the Super Admin can view. **(First demo, on the deployed kiosk,
  together with AC-7.)**
- **AC-11** Given a TP1 employee's active card, when it is shown at a K134 kiosk, then
  `WRONG_PLANT` ("This card is for another plant. Please see the plant office."), no name on
  the screen, the punch is stored with the K134 kiosk's plant and a snapshot; given the
  employee is transferred to K134 effective tomorrow, then the card is still rejected at K134
  today, and from the effective date it is accepted at K134 and rejected at TP1; the QR cards
  list then shows "Reprint needed (card shows TP1)" and the filter finds it; after a reprint
  the badge is gone.
- **AC-12** Given an employee whose punch method is switched from QR to face while the card is
  still active, when the Super Admin opens the card panel, then the reminder banner "Revoke the
  old card?" shows; when the card is shown at the kiosk, then `EMPLOYEE_NOT_QR`, no name, snapshot
  stored.
- **AC-13** Given cards that are expired or not yet valid, when each is shown, then
  `QR_EXPIRED` / `QR_NOT_YET_VALID`, each stored as a rejected punch with a snapshot.
- **AC-14** Given a payload with a changed serial or a signature made with another key, when it
  is sent, then `QR_SIGNATURE_INVALID`, the punch row has no employee and the snapshot is
  stored.
- **AC-15** Given a signed punch request, when the body is changed after signing, or the
  counter is reused, or the kiosk is revoked, then `DEVICE_SIGNATURE_INVALID`,
  `NONCE_REUSED`, `DEVICE_REVOKED` respectively, and no punch row is written.
- **AC-16** Given a punch that was saved, when the kiosk sends the same `client_punch_id`
  again (newly signed), then the response equals the first one and there is still exactly
  one punch row.
- **AC-17** Given a punch request without a snapshot, or with a 100 KB image, or with a PNG,
  then `SNAPSHOT_MISSING` / `PAYLOAD_TOO_LARGE` / `SNAPSHOT_INVALID`; a stored snapshot has no
  EXIF metadata after decryption.
- **AC-18** Given the device time is 3 hours wrong, when a punch is made, then
  `server_received_at` and the shown time are the server's, and the decision is unaffected.
- **AC-19** Given any punch row, when anyone (even the database owner) runs UPDATE or DELETE on
  `punches`, then the database refuses it; no `audit_logs` row is written for a punch.
- **AC-20** Given `STORAGE_BACKEND=local`, when a punch is made, then an encrypted file exists
  under `STORAGE_LOCAL_DIR` (its bytes are not a readable JPEG); given the Supabase back-end
  (a fake server in CI, the real bucket manually), then the object is in the private bucket
  and an anonymous request to its public URL is refused.
- **AC-21** Given storage that fails, when a punch is made, then the punch is accepted, the
  snapshot state is `upload_failed`, and the punch log shows "Photo not saved".
- **AC-22** Given snapshots with `expires_at` in the past, when the daily job runs, then their
  files are deleted, the rows are `purged` with `purged_at`, the punch rows are unchanged, and
  running the job again changes nothing; given the retention is lowered from 60 to 30 days,
  then photos older than 30 days are purged at the next run.
- **AC-23** Given a Super Admin, when they open "View photo", then the image comes from
  `/api/v1/punches/{id}/snapshot` with `Cache-Control: no-store` and one `snapshot.view`
  audit entry is written; a Plant Head and a Corporate Head get `FORBIDDEN` on `/snapshot` and
  `/compare`; no storage URL appears in any API response.
- **AC-24** Given the punch log for today at TP1, when it opens, then it lists TP1's kiosk
  punches newest first with time, employee, direction, result, reason and photo state as text;
  the chips match the counts; a Plant Head of K134 sees only punches at K134 kiosks; a
  Corporate Head sees all plants; only the Super Admin sees "View photo", "Compare" and the
  dark-photo mark; the list refreshes within 30 s after a new punch.
- **AC-25** Given the settings screen, when the Super Admin sets `punch_cooldown_minutes` to 5
  with a reason, then the next duplicate within 5 minutes returns `COOLDOWN_ACTIVE`; values
  out of range are refused; the 11 M2 settings (2 existing + 9 new) are editable and the M3+
  settings stay read-only.
- **AC-26** Given every new text on the kiosk and admin screens and every M2 code, when the
  translation check runs, then every key exists in `en/common.json` (title, message, next step
  and voice line for each kiosk code, including `WRONG_PLANT` and `EMPLOYEE_NOT_QR`).
- **AC-27** Given `APP_ENV=production`, when `QR_SIGNING_KEY`, `SNAPSHOT_ENCRYPTION_KEY` or
  `STORAGE_BACKEND` is missing, then the app stops with "Missing required setting: NAME"; when
  `STORAGE_BACKEND=supabase` and `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` or `SNAPSHOT_BUCKET` is
  missing, then it stops the same way; no secret value is printed.
- **AC-28** Given the CI, when it runs, then backend and frontend coverage are at least 75%.

Extras:
- **AC-29 (F-1)** Given voice on, an English voice, and the sound banner tapped, when a punch
  is accepted, then the kiosk says "Checked in." / "Checked out." and never the name; a
  rejected punch speaks its `.voice` line; given the banner not tapped or the kiosk's sound
  switch off, then no tone and no speech and the screen alone shows the result; given no
  English voice, then tones only.
- **AC-30 (F-6)** Given 40 selected employees (35 QR-method without a card, 2 QR-method with a
  card, 3 face-method), when the Super Admin runs "Issue cards", then 35 cards are issued and
  5 listed as skipped; "Print cards (A4)" for the 35 gives one PDF of 4 pages; "Revoke cards"
  with a reason revokes all selected active cards with one shared request ID; Ctrl+K finds an
  employee by typing their card serial.
- **AC-31 (F-25)** Given a Plant Head of TP1, when they create an important notice for today
  06:00–18:00, then TP1's kiosk shows it within **2 minutes** during that time with the ⚠
  "Important" label and not after 18:00; other plants' kiosks never show it; the Plant Head
  cannot create a notice for another plant or for all plants; an all-plants notice by the
  Super Admin shows on every kiosk.
- **AC-32 (F-27)** Given a TEST card printed by the Super Admin, when it is scanned at any
  kiosk, then the "KIOSK OK" screen shows camera, server and clock ✓, no punch row is written,
  the kiosk's `last_self_test_at` updates and appears in the kiosks list, and `kiosk.self_test`
  is audited; a revoked TEST card is refused with `QR_REVOKED` and still writes no punch row;
  a Plant Head cannot print or issue test cards.
- **AC-33 (F-29)** Given a card with 5 earlier stored photos, when the Super Admin opens
  "Compare with earlier punches", then the current photo and the 3 newest earlier ones are shown
  with date and kiosk, and 4 `snapshot.view` audit entries are written; a Plant Head gets
  `FORBIDDEN`.
- **AC-34 (F-31)** Given a snapshot with brightness below the threshold, when the punch is
  stored, then it is decided normally, `is_dark` is true, the Super Admin's log shows ◐ and
  the summary counts it; given the kiosk preview stays dark for 10 s, then the "Too dark" hint
  shows and hides again when it is bright.
- **AC-35 (F-33)** Given 12 active cards ending within 14 days, when the Super Admin opens the
  dashboard, then the "Cards ending soon: 12" card and the sidebar badge show 12, and the link
  opens the QR cards page filtered to "Ends soon".
- **AC-36 (F-34)** Given plant TP1 and a retention of 60 days, when the Super Admin or the TP1
  Plant Head downloads the gate poster, then it is one A4 page with the plant name, the three
  steps and "Kept for 60 days"; a K134 Plant Head gets `PLANT_NOT_FOUND` for TP1.
- **AC-37 (F-35)** Given today's punches at TP1, when "Export day (.xlsx)" is pressed by the
  Super Admin, the Corporate Head or the TP1 Plant Head, then the file opens in Excel with one
  row per punch in the listed columns, no photos, IP or location, a name starting with `=` is
  stored as text, and `punches.export` is audited.
- **AC-38 (F-36)** *Removed, pending Tushar (R7): kiosk online / offline badge.*
- **AC-39 (F-38)** Given a Super Admin who just imported 40 workers (38 QR-method, 2
  face-method), when they press "Issue and print cards for these employees", then the list is
  built from `created_employee_ids` of the import response, 38 cards are issued, the 2
  face-method employees are listed as skipped, and one A4 PDF of 4 pages opens; the same button
  appears on an approved import request, whose result also carries `created_employee_ids`.
- **AC-40 (S-22)** Given the load test (7 simulated gates × 300 punches in 10 minutes) against
  a container limited to 0.1 CPU and 512 MB, when it runs, then at least 95% of decisions take
  under 2 s, no punch is lost or duplicated, and memory stays under 450 MB; the result is
  recorded in the PR.
- **AC-41 (S-23)** Given the CI, when the print-and-scan test runs, then a card PDF rendered to
  an image decodes to exactly the card's payload and the QR version is ≤ 7.
- **AC-42 (S-24)** Given a stored snapshot, when its file is read directly from storage, then
  it is not a JPEG; when it is moved onto another punch's key, then decryption fails (the
  punch ID is bound to the file).
- **AC-43 (S-25)** *Removed, pending Tushar (R7): storage and database usage meter.*
- **AC-44 (S-26)** Given a kiosk whose camera fails, when it sends an error report, then the
  server log has one JSON line with the kiosk id, kind and count and no personal data; the
  21st report in an hour returns `TOO_MANY_REQUESTS`.
- **AC-45 (S-27)** Given an open kiosk on build 1, when build 2 is deployed, then within 10
  minutes the kiosk reloads itself while idle and never during a punch.
- **AC-46 (S-28)** Given the CI, when the bundle-size check runs, then the admin bundle does not
  contain the QR decoder or kiosk code and every bundle stays within its budget (set in the
  plan).
- **AC-47 (S-29)** Given the kiosk setup guide, when a teammate who did not build M2 follows it
  on a new Android phone and a Windows PC, then each runs `/kiosk`, restarts into scanning
  without any tap, and after the one optional banner tap shows full screen with sound; the
  screen does not sleep for 30 minutes on the scanning screen, and camera and location stay
  allowed after a restart.

## 11. Test plan
- **Unit (pytest):**
  - payload build, base32 form, signature verify, strict pattern, key id handling (AC-3);
  - card state calculation by IST day; issue / replace / revoke / end-date / extend rules;
    default 2 months; `EMPLOYEE_NOT_QR` on issue; `printed_plant_id` and `reprint_needed`
    (AC-1, AC-2, AC-4, AC-6, AC-11);
  - each rule file on its own (`snapshot`, `qr_credential` incl. `EMPLOYEE_NOT_QR` and
    `WRONG_PLANT`, `cooldown`), and the engine order (first reject wins); test-card branch
    (AC-11 to AC-14, AC-32);
  - IN/OUT decision table: cool-down, `OUT_TOO_SOON`, night shift, forgotten OUT, boundaries
    exactly at 2 min / 30 min / 20 h (AC-8, AC-9);
  - transfer on its effective date: the card works at the new plant, not at the old one
    (AC-11);
  - snapshot checks: missing, too large, PNG, too many pixels, metadata stripped, brightness
    and `is_dark` (AC-17, AC-34);
  - encryption: round trip, wrong key, swapped punch ID (AC-42);
  - storage layer: local back-end; Supabase back-end against a small fake HTTP server
    (upload, read, delete, timeout, retry) (AC-20, AC-21);
  - start-up checks for required variables, including the `supabase` extras (AC-27);
  - purge job: batches, idempotent, lowered retention (AC-22);
  - notice visibility (AC-31); settings ranges, 11 rows (AC-25); export escaping (AC-37);
    error-report limits (AC-44).
- **API (pytest + httpx, real Postgres in CI):**
  - every new endpoint × every role (generated matrix): card print and snapshot endpoints are
    Super Admin only, punch list and export readable by Corporate Head and Plant Head (own
    plant), notices and poster per §7 rule 1 (AC-1, AC-5, AC-23, AC-24, AC-31, AC-36);
  - full signed punch flow with a P-256 key made in the test (AC-7 server side, AC-10 to
    AC-18); concurrency test: two punches of one employee in parallel give one accepted;
  - import commit and approved import request return `created_employee_ids` (AC-39);
  - `punches` trigger refuses UPDATE / DELETE and no audit row per punch (AC-19);
  - card PDF and gate poster are valid PDFs; print-and-scan test with pypdfium2 + zxing-cpp
    (AC-4, AC-41); export opens with openpyxl (AC-37).
- **Unit (Vitest + Testing Library):** kiosk state machine (camera starts without a tap →
  scanning → read → checking → result → scanning; self-test; network error; server waking;
  "Start camera" fallback); sound banner shows and hides; 60 s heartbeat; same-payload 5 s
  debounce; client format check; snapshot size loop (mocked canvas); low-light hint timing;
  self-update waits for idle (AC-45); result screens for each code show title, message, next
  step and the admin code line; voice lines never contain the name, switches respected
  (AC-29, mocked speech); QR cards page bulk bar, "Reprint needed" filter and role hiding
  (print only for the Super Admin); punch log hides photo actions for non-Super Admin roles
  (AC-24); notice form validation.
- **Bundle check (S-28):** size-limit in the `frontend` CI job (AC-46).
- **Load test (S-22, not in CI):** Locust script in `backend/loadtest/`, run by hand against
  `docker run --cpus=0.1 --memory=512m` and once against the deployed backend outside working
  hours; results recorded in the PR (AC-40).
- **End-to-end (Playwright, headed locally so the lead sees it):**
  - a helper makes a test card with a fixed test key and turns its QR into a short `.y4m`
    video clip for Chrome's fake camera (`--use-file-for-fake-video-capture`); the clip is
    made during the test run (synthetic picture, no face, not committed);
  1. Super Admin issues a card, prints the PDF (opens), and the kiosk context (paired as in
     M1, no tap needed) shows the card → green IN; the punch log shows it with "View photo"
     (AC-1, AC-7, AC-23 sample);
  2. second scan → "Already IN" (AC-8);
  3. Super Admin revokes the card → kiosk shows "NOT ACCEPTED … QR_REVOKED" → punch log shows
     the rejected punch (AC-10);
  4. a second kiosk at another plant rejects the card with `WRONG_PLANT`; after a transfer the
     card works at the new plant and the list shows "Reprint needed" (AC-11);
  5. bulk issue + A4 print for 12 workers; import → "Issue and print cards" (AC-30, AC-39);
  6. Plant Head adds a notice → it appears on the kiosk screen within 2 minutes; Plant Head has
     no print, issue or photo buttons (AC-5, AC-24, AC-31);
  7. TEST card → "KIOSK OK" and the kiosks list shows the self-test (AC-32);
  8. axe scan on every new page and on the kiosk scanning and result screens (S-17).
- **Manual checks:**
  - **first demo on the deployed site** with a real phone kiosk and a real gate PC with a
    webcam: valid card accepted, revoked card rejected with reason (AC-7, AC-10); time per
    punch measured with a stopwatch (target < 5 s); a reload starts scanning with no tap;
  - printed cards on the office printer: plain paper and laminated; scan at 10, 20 and 30 cm,
    in daylight and under the gate light; a scratched card; the gate poster printed;
  - speech and tones on Android Chrome and Windows Chrome / Edge (after the banner tap);
  - Supabase: bucket is private, Data API switched off, stored files are not readable images,
    storage size after 100 test punches (to confirm the 15 KB estimate);
  - kiosk setup guide followed by a teammate (AC-47);
  - keyboard-only walk through the new admin pages.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
Think like a product owner. List every idea that would make **this milestone or the whole
project** better: features, screens, checks, UX polish, security, performance, or a better
library or approach than the one planned.

**Approval rule:** nothing in this section is built until the project lead approves it.
- Ask the lead about each suggestion directly in chat as a simple choice; don't leave
  questions only in this file.
- Mark each row as Approved / Rejected / Later.
- Copy approved items into the scope (§2), the acceptance criteria (§10) and
  docs/decisions/.

The rows below were answered in chat on 2026-10-19 by **Anuradha (team member)**, not by the
lead. "Approved (Anuradha)" means: confirmed by the team and built in M2 once the lead approves
this spec. Two rows pull a "Later" item of accepted-extras.md forward; they wait for Tushar
(§14.1). Approved rows are in §2 items 6 and 7, with acceptance criteria AC-29 to AC-47.

Not re-proposed (already decided in accepted-extras.md): F-2, F-3, F-8, F-10–F-14, F-16,
F-21, F-22, F-24, S-13, S-14, S-16, S-19, S-21. F-26 (muster, M5) stays where it is.

### 12.1 Tooling and engineering extras
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status (Pending / Approved / Rejected / Later) |
|---|---|---|---|---|---|---|
| S-22 | Load test of the punch endpoint with Locust (MIT, dev only): 7 gates × 300 punches in 10 minutes against a local container limited like Render (0.1 CPU, 512 MB) and once against the deployed backend outside working hours | Proves NFR-01 ("300 punches in 10 minutes per gate", decision under 2 s) on the free tier before the client relies on it at shift change | M2 | S | Low (must not run against production during shifts) | Approved (Anuradha, 2026-10-19) |
| S-23 | Print-and-scan test in CI: render the card PDF to an image (pypdfium2) and decode its QR (zxing-cpp); also assert the QR version stays ≤ 7 | Catches a QR that prints too small or a payload that grows, before cards are printed for 350 workers | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| S-24 | Encrypt snapshots before upload (AES-256-GCM, `SNAPSHOT_ENCRYPTION_KEY`; `cryptography` is already used) | A leaked bucket or a mis-set "public" flag shows only unreadable files; strong DPDP story | M2 | S | Low (a lost key makes photos unreadable, but they expire in 60 days anyway) | Approved (Anuradha, 2026-10-19) |
| S-25 | Storage and database meter (the M2 part of Later item F-14): Settings shows snapshot storage vs 1 GB and database size vs 500 MB, warning at 80% | M2 is the first milestone that fills Supabase; the client sees the limit coming long before it breaks | M2 | S | Low | Pending Tushar (pulls a Later item forward) |
| S-26 | Kiosk error reports: small signed reports (camera error, decoder fallback, script errors; no images, no payloads) to a rate-limited endpoint, written to the server log | Gate devices are far from the team; we can see why a kiosk misbehaves without visiting it | M2 | S | Low (log volume, capped per kiosk) | Approved (Anuradha, 2026-10-19) |
| S-27 | Kiosk self-update: the kiosk compares its build with the site's `version.json` and reloads itself when idle | Gate kiosks stay open for weeks; without this they keep old code after each deploy | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| S-28 | Bundle-size check in CI (size-limit, MIT) and lazy-loading of the kiosk code and the QR WebAssembly, so the admin bundle never contains them | Faster loading on cheap gate phones and office PCs; stops silent bundle growth | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| S-29 | Kiosk device setup guide + screen-awake lock (`docs/kiosk-setup-guide.md`: Chrome/Edge kiosk mode, autoplay, camera and location permissions, power settings for Android and Windows) | The gate screen must never sleep or lose its permissions; installation repeatable after handover | M2 | S | Low | Approved (Anuradha, 2026-10-19) |

### 12.2 Product features for the whole project
| # | Feature | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-27 | Kiosk test card / self-test: a "TEST" card; scanning it shows "Kiosk OK: camera ✓, server ✓, clock ✓" and creates no attendance | A guard or Plant Head checks a gate in 5 seconds each morning and after installation | M2 | S | Low (test scans never become punches) | Approved (Anuradha, 2026-10-19) |
| F-28 | "Inside now" counter on the kiosk screen: one number per plant, no names | Occupancy at a glance; a first taste of the M5 muster | M5 | S | Medium (approximate until M5 pairs punches) | Later (M5) |
| F-29 | Side-by-side photo review: a punch's photo next to the same card's last 3 photos (Super Admin only) | Card sharing is spotted in seconds when the faces do not match | M2 | S | Low (each photo view is still audited) | Approved (Anuradha, 2026-10-19) |
| F-30 | Face-in-photo check before sending (MediaPipe Face Detector, Apache-2.0) | Stops punches with only a hand or the ceiling in the photo | M3 | M | Medium (extra model download, slower on cheap phones) | Later (M3) |
| F-31 | Low-light hint at the kiosk + "dark photo" mark and count for the Super Admin | Good photos at night shifts; fewer unreadable cards | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| F-32 | Employee photo printed on the ID card (taken with consent, used only for printing) | Guards can compare the card to the person | Later | M | High (face photos of temporary workers: consent, DPDP) | Later (privacy risk) |
| F-33 | Cards ending soon: sidebar badge and dashboard card for the Super Admin | Supports the by-hand expiry rule (decision 0005) | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| F-34 | Printable gate poster (A4 PDF per plant): how to punch + privacy notice + retention days | Trains changing workers without a person; fulfils the DPDP notice at the gate | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| F-35 | Punch log export to Excel (one day) | A pilot next to the current register before M5 reports exist | M2 | S | Low | Approved (Anuradha, 2026-10-19) |
| F-36 | Kiosk online / offline badge from the heartbeat (small first part of Later item F-3 / FR-24) | Admins see a dead gate kiosk before workers queue up | M2 | S | Low | Pending Tushar (pulls a Later item forward) |
| F-37 | Gentle "late" hint on the IN screen, using the M5 shift rules | Punctuality nudge without HR conversations | M5 | S | Medium (can feel like public shaming) | Later (M5, off by default) |
| F-38 | "Issue and print cards" step right after an Excel import (QR-method employees only) | A weekly batch of new workers gets cards in one flow | M2 | S | Low | Approved (Anuradha, 2026-10-19) |

## 13. Dependencies to add
Exact versions are fixed by the lockfiles at build time. All are free and open-source.

| Package | Version | Licence | Reason |
|---|---|---|---|
| fpdf2 | 2.8.x | LGPL-3.0 | **New in the lockfile, planned in ADR 0001:** ID card, test card and gate poster PDFs. Used unmodified as a library, so the LGPL asks only that its licence notice stays; no fee |
| Pillow | 11.x+ | MIT-CMU (HPND) | Comes with fpdf2; also decodes, checks, measures brightness of and re-encodes snapshots (strips metadata) |
| segno | 1.x | BSD-3-Clause | Already installed (M1 pairing QR); now also the card QR |
| cryptography | already installed | Apache-2.0 / BSD | Ed25519 card signatures and AES-256-GCM snapshot encryption (ADR 0001) |
| xlsxwriter | already installed | BSD-2-Clause | Punch log export (F-35) |
| httpx2 | already installed (dev) | BSD-3-Clause | **Moved from dev to runtime:** HTTP calls to Supabase Storage with timeouts. No new licence; the plan may choose the standard library `urllib` instead |
| Inter font (TTF files) | 4.x | OFL-1.1 | Unicode names on the PDFs (fpdf2 needs TTF; the site already uses Inter); each file < 1 MB (repo limit) |
| Lucide icons (SVG files copied for the poster) | current | ISC | Simple pictures on the gate poster (F-34); already used in the frontend; logged in docs/decisions/ui-component-sources.md |
| barcode-detector | 3.x | MIT | **New (frontend):** QR reading on every browser; uses the built-in detector when present, else ZXing WebAssembly |
| zxing-wasm | (comes with barcode-detector) | MIT (ZXing-C++ inside: Apache-2.0) | The WebAssembly decoder; served from our own site, not a CDN |
| locust | latest | MIT | **New, dev only (S-22):** load test |
| pypdfium2 | latest | Apache-2.0 / BSD-3-Clause | **New, dev only (S-23):** render card PDFs to images in tests |
| zxing-cpp (Python) | latest | Apache-2.0 | **New, dev only (S-23):** decode the rendered QR in tests |
| size-limit + @size-limit/preset-app | latest | MIT | **New, dev only (S-28):** bundle-size budget in CI |
| Web Speech API, Web Audio API, Screen Wake Lock, MediaDevices | browser built-in | – | Voice, tones, keep screen on, camera; nothing to install |

No paid service is used. Supabase Storage is part of the existing free project (decision
0002).

## 14. Answered questions
The 16 questions were answered in chat on **2026-10-19 by Anuradha (team member)**, not by the
lead. Seven items conflict with earlier approved decisions; for those the spec follows the
earlier decision and the item waits for Tushar (§14.1). The rest are confirmed as M2's own
decisions (§14.2).

1. **Where does a card work?** Anuradha: at any plant. **Spec follows the earlier rule: only at
   the employee's current plant (`WRONG_PLANT`). Pending Tushar (R1).**
2. **Default card end date:** 2 months (setting, editable at issue). Confirmed (§14.2); changed
   from 6 to 2 months by Anuradha on 2026-10-20.
3. **Transfer / plant on the card:** Anuradha: keep the card, print no plant. **Spec: the card
   keeps working after a transfer, and the card prints the plant name and code (SRS FR-14);
   a reprint is advised. Pending Tushar (R2).**
4. **Missing or broken snapshot:** reject (`SNAPSHOT_MISSING`). Confirmed.
5. **Gate notices:** Super Admin for any / all plants; Plant Head for own plant. Confirmed.
6. **Kiosk voice:** tones + short line without the name. Confirmed.
7. **Minimum IN → OUT gap:** 30 minutes (`OUT_TOO_SOON`). Confirmed.
8. **IN / OUT logic:** toggle from the last accepted punch; an IN older than 20 h is a forgotten
   OUT. Confirmed.
9. **Card size:** CR80 single + A4 sheets of 10. Confirmed.
10. **Photo on the result screen:** none. Confirmed.
11. **Who views snapshots:** Anuradha: Super Admin + Plant Head (own plant). **Spec follows the
    earlier matrix: Super Admin only. Pending Tushar (R4).**
12. **Who prints card PDFs:** Anuradha: Super Admin and Plant Head (own plant). **Spec follows
    decision 0005: Super Admin only. Pending Tushar (R3).**
13. **Audit row per punch:** no (punches table is append-only). Confirmed.
14. **Cards for face employees:** Anuradha: any employee with an active card may punch by QR.
    **Spec follows CLAUDE.md §1 / SRS FR-07: a card only for QR-method employees. Pending
    Tushar (R5).**
15. **Snapshot size:** 320 px, about 12–15 KB. Confirmed.
16. **Supabase Storage access:** service key in Render's environment, Data API switched off.
    Confirmed.

### 14.1 Pending Tushar
Each row needs Tushar's decision (only the lead may change an earlier approved decision). Until
he answers, the spec follows the **earlier decision** in the third column.

| # | What was answered or proposed (2026-10-19) | What the earlier decision says | Status |
|---|---|---|---|
| R1 | Anuradha, Q1: a card works at **any plant** | M1 spec §7 rule 10 and SRS §8: punches are accepted only at the employee's current plant. Spec: `WRONG_PLANT` at another plant's kiosk | Pending |
| R2 | Anuradha, Q3: print **no plant** on cards | SRS FR-14: ID card "with name, code and plant". Spec: plant name and code printed; `printed_plant_id`; "Reprint needed" badge after a transfer (the card keeps working) | Pending |
| R3 | Anuradha, Q12: the **Plant Head prints** cards of their own plant | Decision 0005, CLAUDE.md §1, M1 §7 matrix row "QR cards": only the Super Admin handles QR cards. Spec: print / download / bulk print / test cards are Super Admin only | Pending |
| R4 | Anuradha, Q11: the **Plant Head views snapshots** | M1 matrix row "Review rejected / flagged punches: Super Admin only"; SRS FR-20 / FR-27. Spec: photos and compare are Super Admin only; Corporate Head and Plant Head read the punch list as text (a matrix confirmation, see §14.2) | Pending |
| R5 | Anuradha, Q14: **any employee** with an active card may punch by QR, even with method face | CLAUDE.md §1 (permanent = face, temporary = QR); SRS FR-07 / FR-11 / FR-13 (punch method per employee). Spec: cards only for QR-method employees (`EMPLOYEE_NOT_QR` on issue and at the kiosk); reminder banner when switched to face | Pending |
| R6 | Spec draft (spec-writer's own design, not Anuradha's answer): a **"Tap to start"** start screen | SRS FR-16: detection starts automatically, zero taps. Spec: no start screen; optional "Tap once for sound and full screen" banner; "Start camera" button only if the browser refuses the camera. Recorded because it came up in the audit; if Tushar accepts one tap, say so | Pending |
| R7 | Anuradha approved **S-25** (usage meter) and **F-36** (kiosk online badge) for M2 | accepted-extras.md (lead, 2026-10-12): F-14 free-tier health page and F-3 kiosk health monitor are "Later". Spec: not built in M2; no `/system/usage`, no `online` field, no related settings | Pending |

### 14.2 Own decisions inside M2 (confirmed by Anuradha)
These do not change any earlier approved decision. Each has one line of justification.

- **Card validity default 2 months (answer 2; 6 months until the change of 2026-10-20):** the
  card then expires by itself on its end
  date, and the Super Admin can extend or end it by hand at any time, which is how "expire by
  hand" in decision 0005 is satisfied.
- **Missing or broken snapshot is rejected (answer 4):** the same camera read the card, so a
  missing photo is rare and suspicious; it keeps the photo evidence complete.
- **Gate notices: Super Admin (any / all plants) and Plant Head (own plant) (answer 5):** a
  notice is information, not a credential; the Plant Head knows the gate's daily needs.
- **Voice without the name (answer 6):** a shared gate speaker must not call out personal
  data; the name stays on the screen.
- **30 minutes before an OUT (answer 7):** a second scan by mistake never marks someone OUT.
  It is a setting.
- **IN / OUT toggle with a 20-hour limit (answer 8):** simple to explain, covers night shifts,
  and treats a forgotten OUT safely; M5 reads punches and decides the attendance day.
- **CR80 card + A4 sheets of 10 (answer 9):** fits a standard card holder and any office
  printer.
- **No photo on the result screen (answer 10):** temporary workers have no stored photo and the
  gate screen is public.
- **No audit row per punch (answer 13):** the `punches` table is itself append-only (database
  trigger); an audit row per punch would double database growth on the 500 MB free plan.
  Architecture §3 is updated.
- **Snapshot 320 px, about 12–15 KB (answer 15):** keeps 60 days of photos near 0.55 GB of the
  1 GB free storage.
- **Supabase Storage through its REST API with the service key, Data API off (answer 16):**
  decision 0002 allows "plain Postgres and Storage"; no extra package; the key can only reach
  Storage in practice.
- **The QR payload has no dates (own choice of this spec):** validity lives in the database so
  cards can be extended without reprinting; SRS FR-14 only asks for valid-from / valid-until
  on the card record. Architecture §3 is updated.
- **The card prints the issue date, not the end date (own choice of this spec):** an extended
  or shortened card never needs a reprint; the server is the only judge of validity.
- **The 9 new settings** (§7 rule 12): every rule value is a setting (CLAUDE.md §10).
- **Punch list readable by Corporate Head and Plant Head, text only (A-level confirmation of
  the matrix):** they already read attendance data in M5, so reading the punch list does not
  widen access; photos stay with the Super Admin (R4).
- **Extras confirmed by Anuradha:** F-6 (M2 part), F-25, F-27, F-29, F-31, F-33, F-34, F-35,
  F-38 and S-22, S-23, S-24, S-26, S-27, S-28, S-29 (all free, small, no change to earlier
  decisions; F-1, F-6 and F-25 were approved earlier by the lead).

## 15 Changes
One line per change made on 2026-10-20 (reason, earlier file).
- 2026-10-20 · Attribution · The 2026-10-19 answers are attributed to Anuradha (team member),
  not to the lead; the header says Status: Draft (lead approval pending).
- 2026-10-20 · R1 · Card works only at the employee's current plant, `WRONG_PLANT` restored;
  removed `employee_plant_id`, "Visiting from" badge, `visitors_only` filter, `employee_plant`
  field, the "Abuse of any-plant cards" block, US-10, the M1-spec note, the SRS §8 transfer row
  and the M4 / M5 follow-ups; AC-11 replaced (M1 spec §7 rule 10, SRS §8).
- 2026-10-20 · R2 · Card prints plant name and code again (no end date); added
  `qr_credentials.printed_plant_id`, "Reprint needed" badge and filter, plant transfer rule
  "card works, reprint advised" (SRS FR-14).
- 2026-10-20 · R3 · Printing and downloading card PDFs, bulk print and test cards are Super
  Admin only; removed `PRINT_QR_CARDS` and the Plant Head print scope, US-5, Plant Head print
  audit note; AC-5 rewritten (decision 0005, CLAUDE.md §1).
- 2026-10-20 · R4 · Snapshot view and compare are Super Admin only; the punch list, summary and
  export stay readable for Corporate Head (all) and Plant Head (own plant) as text; US-13,
  §4.10, §5.3, §7 rule 1, AC-23, AC-24, AC-33 updated (M1 matrix, SRS FR-20 / FR-27).
- 2026-10-20 · R5 · Cards only for QR-method employees; `EMPLOYEE_NOT_QR` restored on issue and
  at the kiosk; reminder banner when switched to face; US-11 removed; AC-1 and AC-12 changed;
  storage estimate back to 350 QR workers / about 0.55 GB; F-38 offers QR-method employees only
  (CLAUDE.md §1, SRS FR-07 / FR-11 / FR-13).
- 2026-10-20 · R6 · No "Tap to start" screen; the kiosk starts the camera and scanning by
  itself; optional sound banner and a "Start camera" fallback; AC-7, AC-29, AC-47 and §11
  updated (SRS FR-16).
- 2026-10-20 · R7 · Removed S-25 and F-36 from M2 (no `/system/usage`, no usage card, no
  `online` field or badge, no `last_punch_at` column, four settings removed); AC-38 and AC-43
  removed; both rows "Pending Tushar" (accepted-extras.md: F-14 and F-3 are Later). Kept
  `last_self_test_at`, the sound switch and the storage estimate text.
- 2026-10-20 · C1 · Kiosk heartbeat `GET /kiosk/me` every 60 s (carries notices, settings,
  revocation); `/version.json` every 5 minutes; AC-31 "within 2 minutes"; Render-awake sentence
  corrected (only while a kiosk is open; 31 × 24 = 744 h of 750 free hours, decision 0002).
- 2026-10-20 · C2 · §7 rule 5: step 1 is M1's `require_kiosk` dependency, not a rule file; the
  rule files are `snapshot`, `qr_credential` (incl. punch-method and plant checks) and
  `cooldown`.
- 2026-10-20 · C3 · §5.7: the Excel-import commit response and the approved-import apply result
  get the additive field `created_employee_ids` (needed by F-38).
- 2026-10-20 · C4 · §7 rule 14 and AC-27: in production `STORAGE_BACKEND`, `QR_SIGNING_KEY` and
  `SNAPSHOT_ENCRYPTION_KEY` are required; with `supabase`, also `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY` and `SNAPSHOT_BUCKET`.
- 2026-10-20 · C5 · §7 rule 12: the settings table has 11 rows (2 existing now editable + 9 new).
- 2026-10-20 · A · New §14.2 "Own decisions inside M2" with one justification line each; §2
  item 10 reduced to SRS FR-14, SRS §5.b, SRS §8 "Duplicate punch" row and architecture §3 / §7
  (plus the usual CLAUDE.md / `.env.example` update before the PR).
- 2026-10-20 · A · §4.10: on a `WRONG_PLANT` punch row the Plant Head sees "Card of another
  plant" and no employee code or name (the employee belongs to another plant; M1 §7 rule 1 says
  nothing of other plants is leaked). Super Admin and Corporate Head see the employee.
- 2026-10-20 · D · §4: design gate A approved and linked. Answers: "End today" keeps the rule (card
  works until 23:59:59 IST) with a hint to use Revoke; Ctrl+K Issue / Print use an employee
  picker / the list filtered "Not printed"; the Test cards tab is hidden for Corporate Head and
  Plant Head.
- 2026-10-20 · D · §5.1: the bulk answer gets `card_ids` (additive), so "Print the N new cards" and F-38 can print exactly the cards just issued.
- 2026-10-20 · D · §5.7: the import answer and the approved-import result also carry `created_qr_employee_ids`, so the screen can say how many people get a card and how many (face) are left out.
