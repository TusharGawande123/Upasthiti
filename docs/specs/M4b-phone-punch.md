# M4b – Optional phone punching (employee login, phone face punch, gate code scan): Specification

Status: Approved (lead, 2026-10-31) · Author: spec-writer · Date: 2026-10-31
Lead's answers (Tushar Gawande, in chat, 2026-10-31): the five §14 questions of the draft and every §12
row are answered and written into §2, §4, §5, §6, §7, §8, §10–§13 and §15. Approved extras: F-69, F-70,
F-73, F-74, F-76, F-80, S-46, S-47, S-49. The approved M5 change (§7 rule 22) is already written into
docs/specs/M5-attendance-reports.md §7 rules 17, 19 and 29.
Branch: `milestone/M5-attendance-reports`. **M4b is built in the same branch and the same PR as M5, after
the M5 slices** (lead's choice, 2026-10-31). Decision 0034 item 1 ("M5 is built before M4b") is amended:
M4b is built together with M5 in one PR (§15).
Decisions: the lead's M4b decisions of 2026-10-31 (Tushar Gawande, in chat) are written as rules in §7
and are not re-opened here. They will be recorded as **decision 0035** (`docs/decisions/0035-m4b-phone-punch.md`,
written on the branch when this spec is approved). Decision 0030 stays reserved for the M4 real-device
results.
Related: docs/SRS.md (FR-43, FR-44, FR-45, FR-17, FR-18, FR-25, FR-26, FR-40; NFR-01, NFR-03, NFR-04,
NFR-06, NFR-09), docs/architecture.md §5b, docs/specs/M3-face-attendance.md §5, §7 rules 2, 5, 7, 14,
docs/specs/M4-anti-proxy-offline.md §7 rules 2, 4–7, 14, 18, docs/specs/M5-attendance-reports.md §7 rules
2, 7, 17, 24 (Approved), decisions 0004, 0005, 0016, 0017, 0022, 0023, 0025, 0029, 0034,
docs/decisions/accepted-extras.md, CLAUDE.md §1, §5, §10, §11.

> Write in simple, clear English. No application code. The gate attendance device stays the main way to
> punch; phone punching is the **only** other way, switched on per employee by the Super Admin (CLAUDE.md
> §5, decision 0004). **Wording rule (decision 0013):** every text people read says "attendance device",
> never "kiosk"; code, API paths and database names keep "kiosk". The phone pages are called **"Phone
> attendance"**; the changing code on the gate screen is called the **"phone code"**.

## 1. Problem and goal
Some employees cannot always reach the gate attendance device:
1. **Official work outside the plant** (customer site, another city): today they have no way to punch,
   so their day ends up "Absent" or needs a correction.
2. **Temporary workers in a queue at shift change** wait for one gate device; the proposal (Q1 option B)
   lets them scan a code on the gate screen with their own phone instead.

At the same time, the whole project exists to stop proxy attendance from phones (SRS §2.1). So phone
punching must be **opt-in per employee, proven by the server, and visible to the Super Admin**.

M4b delivers:
- a **per-employee switch** "Phone punching" (Super Admin, reason, audited, default OFF) and a second
  switch **"Outside work allowed"** (Super Admin, reason, audited, default OFF);
- **employee login on a phone web page** (`/phone`) with **employee code + password**; the employee makes
  the **first password** themselves after proving who they are (face check against their own template,
  or scanning their own valid ID card), with no admin step; forgotten password = the same proof again;
- **phone face punch** for face employees: server-chosen head turn, anti-spoof, **1:1 match** against the
  logged-in employee's template, location on every punch;
- **phone scan of the changing gate code** for QR employees: the gate screen shows a server-signed code
  that changes every 30 seconds; the worker scans it with their phone, a selfie is saved (like a card
  punch photo), and the phone must be inside the plant's geofence;
- every phone punch goes through the **same server rule engine** (location, cool-down, `OUT_TOO_SOON`,
  `SHIFT_ALREADY_CLOSED`, travel and two-device flags) and `punches/counting.py`; it shows in the punch
  log with channel **"Phone"** and, when flagged, in **"Needs review"**.

**Done means (SRS §11 M4b exit criteria):** on the deployed site, with a demo plant: (a) a face employee
with phone punching ON makes a first password by a face check, punches IN inside the geofence (accepted)
and, with "Outside work allowed", punches OUT 3 km away (accepted, tagged "Outside plant", in "Needs
review"); (b) the same employee with "Outside work allowed" OFF is refused `OUTSIDE_GEOFENCE` 3 km away;
(c) a temporary worker makes a first password by scanning their ID card at the plant, then punches by
scanning the gate's phone code (accepted, selfie saved); (d) an employee with phone punching OFF cannot
log in; (e) the gate device keeps working exactly as before for cards and faces.

## 2. Scope

**In scope:**
1. **Phone access switches** (FR-43; lead decisions 5 and 7): "Phone punching" ON/OFF and "Outside work
   allowed" ON/OFF per employee, Super Admin only, reason required (3–300 characters), audited, both
   default OFF, for permanent **and** temporary employees. Outside work needs phone punching ON.
2. **Employee login** (lead decision 2; changes CLAUDE.md "employees never log in", §15): employee code +
   password on `/phone`; separate employee sessions (own table, own cookie), never mixed with admin
   sessions. Only employees with phone punching ON can log in.
3. **First password and forgotten password by self-proof** (lead decision 3): face proof (face employees)
   or card proof (QR employees), then the employee sets a password. Password rules, argon2id, lockout
   and rate limits per code and per IP (§7 rules 5–8).
4. **Any phone** (lead decision 4): no binding to one phone. Protection = login + face on every face
   punch + location + session limits + a sessions list for the Super Admin (§8.3 states the proxy risk
   honestly).
5. **Super Admin tools:** the "Phone attendance" card on the employee page (switches, account state,
   active phones, "Sign out all phones", "Require a new password"); employees list filter; settings card.
6. **Phone face punch** (lead decision 6; FR-44): face + liveness + anti-spoof + 1:1 match, location rule
   for phones (§7 rule 12), then the same IN/OUT, M5 and flag rules.
7. **Phone scan of the gate's phone code** (lead decision 6; FR-45): changing server-signed code on the
   gate screen (§7 rule 15), selfie saved as an encrypted snapshot, phone inside the plant fence (no
   outside option).
8. **Outside the plant** (lead decision 7): with "Outside work allowed" a face punch outside the own
   plant's fence is accepted, its GPS position saved, flagged `OUTSIDE_PLANT` ("Outside plant" tag) and
   listed in "Needs review"; without it, the punch is rejected `OUTSIDE_GEOFENCE` exactly like the gate.
   **Inside another Sheet Shapers plant's fence** with outside work ON: accepted **without a flag**; the
   matched plant is stored on the punch (lead, 2026-10-31; §7 rule 12).
9. **Punch log, "Needs review", punch export, M5 screens:** every phone punch in the punch log (channel
   "Phone" filter); "Needs review" lists only flagged phone punches and refused punches that name an
   employee (lead, §14 answer 1); "Outside plant" tag; outside-plant INs are **not** inside any plant in
   the dashboard, muster, gate "Inside now" line and still-inside alert, and a person inside another
   plant's fence counts as inside **that** plant for safety while the register stays with their own plant
   (§7 rule 22; M5 §7 rules 17, 19, 29 amended, lead approved).
10. **No offline phone punching** (lead decision 9, §7 rule 21).
11. **Privacy** (lead decision 10): a "Phone punching notice" that the employee accepts on the phone
    before the first punch (versioned, hashed, stored); self-service "Stop phone punching"; no phone
    number, no device fingerprint (§8.1).
12. **Gate screen changes:** the phone code panel, and a clear message when a phone code is shown to the
    gate camera instead of an ID card (§4.2, §4.3).
13. **New reason, flag and error codes** with English texts as translation keys (§7 rule 24).
14. **Settings** (§7 rule 23), all used from milestone 5 (`CURRENT_MILESTONE` = 5, set by M5; same PR).
15. **Audit** (FR-40) of every switch, password, sign-out, notice and login event (§8.4).
15b. **Approved extras (lead, 2026-10-31; §12; ACs AC-49 to AC-59):**
    - **F-69** "Outside work until" date (§7 rule 3);
    - **F-70** many-phones alert in the M5 bell (§7 rule 27);
    - **F-73** "My attendance" on the phone (§4.8b, §5.1);
    - **F-74** add-to-home-screen manifest for `/phone`, no service worker (§7 rule 26);
    - **F-76** bulk confirm of clean outside punches in "Needs review" (§7 rule 28);
    - **F-80** passkey (WebAuthn) as an optional second way to sign in (§7 rule 29, §13);
    - tooling **S-46** Playwright mobile project with a fake camera, **S-47** strict CSP +
      Permissions-Policy for `/phone`, **S-49** argon2 memory guard test (§11).
16. **Tests** of §11 inside the M5 coverage floor (84%, M5 spec §2 item 17; no extra raise).
17. **Changes to other documents** (§15), made on the branch when this spec is approved.

**Out of scope (not in M4b):**
- **Offline phone punches** (no queue, no sealed evidence on a personal phone; §7 rule 21).
- **Binding to one registered phone**, device keys on employee phones, pairing codes or QR set-up by the
  Super Admin (lead decision 4; replaces the "registered phone" idea of decision 0004, SRS FR-44 and
  architecture §5b, see §15).
- **Face enrolment on the phone.** Only the Super Admin enrols, after recorded consent (CLAUDE.md §5,
  decisions 0016, 0017). A face employee without an active template cannot use the phone face path.
- **QR employees punching by face, face employees using the gate-code path** (§7 rule 2).
- **Outside work for the gate-code path**: the code is on the gate screen, so that path is always at
  the gate (lead decision 7).
- Employee self-service other than the phone pages of §4 (no leave requests, no corrections, no
  salary view, no profile editing).
- Extras marked **Later** by the lead on 2026-10-31: F-71 photo of outside face punches, F-72 "near the
  attendance device" check, F-75 planned outside site, F-77 selfie compare, F-78 Marathi/Hindi phone pages,
  F-79 notice in Marathi/Hindi, F-81 named "On outside work" muster section, S-45 gate-code load test,
  S-48 password strength meter.
- SMS, OTP, email to employees, phone numbers (CLAUDE.md, client answers: never store a contact number).
- A service worker or offline shell for `/phone` (§7 rule 21; an install-only manifest is extra F-74).
- Native Android / iOS apps. Marathi and Hindi texts (all text i18n-ready; F-78, F-79).
- Any paid service (SMS gateway, device attestation, fraud API).

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | switch phone punching on or off for one employee with a reason | only people who need it can punch by phone, with a trail | FR-43 |
| US-2 | Super Admin | allow outside work for one employee, with a reason | a person on official work elsewhere can punch there | FR-44 |
| US-3 | Face employee with phone punching ON | set my own password by showing my face to my phone | I do not wait for the office to give me a password | FR-44 |
| US-4 | Temporary worker with phone punching ON | set my own password by scanning my ID card with my phone at the plant | I can start without paperwork | FR-45 |
| US-5 | Employee | log in with my employee code and password on any phone | a broken or new phone does not stop me | FR-44 |
| US-6 | Employee | reset a forgotten password with the same face or card check | I am never stuck | FR-44 |
| US-7 | Face employee | punch IN or OUT with my face on my phone, at the plant or (when allowed) outside | my attendance is right on outside work days | FR-44 |
| US-8 | Temporary worker | scan the code on the gate screen with my phone | I do not wait in the gate queue | FR-45 |
| US-9 | Super Admin | see every phone punch in the punch log as "Phone", and the outside ones in "Needs review" with a map | I can check outside punches | FR-44, FR-26 |
| US-10 | Super Admin | see which phones an employee is signed in on, sign them all out, or require a new password | I can stop account sharing quickly | FR-44 |
| US-11 | Plant Head / Corporate Head | see (read only) who has phone punching on and which punches came by phone | I know how my people punch | FR-43 |
| US-12 | Employee | read what the phone collects (location at punch time, face check, selfie) and stop phone punching myself | I keep control of my data (DPDP) | NFR-04 |
| US-13 | Safety officer (indirect) | not see people on outside work counted as "inside the plant" | the emergency muster is right | FR-34 |
| US-14 | Worker at the gate | keep punching with my card or face as before | the phone option changes nothing for me | FR-17, FR-18 |

## 4. Screens and UX (light, modern, premium; English first)
The M1–M5 rules apply: states (empty, loading, error, success), en-IN formats (DD/MM/YYYY, 24-hour `HH:mm`
IST), icon + word + colour (never colour alone), keyboard use, all text from
`public/locales/en/common.json`, every screen fits **360 px and 768 px** without sideways page scrolling.
**Design gates** (images, approved in the plan step as in M2–M5): **Gate P1** phone login, proof and
password screens; **Gate P2** phone home and punch flows; **Gate P3** admin "Phone attendance" card and
the gate phone code panel.

### 4.1 Phone pages: general
- Route **`/phone`** (proposed; `/me` was considered but `/api/v1/kiosk/me` and `/api/v1/auth/me` already
  use "me", so `/phone` is clearer). Own small layout (no admin menu, no sidebar). Lazy-loaded: the admin
  bundle and the gate bundle never contain phone code; the phone page has its own size budget (§7 rule 26).
- Phone first: one column, large touch targets (at least 56 px), text at least 18 px, plain words.
- Top bar: "Phone attendance", the employee's name and code once signed in, a menu with "Sign out", "Stop
  phone punching", "Privacy notice".
- The pages are listed in `e2e/tests/responsive.spec.ts`. They are **not** in the admin phone menu (they
  are not admin pages; CLAUDE.md §5 rule "every page reachable from the phone menu" is about admin pages,
  see §15).

### 4.2 Gate screen: phone code panel (`/attendance`)
- Shown **only** when the setting `kiosk_show_phone_code` is `on` **and** the device's plant has at least
  one active QR employee with phone punching ON **and** the gate is online. Otherwise nothing changes.
- **768 px and wider (tablet, PC):** a card at the side of the idle screen: the QR code (about 220 px),
  the heading "Phone code", the line "Workers with phone attendance: scan this with your phone", and a
  thin bar that shows the time left before the code changes.
- **Narrower than 768 px (phone used as gate):** a button "Phone code" on the idle screen. Tapping it
  shows the code full-width for `kiosk_phone_code_show_seconds` (default 60 s), then the screen goes back
  to idle by itself. This keeps the card-reading camera view large on small gates.
- The panel is hidden while a card or face punch is running and on every result screen, so it never
  disturbs the normal flow. The code is drawn from an SVG made by the server (segno, already used for
  pairing QR codes): no new gate library, the gate budget is unchanged.
- Offline (no fresh code for 15 s): the panel shows "Phone code not available now. Show your ID card."
  No code is ever shown that the server did not sign.

### 4.3 Gate screen: a phone code shown to the gate camera
If a worker holds their phone with a screenshot of the phone code to the gate camera, the card reader
sees a text starting with `UPG1.` and shows the gate-only message `GATE_CODE_AT_DEVICE`: "This code is for
phones. Show your ID card to this attendance device." Nothing is sent to the server.

### 4.4 Phone: sign in (`/phone/login`)
- Fields: "Employee code" (upper-case automatically, the M1 code format) and "Password" (show/hide eye).
  Button "Sign in". Link "First time or forgot your password?" → `/phone/setup`.
- Errors in plain words under the form (texts in §9). A locked account says how many minutes are left and
  offers "Forgot password?" (the proof works while locked).
- After a new sign-in on another phone ends this one: "You signed in on another phone, so this phone was
  signed out."

### 4.5 Phone: prove it is you (`/phone/setup`)
- Two big choices (the employee chooses; the server never says which method a code has):
  - **"Check my face"** (for people who punch with their face): type the employee code → front camera →
    the same guidance as the gate face punch (MediaPipe guide, "Look straight", then the server's head
    turn) → "Checking…".
  - **"Scan my ID card"** (for workers with an ID card): rear camera reads the card → "Checking…". Needs
    location ON and the phone inside the plant fence (the screen says so before the camera opens).
- Failure: one message for every "not you" case (`PROOF_FAILED`): "We could not confirm it is you. Please
  try again, or visit the plant office." Camera problems get retry hints ("Please try again.").
- Success → the password step (§4.6).

### 4.6 Phone: set your password (`/phone/setup/password`)
- Two fields ("New password", "Type it again"), the rules as a checklist that ticks while typing (§7 rule
  6), button "Save and sign in". The proof is valid for 5 minutes; after that "Please check again".
- After saving, the employee is signed in and sees the notice (§4.7) if not yet accepted.

### 4.7 Phone: phone punching notice (`/phone/notice`)
- Shown after the first sign-in and again whenever the notice version changes; punching is blocked until
  "I agree" is tapped. The text (server file `phone-notice-v1.en.txt`, versioned like the face consent)
  says in plain words: what is collected (location only at the moment of a punch or card check, never in
  the background; the face pictures for the check, not kept unless the punch is refused; a selfie at a
  gate-code punch; the browser name for the list of signed-in phones), why (attendance only), who sees it
  (the Super Admin; exact outside positions only the Super Admin), how long (the punch records as the law
  requires; selfies `snapshot_retention_days`), that phone punching is optional and saying no or stopping
  does not affect job, pay or shift, how to stop ("Stop phone punching" in the menu), and the
  `privacy_contact` and `company_address`.
- Buttons "I agree" and "Not now" ("Not now" signs out).

### 4.8 Phone: home (`/phone`)
- Greeting with first name; plant name; today's last counted punch ("IN at 07:02, attendance device" or
  "OUT at 19:04, phone").
- **Location chip**: "Location ready" / "Turn on location" / "Location not exact enough (80 m). Move to an
  open place." / for gate-code workers "You are not at the plant". The phone reads its location only
  when this page is open and when a punch starts; it never tracks in the background.
- **One main button by punch method:** face employees "Punch with face"; QR employees "Scan the phone
  code at the gate".
- Face employees with "Outside work allowed": a badge "Outside work allowed" and, when set (F-69),
  "until DD/MM/YYYY".
- Not ready state: no face template or consent → "Your face is not set up. Please visit the plant
  office." (no button). A QR worker needs **no** valid ID card to punch by phone (lead, §14 answer 4).
- Link **"My attendance"** (F-73, §4.8b) and, on supported phones, **"Sign in faster with a passkey"**
  (F-80, §4.8c).

### 4.8b Phone: My attendance (`/phone/attendance`, F-73)
- The last **31 days**, newest first: date, day status as M5 shows it (Present, Half-day, Short hours,
  Absent, Incomplete, Leave, Weekly off, Holiday), first IN and last OUT (IST), worked time, and a small
  "Phone" or "Attendance device" word per punch. Today shows "Open" until the day closes.
- No flags, no reasons, no review marks, no other person. A short line: "Something wrong? Please visit
  the plant office." (corrections stay M5 regularisations, done by admins).
- Empty state: "No attendance yet in the last 31 days."

### 4.8c Phone: passkey (F-80)
- Shown only when the browser supports WebAuthn platform authenticators. "Add a passkey on this phone"
  asks the phone's own screen lock (fingerprint, face unlock or PIN of the phone) and saves a passkey.
- Sign-in page: button "Sign in with passkey" next to the password form (the code is typed first).
- The menu lists the employee's passkeys ("Chrome on Android, added 02/11/2026") with "Remove".
- The password always keeps working; a passkey is only a faster second way.

### 4.9 Phone: face punch
Same steps and texts as the gate face punch (M3 §4.2–§4.4): guidance, the server's head turn, "Checking…".
Before the camera opens, the phone takes a fresh location reading (§7 rule 12). Results (§4.11).

### 4.10 Phone: gate code scan
1. Location check (must be inside the plant fence) → 2. rear camera reads the gate's phone code (only
   texts starting with `UPG1.` are taken; anything else shows "This is not the phone code of the
   attendance device.") → 3. front camera: "Look at the camera" with `kiosk_photo_ready_seconds` (default
   20 s) and "I'm ready" (same as the gate card photo, M2/decision 0013); "Cancel" sends nothing → 4.
   "Checking…" → result.

