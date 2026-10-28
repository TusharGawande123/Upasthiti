# M4 – Anti-proxy engine, location on every punch and offline gate sync: Specification

Status: Approved (lead, 2026-10-28) · Author: spec-writer · Date: 2026-10-28
Decisions: the lead's M4 decisions of 2026-10-28 are in
[docs/decisions/0025-m4-anti-proxy-offline.md](../decisions/0025-m4-anti-proxy-offline.md) and are
followed exactly; they are not re-opened here. The lead answered §14 and chose the §12 extras in
chat on 2026-10-28 (approved: F-3, F-36, F-46, F-48, F-53, F-54, F-55, S-38; see §2 item 12).
Related: docs/SRS.md (FR-21, FR-24, FR-25, FR-26, FR-27; NFR-01, NFR-02, NFR-03, NFR-04; §8 edge
cases; §9 demo scenarios 3 and 5; §11 M4 row), docs/architecture.md §2, §3, §4, §5, §6, §7, §9,
docs/specs/M1-foundation.md §7 rules 1, 5, 6, 7, 8, docs/specs/M2-qr-attendance.md (§2 out of
scope, §5.2 punch contract, §6 `punches`, §7 rules 5–8, 10, 12, 17), docs/specs/M3-face-attendance.md
(§5.2 face punch and code path, §7 rules 5, 7, 13, 14, 18), docs/decisions/0005, 0012, 0013, 0016,
0022, 0023, 0025, CLAUDE.md §1, §5, §6, §10, §11.

> Write in simple, clear English. No application code. The gate attendance device is the only
> punch channel in M4 (phone punching is M4b). **Wording rule (decision 0013):** every text people
> read says "attendance device", never "kiosk"; code, API paths and database names keep "kiosk".
> Rejection texts end politely with "Please visit the plant office."

## 1. Problem and goal
M1 checks the gate device's location only once, at pairing. M2 and M3 built the signed punch, the
card and face rules, cool-down and IN/OUT. Three gaps remain:
1. **A paired phone or PC taken home still works** (M2 §2 known gap). Nothing checks where the
   device is when a punch is made.
2. **Suspicious but possible punches have nowhere to go.** The engine can only accept or reject.
   A GPS reading at the fence edge, a card used at two gates a few minutes apart, or an offline
   punch whose time cannot be proven should count, but a person must look at them (FR-26).
3. **No internet = no attendance.** Today the gate says "No internet. Your punch was NOT saved."
   Gate internet in MIDC Waluj is not perfect; NFR-02 asks for up to 72 hours offline.

M4 delivers:
- **location on every punch:** the gate measures its location all the time and pauses punching
  while it has no good reading ("This attendance device needs its location"); the server re-checks
  every punch and rejects no location, a weak reading or a position outside the fence + margin; a
  reading inside the margin at the edge is accepted and **flagged** (decision 0025 item 1);
- a **FLAG outcome** in the engine, with three flag rules: fence edge, **impossible travel** and
  **"same person at two attendance devices within N minutes"** (decision 0012; 0025 item 5);
- an **offline queue** at the gate: card and face punches are signed at capture time, their
  evidence (photo, card text, face pictures, typed code) is **encrypted for the server only**, kept
  on the device until sync, then deleted; the gate shows "Saved – will be confirmed" without a name
  or IN/OUT; the device syncs by itself through a signed batch endpoint; the server re-runs every
  rule with a **proven punch time** (decision 0025 items 2, 6);
- **attendance device status** (online / offline, last punch, saved punches waiting, location) on
  the attendance devices page and in plant readiness (FR-24), with an offline badge, an in-app
  "attendance device offline" alert and a 7-day health history per device (approved extras);
- a **"Needs review" screen** for the Super Admin: flagged and rejected punches with photo, map
  position against the fence, device, time proof, and the two punches side by side for travel
  flags; **confirm / not accepted** for flagged punches and **approve** for rejected punches that
  name an employee, each with a reason, audited, stored in a separate table (decision 0025 items 3,
  4; FR-27).

**Done means (SRS §11 M4 exit criteria and §9 demo scenarios 3 and 5):** on the deployed site,
(a) every security spoof test of §10 AC-34 is refused: an unregistered device gets
`DEVICE_SIGNATURE_INVALID`, a device whose punch reports a position outside the fence gets
`OUTSIDE_GEOFENCE`, a replayed request or offline item is refused; (b) a gate device that loses the
internet for one hour keeps taking card and face punches ("Saved – will be confirmed"), and within
a few minutes of reconnecting every saved punch is in the punch log, accepted, rejected or flagged
correctly, with its proven time and the right IN/OUT; (c) a live punch made during the sync still
gets its answer in under 2 s on the server.

## 2. Scope

**In scope:**
1. **Location on every punch** (FR-25 rule 4; decision 0025 item 1; M1 §7 rule 5 step 6):
   - the gate keeps measuring its location (§7 rule 3) and pauses card scanning and the face button
     while it has no good reading: none, worse than `gps_accuracy_limit_m`, older than
     `kiosk_location_max_age_seconds`, or outside the fence + margin as far as the device can tell;
   - every punch (online and offline) carries the reading; the new rule file `kiosk_location.py`
     reuses the M1 pairing logic (`_check_location` → shared function) and decides **reject**
     (`LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE`, `GEOFENCE_NOT_SET`), **flag**
     (`LOCATION_AT_EDGE`: outside the drawn shape but within the margin) or pass;
   - **no plant network / IP allow-list** (decision 0025 item 7, decision 0005). The IP stays in
     logs only;
   - **offline only:** when the gate is offline and cannot get a new good reading, it keeps using
     its **last good reading of the same page session** for up to `offline_max_hours`; such punches
     get **FLAG `LOCATION_STALE`** (lead, 2026-10-28, §14 answer 1). Online the rule is unchanged.
2. **FLAG outcome in the engine** (FR-26): a rule may return FLAG with a code; the chain continues;
   a punch with flags and no rejection gets decision `flagged`, counts at once as IN/OUT, and its
   `reason_codes` hold the flag codes (§7 rule 2). Database constraints change accordingly (§6).
3. **Flag rules** (FR-25 rule 7; decision 0025 item 5; decision 0012):
   - `impossible_travel.py`: `IMPOSSIBLE_TRAVEL` when the speed between this punch and the same
     employee's nearest punch before or after it, at another place, is above `impossible_travel_kmh`;
   - `two_devices.py`: `TWO_DEVICES_SOON` when the same card or the same employee was used at
     **another attendance device** within `same_person_two_devices_minutes`;
   - both only flag, never reject.
4. **Offline queue and signed sync** (FR-21, NFR-02; decision 0025 items 2, 6):
   - the gate enters offline mode on its own (§7 rule 9), keeps working for card and face punches,
     and shows "Saved – will be confirmed" (no name, no IN/OUT);
   - **offline card punch:** same steps as online (card read, "get ready for your photo", photo);
   - **offline face punch:** the employee code first (code pad), then face pictures with a head
     turn **chosen by the device**; checked at sync with the full M3 face pipeline and a **1:1 match
     against that code**;
   - each queued punch is **signed at capture time** with the device key and its own counter; its
     evidence is sealed for the server only (ECDH P-256 + AES-256-GCM to a server public key);
   - **time proof:** the device keeps the last server time it received (a server-signed time
     anchor) and counts elapsed time with a monotonic clock; the server computes the punch time;
     older than `offline_max_hours` (72) or unproven (device restarted while offline) = **flagged**,
     never rejected; online punches keep server time only;
   - `POST /api/v1/kiosk/sync`: signed batches, per-item results, idempotent by `client_punch_id`,
     replay-safe; the server decides in punch-time order and decides IN/OUT at sync;
   - **queue limits** (count and size), **privacy** (nothing readable on the device; deleted after
     sync), behaviour when the device is **revoked** with a queue (the queue is deleted at once; the
     revoke dialog first shows "N punches are still waiting on this attendance device" so the admin
     can wait for the sync; §14 answer 2);
   - **the gate page loads without internet** after a reload or power cut during an outage
     (service worker app shell via vite-plugin-pwa + Workbox, scope `/attendance` only; §7 rule 13).
5. **Attendance device status** (FR-24): `POST /api/v1/kiosk/heartbeat` (every 60 s, replaces the
   M2 `GET /kiosk/me` poll; same answer) reports saved punches waiting, location state and app
   facts; the attendance devices page and plant readiness show Online / Offline / Needs location /
   Sending saved punches / Switched off, last punch, last sync, saved punches waiting.
6. **"Needs review" screen** `/admin/review` (FR-26, FR-27; decision 0025 items 3, 4; Super Admin
   only, M1 §7 rule 1):
   - tabs "To check" (flagged, not yet reviewed), "Rejected", "Reviewed"; filters; detail panel with
     photo (M2 rules, audited), map (fence version at punch time, margin, point, accuracy circle,
     distance), device, time proof, and the related punch side by side for `IMPOSSIBLE_TRAVEL`,
     `TWO_DEVICES_SOON` and `SYNC_ORDER_CONFLICT`;
   - **Confirm** or **Not accepted** (reason required) for a flagged punch; **Approve** (reason
     required, IN/OUT chosen by the Super Admin, server suggestion shown) for a rejected punch that
     names an employee; reviews are a separate append-only table, audited; punch rows never change.
7. **Punch log, export, dashboard, Ctrl+K additions** (§4.9–§4.12): flagged and offline columns
   and filters; review state (read-only text for the Corporate Head and Plant Head, §14 answer 4);
   "Needs review" sidebar entry with count; dashboard cards.
8. **Reason and flag code catalogue** (§7 rule 18): every new code has an English text under
   `kiosk.punch.<CODE>.*` (gate), `punchReasons.<CODE>` (admin) and `errors.<CODE>` (admin errors);
   `npm run i18n:check` enforces it.
9. **Settings** (§7 rule 17): `impossible_travel_kmh` becomes editable; new keys with defaults;
   `CURRENT_MILESTONE` = 4.
10. **New required production secret** `OFFLINE_EVIDENCE_KEY` (+ optional `OFFLINE_EVIDENCE_KEY_ID`)
    and the command `make_offline_key` (§8.2).
11. **Raise the coverage floor** from 80% to **82%** (backend and frontend).
12. **Approved extras (lead, 2026-10-28; details §12, acceptance criteria AC-37 to AC-44):**
    - **F-36** offline badge in the admin top bar and on the "Attendance devices" sidebar entry (§4.7);
    - **F-46** in-app "attendance device offline" alert for the Super Admin and the plant's Plant
      Head when a device is offline for `kiosk_offline_alert_minutes` during a shift (§4.7, §7 rule 20);
    - **F-55** gate "last sync" line for guards (§4.2);
    - **F-53** "Why paused?" fence sketch on the gate's needs-location screen (§4.1);
    - **F-3** attendance device health monitor+: battery, camera, storage, app version and a 7-day
      online/offline timeline from a small `kiosk_heartbeats` table kept 7 days (RLS + deny_all,
      purged by the daily job) (§4.7, §6, §7 rule 20);
    - **F-48** daily review digest card on the dashboard (§4.10, §5.3);
    - **F-54** repeat-pattern hints on the review screen (§4.8, §7 rule 20);
    - **S-38** gate storage self-check: offline saving is switched off on a device whose storage
      quota is too small, and this is shown on the devices page (§4.6, §7 rule 12).
13. **Changes to other documents** (§15), made on the milestone branch when this spec is approved.

**Out of scope (not in M4):**
- **Phone punching** and the temporary workers' phone scan of the gate QR (FR-43–FR-45): M4b. The
  location rule and the review screen are written so M4b can reuse them (`outside_plant` tag).
- **Plant network / IP allow-list**: dropped for good (decisions 0005, 0025 item 7).
- **Attendance days, regularisation, reports** (FR-28–FR-35): M5. M5 reads `punches` +
  `punch_reviews` and **must show review approvals and regularisations together** (decision 0025
  item 4); M4 builds no attendance day.
- **Email alerts** for an offline device or many rejections (FR-41): M5 (F-7, SMTP). M4 has the
  in-app alert only (F-46).
- **Extras not chosen** (lead, 2026-10-28): Later: F-45 offline drill mode, F-47 location drift
  chart, F-49 review shortcuts and bulk confirm, F-50 sync history, F-52 flag every offline face
  punch, S-34 outage simulation helper, S-35 spoof-test tool and checklist (the AC-34 attack tests
  stay core in pytest), S-36 property tests, S-37 sync load test. Rejected: F-51 "retire after sync".
- **Office-verified punch for a person with no evidence** (F-44): Later, inside M5 regularisation.
  M4's approval needs an existing rejected punch that names an employee.
- **Offline self-test answer from the server**: a test card scanned offline shows "No internet"
  and is never queued.
- Key rotation tooling for `OFFLINE_EVIDENCE_KEY` (the stored key id letter makes it possible later).
- Detecting a faked browser location (developer tools, mock-location apps): not possible from a web
  page; recorded as an accepted risk (§8.3).
- Marathi and Hindi texts (all text i18n-ready); salary (M7); every future-scope item in CLAUDE.md §1.

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | have every punch checked against the plant's fence | a gate phone or PC taken home cannot mark attendance | FR-25 r4 |
| US-2 | Worker at the gate | see clearly when the attendance device is not ready ("needs its location") instead of being rejected | I do not stand there wondering what I did wrong | FR-20 |
| US-3 | Worker | punch with my card or face while the internet is down and see "Saved – will be confirmed" | my attendance is not lost | FR-21 |
| US-4 | Permanent employee | punch by typing my code and showing my face when the internet is down | I am not sent to the office every time the network fails | FR-21 |
| US-5 | Super Admin | trust the time of an offline punch, or see clearly that it is unproven | nobody fakes a punch time by changing the device clock | FR-26, NFR-02 |
| US-6 | Super Admin | see flagged punches (fence edge, two devices, impossible travel, old or unproven offline time) and confirm them or mark them "Not accepted" with a reason | suspicious punches are checked, not silently accepted | FR-26, FR-27 |
| US-7 | Super Admin | approve a rejected punch that names an employee, choosing IN or OUT, with a reason | a genuine worker wrongly refused is counted, with a trail | FR-27 |
| US-8 | Super Admin | see the photo, the map position against the fence and the two punches side by side | I can decide in seconds | FR-27 |
| US-9 | Super Admin / Plant Head / Corporate Head | see which attendance devices are online, offline, waiting to send saved punches or missing their location | a dead or moved gate device is noticed before workers queue | FR-24 |
| US-10 | Plant Head | see "Attendance device online" and "Location good" in plant readiness | I know my gate is ready each morning | F-17, FR-24 |
| US-11 | Worker / employee | know that nothing readable is kept on the gate device | my photo, face and code are not exposed if the device is stolen | NFR-04 |
| US-12 | Team / examiners | run the proxy-from-home and 1-hour-outage demos and see the right results | the anti-proxy claim is proven | SRS §9 (3, 5) |
| US-13 | Attendance device | send only signed evidence and let the server decide, also after an outage | a hacked device cannot decide a punch or its time | FR-25 |
| US-14 | Super Admin / Plant Head | get an alert in the admin website when my plant's attendance device has been offline for 10 minutes during a shift | someone fixes it before the shift change | F-46, F-36 |
| US-15 | Super Admin / Plant Head | see a device's battery, camera, storage and its online/offline timeline of the last 7 days | gate problems are found without a site visit | F-3 |
| US-16 | Super Admin | see yesterday's flagged and rejected punches per plant on the dashboard and hints such as "rejected 3 times this week" | review is a short morning habit and repeat problems stand out | F-48, F-54 |
| US-17 | Guard at the gate | see "All punches sent ✓ 09:02" or "12 waiting since 08:05" | I can tell the office at once that punches are waiting | F-55 |

## 4. Screens and UX (light, modern, premium; English first)
The M1–M3 rules apply (states, en-IN formats, icon + word, keyboard, role-based hiding, every
screen fits 360 px and 768 px without sideways scrolling, every page reachable from the phone menu
and listed in `e2e/tests/responsive.spec.ts`). Gate screen rules: text at least 24 px, touch targets
at least 64 px, contrast 7:1, colour + icon + word, honest connection messages, all text from the
translation file, the word "attendance device" in every text people read. Design gates (images,
approved in the plan step like M2/M3): **Gate A** gate screens (§4.1–§4.6); **Gate B** "Needs
review" list, detail panel, map, side-by-side, review dialogs (§4.8); **Gate C** attendance devices
page status, readiness card, punch log additions, dashboard cards, settings cards (§4.7, §4.9–§4.12).
Gate A (approved 2026-10-28, decision 0026): [docs/design-refs/m4/gate-a/index.html](../design-refs/m4/gate-a/index.html). Gate B and Gate C links are added once approved.

### 4.1 Gate screen: location (`/attendance`)
- **Starting:** after load the gate shows its normal scanning screen with a small chip
  "◌ Finding location…" for up to 20 s; card scanning and the face button wait for the first good
  reading (no punch can be sent without one).
- **Top bar chip** (next to the M2 connection chip): "📍 Location good (±12 m)" (green) /
  "📍 Location weak (±140 m)" (amber) / "📍 No location" (red). Icon + word + colour.
- **"Needs its location" screen** (decision 0025 item 1), shown while there is no good reading for
  more than 10 s; replaces the camera area; card scanning paused, face button hidden:
  - title **"This attendance device needs its location"**, line "Punching is paused. Please wait a
    moment. If this stays, please visit the plant office.";
  - one plain cause line with an icon, from the gate-only codes of §7 rule 18:
    - location blocked in the browser (`LOCATION_DENIED`): "Location is blocked for this website.
      Ask the plant office to allow it." + the setup-guide steps link for the admin (small text);
    - location off or unavailable (`LOCATION_UNAVAILABLE`): "Location is switched off or not
      available on this attendance device.";
    - too weak (`LOCATION_WEAK`): "Waiting for a better location signal (now ±140 m, needed ±50 m).";
    - outside (`LOCATION_OUTSIDE`): "This attendance device does not seem to be at the plant gate.";
  - "For the admin: LOCATION_WEAK" line (decision 0006);
  - **"Why paused?" sketch (F-53):** a small drawing (plain SVG, no map tiles, no internet needed)
    of the fence outline, the dashed margin and the device's point with its accuracy circle, plus
    the line "±140 m now, ±50 m needed" or "about 60 m outside the fence"; shown only when a reading
    exists; for the installer, not a map;
  - it disappears by itself as soon as a good reading arrives; no tap needed.
- **Offline with no new reading** (§14 answer 1): the gate keeps using its last good reading of the
  same page session (up to `offline_max_hours`) instead of pausing; the location chip shows
  "📍 Last location (offline)". After a reload during the outage there is no reading of this session,
  so the gate pauses until a new good reading arrives.
- The check on the device is only a guide so workers are not rejected for nothing; the server
  decides every punch again (§7 rule 4).

### 4.2 Gate screen: offline banner and status
- **Connection chip** (M2): "● Online" / "⚠ No internet – punches are saved" (amber).
- When saved punches wait: a chip **"⏳ 12 saved"**; while sending: **"↑ Sending saved punches… 12
  left"**. No names, no results.
- **Last sync line for guards (F-55)**, always in the footer (`kiosk.offline.lastSync`): "All punches
  sent ✓ 09:02" when the queue is empty, or "12 punches waiting since 08:05" (oldest item's time from
  the anchor clock). Counts and times only.
- The live clock keeps running from the last server time + elapsed time (§7 rule 8), with
  "(offline)" after it.
- Footer privacy line (`kiosk.footer.privacy`) gains one sentence: "When the internet is down, your
  punch is saved on this attendance device in a locked form that only our server can open, and it
  is deleted from the device once it is sent." (also on the gate poster, §8.1).

### 4.3 Gate screen: offline card punch
- Same steps as online (M2 §4.3): card read → "Card read. Get ready for your photo." → photo.
- Card format check on the device only (`UPS1.` prefix, M2); the card is not judged offline.
- "Already saved" hint: the same card read again within `punch_cooldown_minutes` on this device
  while offline shows the amber "Already saved at 08:02. No need to punch again." and saves nothing
  (kept in memory only; the server would reject it as `COOLDOWN_ACTIVE` anyway).
- Result: §4.5.
- A **test card** offline shows "Attendance device test: Camera ✓ · Location ✓ · Internet ✗" and
  "No attendance was recorded." Nothing is queued.

### 4.4 Gate screen: offline face punch (decision 0025 item 2)
- "Punch with face" stays visible offline when the last `/kiosk/me` answer said the plant has
  enrolled face employees.
- **Step 1, code pad first** (the M3 pad, §4.5 of M3): amber ⓘ, title **"Type your employee code"**,
  line "No internet right now. Type your code, then look at the camera." Prefix keys from the last
  `/kiosk/me`. The code is checked only for its form (1–12 letters, digits, `-`, `/`); the device
  has no employee list and shows no name.
- **Step 2, face guidance and challenge** as M3 §4.2–§4.3, but the head-turn direction (and order,
  when `face_challenge_steps` = 2) is **chosen by the device** with a secure random number.
- **Step 3:** frames are sealed and saved (§7 rule 10); result §4.5.
- "Cancel" at any step saves nothing; nothing is kept from a cancelled attempt.
- An online face punch whose request fails for the network is not queued (its server challenge
  cannot be checked later): the gate shows "No internet. Type your employee code to save your
  punch." and goes to Step 1 by itself.

### 4.5 Gate screen: "Saved – will be confirmed"
| Result | Colour + icon + word | Main text | Voice (F-1) | Shown for |
|---|---|---|---|---|
| Saved offline (`OFFLINE_SAVED`, gate-only) | slate blue, ⏳ cloud-check icon, **SAVED** | "Saved – will be confirmed" + "Your punch is saved on this attendance device. It will be checked when the internet is back." + the time (server-based clock) | "Saved." | `kiosk_result_seconds` |
| Already saved (offline, same card) | amber ⓘ **ALREADY SAVED** | "Already saved at 08:02. No need to punch again." | "Already saved." | 4 s |
| Storage full (`QUEUE_FULL`) | red ✗ **NOT SAVED** | "This attendance device cannot save more punches. Your punch was NOT saved. Please visit the plant office." | "Not saved. Please visit the plant office." | `kiosk_reject_seconds` |

- Never a name, never IN or OUT, never a guess of the result (the device cannot know it).
- Workers are not told later what happened to an offline punch (they have left the gate); the plant
  office sees rejected offline punches in "Needs review". The poster says so (§8.1).

### 4.6 Gate screen: queue warnings and revoked device
- At 80% of `offline_queue_max_items` or `offline_queue_max_mb`: amber line "Storage almost full –
  please restore the internet." At 100%: every punch shows the "NOT SAVED" result of §4.5 until
  space is free (sync).
- The device asks the browser for persistent storage at start (`navigator.storage.persist()`); the
  answer is reported in the heartbeat; "not persisted" shows on the devices page (§4.7) as a hint.
- **Storage self-check (S-38):** at start the gate reads `navigator.storage.estimate()`. When the
  free quota is smaller than `offline_queue_max_mb` + 50 MB, offline saving is switched off on this
  device: offline, a punch shows red ✗ **NOT SAVED** "This attendance device cannot save punches
  without internet. Your punch was NOT saved. Please visit the plant office."
  (`OFFLINE_STORAGE_TOO_SMALL`); the devices page shows "Offline saving off: not enough storage".
- **Revoked while punches are waiting** (§7 rule 12; §14 answer 2): the M1 revoked screen plus "12
  saved punches could not be sent. Please visit the plant office." The saved punches are then
  deleted from the device at once.

### 4.7 Admin: attendance devices page and plant readiness (FR-24)
- **Status column** with icon + word: ● **Online**, ○ **Offline since 08:12** (no contact for
  `kiosk_offline_after_minutes`), ⚠ **Needs location** (online, but its last heartbeat says no good
  reading), ↑ **Sending saved punches (12)**, ⊘ **Switched off** (revoked), ◌ **Waiting for pairing**.
- New columns: last contact ("2 min ago"), last punch (time, IST), saved punches waiting (count and
  oldest time, from the last heartbeat; "–" when 0), last sync, location (±m and "inside" /
  "edge" / "outside" from the last heartbeat), app version.
- Device detail drawer: the same facts + "Storage kept by the browser: Yes / No" + a small map with
  the last reported position and the fence (Super Admin and own Plant Head; the Corporate Head sees
  the drawer without the map).
- **Health monitor+ (F-3)** in the drawer, for all roles in scope: battery (level and "charging",
  or "Not reported" when the browser has no battery information), camera ("Working" / "Not
  working"), storage (used / free, "Offline saving ready" or "off: not enough storage", S-38), app
  version, and a **7-day timeline** bar per day with online (green) and offline (grey) stretches,
  plus "Online 96% of shift time this week".
- **Revoke dialog** (M1 dialog, §14 answer 2): when the device's last heartbeat reported waiting
  punches, an amber line "12 punches are still waiting on this attendance device. If you switch it
  off now, they are lost. Wait until it shows 0 if you can." Revoking stays allowed (a stolen device
  must be switched off at once).
- **Offline badge (F-36):** a small "⚠ 1 attendance device offline" badge in the admin top bar and
  a count on the "Attendance devices" sidebar entry, for all roles in their scope; it links to the
  devices page filtered "Offline". Hidden when all are online.
- **Offline alert (F-46):** for the Super Admin (all plants) and the Plant Head (own plant): an
  amber banner at the top of every admin page "Attendance device 'TP1 Gate' has been offline since
  08:12 (14 min). Check its power and internet." with "View" and "Hide". It shows when a device has
  been offline for `kiosk_offline_alert_minutes` while one of its plant's shifts is running; "Hide"
  hides it on this browser until the device comes back online. Not shown to the Corporate Head.
- **Plant readiness card** (F-17) gains two lines: "Attendance device online" (✓ when at least one
  active device of the plant is online) and "Location good" (✓ when that device's last reading is
  inside). Corporate Head and Plant Head see the same, in their scope.
- Auto-refresh every 30 s while open.

### 4.8 Admin: "Needs review" (`/admin/review`, Super Admin only)
- **Sidebar entry** "Needs review" with a count badge (flagged punches not yet reviewed, all
  plants); Ctrl+K "Needs review", "Rejected punches". Corporate Head and Plant Head do not see the
  entry; the URL answers `FORBIDDEN` for them (M1 §7 rule 1 row "Review rejected / flagged punches").
- **Tabs:** "To check (7)" = flagged without a review; "Rejected" = rejected punches (hides
  `COOLDOWN_ACTIVE` unless "Show already-punched" is ticked; `needs_code` rows never shown);
  "Reviewed" = punches with a review, newest review first.
- **Filters:** date range (default last 7 days, IST), plant, attendance device, code (flag or
  reason), method (card / face), saved offline (yes / no), employee (code or name), "names an
  employee" (rejected tab).
- **List row:** time (punch time; offline rows show "saved offline, sent 52 min later"), employee
  (code, name, or "Unknown"), plant, device, method, result + codes (icon + translated text),
  "Photo" state as text (no thumbnails: every view is audited, M2).
- **Detail panel** (side sheet on desktop, full screen on a phone):
  - summary: decision, codes with plain explanations, IN/OUT as decided, employee, device, plant;
  - **time:** server receive time; for offline punches the proven punch time, "Time proof:
    anchored to server time" or "⚠ Time not proven (device restarted while offline)", and the delay;
  - **map** (Leaflet, OpenStreetMap / Esri satellite toggle, decision 0014; loaded lazily): the
    fence version that was current at the punch time, the margin ring, the punch point, its accuracy
    circle, and the line "18 m outside the drawn fence, inside the 25 m margin";
  - **photo:** "View photo" (M2 dialog, audited; M3 rules for face photos);
  - **related punch** for `IMPOSSIBLE_TRAVEL`, `TWO_DEVICES_SOON`, `SYNC_ORDER_CONFLICT`: the two
    punches side by side (time, device, plant, method, decision, "View photo" each audited) and the
    map with both points, the distance and the speed ("2.4 km in 3 min = 48 km/h; limit 60");
  - **history:** earlier reviews of this punch (who, when, action, reason);
  - **repeat-pattern hints (F-54)**, shown as amber info lines when they apply (last 7 days):
    "EMP-0123 was rejected 3 times this week" (link: those punches), "This attendance device had 24
    fence-edge flags this week – check its location or the fence margin" (link: those punches),
    "This card was used at two attendance devices 2 times this week". Hints only; nothing is blocked.
- **Actions** (buttons at the bottom; keyboard reachable):
  - flagged punch: **"Confirm"** (optional note) and **"Not accepted"** (reason 3–300 characters,
    required; warning "This punch will no longer count as IN/OUT.");
  - rejected punch that names an employee (card read, code typed or face matched): **"Approve"**:
    dialog with "Count as IN" / "Count as OUT" (the server's suggestion pre-selected and labelled
    "Suggested"), reason 3–300 characters, and a warning when another counted punch of the same
    person is within the cool-down ("There is a counted OUT at 08:03.");
  - rejected punch that names nobody: no action; text "No employee is known for this punch.";
  - a reviewed punch: **"Change review"** (adds a new review; the old one stays in history).
- **Empty states:** "Nothing to check. Well done." / "No rejected punches in these dates."
- After an action the next row opens (fast review of a queue).

### 4.9 Admin: punch log (M2/M3 page) additions
- Result column shows ⚑ **Flagged** (amber) next to ✓ IN / OUT for flagged punches, with the flag
  texts; a review mark: "✓ Confirmed", "✗ Not accepted", "✓ Approved as IN".
- "Saved offline" mark (⏳ icon + "Offline, sent 09:02") on offline punches; the time column shows the
  punch time; the detail shows both times.
- New filters: "Flagged", "Saved offline", "Review: to check / confirmed / not accepted / approved".
- Chips add "⚑ Flagged n" and "⏳ Offline n".
- All three roles see these marks and texts in their scope (read-only, as M2); only the Super Admin
  sees actions (they open the review panel) (§14 answer 4).
- Excel export (F-35) gains columns "Punch time", "Saved offline", "Flags", "Review".

### 4.10 Admin: dashboard
- Card **"To check: 7 flagged punches"** with a link to "Needs review" (Super Admin).
- Card **"Attendance devices: 6 online · 1 offline · 0 need location"** (all roles in scope),
  linking to the devices page filtered by state.
- **Daily review digest card (F-48, Super Admin):** "Yesterday (27/10/2026)" with one row per plant:
  flagged n, rejected with an employee n, still to check n, attendance device offline during shifts
  (for example "2 h 10 min"); links open "Needs review" with that plant and date. A date arrow shows
  earlier days (up to 7 days back, the health history).

### 4.11 Admin: settings cards
- Card **"Location and anti-proxy"**: `gps_accuracy_limit_m` (now also per punch),
  `geofence_default_buffer_m`, `kiosk_location_max_age_seconds`, `kiosk_location_refresh_seconds`,
  `impossible_travel_kmh`, `impossible_travel_min_distance_m`, `same_person_two_devices_minutes`,
  `review_hint_employee_rejections`, `review_hint_device_edge_flags`.
- Card **"Offline attendance devices"**: `offline_max_hours`, `offline_queue_max_items`,
  `offline_queue_max_mb`, `offline_clock_drift_seconds`, `kiosk_offline_after_minutes`,
  `kiosk_offline_alert_minutes`.
- Each change needs a reason (M1). A warning on `gps_accuracy_limit_m` and the fence margin:
  "Plants in MIDC Waluj are close together. A larger value may let a device at a neighbouring plant
  punch here."

### 4.12 Gate poster (F-34) update
- Adds: "No internet? Your punch is saved and checked later. If something is wrong, the plant
  office will tell you." and the offline privacy sentence of §4.2.

## 5. API contract
Conventions as M1–M3: REST under `/api/v1`, JSON, error format
`{ "error": { "code", "message", "details" } }`, pagination `?page=&page_size=`, Origin check on user
writes, plant scope inside each query, out-of-scope single records → `NOT_FOUND`. Each code is the
translation key: `errors.<CODE>` in the admin, `kiosk.punch.<CODE>.*` at the gate,
`punchReasons.<CODE>` in the punch log and review screen. Kiosk requests are signed (M1 §7 rule 6).
All times ISO 8601 UTC.