### 4.11 Phone: results
- **Accepted** (also when flagged, M4 rule): big "IN" or "OUT", the time, the plant. For an `OUTSIDE_PLANT`
  flag the line "Saved as an outside-plant punch. The office will check it." (the employee chose outside
  work, so this is honest; other flags are never shown, as at the gate).
- **Refused:** title, message ending "Please visit the plant office." for refusals, "Please try again."
  for camera and location retry hints (decision 0022), and a "Back" button. No voice, no sound.
- **No internet:** "No internet. Your punch was NOT saved. Try again when you have internet, or punch at
  the attendance device." (§7 rule 21).

### 4.12 Admin: employee page, card "Phone attendance"
- Super Admin: switch "Phone punching" (dialog with reason), switch "Outside work allowed" (enabled only
  when phone punching is ON; dialog with reason and an optional "until" date, F-69), account state ("No
  password yet" / "Password set on DD/MM/YYYY by face check" / "Locked until HH:mm" / "New password
  required"), notice ("Accepted v1 on DD/MM/YYYY"), list of signed-in phones (browser and system in short
  words, signed in at, last used; IP for the Super Admin only), list of passkeys (F-80: label, added,
  last used), buttons **"Sign out all phones"** and **"Require a new password"** (both with a reason;
  the second also removes the passkeys).
- Corporate Head (all plants) and Plant Head (own plant): the same card read-only, without IPs.
- Empty state: "Phone punching is off. The employee punches only at the attendance device."

### 4.13 Admin: lists, punch log, "Needs review", settings
- Employees list: filter "Phone punching: on / off", small phone icon + word "Phone" in the row.
- Punch log (M2 page): column/filter **Channel** ("Attendance device" / "Phone"), method "Face" / "Card"
  / "Phone code", tag "Outside plant". Punch detail: for phone punches the signed-in phone (browser),
  location accuracy, distance to the fence; the **map position of an outside punch for the Super Admin
  only**. Excel export (F-35) gains "Channel" and "Outside plant" columns.
- Punch detail and log of a phone punch made inside another plant's fence: "At plant X-280 (own plant
  K134)".
- "Needs review" (M4 page): filter "Phone"; `OUTSIDE_PLANT` rows show the plant fence and the position on
  the M4 review map, the distance to the fence and the employee's outside-work reason. Listed: only
  flagged phone punches and refused ones that name an employee (§7 rule 19). **Bulk confirm (F-76):**
  with the "Phone" filter, a checkbox column appears on clean outside punches (§7 rule 28) and a button
  "Confirm selected (n)" with one optional note.
- Settings: new card **"Phone attendance"** with the keys of §7 rule 23.
- Dashboard (M5): a small line **"On outside work: N"** next to "Inside now" (§7 rule 22). The muster has
  no outside-work list (F-81, Later).
- Bell (M5 F-7): new notice kind "Signed in on many phones" (F-70, §7 rule 27).

## 5. API contract
Conventions as M1–M5: REST under `/api/v1`, JSON, errors `{ "error": { "code", "message", "details" } }`,
pagination `?page=&page_size=`. Every error `code` is the translation key: `errors.<CODE>` (admin and
phone pages), `phone.punch.<CODE>.title|message|next` (phone punch results), `kiosk.punch.<CODE>.*` (gate),
`punchReasons.<CODE>` (punch log). **Employee identity** = cookie `ups_phone` (HttpOnly, Secure,
SameSite=Strict, **Path=/api/v1/phone**, so admin endpoints never receive it and the admin cookie
`ups_session` never authorises a phone endpoint). Writes check the Origin header (M1). Decided punches
answer **200** also when rejected (M2 rule); request-level errors write no punch row.