### 5.1 Gate: changed endpoints (additive)
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/punch/kiosk | kiosk (signed) | M2/M3 body; **`location: { lat, lon, accuracy_m, age_s }`** is now needed for a decision (still optional in the schema, so an old gate gets the stored rejection `LOCATION_REQUIRED`, not a 422); `age_s` (0–600 for online punches, new, informational) | M2/M3 response **plus** `time_anchor: { token, server_time }` (§7 rule 8). **A flagged punch answers `decision: "accepted"`** (the gate shows the normal IN/OUT screen; flags are for the admin only). `details` may carry `location: { distance_m }` on `OUTSIDE_GEOFENCE` | as M2/M3 |
| POST | /api/v1/punch/kiosk/code | kiosk (signed) | as M3 | as M3 **plus** `time_anchor`; the final row uses the location of its `needs_code` row; flagged → `"accepted"` | as M3 |
| POST | /api/v1/punch/challenge | kiosk (signed) | as M3 | as M3 **plus** `time_anchor` | as M3 |
| GET | /api/v1/kiosk/me | kiosk (signed) | – | M1–M3 fields **plus** `time_anchor`; `kiosk_settings.location: { accuracy_limit_m, max_age_seconds, refresh_seconds, geofence: { version_id, shape, geojson, radius_m, buffer_m } }`; `kiosk_settings.offline: { enabled: bool, evidence_key_id, evidence_public_key (base64url, 65-byte uncompressed P-256 point), max_items, max_mb, max_hours, cooldown_minutes, sync_max_items: 20, sync_max_bytes: 1048576 }` (`enabled` false when `OFFLINE_EVIDENCE_KEY` is not set, development only) | as M1 |

Notes:
- The punch's `device_time` stays informational and is never used for an online punch.
- **Self-test** (F-27) answers gain `details.location_check: "ok" | CODE` (the location rule's verdict,
  nothing stored); the gate shows "Location ✓" or "Location ✗".

### 5.2 Gate: new endpoints
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/kiosk/heartbeat | kiosk (signed) | `{ queue: { count (0–100000), bytes (0–2^40), oldest_punch_at? (device estimate, informational) }, location: { state: "good"\|"weak"\|"none"\|"denied"\|"outside"\|"stale", lat?, lon?, accuracy_m?, age_s? }, storage: { persisted: bool\|null, quota_mb?, usage_mb?, offline_ready: bool } (S-38), battery: { level (0–1), charging: bool } \| null, camera_ok: bool\|null (F-3), app_version }` (≤ 2 KB) | `200` = the `GET /kiosk/me` body (so one call per minute does both) | `DEVICE_*`, `VALIDATION_FAILED`, `TOO_MANY_REQUESTS` (more than 6 a minute per kiosk) |
| POST | /api/v1/kiosk/sync | kiosk (signed; the request's own counter must grow as usual) | `{ items: [ { counter (int), signed_item (string: the exact JSON text the device signed, §7 rule 11), signature (base64url, ECDSA P-256 over the item statement) } ] (1–20 items), app_version }`; body ≤ 1 MB | `200 { results: [ { client_punch_id \| null, result: "saved"\|"already_saved"\|"retry_later"\|"refused", punch_id?, decision?: "accepted"\|"rejected" (flagged → "accepted"), reason_code? } ], server_time, time_anchor }` in the order received | request-level: `DEVICE_SIGNATURE_INVALID`, `NONCE_REUSED`, `DEVICE_REVOKED`, `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (more than 30 sync requests a minute per kiosk), `OFFLINE_NOT_CONFIGURED` (503, development), `INTERNAL_ERROR` |

**Signed item** (the JSON text inside `signed_item`, parsed only after its signature is verified):
`{ v: 1, client_punch_id (uuid), method: "qr"|"face", challenge?: "turn_left"|"turn_right"|"left_then_right"|"right_then_left" (face only), time: { anchor_token, anchor_server_time, elapsed_ms (monotonic), wall_elapsed_ms (device clock), same_session: bool, device_time }, location: { lat, lon, accuracy_m, age_s (0 – offline_max_hours × 3600) }, evidence: { key_id, ephemeral_public_key, nonce, ciphertext } (base64url), app_version }`.
Sealed evidence after decryption: card `{ qr_payload, snapshot_jpeg }` (M2 limits); face
`{ employee_code, frames: [ { role, jpeg } ] }` (M3 limits: 2–4 frames, ≤ 70 KB each).

Per-item results:
- `saved`: a new punch row was decided (accepted / flagged / rejected).
- `already_saved`: the same `(kiosk, client_punch_id)` exists (an online request that did arrive, or
  an earlier sync whose answer was lost); its stored decision is returned. Nothing new is written.
- `retry_later`: not decided now (face worker busy, the 20 s time budget of the request used up, or
  storage of the photo timed out before the transaction); the device keeps the item.
- `refused`: the item can never be decided (bad signature, bad counter, unreadable form, sealed for
  another kiosk); `reason_code` = `ITEM_SIGNATURE_INVALID` / `ITEM_COUNTER_INVALID` /
  `ITEM_INVALID`; no punch row; audit `kiosk.sync_item_refused`; the device deletes the item.
- The device deletes items with `saved`, `already_saved` and `refused`, keeps `retry_later`.

### 5.3 Admin: review
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/reviews | Super Admin | `tab=to_check\|rejected\|reviewed`, `date_from, date_to` (IST days, at most 62 days), `plant_id, kiosk_id, code, method, was_offline, employee_id, q, names_employee, include_cooldown`, page | page of `{ punch: (punch log item + punch_time, was_offline, time_proof, reason_codes), latest_review: { id, action, direction?, reason?, reviewed_by: { id, name }, reviewed_at } \| null, approvable: bool }` | `VALIDATION_FAILED` (range too long) |
| GET | /api/v1/reviews/summary | Super Admin | `plant_id?` | `200 { to_check, rejected_last_7_days, by_code: { CODE: n } }` (badge, dashboard) | – |
| GET | /api/v1/punches/{id}/review-context | Super Admin | – | `200 { punch (full detail incl. location, time proof, offline delay), geofence: { version_id, shape, geojson, radius_m, buffer_m, was_current_at_punch_time: true } \| null, distance_m \| null, related: [ { punch (detail), relation: "travel"\|"two_devices"\|"order", distance_m, minutes_apart, speed_kmh } ], suggestion: { direction: "in"\|"out" } \| null (rejected + names an employee), nearby_counted: [ { punch_id, punch_time, direction } ] (same employee within the cool-down), reviews: [ … history ], hints: [ { kind: "employee_rejections"\|"device_edge_flags"\|"card_two_devices", count, days: 7, filter (query for the linked list) } ] (F-54) }` | `NOT_FOUND`, `FORBIDDEN` |
| GET | /api/v1/reviews/digest | Super Admin | `date` (IST day, default yesterday, at most 7 days back) | `200 { date, plants: [ { plant: { id, code, name }, flagged, rejected_with_employee, to_check, device_offline_minutes_in_shifts } ] }` (F-48; offline minutes from `kiosk_heartbeats`) | `VALIDATION_FAILED` |
| POST | /api/v1/punches/{id}/reviews | Super Admin | `{ action: "confirm"\|"not_accepted"\|"approve", reason? (3–300; required for not_accepted and approve; optional note for confirm, ≤ 300), direction? ("in"\|"out", required for approve), expected_latest_review_id (uuid\|null: the review the screen showed) }` | `201 { review }` | `REVIEW_NOT_ALLOWED` (409: e.g. confirm on a rejected punch, approve on a flagged one, a `needs_code` row, `COOLDOWN_ACTIVE`), `REVIEW_NO_EMPLOYEE` (409: approve on a rejected punch that names nobody), `REVIEW_CHANGED` (409: someone reviewed it meanwhile; reload), `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN` |

### 5.4 Admin: changed endpoints (additive)
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/kiosks | as M1 | **additive filter** `state=online\|offline\|needs_location\|sending\|revoked\|pending` | items gain `state`, `last_contact_at`, `last_punch_at`, `last_sync_at`, `queue: { count, bytes, oldest_punch_at } \| null`, `location: { state, accuracy_m, at, inside: "inside"\|"edge"\|"outside"\|null }`, `storage: { persisted, quota_mb, usage_mb, offline_ready }`, `battery: { level, charging } \| null`, `camera_ok`, `app_version`; Super Admin and own Plant Head also `location.lat/lon` (rounded to 5 decimals). The revoke dialog uses `queue.count` | as M1 |
| GET | /api/v1/kiosks/status-summary | Super Admin, Corporate Head (all), Plant Head (own plant) | – | `200 { online, offline, needs_location, sending, alerts: [ { kiosk: { id, name }, plant: { id, code, name }, offline_since } ] }`; `alerts` (F-46) only for the Super Admin and the Plant Head, empty for the Corporate Head (F-36 badge, dashboard card; polled every 60 s by the admin shell) | – |
| GET | /api/v1/kiosks/{id}/health | as the kiosks list (scope) | `days` (1–7, default 7) | `200 { days: [ { date, online_minutes, offline_minutes, shift_minutes, stretches: [ { from, to, state: "online"\|"offline" } ] } ], latest: { battery, camera_ok, storage, app_version, at } }` (F-3) | `NOT_FOUND` |
| GET | /api/v1/plants/{id}/readiness | as M1 | – | **additive:** `device_online: bool`, `location_good: bool` | as M1 |
| GET | /api/v1/punches | as M2/M3 | **additive filters** `flagged=true`, `was_offline=true`, `review_state=to_check\|confirmed\|not_accepted\|approved`; the `date` filter uses the punch time | items gain `punch_time`, `was_offline`, `review_state`, `review_direction?`; `decision` may be `"flagged"` | as M2 |
| GET | /api/v1/punches/summary | as M2/M3 | as M2 | **additive:** `flagged`, `offline`, `to_check` (Super Admin only) | – |
| GET | /api/v1/punches/{id} | as M2/M3 | – | **additive:** `punch_time`, `was_offline`, `time_proof: "anchored"\|"unproven"\|null`, `offline_delay_seconds`, `geofence_distance_m`, `location_age_s`, `related_punch_id`, `reviews` (Super Admin: full; others: latest action + direction only, no reason) | as M2 |
| GET | /api/v1/punches/export.xlsx | as M2 | as the list | additive columns of §4.9 | as M2 |
| GET/PUT | /api/v1/settings | as M1 | the keys of §7 rule 17 | as M1 | `SETTING_INVALID` (§7 rule 17 cross-checks) |
| GET | /api/v1/dashboard cards | as M1–M3 | – | additive card data of §4.10 (exact endpoint chosen in the plan; reuses `/reviews/summary` and the kiosks list) | – |

Common errors for all admin endpoints: as M1 (`NOT_AUTHENTICATED`, `FORBIDDEN`,
`ORIGIN_NOT_ALLOWED`, `VALIDATION_FAILED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`).

## 6. Data model changes
Conventions as M1–M3: UUID `id`, `created_at` / `updated_at` `timestamptz` (UTC), constraint names
per the M0 convention. The last migration is `0014_five_enrolment_poses`, so M4 starts at **0015**.
**Every new table gets, in the migration that creates it,
`ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY deny_all ON <name> FOR ALL USING (false) WITH CHECK (false)`**, no grants to anon;
every new trigger function has `SET search_path = ''` (CLAUDE.md §5, decision 0007);
`tests/test_row_level_security.py` covers the new tables (`punch_reviews`, `kiosk_heartbeats`). **No database view is created** for
"counted punches": Supabase would expose a view over its API and a view runs with its owner's
rights, which ignore RLS; the rule lives in one service function instead (§7 rule 6).

Hard deletes: `punches`, `punch_reviews` and `audit_logs` are append-only (triggers refuse UPDATE
and DELETE). `kiosk_devices` status columns are updated in place (setup data, not records). The only
rows deleted by design are `kiosk_heartbeats` older than 7 days (F-3): device health samples, not
attendance, audit or employee records.

**Migration `0015_punch_time_flags_and_offline`**
| Table | Columns (type) | Keys / indexes / constraints |
|---|---|---|
| `punches` (change) | + `offline_punch_time` (timestamptz null: the server-computed time of an offline punch), + `time_proof` (text null: `anchored` / `unproven`), + `device_counter` (bigint null: the counter the device reserved at capture, offline items only), + `location_age_s` (integer null: seconds; up to `offline_max_hours` × 3600 for a stale offline reading), + `geofence_id` (FK geofences null: the fence version used), + `geofence_distance_m` (numeric(7,1) null: 0 inside the drawn shape), + `related_punch_id` (FK punches null: the other punch of a travel / two-devices / order flag), + **`punch_time`** (timestamptz, **generated always as `COALESCE(offline_punch_time, server_received_at)` stored**) | change `ck_punches_accepted_has_direction` to `decision NOT IN ('accepted', 'flagged') OR direction IS NOT NULL`; `ck_punches_reason_codes_match_decision` **stays as it is** (`(decision = 'accepted') = (cardinality(reason_codes) = 0)`: a flagged row has ≥ 1 flag code, a rejected row has its rejection code first and may add flag codes collected before it); new check `was_offline = (offline_punch_time IS NOT NULL)`; new check `(time_proof IS NULL) = (NOT was_offline)`; new check `device_counter IS NULL OR was_offline`; new check `location_age_s IS NULL OR location_age_s BETWEEN 0 AND 604800` (7 days, the largest `offline_max_hours`); new partial unique `(kiosk_id, device_counter) WHERE device_counter IS NOT NULL`; **drop** index `ix_punches_employee_last_accepted` and create `ix_punches_employee_counted` on `(employee_id, punch_time DESC) WHERE decision IN ('accepted', 'flagged')`; index `(qr_credential_id, punch_time DESC)` replaces the M2 one; index `(plant_id, punch_time)`; partial index `(punch_time DESC) WHERE decision IN ('flagged', 'rejected')` (review lists). Adding columns and the generated column is allowed by the append-only trigger (a table rewrite fires no row trigger; a migration test proves the trigger still refuses UPDATE and DELETE afterwards) |
| `punch_snapshots` (change) | `reason` gains `face_offline` | update `ck_punch_snapshots_reason_known` |

- The `decision` list (`accepted`, `rejected`, `flagged`, `needs_code`) already exists (0013); no
  change. `needs_code` rows are never offline (the offline face path has no code round-trip).

**Migration `0016_punch_reviews`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `punch_reviews` | punch_id (FK punches), action (`confirmed` / `not_accepted` / `approved`), direction (`in` / `out` null), employee_id (FK employees: the person the review is about: the punch's `employee_id`, else its `claimed_employee_id`), reason (text null), reviewed_by (FK users), reviewed_at (timestamptz), supersedes_review_id (FK punch_reviews null) | check `(action = 'approved') = (direction IS NOT NULL)`; check `action = 'confirmed' OR length(trim(reason)) >= 3`; check reason length ≤ 300; partial unique `(supersedes_review_id) WHERE supersedes_review_id IS NOT NULL` (a review is changed once, by one newer review); index `(punch_id, reviewed_at DESC)`; index `(employee_id, reviewed_at DESC)`; **append-only trigger** (refuses UPDATE, DELETE, TRUNCATE; function with `SET search_path = ''`); RLS + `deny_all` |

**Migration `0017_kiosk_status`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `kiosk_devices` (change) | + `last_heartbeat_at` (timestamptz null), + `queue_count` (int, default 0), + `queue_bytes` (bigint, default 0), + `queue_oldest_at` (timestamptz null, device estimate), + `last_sync_at` (timestamptz null), + `location_state` (text null: `good` / `weak` / `none` / `denied` / `outside` / `stale`), + `last_lat`, `last_lon` (numeric(9,6) null), + `last_accuracy_m` (numeric(7,1) null), + `last_location_at` (timestamptz null), + `storage_persisted` (bool null), + `storage_quota_mb`, `storage_usage_mb` (int null), + `offline_ready` (bool null, S-38), + `battery_level` (numeric(3,2) null, 0–1), + `battery_charging` (bool null), + `camera_ok` (bool null) (F-3), + `last_punch_at` (timestamptz null: the newest punch time of a decided punch row of this device) | check `queue_count >= 0 AND queue_bytes >= 0`; check `location_state` known; check `battery_level` between 0 and 1; lat/lon range check as `punches`. The M1 columns `last_seen_at` and `app_version` keep being set by every signed request |

**Migration `0018_kiosk_heartbeats`** (F-3)
| Table | Columns | Keys / constraints |
|---|---|---|
| `kiosk_heartbeats` | kiosk_id (FK kiosk_devices), received_at (timestamptz, server time), queue_count (int), location_state (text), accuracy_m (numeric(7,1) null), battery_level (numeric(3,2) null), battery_charging (bool null), camera_ok (bool null), storage_usage_mb (int null), app_version (text null) | index `(kiosk_id, received_at DESC)`; index `(received_at)` (purge); same value checks as `kiosk_devices`; RLS + `deny_all`. **One row at most every 5 minutes per device**, plus a row whenever the location state or camera state changes (about 2,000 rows per device per week); rows older than 7 days are **deleted** by the daily job (§7 rule 20). No location coordinates are kept here (only state and accuracy) |

- **State is computed on read**, never stored (§7 rule 15): no background job. The 7-day timeline
  is computed from the gaps between `kiosk_heartbeats` rows (a gap longer than
  `kiosk_offline_after_minutes` + 5 minutes = offline).

**Size estimate (Supabase Free 500 MB):** 7 nullable columns on `punches` add about 40 bytes a row
(the M2 estimate of about 160 MB a year stays about the same). Reviews: a few hundred rows a month
(< 1 MB a year). `kiosk_heartbeats`: 7–10 devices × about 2,000 rows × about 120 bytes ≈ 2–3 MB, flat
(7-day purge). Offline face punches keep a 320 px photo (about 15 KB) each, within the M3
snapshot estimate (only during outages).

**Device storage (IndexedDB, Dexie schema version 2 of `upasthiti-kiosk`):**
| Table | Contents | Notes |
|---|---|---|
| `device` (change) | + `anchor: { token, server_time, received_monotonic_ms, received_wall_ms, session_id }` | the last time anchor; `session_id` is a random id made at each page load |
| `queue` (new) | key `client_punch_id`; `counter`, `method`, `signed_item` (string), `signature`, `bytes`, `saved_wall_ms` | evidence inside `signed_item` is ciphertext only; no name, no card text, no code, no picture in readable form; index on `counter` (sync order) |

## 7. Business rules

1. **Role permission matrix (M4 rows; extends M1 §7 rule 1, M2 and M3).**

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK |
   |---|---|---|---|---|
   | "Needs review": list, detail, map, related punch | all | – | – | – |
   | Confirm / mark "Not accepted" a flagged punch; approve a rejected punch; change a review | ✔ | – | – | – |
   | Punch log: flagged and offline marks, review state (text) | all | all (read) | own plant (read) | – |
   | Attendance device status (state, queue, last punch, location state), health monitor+ and 7-day timeline (F-3), offline badge (F-36) | all | all (read) | own plant (read) | – |
   | "Attendance device offline" alert banner (F-46) | all | – | own plant | – |
   | Daily review digest card (F-48), repeat-pattern hints (F-54) | all | – | – | – |
   | Device's last position on a map | all | – | own plant | – |
   | Settings (new M4 keys) | edit | read | read | – |
   | Heartbeat, sync, punch with location | – | – | – | own kiosk |

   New capabilities in `permissions.py`: `REVIEW_PUNCHES` (Super Admin only), `VIEW_KIOSK_STATUS`
   (all three roles in scope). Review endpoints return `FORBIDDEN` to other roles.

2. **Engine outcomes and order** (FR-25, FR-26). A rule returns **ALLOW**, **REJECT(code)**,
   **FLAG(code)** or **SELF_TEST** (M2).
   - REJECT stops the chain. The row is `rejected`; `reason_codes` = the rejection code first, then
     any flag codes collected before it (useful for review; the gate shows only the first).
   - FLAG records the code and the chain goes on. If no rule rejects and at least one flag exists,
     the row is **`flagged`**, has a direction, **counts as IN/OUT at once**, and `reason_codes` = the
     flag codes in rule order (no duplicates).
   - No rejection and no flag → `accepted`, empty `reason_codes` (constraint unchanged).
   - The kiosk answer says `"accepted"` for a flagged punch (§5.1).
   - **Card punch order** (`QR_RULES`): `read_card` (a test card stops with SELF_TEST; the answer
     adds the location verdict, nothing stored) → **`kiosk_location`** → `check_snapshot` →
     `check_qr_credential` → `check_in_out` → **`impossible_travel`** → **`two_devices`** →
     (offline only) **`offline_time`**.
   - **Face punch order:** request checks and face worker (M3) → **`kiosk_location`** →
     `FACE_RULES` (M3; offline: §7 rule 10) → `check_in_out` → `impossible_travel` → `two_devices` →
     (offline only) `offline_time`.
   - Why location first: it is cheap and refuses a device taken away before any card or face work;
     the flag rules run last because they need the identified employee and the decided time.

3. **Location at the gate** (device side; decision 0025 item 1). Guidance only; the server decides.
   - The gate runs `watchPosition` (high accuracy) all the time and also asks for a fresh reading
     every `kiosk_location_refresh_seconds` (30), because a still device may report nothing new.
   - A reading is **good** when its accuracy ≤ `accuracy_limit_m`, it is no older than
     `max_age_seconds` (120), and its distance to the fence (computed on the device from the fence
     in `/kiosk/me`) ≤ `buffer_m`.
   - No good reading for 10 s → "needs its location" screen (§4.1). A good reading → punching
     resumes at once.
   - Each punch carries the newest good reading and its age (`age_s`). The gate never sends a punch
     without one.
   - The fence on the device updates with the 60 s heartbeat (new version id → new fence).
   - **Offline: last good reading** (§14 answer 1). A PC finds its position through nearby Wi-Fi
     networks and Windows' location service, which may need the internet. So, **only while the gate
     is offline**, when no new good reading comes, it keeps using its last good reading **of the same
     page session** (never one stored before a reload) for up to `offline_max_hours`, and sends it
     with its true age. A newer good reading always replaces it; a newer reading that is outside or
     too weak still pauses the gate. Online the rule above is unchanged (a reading older than
     `max_age_seconds` = none).

4. **Location rule on the server** (`rules/kiosk_location.py`; reuses the M1 pairing logic, moved
   into one shared function used by pairing and punches):
   1. no `location` → REJECT `LOCATION_REQUIRED`;
   2. `accuracy_m` outside 0–`MAX_ACCURACY_REPORTED_M` or above `gps_accuracy_limit_m` → REJECT
      `GPS_ACCURACY_TOO_LOW` (`details`: accuracy, limit);
   3. the plant has no fence → REJECT `GEOFENCE_NOT_SET` (should never happen: a device can only be
      paired at a plant with a fence);
   4. distance *d* from the point to the drawn shape (0 inside; M1 §7 rule 7) and the fence's
      margin *b* (`buffer_m`):
      - *d* = 0 → ALLOW;
      - 0 < *d* ≤ *b* → **FLAG `LOCATION_AT_EDGE`** (accepted and flagged, decision 0025 item 1);
      - *d* > *b* → REJECT `OUTSIDE_GEOFENCE`.
   - The fence used is the version that was current at the **punch time** (online: now; offline:
     the proven punch time; versions are kept, M1); its id and *d* are stored on the row.
   - `age_s` is stored. Online it is not judged (the device decides freshness; the server cannot
     prove it). **Offline items** with `age_s` > `kiosk_location_max_age_seconds` get **FLAG
     `LOCATION_STALE`** (the reading was reused, §7 rule 3); accuracy and fence are still checked on
     that reading, so a stale reading outside the fence is still `OUTSIDE_GEOFENCE`.
   - Code path (M3 `/punch/kiosk/code`): the final row reuses the location verdict of its
     `needs_code` row (no new reading is needed for the same person seconds later).
   - Remaining risk: a faked browser location passes this rule (§8.3).

5. **IN/OUT and cool-down with punch time** (M2 §7 rule 6 changed; FR-19).
   - **Punch time** = server receive time for online punches, the proven (or best) offline time for
     offline punches (rule 8). It is the stored generated column `punch_time`.
   - *last* = the employee's latest **counted** punch (rule 6) with `punch_time` **before** this
     punch's time; *next* = the earliest counted punch **after** it (only possible for offline
     punches). The employee row is locked (`SELECT … FOR UPDATE`) as in M2.
   - The M2 table applies with "now" = this punch's time: cool-down → `COOLDOWN_ACTIVE`; IN younger
     than `min_minutes_before_out` → `OUT_TOO_SOON`; IN younger than `open_in_max_hours` → OUT;
     otherwise IN.
   - **Offline extra:** if *next* exists and is within `punch_cooldown_minutes` after this punch →
     REJECT `COOLDOWN_ACTIVE` (a double punch; the earlier-stored one stays). If *next* exists
     further away → the direction is still decided from *last* only, and the row gets **FLAG
     `SYNC_ORDER_CONFLICT`** with `related_punch_id` = *next*, because *next* was decided without
     knowing this punch (punch rows never change, so the pair may read IN, IN; the Super Admin and
     M5 see why).
   - Card, employee and plant facts are judged **as they were at the punch time** when the time is
     anchored: card `revoked_at`, `valid_from` / `valid_until` (IST day of the punch time),
     employee status and `left_on`, current plant from the plant history (M1 F-20). When the time is
     unproven they are judged as they are at sync (stricter).
   - Face templates are always the ones active at sync (a deleted template cannot be used).

6. **Counted punches and reviews** (decision 0025 items 3, 4). One service function
   `counted_punches(employee, before/after time)` defines what counts, used by rule 5, the flag
   rules, the punch log review state and (later) M5:
   - `accepted` rows count;
   - `flagged` rows count **unless** their latest review is `not_accepted`;
   - `rejected` rows count **only** when their latest review is `approved`, with the review's
     direction (and the review's `employee_id`);
   - `needs_code` rows never count.
   - A review changes only future decisions: punches already decided keep their stored direction.
   - **Latest review** = the review row that no other row supersedes.

7. **Review rules.**
   - **Confirm** (flagged only): the flag was checked; the punch keeps counting. Note optional.
   - **Not accepted** (flagged only): reason 3–300 characters; the punch stops counting.
   - **Approve** (rejected only): allowed when the punch names an employee (`employee_id` or
     `claimed_employee_id`), whatever its reason, except `COOLDOWN_ACTIVE` rows (a duplicate of a
     punch that already counts) (§14 answer 3). Reason 3–300 characters; direction chosen by the Super Admin.
     The **suggestion** = the direction rule 5 would give at the punch time from the counted punches
     at the moment of the review. A warning lists counted punches of the same person within the
     cool-down; approving is still allowed.
   - **Change review:** a new row with `supersedes_review_id` = the shown latest review; the
     request carries `expected_latest_review_id`; a mismatch → `REVIEW_CHANGED` (two Super Admins at
     once). Any action may follow any other that fits the punch's decision (e.g. confirmed → not
     accepted).
   - Every review writes an audit row in the same transaction: `punch_review.confirm`,
     `punch_review.not_accepted`, `punch_review.approve`, with punch id, employee, direction,
     reason and the superseded review id.
   - M5 shows review approvals next to regularisations and must not count the same event twice
     (M5 spec).

8. **Offline time proof** (decision 0025 item 6).
   - **Time anchor:** every signed kiosk response carries `time_anchor = { server_time, token }`,
     where `token` = HMAC-SHA256 over `kiosk_id | server_time (ms) | request counter`, with a key
     derived from `APP_SECRET_KEY` (label `offline-time-anchor-v1`). Only the server can make or
     check it. Changing `APP_SECRET_KEY` makes queued anchors unproven (flagged), never lost.
   - **Device:** on each response it stores the anchor with `performance.now()` and `Date.now()` at
     receipt and the page's `session_id`. At an offline capture it records
     `elapsed_ms = performance.now() − received_monotonic_ms`,
     `wall_elapsed_ms = Date.now() − received_wall_ms`, `same_session` = the anchor was received in
     this page load, and `device_time` (informational).
   - **Server, for each offline item** (`received` = server receive time of the sync request):
     1. the anchor token is valid for this kiosk, `same_session` is true, and
        |`elapsed_ms` − `wall_elapsed_ms`| ≤ `offline_clock_drift_seconds` (a device that slept or
        whose clock jumped shows a difference);
     2. `t = anchor_server_time + elapsed_ms`, and `anchor_server_time ≤ t ≤ received + 5 s`;
     3. the item's counter is greater than the anchor request's counter, and within one sync batch
        and one anchor, counter order equals time order;
     - all true → `offline_punch_time = t`, `time_proof = anchored`;
     - any false → `time_proof = unproven`, **FLAG `OFFLINE_TIME_UNPROVEN`**, and
       `offline_punch_time` = the device's estimate (`anchor_server_time + wall_elapsed_ms`, or
       `device_time`) clamped into [valid anchor time or `received − offline_max_hours`, `received`];
       without any usable value, `received`.
   - **Too old:** `received − offline_punch_time > offline_max_hours` (72) → **FLAG `OFFLINE_TOO_OLD`**.
   - Both are flags, never rejections (decision 0025 item 6). Online punches use server time only.
   - The gate's on-screen clock uses the same anchor + elapsed time.

9. **When the gate is offline** (device behaviour).
   - Offline mode starts when the browser reports no network, or a request fails with a network
     error twice in a row (the M2 single retry included), or a punch gets no answer within 15 s
     while the last heartbeat also failed. A slow but alive server (Render waking, the M2 "server is
     starting" text) is **not** offline: the gate waits up to 60 s as in M2, then queues a card punch.
   - A card punch request that failed or timed out is queued **with the same `client_punch_id`**,
     so if it did reach the server the sync answers `already_saved`.
   - Offline mode ends when a heartbeat succeeds; sync starts at once (rule 11).
   - Offline needs `kiosk_settings.offline.enabled` from the last `/kiosk/me`; without it (development
     without the key) the gate keeps the M2 "No internet. Your punch was NOT saved." message.
   - Location is still required offline (rule 3); the last good reading of the same session may be
     reused (flag `LOCATION_STALE` at sync); without any, punching pauses.
   - Offline saving also needs `offline_ready` (storage self-check, rule 12).

10. **Offline face punch: capture and checks at sync** (decision 0025 item 2).
    - **Capture:** code typed first; the device picks the challenge with `crypto.getRandomValues`
      (one turn, or two ordered turns when `face_challenge_steps` = 2); frames as M3 (2–4 JPEG,
      640 × 480 at most, frontal first, one turn frame per step, frontal again).
    - **At sync** (one item at a time through the M3 face worker; live punches go first, rule 11):
      1. `kiosk_location` (rule 4);
      2. **`offline_challenge`** (replaces `face_challenge`): the signed item names a valid challenge
         for the current `face_challenge_steps` → else REJECT `OFFLINE_CHALLENGE_INVALID`;
      3. `face_frames`, `face_liveness` (turns must follow the signed challenge, in order),
         `face_antispoof`, `face_consistency` exactly as M3;
      4. **`offline_code_match`**: the candidate = the employee with that code who is active, face
         method and has an active template of the running model (any plant); 1:1 cosine ≥
         `face_code_match_threshold` → matched; matched at another plant → REJECT `WRONG_PLANT`; not
         matched or no candidate → REJECT `FACE_NOT_RECOGNISED`; `claimed_employee_id` = the
         employee of the typed code when it exists; `employee_id` only when matched; `match_mode =
         code`; one try only (the worker has left);
      5. `check_in_out`, `impossible_travel`, `two_devices`, `offline_time`.
    - **Photo:** every offline face punch keeps one 320 px encrypted photo made by the server from
      the first frontal frame (`punch_snapshots.reason = face_offline`), accepted or rejected (it is
      a code-path punch, M3 §7 rule 14; covered by the consent text "you have to type your employee
      code"), except `COOLDOWN_ACTIVE`, `OUT_TOO_SOON` and `FRAMES_INVALID`.
    - **Why it is weaker than online (accepted risk, decision 0025 item 2):** the server did not
      choose the head turn, so someone who controls the gate device (devtools, a modified browser)
      knows the challenge in advance and can inject a recorded clip that turns the right way, and
      the server cannot tell when the frames were taken beyond the time proof. Remaining defences:
      anti-spoof on the frontal frames, same person in all frames, 1:1 match to the typed code, the
      device key, the location at capture, a photo kept for every offline face punch, and review of
      flags. Recorded for the M4 security review and M6; F-52 (§12, Later) would flag all offline
      face punches if the lead wants more.

11. **Signed queue items and sync.**
    - **At capture:** the device reserves the next counter (`takeNextCounter`, the same sequence as
      requests), builds the signed item (§5.2), seals the evidence (rule 10 / §8.2), signs
      `"UPS-OFFLINE-1\n{kiosk_id}\n{counter}\n{SHA-256 hex of signed_item}"` with the device key, and
      writes `{client_punch_id, counter, signed_item, signature}` to Dexie in one transaction. Only
      then does it show "Saved".
    - **Sync request:** signed like any request (M1 §7 rule 6: `counter > last_counter`), carrying
      up to 20 items and ≤ 1 MB, oldest counter first. Live punches have priority: the device pauses
      sync while a punch is on screen, and the server's face worker serves live face punches before
      sync items (a sync face item waits only when no live request waits).
    - **Server, per item** (item-level problems are `refused`, write no punch row and an audit row
      `kiosk.sync_item_refused` with kiosk, `client_punch_id` if readable and the code — never the
      item text):
      1. signature valid with the **sync request's** kiosk key → else `ITEM_SIGNATURE_INVALID`;
      2. `signed_item` parses, `v` = 1, fields within limits → else `ITEM_INVALID`;
      3. `(kiosk, client_punch_id)` exists → `already_saved` with the stored decision;
      4. counter < the sync request's counter and not used by another stored offline punch of this
         kiosk (unique `(kiosk_id, device_counter)`) → else `ITEM_COUNTER_INVALID`;
      5. evidence `key_id` known; decryption with associated data `kiosk_id | client_punch_id |
         method | key_id` succeeds → else a **rejected punch row** `OFFLINE_EVIDENCE_UNREADABLE`
         (the admin then sees that a punch was lost; no employee is known);
      6. punch time (rule 8), then the rules of rule 2 with "now" = punch time.
    - **Order:** the server sorts the batch by punch time (then counter) before deciding. Items of
      an earlier batch were already decided; items later in time than an already stored counted
      punch of the same employee are handled by rule 5 (`SYNC_ORDER_CONFLICT`).
    - **Time budget:** the server stops starting new items after 20 s and answers `retry_later` for
      the rest; the device sends the next batch at once after an answer.
    - **Audit:** one `kiosk.sync` row per sync request (actor kiosk; counts per result; no item
      data). Punch rows get no audit row (M2 rule).
    - The punch row of an offline item: `was_offline = true`, `server_received_at` = the sync
      receive time, `offline_punch_time`, `time_proof`, `device_counter`, `device_claimed_at` =
      `device_time` (informational, as M2), location and age, app version, and the sync request's
      IP (logs only).

12. **Queue limits, privacy on the device, revocation.**
    - Limits from `/kiosk/me`: `offline_queue_max_items` (2,000) and `offline_queue_max_mb` (200).
      Full → `QUEUE_FULL` screen (§4.5); 80% → warning (§4.6). A card item is about 25 KB, a face
      item up to about 300 KB.
    - **Storage self-check (S-38):** at each page load the gate reads
      `navigator.storage.estimate()`; free quota < `offline_queue_max_mb` + 50 MB (or no estimate
      available) → `offline_ready = false`: offline punches are not saved
      (`OFFLINE_STORAGE_TOO_SMALL`, §4.6); reported in the heartbeat and shown on the devices page.
      Saved items already in the queue are still sent.
    - **Nothing readable is kept:** frames, the photo, the card text and the typed code are held in
      memory only until sealed; the ephemeral ECDH private key is created per item, never stored and
      dropped after use; the device cannot open its own queue. Location, method, counter and times
      are kept in clear (no personal data).
    - Items are deleted from Dexie when the server answers `saved`, `already_saved` or `refused`.
    - The heartbeat reports count, bytes and the oldest item's estimated time (never contents).
    - **Revoked device with a queue** (§14 answer 2): the sync is refused (`DEVICE_REVOKED`, M1);
      the gate shows the revoked screen with the number of punches that could not be sent (§4.6),
      then deletes the queue at once (nothing can ever be sent with a revoked key; deleting is the
      privacy-safe choice). **Before revoking**, the revoke dialog shows "N punches are still waiting
      on this attendance device" from the last heartbeat's `queue_count`, so the admin can wait for
      the sync (§4.7). Lost punches are corrected by the plant office (M5 regularisation). There is
      no "retire after sync" mode (F-51 rejected).
    - "Forget this device" / re-pairing also deletes the queue.

13. **Gate page offline (app shell).**
    - vite-plugin-pwa (Workbox) builds a service worker that is **registered only by the gate page**
      with scope `/attendance`; the admin website is never controlled or cached by it.
    - Precached: the gate route's HTML, its JS/CSS chunks, the QR decoder WebAssembly, fonts,
      `locales/en/common.json`, icons. Runtime cache (cache first, versioned): the MediaPipe wasm and
      `face_landmarker.task` after their first load (without them the M3 timed-capture fallback works).
    - **Never cached:** `/api/*` (network only), `/version.json` (network only, so S-27 self-update
      keeps working), the pairing page's requests.
    - Updates: a new service worker waits; the S-27 idle reload activates it (never during a punch).
    - A web app manifest (name "Gate attendance", start URL `/attendance`, display fullscreen) lets
      the setup guide add it to the home screen.
    - The bundle check (`npm run size`) keeps the admin's first load free of gate and service-worker
      code.

14. **Flag rules: travel and two devices** (decision 0025 item 5, decision 0012).
    - **`impossible_travel`:** for the identified employee, take *last* and *next* (rule 5, counted
      punches, plus `WRONG_PLANT` rejections of the same employee or card, which show where a card
      really was). For each at another kiosk: distance between the two punch positions (stored
      lat/lon; else the plant fence's centre); skip when below `impossible_travel_min_distance_m`
      (500: GPS noise and gates of one plant); speed = distance ÷ time apart (time apart at least 1
      minute); speed > `impossible_travel_kmh` → FLAG `IMPOSSIBLE_TRAVEL`, `related_punch_id` = that
      punch.
    - **`two_devices`:** the same card (`qr_credential_id`) or the same employee at **another
      kiosk** within `same_person_two_devices_minutes` (10) before or after this punch's time, among
      counted punches and `WRONG_PLANT` rejections → FLAG `TWO_DEVICES_SOON`, `related_punch_id` set.
      Two devices side by side at one gate: a person scanning at device B right after device A gets
      `COOLDOWN_ACTIVE` (rejected, not counted), so the flag stays rare.
    - When several related punches exist, the nearest in time is linked; the review screen lists
      all within the window.
    - Both rules only flag. They also run on the final row of the M3 code path.

15. **Attendance device status** (FR-24; computed on read):
    - `revoked` → **Switched off**; `pending` → **Waiting for pairing**;
    - no signed request for `kiosk_offline_after_minutes` (3) → **Offline since** `last_seen_at`;
    - else heartbeat `location_state` not `good` (and not `stale`, which only happens offline) →
      **Needs location**;
    - else `queue_count` > 0 → **Sending saved punches (n)**;
    - else **Online**.
    - `last_punch_at` is updated in the same transaction as each new punch row of the device (the
      newest punch time). Heartbeats update the queue and location columns; a successful sync updates
      `last_sync_at`.
    - Plant readiness: `device_online` = at least one active device of the plant is Online or
      Sending; `location_good` = such a device's `location_state` is `good`.

16. **Heartbeat.** `POST /kiosk/heartbeat` every 60 s replaces the M2 `GET /kiosk/me` poll (the
    answer is the same body). `GET /kiosk/me` stays for start-up and for an old gate. During a
    deploy the new gate may meet the old backend for a few minutes: a 404 on heartbeat or sync makes
    the gate fall back to `GET /kiosk/me` and keep the queue (rule 19).

17. **Settings (company-wide; `CURRENT_MILESTONE` = 4).**

    | Key | Default | Range | Group |
    |---|---|---|---|
    | `gps_accuracy_limit_m` | 50 | 10–200 | kiosk (existing; now also per punch) |
    | `geofence_default_buffer_m` | 25 | 0–200 | kiosk (existing; margin of new fences) |
    | `impossible_travel_kmh` | 60 | 10–200 | anti-proxy (existing, now editable) |
    | `impossible_travel_min_distance_m` | 500 | 100–5,000 | anti-proxy (new) |
    | `same_person_two_devices_minutes` | 10 | 1–60 | anti-proxy (new) |
    | `kiosk_location_max_age_seconds` | 120 | 30–600 | kiosk (new) |
    | `kiosk_location_refresh_seconds` | 30 | 10–120 | kiosk (new) |
    | `kiosk_offline_after_minutes` | 3 | 2–30 | kiosk (new; the M2 draft name, F-36) |
    | `offline_max_hours` | 72 | 24–168 | offline (new; NFR-02) |
    | `offline_queue_max_items` | 2,000 | 200–10,000 | offline (new) |
    | `offline_queue_max_mb` | 200 | 20–1,000 | offline (new) |
    | `offline_clock_drift_seconds` | 120 | 30–600 | offline (new) |
    | `kiosk_offline_alert_minutes` | 10 | 5–120 | offline (new, F-46) |
    | `review_hint_employee_rejections` | 3 (in 7 days) | 2–20 | anti-proxy (new, F-54) |
    | `review_hint_device_edge_flags` | 20 (in 7 days) | 5–200 | anti-proxy (new, F-54) |

    Cross-checks: `kiosk_offline_alert_minutes` ≥ `kiosk_offline_after_minutes`, else
    `SETTING_INVALID` ("The alert time cannot be shorter than the offline time."). Also: `kiosk_location_refresh_seconds` < `kiosk_location_max_age_seconds`, else
    `SETTING_INVALID` ("The refresh time must be shorter than the maximum age."). Settings are read
    per punch (M2 `PunchLimits` style); a change reaches the gates with the next heartbeat.

18. **Reason and flag code catalogue (M4).** Gate texts under `kiosk.punch.<CODE>.title`,
    `.message`, `.next`, `.voice`; admin texts under `punchReasons.<CODE>` and `errors.<CODE>`; gate
    screens under `kiosk.location.*` and `kiosk.offline.*`. `npm run i18n:check` fails on a missing
    text; a test fails if any gate text contains "kiosk".
    - **Rejection codes** (stored): `LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE`,
      `GEOFENCE_NOT_SET` (the four M1 pairing codes, now also punch codes), `OFFLINE_CHALLENGE_INVALID`,
      `OFFLINE_EVIDENCE_UNREADABLE`; reused: `FACE_NOT_RECOGNISED`, `WRONG_PLANT`, `COOLDOWN_ACTIVE`,
      `OUT_TOO_SOON` and all M2/M3 codes.
    - **Flag codes** (stored on `flagged` rows): `LOCATION_AT_EDGE`, `LOCATION_STALE`, `IMPOSSIBLE_TRAVEL`,
      `TWO_DEVICES_SOON`, `OFFLINE_TIME_UNPROVEN`, `OFFLINE_TOO_OLD`, `SYNC_ORDER_CONFLICT`. Flags have
      only `punchReasons.<CODE>` (+ a longer `punchReasons.<CODE>_help` for the review panel); the
      gate never shows them.
    - **Sync item codes** (answers only, no row): `ITEM_SIGNATURE_INVALID`, `ITEM_COUNTER_INVALID`,
      `ITEM_INVALID`. Request error: `OFFLINE_NOT_CONFIGURED`.
    - **Gate-only codes** (never from the server): `LOCATION_DENIED`, `LOCATION_UNAVAILABLE`,
      `LOCATION_WEAK`, `LOCATION_OUTSIDE`, `OFFLINE_SAVED`, `OFFLINE_ALREADY_SAVED`, `QUEUE_FULL`,
      `QUEUE_ALMOST_FULL`, `OFFLINE_FACE_NETWORK` (the "type your code to save" switch),
      `REVOKED_WITH_QUEUE`, `OFFLINE_STORAGE_TOO_SMALL` (S-38).
    - **Admin texts without a code:** `kiosks.offlineAlert`, `kiosks.offlineBadge`,
      `kiosks.revokeQueueWarning`, `kiosks.health.*`, `review.digest.*`, `review.hints.*`,
      `kiosk.offline.lastSync`, `kiosk.location.sketch.*`.
    - **Admin codes:** `REVIEW_NOT_ALLOWED`, `REVIEW_NO_EMPLOYEE`, `REVIEW_CHANGED`, `SETTING_INVALID`.

19. **Rollout.** Push to `main` deploys Vercel (about 1 minute) and Render (several minutes). The new
    gate tolerates the M3 backend (falls back to `GET /kiosk/me`, offline stays off until
    `kiosk_settings.offline` arrives). The new backend rejects a punch without location
    (`LOCATION_REQUIRED`), so an old gate page that has not reloaded yet is refused until the S-27
    self-update reloads it (at most about 5 minutes plus 30 s idle). The plan schedules the deploy
    outside shift change and the setup guide's checklist opens each gate once after the deploy.

20. **Health history, offline alert, digest and hints** (approved extras F-3, F-46, F-48, F-54).
    - **Heartbeat samples (F-3):** each heartbeat updates the `kiosk_devices` columns; a
      `kiosk_heartbeats` row is written only when the device's newest row is at least 5 minutes old
      or its location or camera state changed. Battery comes from the browser's Battery Status API
      where it exists (else null, "Not reported"); `camera_ok` = the gate's camera stream is running.
    - **Purge:** the daily job (`app/jobs/daily.py`, 00:05 IST, safe to repeat) deletes
      `kiosk_heartbeats` rows older than 7 days in batches and logs only the count.
    - **Timeline:** per IST day, online and offline stretches from the gaps between samples (rule of
      §6); "shift time" = the union of the plant's active shifts that day (night shifts counted on
      their start day, as SRS §8).
    - **Offline alert (F-46):** computed on read in `/kiosks/status-summary`: a device is in
      `alerts` when it is active, Offline (rule 15) for at least `kiosk_offline_alert_minutes`, and
      the current IST time is inside one of its plant's active shifts. Shown to the Super Admin (all
      plants) and the Plant Head (own plant). Nothing is stored; "Hide" is kept in the browser's
      local storage per device until it is online again. No email in M4 (F-7, M5).
    - **Digest (F-48):** for one IST day per plant: punches with `punch_time` on that day that are
      flagged, rejected with an employee named, and flagged without a review yet; offline minutes of
      the plant's devices inside shift time (from the timeline). Super Admin only.
    - **Hints (F-54):** in the review context, over the last 7 days before the punch time: the
      employee's rejected punches ≥ `review_hint_employee_rejections`; the device's
      `LOCATION_AT_EDGE` flags ≥ `review_hint_device_edge_flags`; the card's `TWO_DEVICES_SOON` flags ≥
      2. Hints only; nothing is blocked or changed.

## 8. Security, privacy and compliance

### 8.1 Privacy and DPDP (Act 2023, Rules 2025); IT Act §43A
- **Data touched:** device location (of the gate, not of a person); card photos, card text, face
  frames and typed codes of offline punches (encrypted on the device until sync); punch times; review
  reasons written by the Super Admin (may mention a person); device health samples (battery,
  camera, storage, location state; no coordinates, no personal data; kept 7 days).
- **Exception to "gate frames are never stored"** (decision 0025 item 2): offline face frames are
  stored **only encrypted, only on the gate device, only until sync**; the device cannot read them;
  they are deleted at sync (or at revocation). On the server they are processed in memory exactly as
  online frames; one 320 px photo is kept (code-path rule, M3).
- **Purpose:** attendance and proxy prevention only; nothing new is shared or sent outside.
- **Minimisation:** heartbeat and queue metadata carry counts and times, never contents; the review
  list shows no thumbnails; photos only on demand, audited (M2).
- **Retention:** offline evidence until sync; offline photos as all snapshots (60 days, purge job);
  reviews and punches as labour law requires (append-only).
- **Notice:** the gate footer and the poster gain the offline sentence (§4.2, §4.12). The face
  consent text `face-consent-v1` already covers "you have to type your employee code" photos; no new
  consent version is needed (the frames are still deleted after the check). The compliance-auditor
  confirms this before approval.
- **Labour Codes:** punches stay append-only; reviews never edit a punch; the original evidence and
  the review trail both stay.

### 8.2 Security
- **The device is untrusted** (FR-25): the server decides location, card, face, identity, punch time
  and IN/OUT. Device location and time are signals the server checks, never trusted facts.
- **Offline evidence encryption** (decision 0025 item 2): per item, the device creates an ephemeral
  ECDH P-256 key (WebCrypto), derives a shared secret with the server's public key, runs HKDF-SHA256
  (info `upasthiti-offline-evidence-v1`, salt = the ephemeral public key) to get an AES-256-GCM key,
  and encrypts with a random 12-byte nonce and associated data `kiosk_id | client_punch_id | method |
  key_id`. The ephemeral private key is non-extractable and dropped. A moved or edited ciphertext
  fails to open. A shared test vector file (fixed keys, used by Vitest and pytest) pins the format.
- **New environment variables:**
  - `OFFLINE_EVIDENCE_KEY` (**required in production**): the server's P-256 private key (PKCS#8,
    base64url). Created with `uv run python -m app.scripts.make_offline_key` (prints the `.env` line,
    like `make_face_key`). The public key is derived at start and handed to gates in `/kiosk/me`.
    **If it is lost, the punches waiting on gate devices at that moment cannot be opened** (each
    becomes a rejected row `OFFLINE_EVIDENCE_UNREADABLE`); punches already synced are not affected.
    **If it leaks**, someone who also steals a gate device could read that device's waiting
    punches. Keep it in the password manager; never in the repository. Without it in development
    the gate's offline mode is off (`OFFLINE_NOT_CONFIGURED`); in production the app does not start
    ("Missing required setting: OFFLINE_EVIDENCE_KEY", value never printed).
  - `OFFLINE_EVIDENCE_KEY_ID` (optional, a letter, default `A`): stored in every item so a later key
    change stays possible.
  - The time-anchor key is derived from `APP_SECRET_KEY` (no new variable).