### 5.1 Phone: sign in and session
| Method | Path | Identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/phone/login | public | `{ employee_code (1–12), password (1–128) }` | `200 { employee: { code, name, plant: { code, name }, punch_method }, notice_required: bool }` + cookie | `PHONE_CREDENTIALS_INVALID` (401), `PHONE_ACCOUNT_LOCKED` (423, `details.minutes_left`), `PHONE_PUNCH_OFF` (403, only after a correct password), `PHONE_NEW_PASSWORD_REQUIRED` (409, only after a correct password), `TOO_MANY_REQUESTS` (429), `ORIGIN_NOT_ALLOWED`, `VALIDATION_FAILED` |
| POST | /api/v1/phone/logout | employee | – | `204` (cookie removed) | – |
| GET | /api/v1/phone/me | employee | – | `200 { employee: { code, name, first_name, plant: { id, code, name }, punch_method }, access: { outside_work_allowed, outside_work_until }, notice: { required, version }, ready: { face: bool }, passkeys: [ { id, label, created_at, last_used_at } ], today: { last_punch: { direction, time, channel } \| null }, settings: { gps_accuracy_limit_m, location_max_age_seconds, challenge_seconds, photo_ready_seconds, capture: { … as M3 } }, geofence: { version_id, shape, geojson, radius_m, buffer_m } }` | `PHONE_NOT_SIGNED_IN` (401), `PHONE_PUNCH_OFF` (403; the session is ended) |
| GET | /api/v1/phone/notice | employee | – | `200 { version, language, text, text_sha256 }` | `PRIVACY_CONTACT_MISSING`, `COMPANY_ADDRESS_MISSING` |
| POST | /api/v1/phone/notice/accept | employee | `{ version, text_sha256 }` | `201 { accepted_at }` | `NOTICE_TEXT_CHANGED` (409: the hash does not match the current text) |
| POST | /api/v1/phone/stop | employee | `{ confirm: true }` | `204` (phone punching OFF, all sessions ended) | – |
| GET | /api/v1/phone/punches/today | employee | – | `200 { items: [ { time, direction, channel, decision_text_key } ] }` (own counted punches of today's attendance day; no flags, no reasons) | `PHONE_NOT_SIGNED_IN` |
| GET | /api/v1/phone/attendance | employee | – (always the last 31 days ending today, IST) | `200 { days: [ { date, status, first_in, last_out, worked_min, channels: ["phone"\|"kiosk"] } ] }` (F-73; from M5 `attendance_days`, stale days recomputed first; no flags, reasons or review marks) | `PHONE_NOT_SIGNED_IN` |

### 5.1b Phone: passkeys (F-80)
| Method | Path | Identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/phone/passkeys/register/options | employee (signed in by password or proof **within the last 10 minutes**) | – | `200 { options }` (WebAuthn creation options: RP id = the site host, user id = a random handle per employee (never the code), `userVerification: "required"`, `residentKey: "preferred"`, `attestation: "none"`, exclude the employee's existing credentials) | `PHONE_RECENT_SIGN_IN_REQUIRED` (403), `PASSKEY_LIMIT_REACHED` (409, at most 3), `PASSKEYS_NOT_CONFIGURED` (503: `APP_PUBLIC_ORIGIN` unset outside development) |
| POST | /api/v1/phone/passkeys/register | employee | `{ credential (WebAuthn JSON) }` | `201 { id, label }` | `PASSKEY_INVALID` (422), `PHONE_RECENT_SIGN_IN_REQUIRED` |
| DELETE | /api/v1/phone/passkeys/{id} | employee (own) | – | `204` (marked removed, never deleted) | `NOT_FOUND` |
| POST | /api/v1/phone/passkeys/login/options | public | `{ employee_code }` | `200 { options }` for **any** well-formed code (an unknown code gets options with no credentials, same shape) | `TOO_MANY_REQUESTS` |
| POST | /api/v1/phone/passkeys/login | public | `{ employee_code, credential }` | as `/phone/login` (+ cookie) | `PASSKEY_INVALID` (401, one answer for every failure), `PHONE_PUNCH_OFF`, `PHONE_NEW_PASSWORD_REQUIRED`, `TOO_MANY_REQUESTS` |

### 5.2 Phone: proof and password (no sign-in needed)
| Method | Path | Identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/phone/proof/face/challenge | public | `{ employee_code }` | `200 { proof_id, challenge_nonce, challenge, expires_at, server_time, capture }` for **any** well-formed code (no hint whether the code exists) | `TOO_MANY_REQUESTS`, `FACE_SERVICE_UNAVAILABLE`, `VALIDATION_FAILED` |
| POST | /api/v1/phone/proof/face | public | `{ proof_id, challenge_nonce, frames: [ { role, jpeg } ] (as M3) }` | `200 { proof_token (base64url, 43 chars), expires_at, employee: { code, first_name } }` | `PROOF_FAILED` (401, one answer for every "not this person / not allowed" case), retry hints `NO_FACE`, `MULTIPLE_FACES`, `FACE_TOO_SMALL`, `FACE_QUALITY_LOW`, `LIVENESS_FAILED`, `CHALLENGE_EXPIRED`, `CHALLENGE_INVALID`, `FRAMES_INVALID` (422, `details.retry_allowed`), `FACE_SERVICE_BUSY`, `TOO_MANY_REQUESTS`, `PAYLOAD_TOO_LARGE` |
| POST | /api/v1/phone/proof/card | public | `{ qr_payload, location: { lat, lon, accuracy_m, age_s } }` | `200 { proof_token, expires_at, employee: { code, first_name } }` | `PROOF_FAILED` (401), `LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE` (422; only after the card was found valid), `TOO_MANY_REQUESTS` |
| POST | /api/v1/phone/password | public | `{ proof_token, new_password }` | `200 { employee: {…as login}, notice_required }` + cookie | `PROOF_TOKEN_INVALID` (401: unknown, used or expired), `PASSWORD_TOO_WEAK` (422, `details.rule`), `PHONE_PUNCH_OFF` (403) |

### 5.3 Phone: punches
| Method | Path | Identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/phone/punch/challenge | employee | – | `200 { challenge_nonce, challenge, expires_at, server_time, capture }` | `PHONE_NOT_SIGNED_IN`, `PHONE_NOTICE_REQUIRED` (428), `EMPLOYEE_NOT_FACE` (403), `PHONE_FACE_NOT_READY` (409), `FACE_SERVICE_UNAVAILABLE`, `TOO_MANY_REQUESTS` |
| POST | /api/v1/phone/punch/face | employee | `{ client_punch_id (uuid), challenge_nonce, frames (2–4, as M3), location: { lat, lon, accuracy_m, age_s }, app_version? }` | `200 { punch_id, decision: "accepted"\|"rejected", reason_code, direction, punch_time, outside_plant: bool, details: { retry_allowed? } }` (a flagged punch answers "accepted"; `outside_plant` is true only for `OUTSIDE_PLANT`) | request-level: `PHONE_NOT_SIGNED_IN`, `PHONE_NOTICE_REQUIRED`, `EMPLOYEE_NOT_FACE`, `PHONE_FACE_NOT_READY`, `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE` (> 384 KB), `TOO_MANY_REQUESTS`, `FACE_SERVICE_UNAVAILABLE`, `FACE_SERVICE_BUSY` |
| POST | /api/v1/phone/punch/gate-code | employee | `{ client_punch_id, gate_code, photo_jpeg (base64, as M2 snapshot limits), location, app_version? }` | same as face | request-level: `PHONE_NOT_SIGNED_IN`, `PHONE_NOTICE_REQUIRED`, `EMPLOYEE_NOT_QR` (403), `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE` (> 64 KB), `TOO_MANY_REQUESTS` |

Decision codes in `reason_code` (stored on the row): see §7 rule 24.
Idempotency: a retry with the same `client_punch_id` from the same session returns the stored answer.

### 5.4 Gate (kiosk, signed as M1–M4)
| Method | Path | Identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/kiosk/gate-code | kiosk (signed) | – | `200 { code_text \| null, svg \| null, issued_at, expires_at, refresh_in_seconds }` (`null` when the panel must not show: setting off or no eligible worker at the plant) | `DEVICE_SIGNATURE_INVALID`, `NONCE_REUSED`, `DEVICE_REVOKED`, `TOO_MANY_REQUESTS` (more than 6 a minute per device) |
| GET / POST | /api/v1/kiosk/me · /kiosk/heartbeat | kiosk | as M4 | **additive:** `kiosk_settings.phone_code: { enabled: bool, refresh_seconds, show_seconds }` | as M4 |

### 5.5 Admin
| Method | Path | Role | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/employees/{id}/phone | Super Admin, Corporate Head (all), Plant Head (own plant) — read | – | `200 { phone_punch_enabled, phone_changed_at, phone_changed_by, outside_work_allowed, outside_work_until, outside_changed_at, outside_changed_by, account: { state: "no_password"\|"active"\|"locked"\|"new_password_required", password_set_at, proof_kind: "face"\|"card"\|null, locked_until }, notice: { version, accepted_at } \| null, sessions: [ { id, started_at, last_seen_at, expires_at, browser, system, ip (Super Admin only) } ] }` | `EMPLOYEE_NOT_FOUND` |
| PUT | /api/v1/employees/{id}/phone/access | Super Admin | `{ phone_punch_enabled: bool, reason (3–300) }` | `200` (as GET) | `EMPLOYEE_LEFT`, `FORBIDDEN`, `VALIDATION_FAILED`, `PHONE_ACCESS_UNCHANGED` (409) |
| PUT | /api/v1/employees/{id}/phone/outside-work | Super Admin | `{ allowed: bool, reason (3–300), until? (date, optional, F-69; today or later) }` | `200` | `PHONE_PUNCH_OFF` (409: switch phone punching on first), `EMPLOYEE_NOT_FACE` (409: outside work is only for the face path), `OUTSIDE_UNTIL_INVALID` (422: date in the past), `FORBIDDEN`, `VALIDATION_FAILED` |
| POST | /api/v1/employees/{id}/phone/sign-out-all | Super Admin | `{ reason (3–300) }` | `200 { ended: n }` | `FORBIDDEN` |
| POST | /api/v1/employees/{id}/phone/require-new-password | Super Admin | `{ reason (3–300) }` | `200` (password removed, sessions ended; the employee must prove again) | `FORBIDDEN` |
| GET | /api/v1/employees | as M1 | **additive filter** `phone=on\|off` | items gain `phone_punch_enabled` | as M1 |
| GET | /api/v1/punches · /punches/{id} · /punches/export.xlsx | as M2 | **additive filters** `channel=kiosk\|phone`, `outside_plant=true` | items gain `channel`, `outside_plant`, `phone_browser`; detail lat/lon of a phone punch **Super Admin only** | as M2 |
| GET | /api/v1/reviews | Super Admin | **additive filter** `channel=phone` | items gain `channel`, `outside_plant`, `outside_reason`, `bulk_confirmable` (F-76) | as M4 |
| POST | /api/v1/reviews/bulk-confirm | Super Admin | `{ items: [ { punch_id, expected_latest_review_id \| null } ] (1–100), note? (≤ 300) }` (F-76) | `200 { results: [ { punch_id, ok: bool, error_code? } ] }` (each item in its own small transaction; one failure never undoes the others) | per item: `REVIEW_CHANGED`, `REVIEW_NOT_ALLOWED`, `NOT_BULK_CONFIRMABLE`; request: `FORBIDDEN`, `VALIDATION_FAILED` |
| POST | /api/v1/employees/{id}/phone/passkeys/{passkey_id}/remove | Super Admin | `{ reason (3–300) }` | `204` (F-80; marked removed) | `NOT_FOUND`, `FORBIDDEN` |
| GET/PUT | /api/v1/settings | as M1 | the keys of §7 rule 23 | as M1 | `SETTING_INVALID` |

Common admin errors as M1 (`NOT_AUTHENTICATED`, `FORBIDDEN`, `ORIGIN_NOT_ALLOWED`, `VALIDATION_FAILED`,
`NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`).

## 6. Data model changes
Conventions as M1–M5. M5 ends with migration `0024_shift_swaps` (M5 spec §6), so M4b starts at **0025**
(if M5 adds migrations while it is built, M4b's numbers move up; the plan keeps them in order). **Every new
table gets, in the migration that creates it, `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY deny_all ON <name> FOR ALL USING (false) WITH CHECK (false)`**, no grants to anon; every new
trigger function has `SET search_path = ''`; `tests/test_row_level_security.py` covers every new table.
No phone number, email or device identifier column is added anywhere.

**Migration `0025_phone_access_and_accounts`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `phone_access` | employee_id (FK, unique), phone_punch_enabled (bool, default false), phone_changed_at (timestamptz), phone_changed_by (FK users null: null = the employee stopped it themselves or the "mark as left" step), outside_work_allowed (bool, default false), outside_work_until (date null: last IST day outside punches are allowed, F-69; null = no end), outside_changed_at (timestamptz null), outside_changed_by (FK users null), updated_at | check `NOT outside_work_allowed OR phone_punch_enabled`; index `(phone_punch_enabled) WHERE phone_punch_enabled`; RLS + `deny_all`. A row is made the first time a switch is used; no row = both OFF. History lives in the audit log (reasons there) |
| `phone_accounts` | employee_id (FK, unique), password_hash (text null: null = no password / new password required), password_set_at (timestamptz null), proof_kind (`face`/`card` null), failed_login_count (smallint, default 0), locked_until (timestamptz null), new_password_required_at (timestamptz null), created_at, updated_at | check `proof_kind IS NULL OR proof_kind IN ('face','card')`; check `(password_hash IS NULL) = (password_set_at IS NULL)`; RLS + `deny_all`. Never deleted; "mark as left" sets password_hash to null |
| `phone_sessions` | employee_id (FK), token_hash (char(64), unique), created_at, last_seen_at, expires_at, ip (inet null), browser (text ≤ 40), system (text ≤ 40), user_agent (text ≤ 300), revoked_at (timestamptz null), revoke_kind (`logout`/`new_login`/`admin`/`new_password`/`phone_off`/`self_stop`/`left` null) | index `(employee_id, revoked_at)`; check revoke columns together; RLS + `deny_all`. Ended rows older than 90 days are deleted by the cleanup job (sign-in data, not attendance or audit) |
| `phone_notice_acceptances` | employee_id (FK), version (text), language (text), text_sha256 (char(64)), accepted_at, session_id (FK phone_sessions) | unique `(employee_id, version)`; append-only trigger; RLS + `deny_all` |
| `phone_passkeys` (F-80) | employee_id (FK), credential_id (bytea, unique), public_key (bytea, COSE), sign_count (bigint), user_handle (bytea 32, random per employee, same for all of the employee's passkeys), transports (text[]), label (text ≤ 60: "Chrome on Android"), created_at, last_used_at (null), removed_at (null), removed_by (FK users null: null = the employee or the system), remove_kind (`self`/`admin`/`new_password`/`left`/`phone_off` null) | index `(employee_id) WHERE removed_at IS NULL`; check remove columns together; RLS + `deny_all`. Never deleted (a removed passkey stays as a trail); holds no biometric data (the fingerprint or face unlock never leaves the phone) |
| `phone_proofs` | kind (`face`/`card`/`passkey_register`/`passkey_login`), claimed_code (text ≤ 12 null: the typed code, face only), employee_id (FK null: set only when the proof passed), challenge (as M3 values, face only), nonce_sha256 (char(64) null), issued_at, expires_at, used_at (null), result (`passed`/`failed` null), ip (inet null), token_sha256 (char(64) null, unique), token_expires_at (null), token_used_at (null), webauthn_challenge_sha256 (char(64) null: passkey kinds) | index `(expires_at)`; RLS + `deny_all`. **Rows deleted** after 1 day by the cleanup job (no face data; the audit log keeps the outcome) |
| `notifications` (M5, change) | the `kind` check gains **`phone_many_phones`** (F-70) | – |

**Migration `0026_phone_punches`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `punches` (change) | + `channel` (text, not null, default `kiosk`; `kiosk`/`phone`); + `phone_session_id` (FK phone_sessions null); + **`location_plant_id`** (FK plants null: the plant whose fence the punch position matched — the own plant, or for a phone punch with outside work another plant; null for an `OUTSIDE_PLANT` punch and for old rows; gate rows get the gate device's plant); `geofence_id` / `geofence_distance_m` (M4) hold the **matched** fence version and the distance to it; **`kiosk_id` becomes nullable** (null for a phone face punch; for a gate-code punch it is the gate device whose code was scanned); method gains **`gate_code`**; `match_mode` gains **`one_to_one`** (phone face) | checks: `channel IN ('kiosk','phone')`; `channel = 'kiosk' OR phone_session_id IS NOT NULL`; `channel = 'phone' OR (kiosk_id IS NOT NULL AND phone_session_id IS NULL)`; `method <> 'gate_code' OR (channel = 'phone' AND kiosk_id IS NOT NULL)`; `match_mode <> 'one_to_one' OR channel = 'phone'`; `NOT ('OUTSIDE_PLANT' = ANY(reason_codes)) OR location_plant_id IS NULL`; index `(location_plant_id, punch_time DESC)`; update `method_known`, `match_mode_known`; partial unique `(phone_session_id, client_punch_id) WHERE phone_session_id IS NOT NULL`; index `(channel, punch_time DESC) WHERE channel = 'phone'`. The existing unique `(kiosk_id, client_punch_id)` stays (NULLs never clash). Append-only trigger stays |
| `punch_challenges` (change) | **`kiosk_id` becomes nullable**; + `phone_session_id` (FK null) | check exactly one of `kiosk_id`, `phone_session_id` is set |
| `punch_snapshots` (change) | `reason` gains `phone_gate_code` (selfie of a gate-code punch) and `phone_face_rejected` | update `reason_known` |
| `punch_reviews` (no change) | F-76 bulk confirm writes ordinary `confirmed` rows, one per punch | – |
| `kiosk_devices` (no change) | the gate-code HMAC key is derived from `APP_SECRET_KEY`; nothing is stored per code | – |

Existing rows: `channel` = `kiosk` by default; `location_plant_id` stays null for old rows (readers use
`COALESCE(location_plant_id, plant_id)`; new gate rows store the gate's plant); no data step on the
append-only table. The `punches` column `ip` is filled for phone
punches as for gate punches (logs only, never proof).

**Size estimate (Supabase Free 500 MB):** 650 people at most; realistically 20–80 with phone punching.
Accounts, sessions and notices are under 1 MB. Phone punches are ordinary punch rows (about 200 bytes);
gate-code selfies are 320 px photos like card photos (about 15 KB each, `snapshot_retention_days`), so
replacing card scans with phone scans does not add storage. `phone_proofs` is emptied daily.

## 7. Business rules

1. **Role permission matrix (M4b rows; extends M1 §7 rule 1 and M2–M5).**

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK | Employee (phone) |
   |---|---|---|---|---|---|
   | Phone punching switch, outside-work switch | ✔ | – | – | – | stop only (own) |
   | "Sign out all phones", "Require a new password" | ✔ | – | – | – | – |
   | See phone access, account state, signed-in phones (no IP) | all (with IP) | all (read) | own plant (read) | – | – |
   | Punch log channel, "Outside plant" tag | all | all | own plant | – | – |
   | Exact position of an outside-plant punch | ✔ | – | – | – | own result only |
   | "Needs review" of phone punches | ✔ | – | – | – | – |
   | Phone settings | edit | read | read | – | – |
   | Show the phone code | – | – | – | own plant | – |
   | Sign in, prove identity, set password, accept notice, punch, see today's own punches and own last 31 days (F-73), add / remove own passkeys (F-80) | – | – | – | – | own account only |
   | Bulk confirm of clean outside punches (F-76) | ✔ | – | – | – | – |
   | Remove an employee's passkey (F-80) | ✔ | – | – | – | – |
   | "Signed in on many phones" notice (F-70) | ✔ | – | – | – | – |

   New capabilities in `permissions.py`: `MANAGE_PHONE_ACCESS` (Super Admin), `VIEW_PHONE_ACCESS` (all three
   roles in scope). Employee endpoints use a new dependency `require_phone_employee` that reads only the
   `ups_phone` cookie; admin dependencies never accept it and vice versa. A Corporate Head cannot request
   phone access through the approvals inbox (lead decision 5: Super Admin only).

2. **Which path an employee uses** (lead decision 6; spirit of `EMPLOYEE_NOT_QR`). The path follows the
   employee's **punch method** (M1 `punch_method`), not the employee type:
   - `face` employees use **phone face punch** only; the gate-code endpoint answers `EMPLOYEE_NOT_QR`.
   - `qr` employees use **gate-code scan** only; the face endpoints answer `EMPLOYEE_NOT_FACE`.
   - A method change (M1 edit, approved change request, consent withdrawal) changes the path at the next
     request; password and sessions stay.
   - Outside work is only possible on the face path (the gate-code path is always at the gate), so the
     outside-work switch is refused for `qr` employees (`EMPLOYEE_NOT_FACE`).

3. **Phone access switches** (FR-43; lead decisions 5, 7).
   - Default OFF for everyone. Only the Super Admin changes them, always with a reason (3–300). Audit
     `phone_access.enable` / `.disable` / `.outside_on` / `.outside_off` with before, after and reason.
   - Turning **phone punching OFF** in one transaction: outside work OFF too, every active phone session
     ended (`revoke_kind = phone_off`). The password is kept, so switching ON again later works without a
     new proof.
   - Turning **outside work ON** needs phone punching ON (`PHONE_PUNCH_OFF`) and a face employee.
   - **"Until" date (F-69, approved):** optional, today or later (`OUTSIDE_UNTIL_INVALID`). Outside
     punches are allowed while the IST date of the punch time ≤ `outside_work_until` (the whole last day
     counts). After that date the switch is still stored as ON but the rule treats it as OFF; the admin
     card shows "Outside work ended on DD/MM/YYYY" and the phone badge disappears. The daily job (M1) turns
     an ended switch OFF the next morning with audit `phone_access.outside_off` (actor system, reason
     "Until date passed"), so lists stay honest. Changing the date is a new switch change with a reason.
   - **Mark as left** (M1): in the same transaction as the M2 card revoke and the M3 template delete:
     phone punching OFF, outside work OFF, sessions ended (`left`), password removed. Reactivation brings
     nothing back.
   - **Plant transfer** (M1 F-20): switches stay; from the effective date the new plant's fence is used.
   - **Employee stops it themselves** (`POST /phone/stop`, DPDP: withdrawing is as easy as giving): phone
     punching OFF, outside work OFF, sessions ended (`self_stop`), audit `phone_access.self_disabled`
     (actor = the employee). Only the Super Admin can switch it on again.

4. **Employee sign-in** (lead decision 2).
   - `POST /phone/login` with employee code (compared as M1 compares codes) + password.
   - Order: per-IP limit (rule 8) → find the account → unknown code, no password, or code of a left
     employee → the same `PHONE_CREDENTIALS_INVALID` after a dummy argon2 check (same timing as a real
     check) → locked → `PHONE_ACCOUNT_LOCKED` → wrong password → count, lock at the limit → right
     password: then `PHONE_NEW_PASSWORD_REQUIRED` if the Super Admin required one, `PHONE_PUNCH_OFF` if
     phone punching is OFF (no session is made in either case) → success.
   - Success: failure count reset, rehash if argon2 settings got stronger, new session (random 32 bytes,
     only the SHA-256 hash stored; cookie `ups_phone`), audit `phone_auth.login`.
   - **One phone at a time** (setting `phone_max_sessions`, default 1): if the employee already has that
     many active sessions, the oldest is ended (`new_login`) in the same transaction. The old phone shows
     "You signed in on another phone, so this phone was signed out." (§4.4).
   - Session life: ends after `phone_session_idle_days` (7) without use or `phone_session_max_days` (30)
     after sign-in, whichever comes first; at logout; when the Super Admin signs out all phones or requires
     a new password; when phone punching is switched OFF; when the employee leaves.
   - Every request with the cookie re-checks: session valid, employee active, phone punching ON (else the
     session is ended and `PHONE_PUNCH_OFF` / `PHONE_NOT_SIGNED_IN`).
   - `last_seen_at` is written at most once a minute (as admin sessions).

5. **First password and forgotten password: proof without any admin step** (lead decision 3). The same
   steps serve the first password and every reset.
   - **Face proof** (for `face` employees):
     1. `POST /phone/proof/face/challenge { employee_code }` always answers with a challenge (no hint
        whether the code exists). A `phone_proofs` row keeps the typed code, the challenge and the nonce
        hash; life `face_challenge_seconds` (10 s).
     2. `POST /phone/proof/face`: the M3 checks run **for every code** in the M3 order: challenge (used
        once), frames, liveness (server-chosen turn), anti-spoof, consistency. Quality failures answer the
        retry hint (`NO_FACE`, `LIVENESS_FAILED`, …), the same for every code.
     3. Then the code decides: the candidate is the employee with that code who is **active, punch method
        face, phone punching ON, and has an active template of the running model**. 1:1 cosine ≥
        `face_match_threshold` (the stricter gate threshold, not the code-path threshold) → **passed**.
        Anything else (unknown code, QR worker, phone OFF, no template, no match, spoof) → `PROOF_FAILED`.
     4. Every `PROOF_FAILED` answer and every pass take at least **1 second** from the request start, so the
        timing does not tell which case happened.
   - **Card proof** (for `qr` employees): `POST /phone/proof/card { qr_payload, location }`. The M2 card
     checks run (format, signature, revoked, not yet valid, expired, employee active, punch method `qr`)
     plus "phone punching ON". **The card must be valid for this proof** (not revoked, inside its dates,
     not a test card): it is the only proof of identity a QR worker has. Any failure → `PROOF_FAILED` (one
     answer). After the password exists, the card's validity no longer matters for phone punches (lead,
     §14 answer 4; rule 11), only for the next proof (a forgotten password). Then the **location rule** of
     rule 12 with the gate-code variant (inside the own plant's fence; edge allowed): `LOCATION_REQUIRED`,
     `GPS_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE`. So a card proof can only be done at the plant. Test cards
     (F-27) always give `PROOF_FAILED`.
   - **Proof token:** a pass returns a random token (only its hash is stored), valid
     **5 minutes**, usable **once**, bound to that employee.
   - **Set password** (`POST /phone/password`): token valid → password rules (rule 6) → in one
     transaction: hash stored, `password_set_at`, `proof_kind`, failure count and lock cleared,
     `new_password_required_at` cleared, **every other session ended** (`new_password`), a new session
     made, audit `phone_account.password_set` with the proof kind. A reset therefore signs out a phone
     that someone else was using.
   - The proof works while the account is locked (so a locked person is never stuck).
   - No face picture is kept, also not for a failed proof (it is not a punch, so there is no photo
     purpose). What remains of a failed proof: the `phone_proofs` row (deleted after a day) and one audit
     line `phone_proof.failed` with the kind and the typed code, never a picture or a score.

6. **Password rules** (employees; the admin rules of M1 stay unchanged).
   - Length **8 to 128** characters; not only digits; not the employee code (any case); not in the M1
     common-password list (plus the employee code with "123" and "@123"). Spaces allowed. No 6-digit PIN (lead, §14
     answer 2).
   - Stored with **argon2id** (argon2-cffi defaults, as M1), rehashed when the settings get stronger.
   - The password never appears in logs, audit rows or error details (`details.rule` only).

7. **Lockout** (per employee code, stored in the database, survives restarts):
   `phone_login_max_failures` (default 5) wrong passwords in a row → locked for `phone_login_lock_minutes`
   (default 15). Each failure writes `phone_auth.login_failed` (code only). A Super Admin's "Require a new
   password" clears the lock with the password.

8. **Rate limits** (in memory per process, as M1; the per-account lock above is the durable one).
   | What | Limit |
   |---|---|
   | `POST /phone/login` per IP | 20 per 10 minutes (the admin login limiter's value; `E2E_LOGIN_LIMIT` honoured only with `APP_ENV=test`) |
   | Proof challenges + proofs (face and card) per IP | 10 per 10 minutes |
   | Face proofs per typed employee code | 5 per hour |
   | Failed proofs from anyone (global) | 60 per 10 minutes (the client IP can be faked behind Vercel, so a global cap protects the face worker and stops guessing) |
   | Password set per IP | 10 per 10 minutes |
   | Phone punch challenges per session | 10 per minute |
   | Phone punches per session | 10 per minute |
   | `POST /kiosk/gate-code` per gate device | 6 per minute |
   | Passkey sign-in options + sign-ins per IP (F-80) | counted in the 20 per 10 minutes of `/phone/login` |
   | Passkey adds per session (F-80) | 5 per hour |
   Limit reached → `TOO_MANY_REQUESTS` (429), no row written.

9. **Password hashing and memory.** argon2id uses about 64 MB per check. On Render Free (512 MB) at most
   **2** employee password checks run at the same time (a small semaphore shared by login and password
   set; others wait up to 5 s, then `TOO_MANY_REQUESTS`). The CI memory check adds 4 parallel logins
   (AC-44).

10. **Phone face punch pipeline** (FR-44; lead decision 6). Order of the work:
    1. **Request checks** (no row on failure): body size (≤ 384 KB), session (rule 4), notice accepted
       (rule 20, `PHONE_NOTICE_REQUIRED`), punch method face (`EMPLOYEE_NOT_FACE`), an active agreed face
       consent and an active template of the running model (`PHONE_FACE_NOT_READY`), rate limit, frame
       shape (as M3), face engine ready.
    2. **Phone location rule** (rule 12) — before the face worker, as M4 does at the gate: cheap, and it
       stops a punch from the wrong place before any model work.
    3. **Face worker** (M3 single worker, queue limits): `face_challenge` (the challenge must belong to
       **this session**, unused, not expired), `face_frames`, `face_liveness`, `face_antispoof`,
       `face_consistency`, then **`face_match_one_to_one`**: cosine of the frontal embedding against the
       logged-in employee's own template ≥ `face_match_threshold` → matched (`match_mode = one_to_one`);
       else `FACE_NOT_RECOGNISED`. No 1:N search, no code path, no `needs_code`.
    4. **After identity** (employee row locked `FOR UPDATE`, as M2–M5): `check_in_out` (cool-down
       `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`, direction), **`shift_closed`** (M5 `SHIFT_ALREADY_CLOSED`),
       `impossible_travel`, `two_devices`.
    5. **Store** in one transaction: the punch row (`channel = phone`, method `face`, `kiosk_id` null,
       `phone_session_id`, `plant_id` = the employee's plant on the punch date (plant history), location,
       `location_plant_id`, matched fence id and distance (rule 12), scores, challenge, model). `employee_id` is set only when the face matched;
       the rejected rows before or without a match carry `claimed_employee_id` = the signed-in employee
       (as the M3 code path), so the Super Admin may approve them (M4 §7 rule 7).
    6. **Photo:** as M3 rule 14: no image for an accepted or flagged phone face punch; a rejected one keeps
       the first frontal frame as a snapshot (`phone_face_rejected`), except `COOLDOWN_ACTIVE`,
       `OUT_TOO_SOON`, `SHIFT_ALREADY_CLOSED` (no new evidence) and `FRAMES_INVALID`. (F-71, Later, would add a
       photo for outside-plant punches.)
    7. Frames, crops and embeddings are dropped from memory when the request ends.

11. **Gate-code punch pipeline** (FR-45; lead decision 6).
    1. **Request checks:** body ≤ 64 KB, session, notice, punch method `qr` (`EMPLOYEE_NOT_QR`), rate limit.
       The employee is known from the session, so **`employee_id` is set on every decided row** (as after
       a card is read).
    2. **Phone location rule, gate variant** (rule 12): inside the own plant's fence (edge = flag); outside
       → `OUTSIDE_GEOFENCE` even when outside work is allowed.
    3. **`check_snapshot`** (M2): the selfie must be a valid JPEG within the M2 limits (`SNAPSHOT_MISSING`,
       `SNAPSHOT_INVALID`).
    4. **`check_gate_code`** (rule 15): `GATE_CODE_INVALID`, `GATE_CODE_EXPIRED`; the device's plant ≠ the
       employee's plant on the punch date → `WRONG_PLANT`.
    5. **No card check** (lead, §14 answer 4): the sign-in is enough; an expired or revoked ID card does not
       stop a phone punch, and `qr_credential_id` stays null. (The card still matters for the gate and
       for the card proof of rule 5. To stop a worker, the Super Admin switches phone punching OFF or marks
       them as left.)
    6. **After identity:** `check_in_out`, `shift_closed`, `impossible_travel`, `two_devices`.
    7. **Store:** punch row (`channel = phone`, method `gate_code`, `kiosk_id` = the gate device of the code,
       `phone_session_id`, `location_plant_id` = the employee's plant); the selfie as an encrypted snapshot (`phone_gate_code`, AES-256-GCM with the
       punch id bound in, `snapshot_retention_days`), for accepted, flagged and rejected rows as for card
       punches (M2 rule 15 exceptions apply); F-30 face-in-photo check runs as for card photos. The gate
       device's `last_punch_at` is updated.

12. **Location rule for phones** (`rules/phone_location.py`; reuses `kiosks/location_check.py`; M4 §7 rule 4
    applies unless said otherwise).
    - The phone takes a **fresh** reading when the punch starts (`maximumAge` 0, high accuracy) and sends it
      with `age_s`. The server treats `age_s` > `phone_location_max_age_seconds` (default 60) as no
      location.
    - No location → `LOCATION_REQUIRED`; accuracy worse than `gps_accuracy_limit_m` (50) →
      `GPS_ACCURACY_TOO_LOW`; the employee's plant (on the punch date) has no fence → `GEOFENCE_NOT_SET`.
    - Steps, in this order (fences = the versions current now; *b* = each fence's own margin):
      1. Distance *d* to the **employee's own plant fence**. *d* = 0 → pass; 0 < *d* ≤ *b* → **FLAG
         `LOCATION_AT_EDGE`** (as M4). Matched plant = own plant.
      2. *d* > *b* and **not** (face path with outside work allowed and the punch's IST date ≤
         `outside_work_until` when set, F-69) → **REJECT `OUTSIDE_GEOFENCE`**. This covers outside work
         OFF, every gate-code punch and every card proof.
      3. Otherwise (outside work allowed): the current fences of **all other active plants** (7 plants,
         one small query, distances computed in Python as M4) are checked. If the position is inside one of
         them or within its margin, the nearest such plant is the **matched plant**: the punch is
         **accepted without a flag** (lead, §14 answer 5); inside its margin only → `LOCATION_AT_EDGE` as
         usual. Example: employee of K134 with outside work, standing inside plant X-280's fence → accepted,
         `plant_id` = K134, `location_plant_id` = X-280, `geofence_id` = X-280's fence version.
      4. Inside no plant fence → **FLAG `OUTSIDE_PLANT`**, position stored, `location_plant_id` null,
         `geofence_id` and the distance = those of the own plant's fence (so the review shows "3.2 km from
         K134").
    - **What is stored, precisely:** `plant_id` is always the employee's own plant on the punch date (it
      decides the attendance register, M5); `location_plant_id` is where the person stood (it decides
      "inside now" and the muster, rule 22); `geofence_id` and `geofence_distance_m` belong to the matched
      fence (step 1 or 3) or to the own fence (step 4).
    - With outside work OFF, standing inside another plant's fence is `OUTSIDE_GEOFENCE` (step 2 comes
      before step 3). A gate-code scan at another plant's gate stays `WRONG_PLANT` (rule 15).
    - Accuracy is still required for outside punches, so the saved position means something.
    - A faked phone location (mock-location apps) passes this rule; see §8.3.

13. **IN/OUT, M5 rules and counting** (lead decision 8). Phone punches use the **same** `check_in_out`
    (cool-down 2 min, `OUT_TOO_SOON` 30 min, open IN 20 h), the M5 `shift_closed` rule (one IN and one OUT
    per shift; `SHIFT_ALREADY_CLOSED`), and `punches/counting.py` (no change: it does not look at the
    channel). The last counted punch counts across channels: IN at the gate and OUT by phone (or the other
    way) is normal. The punch time is always the server receive time (no client time is used).

14. **Flag rules across channels.** `impossible_travel` and `two_devices` compare with the person's punches
    at **another device**: a different gate device or a phone punch (a phone face punch has no gate device;
    two phone punches count as "another device" only when their sessions differ). Positions: the stored
    lat/lon (phones always have one). Example: phone OUT in Pune at 10:00 (outside work), gate IN at Waluj
    at 10:30 → about 230 km in 30 minutes → `IMPOSSIBLE_TRAVEL` on the gate punch. The `WRONG_PLANT`
    refusal look-up also includes gate-code punches.

15. **The changing gate phone code** (FR-45; lead decision 6).
    - **Who signs:** the **server**, never the device. The gate asks `POST /kiosk/gate-code` (signed device
      request, M1) every `refresh_in_seconds`. Why server-signed: the gate's device key is non-extractable,
      so only that device can ask for its codes; a secret on the device (a TOTP-like seed) could be copied
      by anyone with access to the gate PC and used to make codes at home. Codes need the internet anyway,
      because the phone punch needs the server.
    - **Text:** `UPG1.<device id, 26 base32 letters>.<issued at, 10 digits Unix seconds>.<MAC, 26 base32
      letters>`; all capitals, digits and dots (QR alphanumeric mode, version 4–5). MAC = HMAC-SHA256 over
      `UPG1|device id|issued at` with a key derived from `APP_SECRET_KEY` (HKDF, label `gate-code-v1`,
      the same pattern as the M4 time anchor), cut to 128 bits. No plant, no names in the text.
      **No new environment variable.**
    - **Life:** valid from `issued_at` to `issued_at + phone_gate_code_seconds` (default **30 s**) plus a
      fixed **5 s** grace for the phone's upload, judged on the server's receive time. The gate fetches a
      new code every `phone_gate_code_seconds − 10` seconds (20 s), so a code just scanned still has at
      least 10 s.
    - **Checks (`check_gate_code`)**, in order: shape → `GATE_CODE_INVALID`; MAC (constant-time compare) →
      `GATE_CODE_INVALID`; `issued_at` in the future by more than 5 s or older than life + grace →
      `GATE_CODE_EXPIRED`; the device unknown, revoked or not paired → `GATE_CODE_INVALID`; the device's
      plant ≠ the employee's plant → `WRONG_PLANT`.
    - **Replay:** many workers may scan the same code within its life (a queue at shift change is
      normal), so a code is not single-use. One worker cannot reuse it: the code's life plus grace must be
      shorter than the punch cool-down, so a second punch with the same code is always `COOLDOWN_ACTIVE`.
      Cross-check (both settings): `phone_gate_code_seconds + 5 < punch_cooldown_minutes × 60`, else
      `SETTING_INVALID` (defaults: 35 s < 120 s). Retries of the same `client_punch_id` return the stored answer.
    - **Bound to:** device (in the text) + plant (from the device, checked against the employee) + time
      window (issued at + life). The phone must also be inside the plant fence (rule 12), so a photo of the
      code sent to someone at home fails unless that person also fakes their location (§8.3).
    - **When the panel shows:** rule 4.2 conditions; the answer is `null` when the setting is off or the
      plant has no active QR employee with phone punching ON (checked with one small count query, cached
      for 60 s).
    - **Gate device states:** offline, "needs its location", switched off → no code (no new code can be
      fetched; an old one is removed after `phone_gate_code_seconds`).

16. **Gate card reader and phone codes.** The gate's card reader ignores texts that start with `UPG1.` and
    shows `GATE_CODE_AT_DEVICE` (§4.3); it sends nothing. A card text (`UPS1.`) scanned by the phone in the
    gate-code step gets "This is not the phone code of the attendance device." (phone-only text).

17. **Punch row identity for phone punches.**
    | | channel | method | kiosk_id | employee_id | claimed_employee_id |
    |---|---|---|---|---|---|
    | Phone face, matched | phone | face | null | signed-in employee | null |
    | Phone face, refused before or without a match | phone | face | null | null | signed-in employee |
    | Gate code (any decision) | phone | gate_code | scanned gate device | signed-in employee | null |
    `plant_id` = the employee's plant on the punch date for phone face punches; the gate device's plant for
    gate-code punches (which must be equal, else `WRONG_PLANT`).

18. **"Outside plant" tag.** The tag is the flag code `OUTSIDE_PLANT` stored in `reason_codes` of a
    `flagged` row. It stays on the row for ever (rows never change), so the tag still shows after a review.
    It counts at once like every flag (M4); "Not accepted" in review stops it counting.

19. **"Needs review" and FR-44** (lead, §14 answer 1: option B). Every phone punch is in the **punch log**
    (channel filter "Phone"). **"Needs review"** lists only the phone punches that are **flagged**
    (`OUTSIDE_PLANT`, `LOCATION_AT_EDGE`, travel, two devices) and the **refused** ones that name an
    employee (approvable, M4 §7 rule 7). Accepted phone punches inside a plant fence need no click, like
    gate punches. There is **no** `PHONE_PUNCH` flag.

20. **Phone punching notice** (DPDP; lead decision 10).
    - Text files `backend/app/phone/notice_texts/phone-notice-v1.en.txt` (a used version is never edited;
      a change is a new version; a test fixes the hash of v1). `{{privacy_contact}}`, `{{company_address}}`
      and `{{retention_days}}` are filled in when shown; both settings must be set (as M3).
    - The **employee** taps "I agree" on their own phone (better than the M3 face consent, where the Super
      Admin taps; decision 0017 item 1). Stored in `phone_notice_acceptances` with the text hash and the
      session. Punch endpoints answer `PHONE_NOTICE_REQUIRED` until the current version is accepted.
    - This notice is **in addition** to the M3 face consent: face processing still needs the active agreed
      face consent recorded by the Super Admin (`PHONE_FACE_NOT_READY` otherwise). The phone notice covers
      what is new: the employee's own phone, location at punch time (also outside the plant), the selfie of
      a gate-code punch, and the sign-in data.

21. **No offline phone punching** (lead decision 9, proposed and kept). Reasons:
    - an employee's phone is not a trusted device: it has no paired device key, no counter, no health
      samples, so the M4 time proof (anchor + heartbeats) cannot work and a saved punch could be backdated;
    - a queued outside-work punch could be sent hours later from anywhere;
    - the gate device already has the offline queue for the plant, and a phone without internet at the
      plant can still punch at the gate.
    The phone page shows the "No internet" message (§4.11) and keeps nothing (no IndexedDB, no service
    worker). A punch that was sent but whose answer was lost is retried with the same `client_punch_id` by
    a "Check again" button (idempotent), never queued.

22. **Inside now, muster and alerts with phone punches** (lead-approved change of M5 §7 rules 17, 19, 29,
    already written into the M5 spec).
    - **Where a person is inside** = the latest counted IN (M5 rule 17) at **`COALESCE(location_plant_id,
      plant_id)`** of that punch: the gate's plant for gate punches, the plant whose fence matched for
      phone punches. Example: a K134 employee with outside work punches IN by phone inside X-280's fence →
      counted in X-280's "Inside now", X-280's muster (with the home plant code "K134" next to the name) and
      X-280's gate count (F-28); the attendance day and the register stay with K134 (`plant_id`).
    - An IN with the flag `OUTSIDE_PLANT` is **inside no plant**: left out of "Inside now", the muster, the
      still-inside alert (F-4) and the gate count (F-28). The dashboard shows **"On outside work: N"** (the
      count comes from the same bulk query, so it is cheap) for the employees' own plants and for "All
      plants". No named outside-work list (F-81 is Later).
    - The still-inside alert for a person standing in another plant goes to that plant (where they are).
    - Attendance days (M5) count phone punches like any other counted punch, always for `plant_id`; an
      outside IN without OUT is still "Incomplete".
    - Plant scope: a Plant Head of X-280 sees the visiting K134 employee in X-280's dashboard and muster
      (name, code, home plant; safety needs it) but not in X-280's punch log, attendance or reports (those
      follow `plant_id`). See §14 question 1.

23. **Settings** (Super Admin edits; others read; `used_from` = 5, built in the M5 PR).
    | Key | Group | Default | Range | Used for |
    |---|---|---|---|---|
    | `phone_session_idle_days` | phone | 7 days | 1–30 | rule 4 |
    | `phone_session_max_days` | phone | 30 days | 1–90 | rule 4 (must be ≥ idle days, `SETTING_INVALID`) |
    | `phone_max_sessions` | phone | 1 | 1–3 | rule 4 ("one phone at a time"; lead, §14 answer 3) |
    | `phone_login_max_failures` | phone | 5 tries | 3–10 | rule 7 |
    | `phone_login_lock_minutes` | phone | 15 min | 5–120 | rule 7 |
    | `phone_location_max_age_seconds` | phone | 60 s | 10–120 | rule 12 |
    | `phone_gate_code_seconds` | phone | 30 s | 15–60 | rule 15 (cross-check with the cool-down) |
    | `kiosk_show_phone_code` | kiosk_screen | `on` | `on` / `off` | §4.2 |
    | `kiosk_phone_code_show_seconds` | kiosk_screen | 60 s | 20–180 | §4.2 (narrow gates) |
    | `phone_many_phones_alert_count` | phone | 3 phones | 2–10 | F-70, rule 27 (in 30 days) |
    Reused: `gps_accuracy_limit_m`, `face_match_threshold`, `face_challenge_seconds`, the other face
    settings, `kiosk_photo_ready_seconds`, `snapshot_retention_days`, `punch_cooldown_minutes`,
    `min_minutes_before_out`, `open_in_max_hours`, the M4 flag settings. Fixed in code (security, not
    settings): password length 8–128, proof token 5 minutes, proof answer at least 1 second, gate-code
    grace 5 s, the rate limits of rule 8.

24. **Code catalogue (M4b).** Every server code has `errors.<CODE>` (short English message); phone results
    have `phone.punch.<CODE>.title`, `.message`, `.next`; stored codes have `punchReasons.<CODE>` (and
    `punchReasons.<CODE>_help` for flags); gate-only codes have `kiosk.punch.<CODE>.*`. `npm run
    i18n:check` fails on a missing text; a test fails if any phone or gate text contains "kiosk".
    - **New rejection codes (stored):** `GATE_CODE_INVALID`, `GATE_CODE_EXPIRED`.
    - **New flag code (stored):** `OUTSIDE_PLANT`.
    - **Reused on phone rows:** `LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `GEOFENCE_NOT_SET`,
      `OUTSIDE_GEOFENCE`, `LOCATION_AT_EDGE`, all M3 face codes, `SNAPSHOT_MISSING`, `SNAPSHOT_INVALID`,
      `WRONG_PLANT`, `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`, `SHIFT_ALREADY_CLOSED`, `IMPOSSIBLE_TRAVEL`,
      `TWO_DEVICES_SOON`.
    - **New request / answer codes (no row):** `PHONE_CREDENTIALS_INVALID`, `PHONE_ACCOUNT_LOCKED`,
      `PHONE_PUNCH_OFF`, `PHONE_NEW_PASSWORD_REQUIRED`, `PHONE_NOT_SIGNED_IN`, `PHONE_NOTICE_REQUIRED`,
      `NOTICE_TEXT_CHANGED`, `PHONE_FACE_NOT_READY`, `PROOF_FAILED`, `PROOF_TOKEN_INVALID`,
      `PHONE_ACCESS_UNCHANGED`, `OUTSIDE_UNTIL_INVALID` (F-69), `NOT_BULK_CONFIRMABLE` (F-76),
      `PHONE_RECENT_SIGN_IN_REQUIRED`, `PASSKEY_INVALID`, `PASSKEY_LIMIT_REACHED`, `PASSKEYS_NOT_CONFIGURED`
      (F-80); reused `EMPLOYEE_NOT_FACE` and `EMPLOYEE_NOT_QR` (now also phone answers),
      `PASSWORD_TOO_WEAK`, `TOO_MANY_REQUESTS`, `FACE_SERVICE_*`.
    - **Phone-only codes (never from the server):** `PHONE_LOCATION_DENIED`, `PHONE_LOCATION_UNAVAILABLE`,
      `PHONE_LOCATION_WEAK`, `PHONE_NOT_AT_PLANT` (gate-code path, checked on the phone before the
      camera), `PHONE_CAMERA_BLOCKED`, `PHONE_CAMERA_NOT_FOUND`, `PHONE_NETWORK_OFFLINE`,
      `PHONE_NOT_GATE_CODE`, `PHONE_BROWSER_UNSUPPORTED`, `PHONE_SIGNED_OUT_ELSEWHERE`,
      `PASSKEY_CANCELLED` (the person closed the phone's screen-lock prompt).
    - **Admin-only text without a code:** `notifications.phone_many_phones` (F-70).
    - **Gate-only code:** `GATE_CODE_AT_DEVICE`.
    - Texts in §9. Refusals end with "Please visit the plant office."; camera and location hints end with
      "Please try again." (decision 0022).

25. **Cleanup job** (the M3 job, every 5 minutes): delete `phone_proofs` older than 1 day, phone
    challenges as other challenges (1 day), ended `phone_sessions` older than 90 days. Logs counts only.

26. **Frontend structure and budgets.** `frontend/src/phone/` (pages, hooks), sharing the face capture and
    QR reading code with the gate (moved to a shared folder in the plan, no behaviour change at the gate).
    The phone page loads MediaPipe and the QR decoder lazily. Budget: the phone page's first load
    ≤ 70 kB gzip (own entry in `npm run size`); the gate budget (65 kB) and the admin first load do not
    grow except the phone code panel (≤ 1.5 kB). The gate service worker scope stays `/attendance`; `/phone`
    has no service worker.
    - **Add to home screen (F-74, approved):** a separate web manifest `/phone.webmanifest` (name "Phone
      attendance", `start_url` and `scope` `/phone`, `display: standalone`, the existing app icons) linked
      only from the `/phone` pages, plus the Apple meta tags for iPhones. **No service worker** is
      registered for `/phone`, so the page stays online-only (rule 21); the browser may then not offer its
      own install prompt, so the menu shows short "Add to home screen" steps for Chrome and Safari. The
      admin and gate manifests do not change.

27. **Many-phones alert (F-70, approved).** When a sign-in (password or passkey) succeeds, the server
    counts the employee's **distinct phones** among sessions started in the last 30 days, where a phone =
    the pair (browser, system) parsed from the user agent. When the count reaches
    `phone_many_phones_alert_count` (3), one M5 notification `phone_many_phones` (severity warning,
    `plant_id` = the employee's plant, `subject_ids` = the employee, params = the count, **no names, no
    IPs**; dedupe key employee + 30-day period) is made for **Super Admins only** (they alone act on
    phone access). The text: "An employee signed in on 3 phones in 30 days. Check the signed-in phones."
    with a link to the employee's "Phone attendance" card. Two identical phones look like one; the alert is
    a hint, never a block.

28. **Bulk confirm of clean outside punches (F-76, approved).**
    - **Clean** = a phone punch whose decision is `flagged`, whose `reason_codes` are **exactly**
      `["OUTSIDE_PLANT"]` (no edge, travel, two-device or other flag), with no review yet, a matched face
      (`employee_id` set), and outside work allowed for that employee on the punch date.
    - In "Needs review" (Super Admin, filter "Phone") those rows get a checkbox; "Confirm selected (n)",
      1–100 rows, one optional note. Each row is confirmed in its own short transaction with the M4 checks
      (`expected_latest_review_id`, `REVIEW_CHANGED`); a row that is no longer clean answers
      `NOT_BULK_CONFIRMABLE` and is left for a single review. Each confirm writes its own `punch_reviews`
      row and audit `punch_review.confirm` with `bulk: true`. Nothing else can be bulk-approved (no bulk
      "not accepted", no bulk approval of refused punches).

29. **Passkey as an optional second way to sign in (F-80, approved).**
    - **Free and standard:** the browser's own WebAuthn API (no frontend library; a small own helper for
      base64url) and on the server **`webauthn` (py_webauthn, Duo Labs, BSD-3-Clause)** to make options and
      verify answers (§13). No outside service; the fingerprint, face unlock or phone PIN never leaves the
      phone; the server stores only a public key and a counter.
    - **Adding:** only while signed in **and** within 10 minutes of a password sign-in or a proof
      (`PHONE_RECENT_SIGN_IN_REQUIRED`), so a borrowed open session cannot add a passkey. At most **3**
      active passkeys per employee (`PASSKEY_LIMIT_REACHED`). `userVerification` required, attestation none,
      RP id = the host of `APP_PUBLIC_ORIGIN` (development: `localhost`). The challenge is stored as a hash
      in `phone_proofs` (single use, 5 minutes). Audit `phone_passkey.add`.
    - **Signing in:** the employee types the code, the phone asks its screen lock, the server checks the
      signature, the challenge, the origin, the RP id, user verification and that the counter did not go
      backwards (a backwards counter → `PASSKEY_INVALID` and audit, the passkey stays). Then the **same**
      checks and effects as a password sign-in (rule 4): phone punching ON, no new password required,
      `phone_max_sessions`, F-70 count, audit `phone_auth.login` with method `passkey`. Every failure is one
      answer `PASSKEY_INVALID`; unknown codes get same-shaped options. Passkey sign-ins share the per-IP
      sign-in limit; a failed passkey does **not** count towards the password lockout (it cannot guess a
      password).
    - **Removing:** the employee (own), the Super Admin (with reason), and automatically on "Require a new
      password" (`new_password`), phone punching OFF (`phone_off`), self-stop and "mark as left". Rows are
      marked removed, never deleted.
    - **Still "any phone"** (lead decision 4): a passkey is an addition on the phones the employee chooses;
      the password always works. A passkey synced by Google or Apple to another phone of the same person
      works there too; that is accepted (it still needs that phone's screen lock).
    - **Portability:** passkeys are bound to the website's host name. If the site moves to another address
      (for example the client's own server), passkeys stop working and employees use their password and
      add a new passkey; the handover guide says so.
    - **Memory and speed:** verification is one ECDSA or RSA check (well under 10 ms, no argon2), so a passkey
      sign-in is lighter for Render's 512 MB than a password sign-in.

## 8. Security, privacy and compliance

### 8.1 Privacy and DPDP (Act 2023, Rules 2025); IT Act §43A + SPDI Rules 2011
- **New personal data:** employee password hash; sign-in sessions (IP, browser and system name, the
  user agent, times); **phone location at punch time** (inside and outside the plant); selfies of
  gate-code punches; the notice acceptance. **No phone number, email, IMEI, device id or fingerprint**
  (lead decision 10; client answers). The browser name is kept only so the employee and the Super Admin
  recognise a phone in the sessions list.
- **Purpose and minimisation:** location is read only at the moment of a punch or a card proof, never in
  the background, never on a timer; exact outside positions are visible to the Super Admin only; Corporate
  and Plant Heads see the "Outside plant" tag without coordinates.
- **Notice and consent:** the phone punching notice is accepted by the employee on their phone (rule 20);
  face processing still needs the M3 consent. Phone punching is optional; stopping is one tap (rule 3).
- **Retention:** selfies as card photos (`snapshot_retention_days`, encrypted, purged); punch rows as
  attendance records (no deletion, M5 §7 rule 25); proofs 1 day; ended sessions 90 days.
- **Passkeys (F-80):** only a public key, a counter, a random user handle and a label ("Chrome on
  Android") are stored; no biometric data reaches the server. The notice v1 mentions them.
- **Data-subject access:** the phone shows today's own punches and the last 31 days (F-73); full access
  requests stay manual (M6).
- **Client follow-up (not a blocker):** the client's HR or legal advisor confirms the notice text at the M6
  handover, together with the open points of decisions 0017 and 0029 C.

### 8.2 Security controls
- Employee and admin identities are fully separate: different tables, cookies, cookie paths, dependencies.
  An employee session can never call an admin endpoint; a stolen admin cookie never punches.
- Cookie `ups_phone`: HttpOnly, Secure, SameSite=Strict, Path `/api/v1/phone`; token 32 random bytes;
  only the SHA-256 hash stored. Origin check on every write (M1). No token in URLs or local storage.
- argon2id; dummy check for unknown codes; same answer for unknown code and wrong password; lockout;
  rate limits per IP, per code and global (rules 6–9).
- Proofs: the same answer and at least 1 s for every failure; challenges single-use and bound to the
  proof row or the session; proof tokens single-use, 5 minutes.
- Gate codes: server HMAC, 128-bit tag, constant-time compare, 30 s life; device-signed fetch.
- Never trust the client: the server decides time, location verdict, face match, IN/OUT (CLAUDE.md §5).
- **Security headers for `/phone` (S-47, approved; Vercel `headers` for `/phone` and `/phone/*`):**
  `Content-Security-Policy` with `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (MediaPipe
  and the QR decoder run WebAssembly served from our own site), `connect-src 'self'`, `img-src 'self'
  data: blob:`, `media-src 'self' blob:`, `worker-src 'self' blob:`, `style-src 'self' 'unsafe-inline'`
  (only if Tailwind/Radix need it; the plan tries without), `frame-ancestors 'none'`, `base-uri 'self'`,
  `form-action 'self'`; `Permissions-Policy: camera=(self), geolocation=(self), publickey-credentials-get=(self),
  publickey-credentials-create=(self), microphone=()`; `Referrer-Policy: no-referrer`. A Playwright test
  loads every `/phone` page and fails on any CSP violation report in the console. The admin and gate
  headers do not change in M4b (the site-wide strict CSP stays the Later item S-21).
- OWASP Top 10 review by the security-reviewer agent; the plan lists the attack tests of §11.

### 8.3 Proxy risk, written honestly (lead decision 4: any phone)
| Attack | What stops it | What is left |
|---|---|---|
| A face employee gives code + password to a friend, who punches from home | The face check: the friend's face does not match (1:1, anti-spoof, server-chosen head turn) | A deepfake or a virtual camera on a rooted phone showing the real person turning their head live. The server cannot detect a virtual camera. Rare and needs skill; the M4 patterns and F-54 hints show repeats |
| A friend punches for a QR worker with the worker's password on the friend's phone, at the gate | Gate code + fence + selfie (the selfie shows the friend's face); "one phone at a time" signs out the real worker's phone, who then notices; F-70 alert | The same as a borrowed ID card today (M2); the selfie is checked only when the Super Admin looks (F-77 selfie compare is Later) |
| A QR worker whose card expired (contract ended, not yet marked as left) keeps punching by phone | No card check for phone punches (lead, §14 answer 4); the office must switch phone punching OFF or mark the person as left | Accepted by the lead: the switch, not the card, controls phone punching. The "Cards ending soon" list (M2 F-33) also shows "Phone punching on" for these workers as a reminder |
| The gate code is photographed and sent on WhatsApp to a worker at home | 30 s life; the phone must be inside the fence; selfie | A worker who also fakes the GPS position (mock-location app) can pass within the 30 s. F-72 ("near the gate device", Later) would make it harder; the selfie remains |
| An employee fakes GPS for "outside work" | Only chosen employees have outside work; every outside punch is flagged and reviewed with the map; face match on every punch | The fake position itself cannot be proven false by a browser. The person is still really themselves (face) |
| Someone sets a QR worker's password with a borrowed card | Card proof only inside the plant fence; the reset signs out the real worker's phone; audit "password set by card proof" | The same holder could already punch with that card at the gate today |
| Brute force of passwords | Lockout per code (5), IP and global limits | An attacker can lock a worker out for 15 minutes; the proof still works |
| Stolen phone with an open session | Face employees: the face check on every punch; QR workers: must be at the gate with the code and a selfie; "Sign out all phones" | – |
| One employee uses many phones | Sessions list; "one phone at a time" (lead, §14 answer 3); F-70 alert | – |
| A borrowed open session adds a passkey to keep access | Passkeys only within 10 minutes of a password sign-in or a proof; listed for the Super Admin; removed by "Require a new password" | – |
| Outside-work person stands in another plant (accepted without flag) | Face match; matched fence stored; counted inside that plant for safety | No review click for these punches (lead, §14 answer 5) |

### 8.4 Audit (FR-40) – new actions
`phone_access.enable`, `phone_access.disable`, `phone_access.outside_on`, `phone_access.outside_off`,
`phone_access.self_disabled`, `phone_account.password_set` (with proof kind), `phone_account.new_password_required`,
`phone_account.sessions_ended`, `phone_auth.login`, `phone_auth.login_failed` (code only),
`phone_auth.logout`, `phone_proof.failed` (kind, typed code; never pictures), `phone_notice.accept`,
`phone_passkey.add`, `phone_passkey.remove` (who, kind, reason), `phone_auth.login` with `method:
"password"|"passkey"`, `punch_review.confirm` with `bulk: true` (F-76), and the system's
`phone_access.outside_off` when an until-date passed (F-69).
New audit `actor_type` **`employee`** (fits the existing column); the audit viewer shows the employee's
code and name for it. Gate-code fetches are not audited (one every 20 s per gate; they are logged as
counts only).

### 8.5 Labour Codes
Phone punches are attendance records like gate punches: never changed, never deleted; corrections stay
M5 regularisations; the channel and outside tag stay visible in registers' source data and the punch export.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | User message (English, i18n key) |
|---|---|---|---|
| Wrong password or unknown code | 401, same answer, same timing | `PHONE_CREDENTIALS_INVALID` | "Employee code or password is wrong. First time? Set your password." (`errors.PHONE_CREDENTIALS_INVALID`) |
| 5 wrong passwords | Locked 15 min | `PHONE_ACCOUNT_LOCKED` | "Too many wrong passwords. Try again in {{minutes}} minutes, or reset your password." |
| Right password, phone punching OFF | No session | `PHONE_PUNCH_OFF` | "Phone attendance is switched off for you. Please visit the plant office." |
| Right password, Super Admin required a new one | No session | `PHONE_NEW_PASSWORD_REQUIRED` | "Please set a new password: tap 'Forgot password?'." |
| Session ended (other phone, admin, idle) | 401 | `PHONE_NOT_SIGNED_IN` | "Please sign in again." (phone-only `PHONE_SIGNED_OUT_ELSEWHERE` when ended by a new sign-in) |
| Notice not accepted | 428 | `PHONE_NOTICE_REQUIRED` | "Please read and accept the phone attendance notice first." |
| Proof does not match / not allowed / unknown code | Same answer, ≥ 1 s | `PROOF_FAILED` | "We could not confirm it is you. Please try again, or visit the plant office." |
| Proof token used or older than 5 min | 401 | `PROOF_TOKEN_INVALID` | "This check has expired. Please check again." |
| Weak password | 422 with rule | `PASSWORD_TOO_WEAK` | "Use at least 8 characters, not only numbers, and not your employee code." |
| Face employee without template or consent | 409, no row | `PHONE_FACE_NOT_READY` | "Your face is not set up for attendance. Please visit the plant office." |
| QR worker calls the face endpoint | 403, no row | `EMPLOYEE_NOT_FACE` | "You punch with the phone code at the gate. Please visit the plant office if this is wrong." |
| Face employee calls the gate-code endpoint | 403, no row | `EMPLOYEE_NOT_QR` | "You punch with your face. Please visit the plant office if this is wrong." |
| Location off / denied | Phone stops before sending | `PHONE_LOCATION_DENIED` | "Turn on location for this website. Please try again." |
| Accuracy 80 m (limit 50) | Phone warns; server rejects if sent | `GPS_ACCURACY_TOO_LOW` | "Your location is not exact enough. Move to an open place. Please try again." |
| Outside the fence, outside work OFF | Rejected, row stored, approvable | `OUTSIDE_GEOFENCE` | "You are not at the plant. Please visit the plant office." |
| Outside the fence, outside work ON | Accepted + flagged, tagged | (flag `OUTSIDE_PLANT`) | "IN · Saved as an outside-plant punch. The office will check it." |
| Outside work ON but punching by gate code | Rejected | `OUTSIDE_GEOFENCE` | as above |
| Outside work ON, standing inside another plant's fence | Accepted without flag; `location_plant_id` = that plant | – | normal IN/OUT |
| Outside work OFF, standing inside another plant's fence | Rejected | `OUTSIDE_GEOFENCE` | as above |
| Outside work ended yesterday (until date, F-69) | Treated as OFF | `OUTSIDE_GEOFENCE` | as above |
| Until date in the past typed by the Super Admin | Refused | `OUTSIDE_UNTIL_INVALID` | "The end date cannot be in the past." |
| Bulk confirm meets a row that changed or got a second flag | That row is skipped, others confirmed | `NOT_BULK_CONFIRMABLE` / `REVIEW_CHANGED` | "n punches were confirmed; m need a single review." |
| Add a passkey 15 minutes after the password sign-in | Refused | `PHONE_RECENT_SIGN_IN_REQUIRED` | "Please sign in with your password again to add a passkey." |
| Fourth passkey | Refused | `PASSKEY_LIMIT_REACHED` | "You already have 3 passkeys. Remove one first." |
| Passkey of a removed key, wrong site, or counter went back | Refused, one answer | `PASSKEY_INVALID` | "The passkey did not work. Please sign in with your password." |
| Person closes the phone's screen-lock prompt | Nothing sent | `PASSKEY_CANCELLED` (phone-only) | "Passkey cancelled. Please try again or use your password." |
| Site moved to another host name | Passkeys fail | `PASSKEY_INVALID` | as above; the password works |
| Inside the margin | Accepted + flagged | (flag `LOCATION_AT_EDGE`) | normal IN/OUT |
| Fresh reading older than 60 s | Treated as missing | `LOCATION_REQUIRED` | "We could not read your location. Please try again." |
| Someone else's face on the phone | Rejected, photo kept | `FACE_NOT_RECOGNISED` | "Face did not match. Please visit the plant office." |
| Printed photo / screen replay | Rejected, photo kept | `SPOOF_SUSPECTED` | M3 text |
| Head turn wrong / too slow | Rejected, retry | `LIVENESS_FAILED` / `CHALLENGE_EXPIRED` | M3 texts ("Please try again.") |
| Gate code forged or from a revoked device | Rejected | `GATE_CODE_INVALID` | "This phone code is not valid. Scan the code on the attendance device again." |
| Gate code older than 35 s | Rejected | `GATE_CODE_EXPIRED` | "The phone code has changed. Scan it again." |
| Code of another plant's gate | Rejected | `WRONG_PLANT` | M2 text ("…registered at another plant. Please visit the plant office.") |
| QR worker's card expired or revoked, phone punch | Not checked: the punch goes on (lead, §14 answer 4) | – | – |
| QR worker's card expired or revoked, card proof (first or forgotten password) | Refused, one answer | `PROOF_FAILED` | as above |
| No selfie / broken selfie | Rejected | `SNAPSHOT_MISSING` / `SNAPSHOT_INVALID` | M2 texts |
| Second punch within 2 min | Rejected | `COOLDOWN_ACTIVE` | M2 text ("Already punched") |
| OUT 10 min after IN | Rejected | `OUT_TOO_SOON` | M2 text |
| Punch after the shift's OUT | Rejected, approvable | `SHIFT_ALREADY_CLOSED` | M5 text |
| Phone shows the gate code to the gate camera | Nothing sent | `GATE_CODE_AT_DEVICE` (gate-only) | "This code is for phones. Show your ID card to this attendance device." |
| Phone scans an ID card in the gate-code step | Nothing sent | `PHONE_NOT_GATE_CODE` (phone-only) | "This is not the phone code of the attendance device." |
| No internet on the phone | Nothing saved, nothing queued | `PHONE_NETWORK_OFFLINE` | "No internet. Your punch was NOT saved. Try again when you have internet, or punch at the attendance device." |
| Answer lost after sending | "Check again" resends the same `client_punch_id` | – | stored answer shown |
| Gate offline | Panel shows "not available" | – | "Phone code not available now. Show your ID card." |
| Employee marked as left while signed in | Next request ends the session | `PHONE_NOT_SIGNED_IN` | "Please sign in again." (sign-in then fails) |
| Phone punching switched OFF while the face check runs | The punch is decided with the state at the request start; the next request is refused | – | – |
| Plant transfer today | New plant's fence and gate codes from the effective date | `WRONG_PLANT` at the old gate | M2 text |
| Two phones sign in at the same second (max 1) | Employee row locked; the later one ends the earlier | – | – |
| `phone_gate_code_seconds` set to 60 with cool-down 1 min | Refused | `SETTING_INVALID` | "The phone code must change faster than the punch cool-down." |
| Outside work switched ON for a QR worker | Refused | `EMPLOYEE_NOT_FACE` | "Outside work is only for employees who punch with their face." |
| Old browser without camera API | Phone page explains | `PHONE_BROWSER_UNSUPPORTED` | "Please open this page in a current Chrome or Edge." |
| Five password checks at once | Two run, others wait ≤ 5 s | `TOO_MANY_REQUESTS` | "Too many tries right now. Please wait a minute and try again." |

## 10. Acceptance criteria (Given / When / Then)
Common setup unless said otherwise: plant **DEMO1** with a polygon fence (margin 25 m), default shift
07:00–19:00 (grace 30), gate device G1 paired at DEMO1; face employee **F-201** (enrolled, active consent);
temporary QR worker **Q-301** (active card valid 01/11/2026–31/12/2026); a second plant **DEMO2** with its
own fence and gate device G2; settings at defaults. Times are IST
on **Monday 02/11/2026** unless said otherwise.

**Switches and sign-in**
- **AC-1** Given F-201 with phone punching OFF, when the Super Admin switches it ON with reason "Site
  visits", then `phone_access.phone_punch_enabled` is true and one audit row `phone_access.enable` holds the
  reason; a Corporate Head calling the same endpoint gets `FORBIDDEN`; a Plant Head of DEMO1 sees the state
  read-only and without IPs.
- **AC-2** Given phone punching OFF for F-201, when the Super Admin switches outside work ON, then
  `PHONE_PUNCH_OFF` (409) and nothing changes; for Q-301 with phone ON the answer is `EMPLOYEE_NOT_FACE`.
- **AC-3** Given F-201 with phone ON and no password, when F-201 signs in with any password, then
  `PHONE_CREDENTIALS_INVALID`, and the answer time is within 20% of a wrong-password answer for an account
  that has a password.
- **AC-4** Given F-201 with a password and phone punching OFF, when the right password is sent, then
  `PHONE_PUNCH_OFF` and no session row exists; with a wrong password the answer is
  `PHONE_CREDENTIALS_INVALID`.
- **AC-5** Given F-201 signed in on phone A, when F-201 signs in on phone B (`phone_max_sessions` 1), then
  A's session ends with `new_login`, A's next request answers `PHONE_NOT_SIGNED_IN`, and A shows "You signed
  in on another phone, so this phone was signed out."
- **AC-6** Given 5 wrong passwords for F-201 at 08:00, when a 6th try comes at 08:05 with the right password,
  then `PHONE_ACCOUNT_LOCKED` with `minutes_left` 10; at 08:15:01 the right password signs in.
- **AC-7** Given phone punching is switched OFF while F-201 has a session, when the phone calls
  `/phone/me`, then `PHONE_PUNCH_OFF` and the session is ended (`phone_off`); outside work is OFF too.
- **AC-8** Given an employee signed in, when the session is unused for 7 days and 1 minute, then the next
  request answers `PHONE_NOT_SIGNED_IN`; a session used daily ends 30 days after sign-in.
- **AC-9** Given F-201 is marked as left, then in the same transaction phone punching and outside work are
  OFF, sessions are ended (`left`) and `password_hash` is null.

**Proof and password**
- **AC-10** Given F-201 with phone ON and no password, when F-201 completes a face proof (correct turn, live
  face, 1:1 score above `face_match_threshold`) and sets "Ganesh@2026", then a session is created, the account
  shows "Password set by face check", and an audit row `phone_account.password_set` with proof kind `face`
  exists; no picture is stored anywhere.
- **AC-11** Given the typed code is unknown, a QR worker's code, a code with phone OFF, or F-201's code with
  another person's face, when the face proof is sent, then every case answers `PROOF_FAILED` after at least
  1 second, with the same body.
- **AC-12** Given Q-301 with phone ON, standing inside the DEMO1 fence (accuracy 15 m), when Q-301 scans
  their own card in the card proof and sets a password, then a session is created and the proof kind is
  `card`; the same proof from 2 km away answers `OUTSIDE_GEOFENCE`; a revoked or test card answers
  `PROOF_FAILED`.
- **AC-13** Given a proof token issued at 10:00:00, when it is used at 10:05:01, or used a second time, then
  `PROOF_TOKEN_INVALID`.
- **AC-14** Given F-201 is signed in on phone A, when F-201 resets the password by face proof on phone B,
  then A's session ends (`new_password`).
- **AC-15** Given passwords "12345678", "F-201", "f-201123", "password123" and "abc", when set, then each is
  refused `PASSWORD_TOO_WEAK` with the broken rule; "Ganesh@2026" is accepted.
- **AC-16** Given the account is locked, when F-201 does a face proof and sets a password, then the lock is
  cleared and sign-in works.
- **AC-17** Given the Super Admin presses "Require a new password" with a reason, then the hash is removed,
  all sessions end, sign-in with the old password answers `PHONE_CREDENTIALS_INVALID` (no hash) and the
  proof flow works.

**Notice**
- **AC-18** Given F-201 signed in without accepting the notice, when a punch challenge is asked, then
  `PHONE_NOTICE_REQUIRED`; after "I agree" a row in `phone_notice_acceptances` holds version `phone-notice-v1`
  and the hash of the exact text shown, and punching works.
- **AC-19** Given F-201 taps "Stop phone punching", then phone punching is OFF, sessions end (`self_stop`),
  audit `phone_access.self_disabled` has actor type `employee`, and sign-in answers `PHONE_PUNCH_OFF`.

**Phone face punch**
- **AC-20** Given F-201 (phone ON, outside OFF) 30 m inside the fence with accuracy 12 m at 06:55, when F-201
  punches with face, then the row is `accepted`, direction IN, channel `phone`, method `face`, match mode
  `one_to_one`, `kiosk_id` null, `employee_id` F-201, and the punch log shows "Phone"; no snapshot row exists.
- **AC-21** Given the same at 3 km from the fence with outside work OFF, then the row is `rejected`
  `OUTSIDE_GEOFENCE`, `claimed_employee_id` F-201, `employee_id` null, the face worker did not run, and the
  Super Admin can approve it in "Needs review" with a reason (M4).
- **AC-22** Given outside work ON for F-201, when F-201 punches OUT at 18:30 at 3 km from the fence, then the
  row is `flagged` with `OUTSIDE_PLANT`, lat/lon stored, the phone shows "OUT · Saved as an outside-plant
  punch…", the punch counts at once, it is listed in "Needs review" with the map, and a Plant Head sees the
  tag but no coordinates.
- **AC-23** Given F-201 15 m outside the drawn fence (inside the 25 m margin), then the punch is `flagged`
  `LOCATION_AT_EDGE` and the phone shows a normal IN.
- **AC-24** Given accuracy 80 m, or `age_s` 90, then `GPS_ACCURACY_TOO_LOW` or `LOCATION_REQUIRED`.
- **AC-25** Given another person's face on F-201's signed-in phone, then `FACE_NOT_RECOGNISED`, a
  `phone_face_rejected` snapshot is stored encrypted, and `employee_id` is null.
- **AC-26** Given a printed photo of F-201, then `SPOOF_SUSPECTED`; a challenge of another session answers
  `CHALLENGE_INVALID`; a used challenge answers `CHALLENGE_INVALID`.
- **AC-27** Given F-201 without an active template (face data deleted), then the challenge answers
  `PHONE_FACE_NOT_READY` and no row is written.
- **AC-28** Given F-201 punched IN at the gate G1 at 06:58, when F-201 punches by phone at 07:00, then
  `COOLDOWN_ACTIVE`; at 07:10 `OUT_TOO_SOON`; at 19:05 an OUT is accepted; at 19:40 `SHIFT_ALREADY_CLOSED`
  (M5 rule 24), approvable.
- **AC-29** Given F-201's phone OUT in Pune (outside work ON) at 10:00, when F-201's face is accepted at gate
  G1 at Waluj at 10:30, then the gate punch is flagged `IMPOSSIBLE_TRAVEL` with the phone punch linked.

**Gate code**
- **AC-30** Given G1 online at DEMO1 and Q-301 has phone ON, then `POST /kiosk/gate-code` returns a code
  text starting `UPG1.` and an SVG; with no QR worker of DEMO1 having phone ON, or `kiosk_show_phone_code`
  off, it returns `code_text: null` and the gate shows no panel.
- **AC-31** Given a code issued at 07:00:00 (life 30 s, grace 5 s), when Q-301 inside the fence sends it with
  a selfie at 07:00:34, then the row is `accepted` IN, channel `phone`, method `gate_code`, `kiosk_id` G1,
  `employee_id` Q-301, `qr_credential_id` null, `location_plant_id` DEMO1, a `phone_gate_code` snapshot
  encrypted with the punch id bound; the same code sent at 07:00:36 by another worker answers `GATE_CODE_EXPIRED`.
- **AC-32** Given a code text with one changed letter, then `GATE_CODE_INVALID`; given a valid code of a gate
  at plant DEMO2, then `WRONG_PLANT`; given a code of a device revoked after issue, then `GATE_CODE_INVALID`.
- **AC-33** Given Q-301 2 km from the fence (accuracy 10 m) sends a valid, fresh code that someone else
  photographed at G1, then the row is `rejected` `OUTSIDE_GEOFENCE` (the gate-code path has no outside
  option) and the selfie is stored for the review.
- **AC-34** Given Q-301 already has a password and Q-301's card was revoked on 01/11/2026, when Q-301 sends a
  valid code from inside the fence on 02/11/2026, then the punch is `accepted` (no card check, lead §14
  answer 4); but a card proof with that revoked card ("Forgot password") answers `PROOF_FAILED`.
- **AC-35** Given F-201 (face) sends a gate code, then `EMPLOYEE_NOT_QR` and no row; given Q-301 asks a face
  challenge, then `EMPLOYEE_NOT_FACE`.
- **AC-36** Given the gate shows a code and a worker holds a screenshot of it to G1's camera, then G1 shows
  "This code is for phones. Show your ID card to this attendance device." and sends nothing.
- **AC-37** Given G1 is offline for 20 s, then the panel shows "Phone code not available now. Show your ID
  card." and no old code stays on screen longer than its life.
- **AC-38** Given a card punch or face punch is running at G1, then the panel is hidden until the gate is
  idle again; on a 360 px gate the "Phone code" button shows the code for 60 s.

**Lists, review, M5**
- **AC-39** Given phone and gate punches on 02/11/2026, when the Super Admin filters the punch log by channel
  "Phone", then only phone rows show; the Excel export has "Channel" and "Outside plant" columns.
- **AC-40** Given on 02/11/2026 an accepted phone punch inside the DEMO1 fence, a flagged `OUTSIDE_PLANT`
  phone punch and a refused `OUTSIDE_GEOFENCE` phone punch naming F-201, when the Super Admin opens "Needs
  review" with the "Phone" filter, then only the flagged and the refused punch are listed; all three are in
  the punch log under "Phone"; no row anywhere carries a `PHONE_PUNCH` code.
- **AC-41** Given F-201's latest counted punch is an `OUTSIDE_PLANT` IN at 08:00, then the DEMO1 dashboard
  "Inside now" does not count F-201, "On outside work: 1" shows, the muster does not list F-201, the gate
  count (F-28) does not count F-201, and at 20:01 the F-4 still-inside alert does not include F-201; the
  attendance day of F-201 is "Open" (then "Incomplete" if no OUT comes).
- **AC-41b** Given F-201 (home DEMO1, outside work ON) punches IN by phone at 08:00 standing inside DEMO2's
  fence, then the row is `accepted` with no flag, `plant_id` DEMO1, `location_plant_id` DEMO2, `geofence_id`
  = DEMO2's fence version, distance 0; DEMO2's "Inside now" and muster list F-201 with the home plant code
  "DEMO1"; DEMO1's "Inside now" does not; F-201's attendance day is in DEMO1's register; it is not listed in
  "Needs review". With outside work OFF the same punch is `OUTSIDE_GEOFENCE`.
- **AC-42** Given a `phone_gate_code_seconds` of 60 and `punch_cooldown_minutes` 1, when saved, then
  `SETTING_INVALID`.

**Non-functional**
- **AC-43** Phone face punch decision p95 under 2 s in the Render-like container (NFR-01), measured with 20
  signed phone punches (extends `face_memory_check`).
- **AC-44** Four parallel employee sign-ins and 20 phone face punches keep the backend under 450 MB (CI
  `docker` job).
- **AC-45** Every `/phone` page and the gate panel fit 360 px and 768 px without sideways scrolling
  (`responsive.spec.ts`); axe finds no serious issue; no phone or gate text contains "kiosk"; `npm run
  i18n:check` passes with every new code.
- **AC-46** Every new table has RLS + `deny_all` (`test_row_level_security.py`); no new column is named or
  holds a phone number (schema test lists the new columns).
- **AC-47** The phone page's first load is ≤ 70 kB gzip; the gate budget (65 kB) and admin first load stay
  within their M5 limits (`npm run size`).
- **AC-48** With the phone offline, a punch shows the "NOT saved" message and nothing is written to
  IndexedDB, localStorage or a service worker cache.

**Approved extras**
- **AC-49 (F-69)** Given outside work ON for F-201 until 03/11/2026, when F-201 punches 3 km away at
  03/11/2026 23:50 IST, then `flagged` `OUTSIDE_PLANT`; at 04/11/2026 00:10 IST the same punch is
  `OUTSIDE_GEOFENCE`; the daily job of 04/11/2026 sets the switch OFF with audit actor system and reason
  "Until date passed"; saving an until date of 01/11/2026 on 02/11/2026 answers `OUTSIDE_UNTIL_INVALID`.
- **AC-50 (F-70)** Given F-201 signed in on 05/10 (Chrome, Android), 20/10 (Samsung Internet, Android) and
  02/11/2026 (Safari, iOS), then at the third sign-in exactly one `phone_many_phones` notification exists
  for Super Admins (no name, no IP in its params); a fourth phone on 03/11 does not make a second one;
  Plant Heads and Corporate Heads do not see it.
- **AC-51 (F-73)** Given F-201 with M5 days in October and November, when F-201 opens "My attendance" on
  02/11/2026, then the days 03/10/2026 to 02/11/2026 show with status, first IN, last OUT and worked time,
  without flags or reasons, and only F-201's own data (another employee's id cannot be asked for: the
  endpoint has no id parameter).
- **AC-52 (F-74)** `/phone` links `/phone.webmanifest` with `scope` `/phone` and `display` standalone; no
  service worker is registered under `/phone` (checked in Playwright via
  `navigator.serviceWorker.getRegistrations()`); the admin and gate manifests are unchanged.
- **AC-53 (F-76)** Given 3 flagged phone punches with only `OUTSIDE_PLANT` and 1 with `OUTSIDE_PLANT` +
  `IMPOSSIBLE_TRAVEL`, then only the first 3 have a checkbox; confirming all 4 by API gives 3 `ok` and 1
  `NOT_BULK_CONFIRMABLE`; 3 `punch_reviews` rows and 3 audit rows with `bulk: true` exist; a Corporate Head
  gets `FORBIDDEN`.
- **AC-54 (F-80)** Given F-201 signed in by password at 09:00, when F-201 adds a passkey at 09:05, then a
  `phone_passkeys` row with public key and counter 0 exists and audit `phone_passkey.add`; at 09:20 adding
  another answers `PHONE_RECENT_SIGN_IN_REQUIRED`.
- **AC-55 (F-80)** Given F-201 has a passkey, when F-201 signs in with it on that phone, then a session is
  created as with a password (one phone at a time applies; phone punching OFF answers `PHONE_PUNCH_OFF`);
  a signature for another challenge, a wrong origin, a removed passkey or a lower counter answers
  `PASSKEY_INVALID` and does not change `failed_login_count`.
- **AC-56 (F-80)** Given "Require a new password" or phone punching OFF for F-201, then all F-201's passkeys
  are marked removed and passkey sign-in answers `PASSKEY_INVALID`; the server tests use py_webauthn's
  own test vectors and a software authenticator, no real biometric.
- **AC-57 (S-46)** The Playwright mobile project (Pixel 7 and iPhone 13 viewports, Chromium with a fake
  camera file and fixed geolocation) runs the face punch, the gate-code scan and the proof flows; the repo
  holds only a synthetic camera file; a consented real-face file is read from a folder outside the repo
  when present (local runs) and skipped in CI.
- **AC-58 (S-47)** Every `/phone` response has the CSP and Permissions-Policy of §8.2; the Playwright run of
  the phone flows records zero CSP violations; `/admin` and `/attendance` headers are unchanged.
- **AC-59 (S-49)** In the 512 MB container, 8 parallel password sign-ins plus 4 phone face punches keep
  the backend process under 450 MB (fails above), and the semaphore of rule 9 lets at most 2 argon2 checks
  run at once.

## 11. Test plan
All time-dependent tests pass `now` in or freeze the clock with time-machine (S-40, approved in M5) at the
pinned IST times of §10; the midnight-IST CI run of M5 also runs the M4b tests.
- **Unit (pytest):** password rules (AC-15); gate-code text build/parse/MAC/expiry with pinned times 07:00:00,
  07:00:34, 07:00:36 (AC-31, AC-32); phone location rule table: inside, edge, outside with/without outside
  work, gate variant, accuracy, age (AC-20–AC-24, AC-33); 1:1 match rule with the fake face engine
  (`FACE_ENGINE=fake`); setting cross-checks (AC-42); session expiry arithmetic (AC-8); notice hash fixed
  for v1.
- **API (pytest + httpx, test database):** every AC-1 to AC-42 path, including: same-answer and ≥ 1 s timing
  of `PROOF_FAILED` (AC-11, measured with a tolerance); lockout across restarts (DB); rate limits per IP,
  per code, global; cookie path and SameSite flags; admin cookie refused on `/phone/*` and phone cookie on
  admin endpoints; idempotent retry of `client_punch_id`; counting across channels (AC-28); travel flag
  (AC-29); M5 inside-now exclusion (AC-41); RLS (AC-46); no-delete grep for punches stays green.
- **Attack tests (core, not the S-35 tool):** replay of a gate code after the cool-down window, a code with a
  future `issued_at`, a code of a revoked device, a challenge of another session, a proof token reused,
  password sign-in for a left employee, a forged session cookie, an outside punch with `age_s` 0 but
  accuracy 5,000 m.
- **Frontend (Vitest):** phone state machine (sign-in, proof, notice, home, face, gate code, results,
  offline); gate panel show/hide rules and the 360 px button (AC-37, AC-38); `UPG1.` text at the gate card
  reader (AC-36); i18n keys.
- **Extras:** F-69 until-date with pinned times 03/11 23:50 and 04/11 00:10 IST (AC-49); F-70 counting of
  distinct phones (AC-50); F-73 31-day window ending today (AC-51); F-76 clean-row rule and per-row
  transactions (AC-53); F-80 with py_webauthn test vectors and a software authenticator (Playwright's
  Chromium virtual authenticator via CDP `WebAuthn.addVirtualAuthenticator`) (AC-54–AC-56).
- **End-to-end (Playwright, headed locally; S-46 approved):** a phone project (Pixel 7 and iPhone 13
  viewports) with Chrome's fake camera (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture`)
  and a fixed geolocation: (1) Super Admin switches F-201 on → proof with the fake engine → password
  → notice → face punch accepted; (2) Q-301 card proof → gate code scanned from a second page showing the
  gate → accepted with selfie; (3) outside work: geolocation 3 km away → flagged, appears in "Needs review";
  (4) responsive and axe checks (AC-45).
  (5) CSP check on every `/phone` page (S-47, AC-58); (6) manifest and no service worker (AC-52).
- **Performance and memory:** AC-43, AC-44 and the S-49 guard (AC-59) in the CI `docker` job. The Locust
  scenario for 50 gate-code scans in one minute (S-45) is Later.
- **Manual (real devices, recorded in the plan's Status):** a cheap Android phone and an iPhone with Chrome
  and Safari: proof, face punch indoors and outdoors, gate code from the gate phone and the gate PC at 1–2 m,
  location accuracy inside the plant buildings, front-camera anti-spoof false rejections.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
Answered by the lead (Tushar Gawande) in chat on 2026-10-31. **Approved** rows are in scope (§2 item 15b,
ACs AC-49 to AC-59); **Later** rows are not built in M4b.

### 12.1 Product features
| # | Suggestion | Why it helps | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|
| F-69 | **"Outside work until" date** on the outside-work switch: after that date outside punches are rejected again (the switch shows "ended") | Outside work is usually a few days; nobody has to remember to switch it off | S | Low | **Approved** (§7 rule 3, AC-49) |
| F-70 | **Many-phones alert:** a bell notice (M5 F-7) when one employee signs in on 3 or more different phones (browser + system) within 30 days | Shows account sharing early (lead decision 4 mitigation) | S | Low (adds a notification kind; browser names can repeat) | **Approved** (§7 rule 27, AC-50) |
| F-71 | **Photo for outside-plant face punches:** keep the first frontal frame (encrypted, normal retention) only for `OUTSIDE_PLANT` punches | The reviewer sees who was there; outside punches are the riskiest | S | Medium (privacy: more photos) | Later |
| F-72 | **"Near the attendance device" check** for gate-code scans: the phone must be within 150 m (setting) of the gate device's last good position from its heartbeat, else flag `FAR_FROM_DEVICE` | Makes the "photo of the code on WhatsApp + fake GPS inside a big fence" attack harder | S/M | Low (flag only) | Later |
| F-73 | **"My attendance" on the phone:** own days of the last 31 days with the M5 day statuses (Present, Half-day, Incomplete…) | Workers check their own record and spot a missing OUT early; DPDP access in practice | M | Low | **Approved** (§4.8b, AC-51) |
| F-74 | **"Add to home screen"**: a web manifest for `/phone` only (icon, name "Phone attendance"), no service worker | One tap to open; still online-only | S | Low | **Approved** (§7 rule 26, AC-52) |
| F-75 | **Planned outside site:** the Super Admin adds a site name and an optional circle on the map with the outside-work switch; punches inside it get the tag "At planned site" (still flagged) | Review is faster: green tick when the position is where the person was sent | M | Low | Later |
| F-76 | **Bulk confirm of clean outside punches** in "Needs review" (rows whose only flag is `OUTSIDE_PLANT`; F-75's planned-site condition is dropped because F-75 is Later) | Saves clicks if outside work is common (part of Later item F-49) | S | Medium (bulk approvals can hide mistakes) | **Approved** (§7 rule 28, AC-53) |
| F-77 | **Selfie compare for gate-code punches:** side-by-side of the last 3 selfies of the worker (extends M2 F-29) | Makes password sharing among QR workers visible | S | Low | Later |
| F-78 | **Marathi and Hindi on the phone pages first** (language switch on `/phone` only), texts checked by a reader | Workers use their own phones; plain language matters most there | M | Low (translation quality) | Later |
| F-79 | **Phone notice text in Marathi and Hindi** (the text only, like the M3 consent) | Real informed consent for workers (DPDP) | S | Low | Later |
| F-80 | **Passkey sign-in (WebAuthn, free)** as an optional second way to sign in after the password exists | Phishing-proof, no password typing; still "any phone" because each phone adds its own passkey | L | Medium (more code, iOS/Android differences, bound to the site's host name) | **Approved** (§4.8c, §5.1b, §7 rule 29, §13, AC-54–AC-56) |
| F-81 | **Muster section "On outside work now"** with names and the time of the outside IN | The safety officer knows who is not on site and why | S | Low | Later (M4b shows only the count "On outside work: N") |

### 12.2 Tooling and engineering
| # | Suggestion | Why it helps | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|
| S-45 | **Locust scenario: 50 gate-code scans in one minute** at shift change (Render-like container) | Proves the phone path does not slow the gate rush (NFR-01) | S | Low | Later |
| S-46 | **Playwright mobile project with a fake camera file** (`--use-file-for-fake-video-capture`, a short consented y4m clip of a team member, kept outside the repo, plus a synthetic one in the repo) | Real face-flow e2e tests on a phone viewport | M | Low (face video never in the public repo) | **Approved** (§11, AC-57) |
| S-47 | **Strict Content-Security-Policy and Permissions-Policy for `/phone`** (Vercel headers) | Limits damage of any script injection on the page that holds a session | S | Low (CSP may need tuning for MediaPipe wasm) | **Approved** (§8.2, AC-58) |
| S-48 | **zxcvbn-ts strength meter** (MIT, lazy-loaded only on the password page) | Workers pick better passwords without longer rules | S | Low (about 400 kB lazy, not in the first load) | Later |
| S-49 | **Memory guard test for argon2** (8 parallel sign-ins in the 512 MB container; fails above 450 MB) | Protects Render Free from a login rush | S | Low | **Approved** (§11, AC-59) |

## 13. Dependencies and risks

### 13.1 Dependencies to add
One new backend package, for F-80 (approved). All free; no paid tier exists or is needed. No new frontend
package: the passkey code uses the browser's own WebAuthn API (`navigator.credentials.create` / `.get`)
with a small own base64url helper.
| Package | Version | Licence | Reason |
|---|---|---|---|
| **webauthn** (py_webauthn, Duo Labs; backend) | latest 2.x, pinned in the plan | **BSD-3-Clause** | F-80: makes WebAuthn options and verifies registration and sign-in answers (signature, challenge, origin, RP id, counter). Pure Python; its own dependencies are `cbor2` (MIT), `asn1crypto` (MIT) and `cryptography` (already installed); the plan lists the exact dependency set of the pinned version and its licences before it is added (`uv add`), and a pyOpenSSL dependency, if the pinned version still has one, is Apache-2.0. **Memory:** a few MB of imports, no model, no background thread; a verification is one ECDSA/RSA check (well under 10 ms); measured inside the S-49 memory test (AC-59). **Cost:** free; no outside service, no attestation service, no metadata download (attestation "none") |
| argon2-cffi, cryptography, segno (backend) | already installed | MIT, Apache-2.0/BSD, BSD-3-Clause | Passwords, HMAC/HKDF of gate codes, gate code SVG |
| barcode-detector, MediaPipe Face Landmarker (frontend) | already installed | MIT, Apache-2.0 | Reading the gate code and the ID card; face guidance on the phone |
| time-machine (backend, tests) | approved in M5 | MIT | Pinned times |
| Playwright fake camera, CDP virtual authenticator (e2e) | already installed (Playwright, Apache-2.0) | Apache-2.0 | S-46 and the F-80 tests |

### 13.2 Risks
| Risk | Effect | Mitigation |
|---|---|---|
| Phone front cameras and light vary | More false rejections (`SPOOF_SUSPECTED`, `LIVENESS_FAILED`) than at the gate | Real-device check (§11); retry hints; the gate stays available; thresholds are settings |
| Indoor GPS inside sheds is poor | `GPS_ACCURACY_TOO_LOW` for gate-code scans | Hint "move to an open place"; scanning happens at the gate (usually outdoors); the card still works |
| argon2 memory on 512 MB | Out of memory at a login rush | Semaphore of 2, long sessions (logins are rare), AC-44 |
| Mock-location apps | Fake outside or inside positions | Face on every face punch, selfie on gate-code punches, review of every `OUTSIDE_PLANT` punch (F-72 is Later) |
| A faked position inside another plant's fence is accepted without review (lead, §14 answer 5) | An outside-work employee can avoid the review by faking a position inside any company plant | Only employees with outside work allowed; face match on every punch; the punch log shows "At plant X-280 (own plant K134)" and the Super Admin can filter by channel "Phone"; F-54 repeat hints |
| Passkeys bound to the host name | A move to the client's server breaks passkeys | Password always works; handover guide; passkeys are optional |
| Expired ID cards no longer stop phone punches (lead, §14 answer 4) | A temporary worker who left but is not marked as left keeps punching by phone | "Cards ending soon" list shows "Phone punching on"; marking as left switches everything off |
| A public face-proof endpoint costs CPU | Denial of service on 0.1 CPU | Per IP, per code and global limits; M3 face worker queue limits; proofs are rare |
| Lost `APP_SECRET_KEY` | Codes on screens invalid for up to 30 s; sessions are not affected (stored hashes) | Nothing to restore; documented |
| Two specs in one PR | A big PR, long review | M4b slices after M5 slices, each committed and tested; separate design gates |
| An approved M5 rule changes (inside now) | M5 screens differ from the approved M5 text | Lead approved; already written into the M5 spec (rules 17, 19, 29, note at the top) |

## 14. Open questions for the team
**Answered by the lead on 2026-10-31 and applied above:** (1) option B — every phone punch in the punch log,
"Needs review" only for flagged phone punches and refused ones naming an employee, no `PHONE_PUNCH` flag
(§7 rule 19); (2) passwords 8+ characters, not only digits (§7 rule 6); (3) `phone_max_sessions` = 1 (§7
rule 4); (4) no ID card check for phone punches, but the card proof for a QR worker's first or forgotten
password needs a valid card (§7 rules 5, 11); (5) outside work + inside another Sheet Shapers plant's fence
= accepted without a flag, counted inside that plant for safety, register with the own plant, matched fence
stored (§7 rules 12, 22); the "phone menu" rule of CLAUDE.md §5 is limited to admin pages (§15); the M5
change is approved and written into the M5 spec.

**Also answered (2026-10-31):** (6) yes, the Plant Head of the visited plant sees the visitor's name, code and home plant in the muster and "Inside now" (safety), never in that plant's punch log, attendance or reports; (7) keep "Phone punching on" in the "Cards ending soon" list. No question is open.

_Original question 6:_ **Plant Head of the plant being visited:** a K134 employee standing inside X-280's fence appears in
   X-280's "Inside now" and muster with name, code and home plant (safety), but not in X-280's punch log,
   attendance or reports (§7 rule 22). Is it right that X-280's Plant Head sees the visitor's name in the
   muster? (Recommended: yes, safety needs names at the assembly point.)

## 15. Changes to other documents (made on the branch when this spec is approved)
- **CLAUDE.md** (before the PR; the lead approves the diff):
  - §1 Roles: "employees never log in" → "employees never log in **to the admin website**; an employee whose
    phone punching is ON signs in on `/phone` with employee code + password (decision 0035)". Phone punching
    line: "any phone (no binding), first password by the employee's own face or card proof".
  - §1 Solution / §6 scope: "Optional phone punch per employee (M4b)" gains "built with M5 in one PR";
    "temporary workers scanning the gate's changing QR" → "the gate's phone code (server-signed, 30 s)".
  - §5: new rules "Employee sign-in and admin sign-in never share tables, cookies or endpoints" and "Phone
    punching: face path for face employees, gate-code path for QR employees, never the other way". **Lead's
    answer (2026-10-31):** the rule "every page must be reachable from the phone menu" becomes "every
    **admin** page must be reachable from the phone menu"; the `/phone` pages have their own layout but
    still must fit 360 px and 768 px and be listed in `e2e/tests/responsive.spec.ts`.
  - §4: new backend library `webauthn` (py_webauthn, BSD-3-Clause, F-80).
  - §7: M4b line ticked with the spec link, decision 0035, "built with M5 in one PR".
  - §10: the phone settings of §7 rule 23; "Gate page" paragraph gains the phone code panel; no new
    environment variable (gate-code key derived from `APP_SECRET_KEY`; passkey RP id from
    `APP_PUBLIC_ORIGIN`); "a phone punch inside another plant's fence counts inside that plant for the
    muster, the register stays with the own plant".
- **docs/decisions/0035-m4b-phone-punch.md** (new): the lead's ten decisions of 2026-10-31 and the §14 answers.
- **docs/decisions/0034-m5-attendance-reports.md:** item 1 amended: "M4b is built together with M5 in one
  PR, after the M5 slices (lead, 2026-10-31)".
- **docs/decisions/0005** (note only): item 8 "employees never log in" is replaced for phone punching by
  decision 0035. **docs/decisions/0004** (note only): item 2 "only the employee's registered phone" is
  replaced by "any phone, login + face + location" (decision 0035).
- **docs/specs/M5-attendance-reports.md: DONE** (lead approved, 2026-10-31): a note at the top; §7 rule 17
  leaves `OUTSIDE_PLANT` INs out of "Inside now" and the muster, shows "On outside work: N", and points to
  M4b §7 rule 22 for "the plant of that punch" (`location_plant_id`); rule 19 (F-4) skips them; rule 29
  (F-28) does not count them. M5 stays Approved. (Left for the branch: the M5 §2 out-of-scope words
  "employees never log in" → "employees apply for nothing; phone sign-in is only for punching, M4b".)
- **docs/specs/M4-anti-proxy-offline.md** (note): rule order for phone punches (§7 rules 10, 11 here); flag
  rules compare across channels (§7 rule 14 here); new flag `OUTSIDE_PLANT`.
- **docs/specs/M3-face-attendance.md** (note): `match_mode` gains `one_to_one`; snapshot reason
  `phone_face_rejected`; `EMPLOYEE_NOT_FACE` is now also a phone answer.
- **SRS:** §1.2 / §3.2: employees sign in only on the phone page when phone punching is ON. **FR-43:**
  "the Super Admin" (not "an admin"); plus the outside-work switch with a reason. **FR-44:** "only the
  employee's registered phone" → "any phone; employee code + password (first password by the employee's
  own face or card proof); one phone at a time (setting)"; "face + liveness" → "face + liveness + 1:1 match
  for face employees"; outside the plant only with "Outside work allowed" (optional until date), otherwise
  `OUTSIDE_GEOFENCE`; inside another company plant's fence with outside work: accepted without a tag;
  "Every phone punch appears in the punch review list" → **"Every phone punch appears in the punch log
  (channel 'Phone'); flagged phone punches and refused ones that name an employee appear in 'Needs review'
  (lead, 2026-10-31, option B)"**. **FR-45:** "a changing QR" → "a server-signed phone code that
  changes every 30 seconds; the phone must be inside the plant fence; a selfie is saved". §1.3: "Punch" =
  "at a kiosk **or by phone (M4b)**". §5.b: new `/phone/*` paths and `/kiosk/gate-code`. §11 M4b exit
  criteria per §1 "Done means".
- **docs/architecture.md §5b:** replace the "registered phone with a P-256 key" design by this spec's design
  (employee login, proof, gate code); **§7:** new tables of §6 (`phone_access`, `phone_accounts`,
  `phone_sessions`, `phone_notice_acceptances`, `phone_proofs`, `phone_passkeys`), `punches.channel`,
  `phone_session_id`, `location_plant_id`, nullable `kiosk_id`; remove `employee_phones` and the
  `employees.phone_punch_enabled` column idea.
- **docs/decisions/accepted-extras.md:** an "M4b" section: Approved F-69, F-70, F-73, F-74, F-76, F-80,
  S-46, S-47, S-49; Later F-71, F-72, F-75, F-77, F-78, F-79, F-81, S-45, S-48 (2026-10-31).
- **e2e/tests/responsive.spec.ts:** the `/phone` pages.
- **Gate poster (M2 F-34):** a line "Phone attendance: scan the phone code on the attendance device" only when
  the plant has phone-code workers (small; part of slice "gate panel").