- **Replay:** an online request needs a growing counter (M1). An offline item is replay-safe by
  `(kiosk, client_punch_id)` uniqueness (the same item again = `already_saved`, nothing new),
  `(kiosk, device_counter)` uniqueness (a re-signed copy with a new id but an old counter is
  `ITEM_COUNTER_INVALID`), and a counter that must be below the sync request's counter. A
  recorded sync request cannot be resent (its own counter). Items signed by another kiosk fail the
  signature check.
- **Forged time:** the anchor is an HMAC only the server can make; elapsed time is bounded by the
  anchor and the receive time; counters must follow time; a device that restarts or whose clocks
  disagree is flagged. A compromised device can still choose any time between its last anchor and
  the sync (flag review is the defence; see §8.3).
- **Location:** server re-check on every punch; fence version stored; margin edge flagged.
- **Limits:** sync body 1 MB, 20 items, per-item M2/M3 limits after decryption (pixel limits on
  JPEG decoding), 30 sync requests a minute per kiosk, 6 heartbeats a minute, 20 s work budget per
  sync request, one face item at a time.
- **Logs:** never the signed item text, ciphertext, plaintext evidence, card text, codes, frames,
  anchor tokens or keys. Sync log lines: kiosk id, counts per result, durations.
- **Review endpoints:** Super Admin only, Origin check, audited; `REVIEW_CHANGED` stops lost updates.
- **Service worker:** scope `/attendance` only; never caches `/api/*`; precache list fixed at build
  (no runtime caching of HTML from other paths).

### 8.3 Accepted risks (for the M4 security review and M6)
| Risk | Why it remains | Mitigation |
|---|---|---|
| Faked browser location (devtools sensors, mock-location app) | A web page cannot prove where it is (decision 0005) | Locked kiosk mode (setup guide), device key, photo/face evidence, travel and two-device flags, location age stored, review |
| Offline face liveness weaker (device-chosen turn) | No server nonce without internet | Anti-spoof, consistency, 1:1 code match, photo kept, location, review; F-52 (Later) if more is wanted |
| A compromised gate device picks an offline punch time within its outage | The device measures elapsed time | Anchor bounds, counter order, drift check, flags; travel/two-device flags |
| Revoked device loses its waiting punches | A revoked key cannot be trusted | Revoke dialog warns "N punches are still waiting"; queue size on the devices page; M5 regularisation (F-51 rejected) |
| Offline punches use a reused (stale) location | Windows Wi-Fi positioning may need the internet, so an offline PC gate may get no new reading | Only the same page session's last good reading, at most `offline_max_hours`; every such punch flagged `LOCATION_STALE`; a moved phone gets a new reading that pauses it (§14 answer 1) |

## 9. Edge cases and error handling
Gate messages show title + message + next step and "For the admin: CODE" on rejections (decision
0006). Keys `kiosk.punch.<CODE>.*`, `kiosk.location.*`, `kiosk.offline.*`; admin keys
`errors.<CODE>`, `punchReasons.<CODE>`.

| Case | Expected behaviour | Error code | Gate / admin message (English, i18n key) |
|---|---|---|---|
| Gate inside the fence, good reading | punch decided as M2/M3; nothing new shown | – | – |
| Location permission blocked | gate paused | `LOCATION_DENIED` (gate) | "This attendance device needs its location. Location is blocked for this website. Please visit the plant office." `kiosk.location.LOCATION_DENIED` |
| Location off / unavailable | gate paused | `LOCATION_UNAVAILABLE` (gate) | "This attendance device needs its location. Location is switched off or not available. Please visit the plant office." `kiosk.location.LOCATION_UNAVAILABLE` |
| Reading ±140 m (limit 50) | gate paused until better | `LOCATION_WEAK` (gate) | "Waiting for a better location signal (now ±{{now}} m, needed ±{{limit}} m)." `kiosk.location.LOCATION_WEAK` |
| Device carried outside the fence | gate paused | `LOCATION_OUTSIDE` (gate) | "This attendance device does not seem to be at the plant gate. Please visit the plant office." `kiosk.location.LOCATION_OUTSIDE` |
| Punch without location (old page, tampered device) | rejected, row stored | `LOCATION_REQUIRED` | "This attendance device did not send its location. Your punch was not saved. Please visit the plant office." `kiosk.punch.LOCATION_REQUIRED` |
| Punch with accuracy above the limit | rejected | `GPS_ACCURACY_TOO_LOW` | "This attendance device's location is not accurate enough. Your punch was not saved. Please visit the plant office." `kiosk.punch.GPS_ACCURACY_TOO_LOW` |
| Punch from outside the fence + margin (demo scenario 3) | rejected, photo kept (card) | `OUTSIDE_GEOFENCE` | "This attendance device is not at the plant. Your punch was not saved. Please visit the plant office." `kiosk.punch.OUTSIDE_GEOFENCE` |
| Plant fence missing | rejected | `GEOFENCE_NOT_SET` | "This attendance device is not set up yet. Please visit the plant office." `kiosk.punch.GEOFENCE_NOT_SET` |
| Reading 18 m outside the drawn fence, margin 25 m | accepted IN/OUT as usual; row flagged | `LOCATION_AT_EDGE` (flag) | gate: normal result; admin: "Location at the fence edge (inside the margin)." `punchReasons.LOCATION_AT_EDGE` |
| Card used at TP1 and 4 min later at another device | second punch decided as usual, flagged, linked | `TWO_DEVICES_SOON` (flag) | admin: "Same person at another attendance device {{minutes}} min earlier/later." |
| Card rejected `WRONG_PLANT` at a plant 3 km away at 08:00, then shown at TP1 at 08:02 | the TP1 punch is decided as usual and flagged (90 km/h > 60), linked to the 08:00 row; the review shows both. In the reverse order the flag rules never run on the later `WRONG_PLANT` row (the chain stopped at its rejection); that row is listed in the "Rejected" tab | `IMPOSSIBLE_TRAVEL` (flag; usually also `TWO_DEVICES_SOON`) | admin: "Too far to travel in the time between the two punches ({{speed}} km/h)." |
| Gate offline and no new reading (e.g. PC without online Wi-Fi positioning) | the last good reading of this page session is reused; punches saved; at sync flagged | `LOCATION_STALE` (flag) | gate: chip "Last location (offline)"; admin: "Saved offline with the attendance device's last known location ({{age}} old)." `punchReasons.LOCATION_STALE` |
| Gate reloaded during the outage, no new reading | no reading of this session → paused | `LOCATION_UNAVAILABLE` (gate) | as above |
| Gate offline, device storage quota too small | not saved | `OFFLINE_STORAGE_TOO_SMALL` (gate) | "This attendance device cannot save punches without internet. Your punch was NOT saved. Please visit the plant office." `kiosk.punch.OFFLINE_STORAGE_TOO_SMALL` |
| Internet drops, worker shows card | saved offline | `OFFLINE_SAVED` (gate) | "Saved – will be confirmed. Your punch is saved on this attendance device. It will be checked when the internet is back." `kiosk.offline.saved` |
| Same card again offline within the cool-down | not saved again | `OFFLINE_ALREADY_SAVED` (gate) | "Already saved at {{time}}. No need to punch again." |
| Face punch offline | code pad first, then face; saved | `OFFLINE_SAVED` | as above |
| Online face request fails for the network | not queued; switch to offline face path | `OFFLINE_FACE_NETWORK` (gate) | "No internet. Type your employee code to save your punch." |
| Offline face: wrong code typed | saved; at sync rejected, photo kept, claimed employee recorded | `FACE_NOT_RECOGNISED` | (gate showed "Saved"); admin: M3 text + "Saved offline" |
| Offline face: right code, other plant | rejected at sync | `WRONG_PLANT` | admin as M3 |
| Offline face: signed challenge missing or of the wrong kind | rejected | `OFFLINE_CHALLENGE_INVALID` | admin: "The saved face check is incomplete." |
| Offline card of a revoked card (revoked before the punch time) | rejected at sync | `QR_REVOKED` | admin as M2 |
| Card revoked after the punch time, while the device was offline | accepted (judged at the punch time) | – | – |
| Employee marked as left after the offline punch | accepted for that time (judged at the punch time); face templates are gone, so an offline **face** punch fails 1:1 | – / `FACE_NOT_RECOGNISED` | – |
| Punch answer lost; queued with the same id | at sync | `already_saved` | – |
| Sync answer lost; same items sent again | `already_saved` for each | – | – |
| Item edited on the device (counter, time, location) | signature fails; refused; audited | `ITEM_SIGNATURE_INVALID` | – (device deletes it) |
| Old item re-signed with a new id and an old counter | refused | `ITEM_COUNTER_INVALID` | – |
| Ciphertext moved to another item, or `OFFLINE_EVIDENCE_KEY` lost/changed | rejected row, no employee | `OFFLINE_EVIDENCE_UNREADABLE` | admin: "The saved punch could not be opened." |
| Device restarted while offline (power cut) | saved punches before and after kept; after-restart items unproven; flagged | `OFFLINE_TIME_UNPROVEN` (flag) | admin: "The time of this offline punch could not be proven." |
| Device clock changed while offline | drift check fails; flagged | `OFFLINE_TIME_UNPROVEN` | as above |
| Punch synced 80 h after it was made | decided, flagged | `OFFLINE_TOO_OLD` (flag) | admin: "Saved offline more than {{hours}} hours before it was sent." |
| Offline IN 08:05 synced after an online IN 08:50 at another device | IN decided from earlier punches; flagged, linked | `SYNC_ORDER_CONFLICT` (flag) | admin: "A later punch was decided before this offline punch arrived." |
| Offline punch 1 min before an already stored counted punch | rejected (double punch) | `COOLDOWN_ACTIVE` | admin as M2 |
| Queue full | not saved | `QUEUE_FULL` (gate) | "This attendance device cannot save more punches. Your punch was NOT saved. Please visit the plant office." |
| Queue 80% full | warning line | `QUEUE_ALMOST_FULL` (gate) | "Storage almost full – please restore the internet." |
| Admin opens the revoke dialog while 12 punches wait | amber warning; revoking still allowed | – | "12 punches are still waiting on this attendance device. If you switch it off now, they are lost. Wait until it shows 0 if you can." `kiosks.revokeQueueWarning` |
| Device offline 10 min during a shift | alert banner for the Super Admin and that plant's Plant Head; badge for all roles in scope | – | "Attendance device '{{name}}' has been offline since {{time}} ({{minutes}} min). Check its power and internet." `kiosks.offlineAlert` |
| Device offline at night (no shift running) | badge only, no alert banner | – | – |
| Browser without battery information | health shows "Not reported" | – | `kiosks.health.batteryUnknown` |
| Alert time set below the offline time | refused | `SETTING_INVALID` | "The alert time cannot be shorter than the offline time." |
| Device revoked with 12 waiting | sync refused; count shown; queue deleted | `DEVICE_REVOKED` / `REVOKED_WITH_QUEUE` (gate) | "This attendance device has been switched off. {{count}} saved punches could not be sent. Please visit the plant office." |
| Face worker busy during sync | item `retry_later`; live punches first | – | – |
| Sync body > 1 MB or > 20 items | refused | `PAYLOAD_TOO_LARGE` / `VALIDATION_FAILED` | – (device sends smaller batches) |
| Development without `OFFLINE_EVIDENCE_KEY` | offline off; M2 message | `OFFLINE_NOT_CONFIGURED` | M2 `NETWORK_OFFLINE` text |
| Page reloaded during an outage | loads from the service worker; queue kept; new anchor needed for proven time | – | – |
| Self-test card with a bad location | "Location ✗" in the self-test answer; nothing stored | – | "Attendance device test: Camera ✓ · Server ✓ · Location ✗" |
| Review: confirm a rejected punch / approve a flagged one | refused | `REVIEW_NOT_ALLOWED` | "This action does not fit this punch." `errors.REVIEW_NOT_ALLOWED` |
| Review: approve a punch that names nobody | refused | `REVIEW_NO_EMPLOYEE` | "No employee is known for this punch, so it cannot be approved." |
| Review: approve a `COOLDOWN_ACTIVE` row | refused | `REVIEW_NOT_ALLOWED` | as above |
| Two Super Admins review the same punch | the second gets a conflict | `REVIEW_CHANGED` | "Someone reviewed this punch a moment ago. Reload to see it." |
| Plant Head / Corporate Head opens `/admin/review` | refused | `FORBIDDEN` | M1 `common.readOnly` |
| Refresh time ≥ max age in settings | refused | `SETTING_INVALID` | "The refresh time must be shorter than the maximum age." |

## 10. Acceptance criteria (Given / When / Then)
Core:
- **AC-1** Given a paired gate with a good reading inside the fence, when a card or face punch is
  made, then the request carries `location` with `age_s`, and the row stores lat, lon, accuracy,
  age, `geofence_id` and `geofence_distance_m` = 0; the decision is as in M2/M3.
- **AC-2** Given the gate's reading becomes worse than the limit, older than the max age, outside the
  fence, denied or unavailable, when 10 s pass, then the "needs its location" screen shows the right
  cause and the "For the admin" code, card scanning stops and the face button hides; when a good
  reading returns, punching resumes without a tap.
- **AC-3** Given a signed punch without location / with accuracy 120 m (limit 50) / 200 m outside
  the fence (margin 25), then the stored decisions are `LOCATION_REQUIRED` / `GPS_ACCURACY_TOO_LOW` /
  `OUTSIDE_GEOFENCE`, with the gate texts of §9 ending "Please visit the plant office."
- **AC-4** Given a reading 18 m outside the drawn fence with a 25 m margin, when an employee punches,
  then the gate shows the normal IN screen, the answer says `accepted`, and the row is `flagged` with
  `reason_codes = [LOCATION_AT_EDGE]`, a direction, and counts for the next punch's IN/OUT.
- **AC-5** Given the punches table, when the migration runs, then a flagged row needs a direction,
  an accepted row has no codes, a flagged or rejected row has at least one, `punch_time` equals
  `server_received_at` for online rows, and UPDATE and DELETE on `punches` and `punch_reviews` are
  still refused.
- **AC-6** Given a card accepted at device A and the same card at device B 4 minutes later (other
  rules pass), then the second punch is `flagged` `TWO_DEVICES_SOON` with `related_punch_id` = the
  first; given 11 minutes, no flag.
- **AC-7** Given an employee's counted punch at a position 3 km away 2 minutes earlier, then the new
  punch gets `IMPOSSIBLE_TRAVEL` (90 km/h > 60); given 400 m (below the minimum distance), no flag;
  neither rule ever rejects.
- **AC-8 (offline card)** Given the gate's network is cut, when a worker shows a valid card and the
  photo is taken, then "Saved – will be confirmed" shows without name or IN/OUT, one item is in the
  Dexie queue, and the stored item contains no readable card text or photo (a test decodes the
  stored row and finds only ciphertext and the allowed clear fields).
- **AC-9 (offline face)** Given the network is cut, when "Punch with face" is tapped, then the code
  pad shows first, then the face guidance with a device-chosen turn; the saved item holds the
  challenge in clear and the code and frames only sealed.
- **AC-10 (sync, demo scenario 5)** Given a gate offline for one hour (simulated clock) with 20 card
  and 10 face punches of 15 people (IN and later OUT), when the network returns, then within 5
  minutes the queue is empty, every punch is in the punch log with `was_offline`, `time_proof =
  anchored`, `punch_time` within 2 s of the real capture time, the IN/OUT pairs as a person would
  expect, the face punches matched 1:1 with `match_mode = code` and a `face_offline` photo, and one
  `kiosk.sync` audit row per sync request.
- **AC-11** Given a queued card punch whose original request did reach the server, when it syncs,
  then the result is `already_saved` with the original decision and no second row exists.
- **AC-12** Given a sync request replayed, then `NONCE_REUSED`; given an item edited after signing,
  then `refused` `ITEM_SIGNATURE_INVALID` and an audit row; given an item re-signed with a new
  `client_punch_id` but a used counter, then `ITEM_COUNTER_INVALID`; given an item signed by another
  kiosk inside this kiosk's sync, then `ITEM_SIGNATURE_INVALID`.
- **AC-13** Given an item whose ciphertext was copied from another item, or the server key was
  replaced, then a rejected row `OFFLINE_EVIDENCE_UNREADABLE` with no employee is stored.
- **AC-14 (time)** Given a page reload during the outage, items made after the reload are
  `unproven` and flagged `OFFLINE_TIME_UNPROVEN`; given the device clock moved by 10 minutes while
  offline, the items after the change are flagged; given an item synced 80 hours after capture, it is
  flagged `OFFLINE_TOO_OLD`; none of them is rejected for time.
- **AC-15 (order)** Given employee X's online IN at device B at 08:50 and an offline punch at device A
  at 08:05 synced at 09:00, then the offline punch is IN, flagged `SYNC_ORDER_CONFLICT`, linked to the
  08:50 punch; given an offline punch at 08:49, it is rejected `COOLDOWN_ACTIVE`.
- **AC-16 (judged at the punch time)** Given a card revoked at 08:30 and an offline punch proven at
  08:10, then accepted; proven at 08:40, then `QR_REVOKED`.
- **AC-17** Given an offline face item with the right code and face, then accepted by code with a
  photo; with the wrong code, then `FACE_NOT_RECOGNISED` with `claimed_employee_id`; with frames that
  turn the other way than the signed challenge, then `LIVENESS_FAILED`; without a valid challenge,
  then `OFFLINE_CHALLENGE_INVALID`.
- **AC-18** Given a sync while live punches arrive, then live face and card punches keep a server
  decision p95 < 2 s (measured in the Render-like container) and sync face items get `retry_later`
  instead of delaying them.
- **AC-19** Given the queue at the max item count or size, then the gate shows "NOT SAVED" and saves
  nothing; at 80% the warning line shows.
- **AC-20** Given a device whose last heartbeat reported 12 waiting punches, when the admin opens
  the revoke dialog, then it shows "12 punches are still waiting on this attendance device"; when
  the device is revoked and next contacts the server, then it shows the revoked screen with "12
  saved punches could not be sent", and the queue is empty afterwards.
- **AC-21** Given the gate page loaded once online, when the browser is offline and the page is
  reloaded, then `/attendance` loads from the service worker, the device key and queue are present,
  card punches can be saved; the admin pages are not controlled by the service worker; `/api/*` and
  `/version.json` are never served from a cache.
- **AC-22 (FR-24)** Given devices in each state, when the devices page is opened, then each shows
  the right state of §7 rule 15 with icon + word, last contact, last punch, saved punches waiting,
  last sync and location; a device silent for 3 minutes shows "Offline since"; plant readiness shows
  "Attendance device online" and "Location good"; a Plant Head sees only their plant.
- **AC-23** Given a heartbeat with `queue.count = 12` and `location.state = weak`, then the device
  shows "Needs location" and "12" waiting on the devices page within 30 s.
- **AC-24 (review list)** Given flagged and rejected punches, when the Super Admin opens "Needs
  review", then "To check" lists flagged punches without a review, "Rejected" lists rejected ones
  without `COOLDOWN_ACTIVE` by default and never `needs_code` rows, filters work, and the sidebar
  badge equals the "To check" count.
- **AC-25 (review detail)** Given a `LOCATION_AT_EDGE` punch, the map shows the fence version of the
  punch time, the margin, the point, the accuracy circle and "18 m outside the drawn fence, inside
  the 25 m margin"; given an `IMPOSSIBLE_TRAVEL` punch, both punches show side by side with distance
  and speed; each "View photo" writes `snapshot.view`.
- **AC-26 (confirm / not accepted)** Given a flagged IN, when the Super Admin marks it "Not accepted"
  with a reason, then a `punch_reviews` row and an audit row exist, the punch row is unchanged, and
  the employee's next punch is decided as if that IN did not count; "Confirm" keeps it counting.
- **AC-27 (approve)** Given a rejected `SPOOF_SUSPECTED` punch with a code typed for EMP-0123, when the
  Super Admin approves it as OUT (suggestion shown) with a reason, then the review stores direction
  `out` and employee EMP-0123, the punch counts as OUT for later decisions, and audit
  `punch_review.approve` exists; approving a rejected punch with no employee gives
  `REVIEW_NO_EMPLOYEE`; approving a `COOLDOWN_ACTIVE` row gives `REVIEW_NOT_ALLOWED`.
- **AC-28** Given a review shown to two Super Admins, when both submit, then the second gets
  `REVIEW_CHANGED`; "Change review" adds a row that supersedes the first; the history lists both.
- **AC-29** Given a Corporate Head or Plant Head, then every review endpoint returns `FORBIDDEN`, the
  sidebar has no "Needs review", and the punch log shows flagged / offline / review marks as text
  only, in their scope.
- **AC-30** Given the settings screen, then the §7 rule 17 keys are editable with ranges and reasons,
  `impossible_travel_kmh` is editable, the refresh/max-age cross-check is enforced, and a gate picks up
  a change within one heartbeat.
- **AC-31** Given `APP_ENV=production` without `OFFLINE_EVIDENCE_KEY`, then the app stops with
  "Missing required setting: OFFLINE_EVIDENCE_KEY" and prints no value; `make_offline_key` prints a
  valid key line; the shared test vector decrypts in both pytest and Vitest.
- **AC-32** Given sync, heartbeat and review traffic, then no log line contains a signed item,
  ciphertext, card text, code, frame, anchor token or key (log-scrub test).
- **AC-33** Given every new code, then `npm run i18n:check` passes with all `kiosk.punch.<CODE>.*`,
  `kiosk.location.*`, `kiosk.offline.*`, `punchReasons.<CODE>` and `errors.<CODE>` texts; no gate
  text contains "kiosk"; every gate rejection text ends "Please visit the plant office." (retry hints
  excepted, decision 0022).
- **AC-34 (security spoof tests, demo scenario 3; security-reviewer, on the deployed site)** Given
  (a) a punch signed by an unregistered key, (b) a punch reporting a position at a team member's home,
  (c) a replayed punch request, (d) a replayed and an edited offline item, (e) a forged time anchor,
  (f) an item of another kiosk, (g) a revoked device, then the answers are (a)
  `DEVICE_SIGNATURE_INVALID`, (b) `OUTSIDE_GEOFENCE`, (c) `NONCE_REUSED`, (d) `already_saved` /
  `ITEM_SIGNATURE_INVALID`, (e) `OFFLINE_TIME_UNPROVEN` flag, (f) `ITEM_SIGNATURE_INVALID`, (g)
  `DEVICE_REVOKED`; none creates a counted punch.
- **AC-35** Given the CI, then backend and frontend coverage are at least 82%; `/admin/review` and
  the changed devices page are in `e2e/tests/responsive.spec.ts` and pass at 360 px and 768 px; the
  admin first-load bundle contains no service-worker or gate code (`npm run size`).
- **AC-36 (stale location, §14 answer 1)** Given a gate that had a good reading and then goes
  offline and gets no new reading for 30 minutes, when a worker punches, then the punch is saved with
  that reading and its true age; at sync it is `flagged` `LOCATION_STALE` (accuracy and fence still
  checked); given the same situation online, the gate pauses ("needs its location") as before; given
  a reload during the outage, no old reading is used.

Extras:
- **AC-37 (F-36)** Given one offline device in the Plant Head's plant, then the top bar shows "1
  attendance device offline" and the sidebar entry shows 1 for that Plant Head, the Corporate Head
  and the Super Admin; a Plant Head of another plant sees nothing; the badge links to the filtered list.
- **AC-38 (F-46)** Given a device offline for 10 minutes during its plant's shift, then the Super
  Admin and that plant's Plant Head see the alert banner on every admin page within 60 s; the
  Corporate Head does not; outside shift time no banner shows; "Hide" hides it until the device is
  online again.
- **AC-39 (F-55)** Given 12 waiting punches, the gate footer shows "12 punches waiting since 08:05";
  after the sync, "All punches sent ✓ {{time}}"; no name or result is shown.
- **AC-40 (F-53)** Given the needs-location screen with a reading outside the fence, then a sketch of
  the fence, the margin and the point with "about 60 m outside the fence" shows, without any network
  request for map tiles.
- **AC-41 (F-3)** Given heartbeats every 60 s for a day with a 40-minute gap, then `kiosk_heartbeats`
  has at most one row per 5 minutes (plus state changes), the drawer's timeline shows the 40-minute
  offline stretch, battery / camera / storage show the latest values (or "Not reported"), and after
  the daily job no row older than 7 days remains; the RLS test includes `kiosk_heartbeats`.
- **AC-42 (F-48)** Given yesterday's flagged and rejected punches and a device offline 2 h in shift
  time, then the Super Admin's digest card shows the right counts and "2 h 0 min" per plant; links
  open "Needs review" filtered; other roles do not see the card.
- **AC-43 (F-54)** Given an employee rejected 3 times in 7 days, or a device with 20 edge flags in 7
  days, then the review panel shows the matching hint with a link to those punches; below the
  thresholds no hint shows.
- **AC-44 (S-38)** Given a browser whose storage estimate is below `offline_queue_max_mb` + 50 MB,
  then offline punches show "NOT SAVED" (`OFFLINE_STORAGE_TOO_SMALL`), the heartbeat reports
  `offline_ready: false`, and the devices page shows "Offline saving off: not enough storage".

## 11. Test plan
- **Unit (pytest):**
  - engine with FLAG: order, flags collected, first rejection wins, rejected rows keep earlier flags,
    flagged rows get a direction (AC-4, AC-5);
  - location rule: each branch and boundary (*d* = 0, = *b*, > *b*; accuracy = limit), fence
    version at punch time (AC-3, AC-4); `LOCATION_STALE` for offline items older than the max age,
    never for online punches (AC-36);
  - direction with punch time, *last* / *next*, `SYNC_ORDER_CONFLICT`, double punch, reviews in
    `counted_punches` (AC-15, AC-26, AC-27);
  - travel and two-devices rules: distance, minimum distance, window edges, WRONG_PLANT rows (AC-6,
    AC-7);
  - time proof: anchor HMAC, drift, bounds, counter order, unproven clamp, too old (AC-14);
  - sync item checks: signature, parse, duplicate, counter, decryption, associated data (AC-11–AC-13);
  - judged-at-punch-time card / employee / plant facts (AC-16);
  - review rules: allowed actions, suggestion, supersede, conflict (AC-26–AC-28);
  - settings ranges and cross-checks; start-up check of `OFFLINE_EVIDENCE_KEY` (AC-30, AC-31);
  - log scrubbing for sync and heartbeat (AC-32);
  - heartbeat sampling (5-minute rule, state changes), timeline from gaps, shift-time overlap,
    7-day purge (AC-41); offline alert in and out of shift time, scope per role (AC-38); digest counts
    (AC-42); hint thresholds (AC-43).
- **API (pytest + httpx, real Postgres, fake face engine):** every new endpoint × every role
  (generated matrix, AC-29); signed online punches with location; a full offline flow made in the
  test with a P-256 device key, the server evidence key and fixed anchors (AC-8–AC-17); migration
  test for the constraints, the generated column and both append-only triggers (AC-5); RLS test
  includes `punch_reviews` and `kiosk_heartbeats`; heartbeat → device state (AC-22, AC-23);
  live-vs-sync priority with the face worker (AC-18); `/kiosks/status-summary`, `/kiosks/{id}/health`
  and `/reviews/digest` × every role (AC-37, AC-38, AC-41, AC-42).
- **Attack tests (core, AC-34):** every attack of AC-34 as a pytest API test (unknown key, outside
  position, replayed request, replayed and edited items, forged anchor, another kiosk's item,
  revoked device). The reusable tool and manual checklist (S-35) are Later.
- **Shared test vectors:** one JSON file with a fixed device key, server key, anchor, item and
  sealed evidence; Vitest builds the same bytes, pytest opens them (AC-31).
- **Unit (Vitest + Testing Library + fake-indexeddb):** location watcher (good / weak / old /
  outside / denied → screen states; refresh timer) (AC-2); offline reuse of the last good reading of
  the same session, none after a reload (AC-36); "Why paused?" sketch from a fence and a point
  (AC-40); storage self-check with a mocked `navigator.storage.estimate()` (AC-44); footer last-sync
  line (AC-39); offline badge and alert banner with "Hide" (AC-37, AC-38); health drawer, digest card
  and hint lines (AC-41–AC-43); offline switch rules (two failures, 15 s,
  server waking is not offline) ; queue (reserve counter, seal, sign, write in one transaction;
  limits; delete on results; revoked) (AC-8, AC-9, AC-19, AC-20); anchor and elapsed time across a
  simulated reload; offline face flow (code first, device challenge, cancel keeps nothing); sync
  loop (batching by count and bytes, `retry_later`, pause during a punch); "Saved" and "Already
  saved" screens without names; review screen actions and role hiding; devices page states.
- **End-to-end (Playwright, headed locally; `FACE_ENGINE=fake`, `APP_ENV=test`; geolocation set by
  the browser context; offline by `context.setOffline`):**
  1. gate inside the fence → card IN; geolocation moved outside → "needs its location" screen; a
     signed punch sent by a test helper from outside → `OUTSIDE_GEOFENCE` in the punch log (AC-2,
     AC-3);
  2. edge position → IN shown, punch log "Flagged", "Needs review" lists it; Super Admin confirms
     (AC-4, AC-24, AC-26);
  3. offline for a simulated hour: card and face punches → "Saved"; reload while offline → page
     loads; back online → queue empties, punch log shows offline rows with the right IN/OUT (AC-8,
     AC-9, AC-10, AC-21);
  4. approve a rejected punch as OUT; Plant Head cannot open the review page (AC-27, AC-29);
  5. devices page states and readiness; offline badge and alert after a gate page is closed for
     the alert time (test setting); revoke dialog warning with waiting punches (AC-20, AC-22, AC-37,
     AC-38);
  6. responsive check of `/admin/review` and the devices page at 360 px and 768 px; axe scan on the
     review panel and the gate's location and saved screens (AC-35).
- **Manual checks:** the security spoof tests on the deployed site (AC-34, security-reviewer); the
  1-hour outage on a real gate phone and a real gate PC (router unplugged), including a power cut
  during the outage and whether the PC keeps a reading offline (`LOCATION_STALE`); battery and
  camera values in the health drawer on a real phone and PC; location at the real gates (indoors near the gate, night, rain); "Add to home
  screen" from the setup guide; review on a phone.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** nothing in this section is built until the project lead approves it. Each row is
asked in chat as a simple choice. Approved rows are copied into §2, §10 and docs/decisions/.
**The lead (Tushar Gawande) answered every row in chat on 2026-10-28** (status column). Approved rows
are in §2 item 12 with AC-37 to AC-44.

Not re-proposed (already decided in accepted-extras.md): F-2, F-8, F-10–F-14, F-16, F-21, F-22,
F-24, F-28, F-32, F-37, F-42, F-44, S-13, S-14, S-16, S-19, S-21, S-25. F-3 and F-36 are offered
again below because M4 is their natural milestone (they were "Later" / "Pending Tushar").
Note: the device state on the attendance devices page is **core** in M4 (FR-24); F-36 below is only
the extra badge and dashboard part.

### 12.1 Product features
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-36 | Online badge (pending Tushar since M2): a small "1 attendance device offline" badge in the admin top bar and on the sidebar's "Attendance devices" entry, for all roles in scope | A dead gate is noticed from any page, not only the devices page | M4 | S | Low | Approved 2026-10-28 by Tushar |
| F-3 | Attendance device health monitor+ (Later since M0): battery level and charging, camera working, free storage, app version, a 7-day online/offline timeline per device (heartbeat data kept 7 days in a small table) | Gate problems are found remotely, before workers queue; good handover tool | M4 | M | Low (one small table; battery API missing on some browsers) | Approved 2026-10-28 by Tushar (`kiosk_heartbeats`, 7 days, RLS + deny_all, daily purge) |
| F-45 | Offline drill mode: the Super Admin starts "Practice an outage" for one device for 10 minutes; the device behaves exactly as offline (real punches, real queue), then syncs; a banner on the gate says "Practice mode" | The team and the client can test the offline path any day, without unplugging the router | M4 | S–M | Medium (real punches in a drill: the screen must make it obvious) | Later (2026-10-28) |
| F-46 | "Attendance device offline" alert inside the app: a notification for the Super Admin and that plant's Plant Head when a device is offline for more than 10 minutes during a shift (email later with F-7 in M5) | Someone acts within minutes, not at the next shift change | M4 | S | Low | Approved 2026-10-28 by Tushar |
| F-47 | Location drift chart per device: accuracy and distance to the fence from the heartbeats of the last 7 days (one sample per 10 minutes) | Shows when a gate's location gets bad (rain, a new wall, Wi-Fi changes) and helps set the margin with data | M4 | M | Low (small table, 7 days) | Later (2026-10-28) |
| F-48 | Daily review digest: a dashboard card each morning "Yesterday: 5 flagged, 3 rejected with an employee, 1 device offline 2 h" per plant (email later with F-7) | Review becomes a 5-minute morning habit instead of a backlog | M4 | S | Low | Approved 2026-10-28 by Tushar (dashboard card; email stays M5) |
| F-49 | Review keyboard shortcuts and bulk confirm: J/K next/previous, C confirm, N not accepted, A approve; tick several `LOCATION_AT_EDGE` flags and confirm them with one note | GPS edge flags can be many; checking them is fast | M4 | S | Low (bulk confirm only for edge flags) | Later (2026-10-28) |
| F-50 | Sync history per device: each sync run with counts per result, refused items and order conflicts, on the device drawer | Explains "what happened during yesterday's outage" without reading logs | M4 | M | Low (one small table) | Later (2026-10-28) |
| F-51 | "Retire after sync" when revoking: a second revoke choice that lets a device send its waiting punches first (up to 24 h), then switches it off; "Switch off now" stays for stolen devices | A planned device replacement loses no saved punches | M4 | S–M | Medium (a device stays trusted a little longer; only allowed with an empty queue deadline) | Rejected (2026-10-28; the revoke dialog warns about waiting punches instead) |
| F-52 | Flag every offline face punch (setting, default off) | Offline face liveness is weaker (device-chosen turn); the lead may want every such punch checked | M4 | S | Low (more items to review) | Later (2026-10-28) |
| F-53 | "Why paused?" sketch on the gate: on the needs-location screen, a tiny drawing of the fence and the device's point (no map tiles) for the installer | The person installing the device sees at once whether it is outside or just weak | M4 | S | Low | Approved 2026-10-28 by Tushar |
| F-54 | Repeat-pattern hints on the review screen: "This employee was rejected 3 times this week", "This device had 20 edge flags this week – check its location or the margin" | Points the Super Admin at the real problem behind many single flags | M4 | M | Low | Approved 2026-10-28 by Tushar |
| F-55 | Gate "last sync" line for guards: footer text "All punches sent ✓ 09:02" or "12 waiting since 08:05" | The guard can tell the office at once that punches are waiting | M4 | S | Low | Approved 2026-10-28 by Tushar |

### 12.2 Tooling and engineering
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| S-34 | Outage simulation script for e2e and demos: a Playwright helper that cuts the network, moves a fake monotonic clock and device clock (1 hour in seconds), makes punches, reloads, reconnects and checks the punch log | Demo scenario 5 runs in CI in about a minute and before every live demo | M4 | S–M | Low | Later (2026-10-28) |
| S-35 | Security spoof-test suite (demo scenario 3): pytest + a small signing tool that sends every attack of AC-34 (unknown key, outside position, replays, edited items, forged anchor, other kiosk's item, revoked device) against a local or deployed backend, plus a manual checklist with the browser's location override | The security review is repeatable and the examiners can watch it | M4 | M | Low (never against production during shifts) | Later (2026-10-28); the AC-34 attack tests stay core in pytest |
| S-36 | Property-based tests (Hypothesis, MPL-2.0, dev only) for direction and order: random mixes of online and offline punches, syncs and reviews must keep the §7 rule 5 invariants | Ordering bugs are the hardest to find by hand | M4 | S | Low | Later (2026-10-28) |
| S-37 | Sync load test (Locust, existing): 7 gates each syncing a 72-hour queue at the same time against the 512 MB / 0.1 CPU container, while live punches run | Proves NFR-01 holds after a plant-wide outage | M4 | S | Low (off-hours only against live) | Later (2026-10-28) |
| S-38 | Gate storage self-check: at start the gate measures its storage quota (`navigator.storage.estimate()`) and refuses to enable offline mode below the queue limit, reporting it in the heartbeat | A cheap phone with little space fails loudly at install time, not during an outage | M4 | S | Low | Approved 2026-10-28 by Tushar |

## 13. Dependencies and risks

### 13.1 Dependencies to add
Exact versions are fixed by the lockfiles. All free.

| Package | Version | Licence | Reason |
|---|---|---|---|
| vite-plugin-pwa (frontend, dev) | latest 1.x | MIT | Builds the gate's service worker and manifest (planned in ADR 0001 / CLAUDE.md §4); gate page loads offline (§7 rule 13) |
| workbox-build, workbox-window, workbox-precaching, workbox-routing, workbox-strategies (come with vite-plugin-pwa) | as required | MIT | Precache and routing rules inside the service worker |
| @turf/boolean-point-in-polygon, @turf/point-to-line-distance, @turf/distance (frontend) | 7.x (same as the existing @turf packages) | MIT | Device-side "inside the fence" guide on the gate (§7 rule 3); the plan may instead reuse a small own function with the M1 projection maths |
| cryptography (backend) | already installed | Apache-2.0 / BSD | ECDH P-256, HKDF, AES-256-GCM, HMAC (no new backend package) |
| dexie, fake-indexeddb | already installed | Apache-2.0 / Apache-2.0 | Offline queue table and its tests |
| WebCrypto (ECDH, HKDF, AES-GCM, ECDSA), Geolocation, Storage (`persist`, `estimate`), Battery Status, Service Worker APIs | browser built-in | – | Nothing to install (Battery Status is optional: "Not reported" where missing) |

### 13.2 Risks
| Risk | Effect | Mitigation |
|---|---|---|
| Gate PC cannot get a good location | Gate paused; workers queue | Setup guide; phone or tablet gate; tune accuracy limit and margin; offline the last good reading is reused and flagged (§14 answer 1) |
| Battery Status API missing on some browsers | No battery in the health monitor | Shown as "Not reported"; nothing depends on it |
| Plants close together; margin too large | A neighbouring plant's device could punch here | Small default margin (25 m), warning in settings, F-47 data |
| Browser evicts IndexedDB under storage pressure | Saved punches lost | `navigator.storage.persist()`, heartbeat reports it, S-38 |
| `performance.now()` pauses while the device sleeps | Elapsed time too short | Drift check against the device clock → unproven flag; wake lock (M2) |
| Large queue after a long outage | Slow sync, face worker busy | Batches, 20 s budget, live first, AC-18 measurement; full sync load test S-37 is Later |
| Service worker serves an old gate build | Gate stays on old code | `version.json` network-only, S-27 idle reload activates the new worker |
| Many flags overwhelm the Super Admin | Flags ignored | Edge flags only inside the margin, travel minimum distance, digest card (F-48), repeat-pattern hints (F-54); shortcuts and bulk confirm (F-49) Later |
| `OFFLINE_EVIDENCE_KEY` lost | Waiting offline punches unreadable | Password manager, handover checklist, only waiting items affected |

## 14. Open questions for the team
All six were answered by the lead (Tushar Gawande) in chat on 2026-10-28; the answers are applied in
§2, §4, §5, §7, §9, §10 and §11.

1. **Location of a PC gate during an outage.** Windows may need the internet to find a PC's
   position from Wi-Fi, so an offline PC gate may lose its location and pause (decision 0025 item
   1). Should the gate keep using its **last good reading of the same session** while offline
   (flagged as a new `LOCATION_STALE`), or stay paused?
   Answered 2026-10-28 by the lead: **yes.** An offline gate keeps using its last good reading of
   the same session for up to `offline_max_hours`; those punches get the flag `LOCATION_STALE`.
   Online the live rule is unchanged (§7 rules 3, 4; AC-36).
2. **Revoked device with waiting punches:** delete the queue at once (privacy-safe) or build F-51
   "retire after sync" so a planned replacement loses nothing?
   Answered 2026-10-28 by the lead: **delete the queue at once**, and the revoke dialog shows "N
   punches are still waiting on this attendance device" (from the heartbeat queue size) so the admin
   can wait for the sync first. F-51 is rejected (§4.7, §7 rule 12; AC-20).
3. **Which rejected punches may the Super Admin approve?** Any rejected punch that names an
   employee, except `COOLDOWN_ACTIVE`, or should more reasons be blocked?
   Answered 2026-10-28 by the lead: **any rejected punch that names an employee, except
   `COOLDOWN_ACTIVE`** (§7 rule 7).
4. **Flags in the punch log for the Corporate Head and Plant Head:** read-only text, or Super Admin
   only?
   Answered 2026-10-28 by the lead: **they see flags, "Saved offline" and the review state as
   read-only text** in their scope (§4.9; AC-29).
5. **Edge flag definition:** only outside the drawn fence but within the margin, or also when the
   accuracy circle reaches outside the margin?
   Answered 2026-10-28 by the lead: **drawn fence only**; no accuracy-circle flag (§7 rule 4).
6. **After 72 hours offline:** keep saving until storage is full, or stop saving after
   `offline_max_hours`?
   Answered 2026-10-28 by the lead: **keep saving until the storage is full**; such punches are
   flagged `OFFLINE_TOO_OLD` at sync (§7 rules 8, 12).

## 15. Changes to other documents (made on the milestone branch when this spec is approved)
- **SRS FR-21:** offline card and face punches (face = code first + device-chosen head turn, 1:1 at
  sync), evidence sealed for the server, "Saved – will be confirmed" without name or IN/OUT, time
  anchor + elapsed time, older than 72 h or unproven = flagged, queue limits, gate page loads offline.
- **SRS FR-24:** heartbeat endpoint, device states, queue size, plant readiness lines; offline badge
  and in-app offline alert; 7-day health history (F-3, F-36, F-46).
- **SRS FR-25:** rule 4 = location on every punch with the edge flag; rule 7 = impossible travel and
  two devices, flag only; rule 3 stays struck out.
- **SRS FR-26 / FR-27:** "HR" → the Super Admin; confirm / not accepted for flags; approve for
  rejected punches that name an employee, with IN/OUT and a reason; separate review table; M5 shows
  approvals with regularisations.
- **SRS §5.b:** `/kiosk/heartbeat`, `/kiosk/sync` (signed items), `/reviews`, `/reviews/summary`,
  `/reviews/digest`, `/punches/{id}/reviews`, `/punches/{id}/review-context`,
  `/kiosks/status-summary`, `/kiosks/{id}/health`.
- **SRS §8:** "Poor indoor GPS / boundary jitter" → `LOCATION_AT_EDGE` flag; "Device clock wrong" →
  time anchor + elapsed time, unproven = flagged; "Network down at the kiosk" → offline queue rules;
  new rows: revoked device with a queue (deleted; revoke dialog warns), location offline (last good
  reading of the session reused, `LOCATION_STALE`).
- **SRS §11 M4 row:** "Geofence/IP/impossible-travel rules" → "Geofence, impossible travel and
  two-device rules (no IP list)".
- **architecture §3 and §4:** M4 rule order (location first, flag rules last); flagged answer =
  accepted at the gate.
- **architecture §5:** rewritten from §7 rules 8–13 (time anchor, signed items, sealed evidence,
  batches of 20 / 1 MB, per-item results, order and `SYNC_ORDER_CONFLICT`, offline face path, queue
  limits, revocation, service worker).
- **architecture §6:** "Kiosk health" (state and offline alert) is computed on read from
  `last_seen_at`, not a job; the daily job also deletes `kiosk_heartbeats` older than 7 days.
- **architecture §7:** `punches` new columns (`punch_time` generated, `offline_punch_time`,
  `time_proof`, `device_counter`, `location_age_s`, `geofence_id`, `geofence_distance_m`,
  `related_punch_id`); `punch_reviews`; `kiosk_devices` status and health columns;
  `kiosk_heartbeats` (7 days); snapshot reason `face_offline`.
- **architecture §9:** both notes done in M4 (two-devices rule; kiosk mode stays in the setup guide).
- **M2 spec §4.5:** `NETWORK_OFFLINE` text applies only when offline mode is off.
- **CLAUDE.md** (before the PR, lead approves the diff): roadmap tick for M4; `make_offline_key`
  command; `OFFLINE_EVIDENCE_KEY` (+ `_KEY_ID`) in §10 with the lose-it warning; vite-plugin-pwa and
  Workbox in use; review screen and flag rule summary (including `LOCATION_STALE` offline); health
  history kept 7 days; coverage floor 82%.
- **`.env.example`:** `OFFLINE_EVIDENCE_KEY`, `OFFLINE_EVIDENCE_KEY_ID` with comments.
- **`docs/guides/kiosk-setup.md`:** location on every punch, PC Wi-Fi switched on, "Add to home
  screen", storage persistence and the storage self-check, what the gate does offline (last known
  location reused and flagged), check the waiting-punch count before revoking, open each gate once
  after a deploy.
- **`docs/decisions/0025` and accepted-extras.md:** the answers to §14 and the §12 statuses (done by
  the coordinator).
