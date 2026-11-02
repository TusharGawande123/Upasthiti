# 0036 – M5 + M4b build choices made while coding

Date: 2026-10-31 · Decided by: Anuradha (build delegated by the lead, Tushar Gawande) · Status: Accepted,
**to confirm with Tushar** where a line changes an approved spec. One line per choice, added as the build goes.

1. **Same-day rule versions: the latest save wins** (changes M5 spec §6 migration 0019). `shift_rule_versions`
   and `plant_weekly_offs` have NO unique `(…, effective_from)`: the tables are append-only, so a second edit
   for the same date (e.g. a shift created today and its grace fixed today) could otherwise never be saved.
   The version in force on a date is the one with the latest `effective_from` ≤ that date and, among equal
   dates, the latest `created_at`. The full history stays.
2. **A future rule version leaves `shifts` as it is** until its date: `shifts` keeps the rules in force today
   (what M1 screens and the gate device status read); the daily job copies a version into `shifts` on its
   `effective_from` date. Screens show it as `upcoming_rules`.
3. **Demo removal learns the M5 tables.** `remove_demo_plant` (decision 0015) also deletes the demo plant's
   `shift_rule_versions` and `plant_weekly_offs`, switching their append-only trigger off only inside its one
   transaction, like `punches`. It stays the only tool that deletes such rows; app code never does (M5 AC-55
   is about app code paths). Later M5 / M4b tables are added the same way in their slice.
4. **Shift form before Gate C:** slice 0 only swaps the M1 fields for the M5 ones (grace 30 up to 120,
   smallest overtime 120 up to 480, "These rules apply from" on edit, plain-word rule lines). The full
   redesign (React Hook Form + Zod, rule history list) comes with the Gate C screens in slice 7.
5. **Attendance start date:** saved and audited from slice 0; the "only later once attendance days exist"
   check (`ATTENDANCE_START_INVALID`) comes in slice 2 with the `attendance_days` table. It is not part of
   the readiness `ready` flag (that flag still means "the gate can take punches").
6. **Whole minutes: every time is cut down to its minute first** (fixes M5 spec AC-6b; **to confirm with
   Tushar**). Durations (worked, payable, worked for status, late, early exit, overtime) are measured between
   times cut down to the whole minute; whether a time is inside grace is decided to the second. So "OUT
   16:29:59" is 31 minutes early (as spec §7 rule 9 says) and "IN 09:30:01" is late 30 with worked for status
   **450**, not 479 (AC-6b's 479 was a typo; E4 "IN 09:40 → 440" follows the same rule).
7. **Leave reasons are shown only to the Super Admin.** Leave reasons can be personal (illness, family); the
   Corporate Head and Plant Head see the leave itself, not its reason or cancel reason (DPDP data minimisation;
   spec §8.3 left it open). Holiday names and cancel reasons are not personal and are shown to everyone.
8. **Grace only at the start; no grace before the shift end** (Anuradha, 2026-10-31; **changes decision 0034
   line 10 and spec §7 rule 9, to confirm with Tushar and the client**). IN until shift start + grace is on time.
   An OUT before the shift end is an early exit and the day is Half-day (or Short hours) as the real minutes
   say; the old "OUT from 16:30 is not early" is gone. The time after the end is a normal OUT window: nothing
   is counted there (overtime still starts at the end and counts only from 2 h). `grace_min` is therefore
   "grace after the start". Spec examples E3, AC-6b, the shift-form helper text and the poster ("leave from")
   change with it.
9. **Early OUT: warning with remaining time, then Agree or Cancel** (Anuradha, 2026-10-31; **replaces the
   first idea "refuse the OUT"; changes the gate rules of M2/M4, to confirm with Tushar and the client**; built
   in slice 3 after a design gate with a mockup image). When a person punches OUT before the shift end, the
   gate shows an alert box with **Agree** and **Cancel**:
   - OUT before the half shift is complete (worked for status below the shift's half-day limit; 09:00 shift,
     half day 4 h: before 13:00): "Your half shift is not complete yet." + the remaining time to the half
     and to the full shift;
   - OUT after the half but before the shift end (before 17:00): "Your full shift is not over yet." + the
     remaining time.
   **Agree** records the OUT as a normal accepted punch (not flagged); the day is then Half-day or Short hours
   by the real minutes. **Cancel** records nothing. For permanent AND temporary workers, online and offline
   (offline: the gate uses the shift times it has stored, and the confirmation is saved with the punch).
   The server stays the judge: the gate only shows the dialog; the early-OUT confirmation is checked and
   recorded by the server (new reason mark `EARLY_OUT_CONFIRMED`, shown in the punch log).
   Open points for slice 3: how card and face punches carry the confirmation without a second photo or
   head-turn; the gate screen text and the texts for the warnings.
10. **Early IN: no gate limit for now** (asked 2026-10-31): the attendance day window opens
    `attendance_window_before_hours` (4 h) before the shift; an earlier IN counts for the day before.
    Whether the gate should also refuse a very early IN is open (asked of Anuradha).
11. **Early-OUT dialog design approved** (Anuradha, 2026-10-31, images at 360 / 768 / 1280 px):
    docs/design-refs/m5/gate-early-out/ (two variants: before the half shift, amber; after it, blue). Agree
    records the OUT, Cancel or 20 seconds of silence records nothing, no name on the screen, text at least 24 px.
12. **Gate rule `shift_closed` built** (spec §7 rule 24): after `check_in_out` for card, face, code and offline
    chains; the Super Admin's review suggests OUT and lists the closing OUT (new relation `closing_out`).
    `punches.related_punch_id` of a refused punch is that OUT.
13. **Offline early OUT: no dialog, a mark afterwards** (Anuradha, 2026-10-31; replaces the "offline too" part
    of line 9; **to confirm with Tushar**). An attendance device without internet cannot know who the person is,
    which shift they work or whether the punch is an IN or an OUT: the server decides all three at sync (M4).
    So no remaining time can be shown offline. At sync, an OUT before the shift end is stored as a normal
    accepted punch with the mark `EARLY_OUT_OFFLINE` (not a flag: it counts at once), the day becomes
    Half-day or Short hours by the real minutes, and the Super Admin sees the mark in the punch log.
14. **Heads and notifications:** the Corporate Head and Plant Head also see `absence_streak` and
    `monthly_register` (plant scope; spec §7 rule 20 names them "per plant"), beside device offline, still
    inside, many rejections and incomplete days. `review_digest` and `correction_requested` are for the Super
    Admin only; `correction_decided` only for the person who asked. An email that fails is recorded once
    (state `failed`, the error class only, never an address) and not retried: the unique delivery key keeps
    it at one try, inside the "at most 3" of the spec. Migration numbers: early-OUT mark 0023, notifications
    0024, shift swaps 0025, M4b 0026-0027.
15. **Absence streak (F-62):** only closed WORKING days count; weekly offs and holidays are skipped and do not
    break a streak, while leave, Short hours, Incomplete and a present day do (spec §7 rule 20 lists the weekly
    off and holiday among the "breakers"; skipping them is the reading that fits "the last N closed working
    days", **to confirm with Tushar**). One notification per person per streak, keyed by the first absent day.
16. **Alert jobs run on the free server's schedule:** the 5-minute job starts with `next_run_time`; the 07:00
    morning job also runs once 90 seconds after start-up when the start is after 07:00 IST (a server that slept
    through 07:00); the dedupe keys make every repeat harmless. The nightly purge of old notifications runs with
    the daily job. DEMO plants never raise an alert.
17. **Design gates A and B approved** (Anuradha, 2026-11-01, images at 360 / 768 / 1280 px): dashboard and
    muster (docs/design-refs/m5/gate-a/: the all-plants total row leaves demo plants out; muster print is A4
    portrait with department heading rows; the page shows 14 people then "Show 50 more", print and PDF hold
    everyone; "On outside work: N" sits on the Inside-now tile) and the attendance screens, register, employee
    tab, day drawer, corrections and bulk wizard (docs/design-refs/m5/gate-b/). The shift rules line reads
    "On time until 09:30. Leave from 17:00." (decision line 8). Missing loading / empty / error states are built
    as in the README and the other screens. Gate C is still being drawn.
18. **Design gate C approved** (Anuradha, 2026-11-01): docs/design-refs/m5/gate-c/ (leave, holidays, plant
    weekly off and start date, shift form with history, reports, punctuality, notifications and the bell,
    settings cards, gate poster). Choices that go with it: the poster privacy text is 11 pt (10.5 pt with six
    shifts) so the shift-times box fits one A4 page (**to confirm with Tushar**); the rate limit of 20 report files in 10 minutes answers the spec's `TOO_MANY_REQUESTS` (the
    mock-up's `REPORT_RATE_LIMIT` was only a proposal); the leave overlap code stays `LEAVE_OVERLAPS`; "Leave from" on
    screens and the poster is the shift end (decision line 8). Spec §4.10 and §4.17 (old "leave from 16:30")
    are updated in the closing step.
19. **Gate poster layout (slice 4, built from the approved gate C mock-up):** the "Your shift times" box is
    built from the plant's active shifts and their rules of today (start + grace = "on time until", shift end =
    "leave from"). To make room, the card/face boxes are shorter and "See IN or OUT" and "NOT ACCEPTED" sit side
    by side. The M4 offline paragraph stays on the poster (the mock-up left it out) and the privacy text stays
    at 11 pt, so with more than six shifts the box lists FIVE and the sixth line says "and N more shifts: ask
    the plant office" (the mock-up listed six plus that line, which does not fit with the offline paragraph).
    New icon `clock.svg` (Lucide, ISC). **To confirm with Tushar** (changes the mock-up and spec §4.17 slightly).
20. **Slice 7 group A (dashboard, muster):** the Styles budget in `frontend/size-budgets.json` went from 13000 to
    14500 bytes (the new screens add classes; later groups add more; the gate budget is unchanged at 63.5 kB).
    Tile links go to `/admin/attendance?show=<tile>&plant_id=<id>` with `show` one of `inside`, `expected`,
    `arrived`, `late`, `not_arrived`, `on_leave`, `off_today`, `exceptions`, `to_decide`. The "On outside work"
    hero line is left out until the API has the number (M4b). Show more on the muster is client-side (the API
    has no paging). The count-up animation of the tiles is not built.
21. **Slice 7 group E (reports, punctuality, notifications, settings):** the "Admin menu and layout" budget in
    `frontend/size-budgets.json` went from 24400 to 26300 bytes (+1900; measured 25.2 kB): the bell button with its
    popover, the unread count and three more menu items are in the layout file; the bell panel itself, the
    notification list and every new page are lazy. Recharts 3.10.1 (MIT) is a new dependency named in the approved
    stack; it is imported only by the lazy punctuality page (about 100 kB gzip, never in the first load). Differences
    from the mock-ups, caused by the API: the notification list has no plant filter and no "Read" filter (the API
    filters by kind and unread only); notification texts carry no names (decision 0036 line 7 and the backend), so
    "Prakash asked..." reads "A correction was asked for 29/10/2026 at K134."; the report "done" line has no row
    count (the API sends none); the 20-files limit has no minutes in its text (the API sends none, it uses the
    existing code `TOO_MANY_REQUESTS`); the punctuality arrows come from a second request for the period before.
22. **M4b migration numbers (P0):** the spec's `0025_phone_access_and_accounts` and `0026_phone_punches` are
    built as **0026** and **0027**: M5 used one more migration than planned (0023 early-out mark, so
    notifications 0024 and shift swaps 0025). No content change.
23. **M4b context refactor (P0, plan cross-cutting 8):** `PunchContext` and `FacePunchContext` carry `plant_id`
    and `device_identity` (a `DeviceIdentity`: one gate device OR one phone sign-in) instead of the gate
    device. A stored punch tells its device with `Punch.device_key` (gate device, or for a phone punch its
    sign-in), so "another device" for the travel / two-devices flags and the review panel follows spec §7
    rule 14 (a phone punch is always another device than a gate; two phone punches only when the sign-ins
    differ). The review panel's "device often at the fence edge" hint counts gate punches only (a phone's
    position is not the gate's). Gate behaviour is unchanged (whole suite green).
24. **Punches without a gate device (P0, cross-cutting 9):** the punch log item's `kiosk` is `null` for a
    phone face punch (the export writes an empty device cell); the frontend type follows in P3/P4. Dashboard,
    day timeline and reports already allowed it. `COALESCE(location_plant_id, plant_id)` for inside-now and
    the muster stays in P2 as planned.
25. **Removal tools stay the only deleters (P0):** `remove_demo_plant` and `remove_test_employees` remain the
    only code that deletes punches, corrections or other append-only rows (AC-55 is about app code paths).
    They now also delete, for the removed people: phone sign-ins, phone punches, notice acceptances (trigger
    off inside the transaction, as for punches), passkeys, proofs, accounts, switches, phone challenges, M5
    corrections with their decisions and attendance days; the demo tool also deletes the demo plant's
    attendance days and alerts. The demo tool refuses when a phone punch of a real person was matched at the
    demo plant's fence (`location_plant_id`): that is real attendance.
26. **Gate-code key (for P2, plan cross-cutting 11):** `HMAC(APP_SECRET_KEY, "gate-code-v1")`, the pattern of
    the M4 time anchor, not HKDF as spec §7 rule 15 says. Same strength, no new environment variable.
27. **Phone body limits (P0):** `/phone/punch/face` and `/phone/proof/face` 384 KB (the same frames as the gate
    face punch), `/phone/punch/gate-code` 64 KB (spec), every other `/api/v1/phone/*` request 16 KB (the
    spec gives no value; sign-in, notice, card proof and passkey JSON are a few KB at most).
28. **Phone tables, details the spec leaves open (P0):** hash columns are `varchar(64)` with a lower-hex check
    (the project's pattern) instead of `char(64)`; `phone_sessions.browser` / `system` are required and
    `user_agent` may be empty; extra checks: no negative failure or sign counts, a proof token always has
    an end, a session ends after it starts, a challenge belongs to exactly one gate device or sign-in.
    `phone_notice_acceptances.session_id` is required and the table is append-only, so the 90-day clean-up
    of ended sign-ins (P3) must **keep a sign-in that an acceptance points to** (it cannot be set to null).
    **To confirm with Tushar** (small, but it means a few old sign-in rows stay as the consent trail).
29. **Password gate (P0, spec §7 rule 9):** `app/core/password_gate.py`: one process-wide semaphore of 2 around
    every employee password check (real and dummy), wait at most 5 s, then `TOO_MANY_REQUESTS` (429); the
    slot is freed when the check fails. P1 wraps login and password set in it.
30. **Gate-code button text (design gates P1 and P2, Anuradha, 2026-11-01):** the button and the scan page title
    for ID-card workers say "Scan the QR code" instead of the spec text "Scan the phone code at the gate"
    (M4b spec §4.8 and §4.10). The mock-ups use the new text; the spec text is updated in the closing step.
    The gate panel heading "Phone code" is unchanged for now. **To confirm with Tushar.**
31. **Weak-location text on the phone (design gates P1 and P2, Anuradha, 2026-11-01):** "Move to an open place."
    becomes "Move outside, where the sky is open." in the phone texts (M4b spec §4.8, §9 and risk table). The
    mock-ups use the new text; the spec is updated in the closing step. The existing gate texts (M4) do not
    contain "open place" and are unchanged. **To confirm with Tushar.**
32. **Browser-not-supported text (design gates P1 and P2, Anuradha, 2026-11-01):** `PHONE_BROWSER_UNSUPPORTED`
    reads "Please open this page in Chrome or Edge on your phone." instead of "...in a current Chrome or Edge."
    (M4b spec §9). The mock-ups use the new text; the spec is updated in the closing step. **To confirm with
    Tushar.**
33. **Weak-location picture (design gate P2, Anuradha, 2026-11-01):** "Location not exact enough" shows a small
    map picture (a dot for the phone, a dashed circle for the 50 m the plant needs, an amber circle for the
    80 m the phone reports) with a word legend, instead of the "± 50 m needed" chip.
34. **Design gates P1, P2 and P3 approved (Anuradha, 2026-11-01)** with the mock-ups in
    `docs/design-refs/m4b/gate-p1/`, `gate-p2/` and `gate-p3/` and these choices: (a) `PHONE_FACE_NOT_READY`
    reads "Your face is not set up for attendance. Please visit the plant office." everywhere (M4b spec §9 text,
    not the shorter §4.8 text); (b) the sign-in link and the lockout and new-password messages all say
    "First time or forgot your password?"; (c) the mock-up choices stand: the main button stays active when the
    location is weak, `/phone/passkey` is the passkey page, the dashboard gets the small Phone attendance card and
    the "with Phone punching on" line on Cards ending soon, phone sign-ins are shown in the audit log by default,
    and a left employee's phone card is shown with everything off and disabled. Texts the spec does not give
    are the mock-up texts (listed in each gate's README); the notice wording is a layout draft and the final
    text is for the lead to confirm (DPDP notice). **To confirm with Tushar:** decisions 30 to 33 and 34 (c).
35. **Phone sign-ins remember how they were made (P1, migration 0028):** `phone_sessions.sign_in_method`
    (`password` / `proof` / `passkey`). Spec §7 rule 29 allows a passkey only within 10 minutes of a password
    or proof sign-in; the sign-in row is the only place that can say which it was. A passkey sign-in can never
    add a passkey.
36. **py_webauthn 3.0.1 (P1):** the spec named "latest 2.x"; 3.0.1 is the current release (BSD-3-Clause, same
    API). Its own dependencies are cbor2 (MIT), pyasn1 and pyasn1-modules (BSD-2-Clause) and pyOpenSSL
    (Apache-2.0), not asn1crypto as the spec guessed. All free.
37. **Passkey user handle (P1):** 32 bytes, the same for all of an employee's passkeys and never the employee
    code. The first one is `HMAC-SHA256(APP_SECRET_KEY, "passkey-user-handle-v1:" + employee id)` (looks random
    to everyone else and needs no storage between "options" and "register"); later passkeys reuse the stored one.
    The passkey's `user.name` shown in the phone's own passkey list is the employee code, the display name the
    full name (stored on the phone only).
38. **Passkeys and a self reset (P1, to confirm with Tushar):** setting a new password after a face or card proof
    does NOT remove passkeys; only "Require a new password", phone punching OFF, "Stop phone punching" (kind
    `phone_off`) and "mark as left" do (spec §7 rule 29 lists exactly these). A reset still ends every other
    sign-in. If the lead wants a reset to remove passkeys too, it is one line in `proof_service.set_password`.
39. **Passkey sign-in while the password is locked (P1):** allowed. The lock protects against password guessing;
    a passkey cannot guess one, and a failed passkey does not count towards the lock (spec rule 29).
40. **Ended sign-in answers (P1):** a request with an ended sign-in answers `PHONE_NOT_SIGNED_IN` with
    `details.ended` = the end reason (`new_login` lets the phone show "You signed in on another phone…",
    `expired` = idle or 30 days), except a sign-in ended by phone punching OFF, which answers `PHONE_PUNCH_OFF`
    (AC-7). The cookie `ups_phone` is `Secure` everywhere except `APP_ENV=development` (plain http on a laptop).
41. **Face proof answers (P1):** quality and turn problems (`NO_FACE`, `MULTIPLE_FACES`, `FACE_TOO_SMALL`,
    `FACE_QUALITY_LOW`, `LIVENESS_FAILED`, `FRAMES_INVALID`) and a used or old challenge (`CHALLENGE_INVALID`,
    `CHALLENGE_EXPIRED`) answer 422 with `details.retry_allowed`, the same for every typed code; a printed photo
    (`SPOOF_SUSPECTED`) and a different face in the turn picture (`FACE_INCONSISTENT`) are "not you" and answer
    `PROOF_FAILED`. The candidate also needs an active agreed face consent (as the punch, rule 10). Their admin
    texts `errors.<CODE>` are phone texts (new codes for the admin text file). A card proof that fails the place
    check (`LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `GEOFENCE_NOT_SET`, `OUTSIDE_GEOFENCE`) answers 422
    without the 1-second wait (it is only reached with a valid card, as the spec says).
42. **Switch details (P1):** saving outside work with the same values again changes nothing and writes no audit
    row; switching it OFF (also by phone OFF, self stop, leaving or the F-69 job) clears the "until" date (the
    audit keeps it). "Mark as left" writes `phone_access.disable` (actor = the Super Admin, reason = the leaving
    reason) only when phone punching was ON; `phone_changed_by` is null as the spec says. The admin card answer
    also carries `outside_work_ended` (F-69, "Outside work ended on …") and the active `passkeys` (spec §4.12).
43. **Clean-up (P1):** the daily job (not the 5-minute face job) deletes `phone_proofs` older than one day and ended
    or run-out sign-ins older than 90 days, keeping every sign-in that a notice acceptance OR a punch points to
    (both tables can never change). Old phone head-turn challenges are already removed after a day by the M3 job.
44. **Built earlier or later than the plan (P1):** the F-69 daily switch-off and the F-70 many-phones alert are
    built in P1 (they hang on the sign-in and switch code written here; the plan had them in P3).
    `GET /phone/punches/today`, `GET /phone/attendance` (F-73) and the employees list filter `phone=on|off` are
    left for P2/P3. The phone notice v1 text (`app/phone/notice_texts/phone-notice-v1.en.txt`, its hash fixed by
    a test) is written from the approved mock-up sections and mentions passkeys; the wording is **for Tushar to
    confirm** (a new version, never an edit, if it changes).
45. **Phone punch pipeline (P2):** `app/modules/phone/punch_service.py` (challenge, face punch, gate-code punch),
    `app/antiproxy/rules/{phone_location,face_match_one_to_one,gate_code}.py`, rule lists `PHONE_FACE_RULES` and
    `GATE_CODE_RULES` in `engine.py`. A retry (same sign-in + `client_punch_id`) is answered from the stored row
    before any other work after the notice and path checks. The phone has **no early-OUT alert** (decision 0036 line
    9 belongs to the gate screen; the M4b spec does not mention it for phones, so a phone OUT is stored at once and
    carries no `early_out_mark`). **To confirm with Tushar:** should a phone OUT before the shift end ask first?
46. **Location on the phone (P2):** a reading without `age_s` or older than `phone_location_max_age_seconds` counts as
    no reading (`LOCATION_REQUIRED`); a request without any location is a decided refusal, not a request error.
    A refused row still stores the position the phone sent. `plant_id` of a phone row = the employee's plant on
    the punch date; `location_plant_id` = the matched plant (own, or another on outside work) and stays empty for
    `OUTSIDE_PLANT` and for a refused punch. The "other plants" check uses every active plant with a current
    fence (DEMO plants too: they are real plants for the rule) and takes the nearest plant that holds the position.
47. **The phone code (P2):** key = `HMAC-SHA256(APP_SECRET_KEY, "gate-code-v1")` (the same pattern as the M4 time
    anchor; the spec said HKDF, the result is equally a derived key, no new environment variable). The endpoint
    `/api/v1/kiosk/gate-code` accepts **POST (the spec table) and GET (the brief of this slice)**; the request
    changes nothing and the device signature covers the method either way. **To confirm with Tushar:** keep both
    or only POST. "Anyone to scan": the "is a QR worker with phone punching ON at this plant" answer is remembered
    60 s per process (`gate_code_service`); a worker switched on may wait up to a minute for the first panel.
48. **A code that names no known device (P2, to confirm with Tushar):** migration 0027 allows `method = gate_code`
    only with a gate device (`kiosk_id` not null), so a text that is unreadable or names a device that does not
    exist is answered `200 rejected GATE_CODE_INVALID` with `punch_id: null` and **no row** (one warning line in
    the server log, no personal data). A text that names a real device is always stored (also when the MAC is
    wrong, the code is old or the device is revoked), with `kiosk_id` = that device.
49. **Gate-code rows (P2):** `plant_id` = the gate device's plant, `location_plant_id` = the employee's plant,
    `employee_id` on every decided row, no `qr_credential_id`. The selfie is kept also when an earlier rule
    (place, weak reading) refused the punch (AC-33): the photo is checked after the decision for that reason.
    The gate device's `last_punch_at` is updated by every stored gate-code row, as for a card punch.
50. **Where a person is inside (P2, M5 amendment of rule 17):** `dashboard/service.standing_plant_id(punch)` =
    none for an `OUTSIDE_PLANT` punch, else `COALESCE(location_plant_id, plant_id)`. `people_inside` also looks at
    employees of other plants who punched by phone inside the asked plants within `open_in_max_hours`. New:
    `on_outside_work` in the live numbers (per plant and total; counted for the HOME plant) and `home_plant` on a
    muster person (also in the muster PDF, "Name (K134)"). The still-inside alert goes to the plant where the person
    stands. The attendance day, the register and the reports stay with `plant_id`.
51. **Many-rejections alert (P2, decision of the P1 note):** it counts only punches of channel `kiosk`. Refused
    phone gate-code punches carry the gate's `kiosk_id` but say nothing about the device (a slow phone, an old
    code), so they are left out. **To confirm with Tushar** (one line in `notifications/alerts.py`).
52. **F-73 and "today" (P2):** `GET /phone/punches/today` = the employee's counted punches from the start of today's
    attendance day window (M5, a few hours before the shift; midnight IST when there is no shift) until now, each
    with `decision_text_key` `phone.punch.accepted.in|out`. `GET /phone/attendance` = the last 31 days ending today
    from the stored days (brought up to date first), without `not_employed` days; `channels` = the channels of the
    counted punches between the day's first IN and last OUT. No flag, reason or review mark appears in either.
53. **Phone rate limits (P2):** 10 challenges and 10 punches a minute per phone sign-in, 6 phone-code requests a
    minute per gate device (spec rule 8). `/kiosk/me` and the heartbeat carry `kiosk_settings.phone_code`
    `{enabled (the setting only), refresh_seconds (life minus 10, at least 5), show_seconds}`.
54. **Texts (P2):** new stored codes `GATE_CODE_INVALID`, `GATE_CODE_EXPIRED` and the flag `OUTSIDE_PLANT` (with a
    help text) are in `punchReasons` and in the Excel words (`reasons.py`, one test keeps them equal). The phone
    result texts `phone.punch.<CODE>.title|message|next` and the settings labels are written in P4 with the pages.
55. **Bulk confirm "clean" test (P3, to confirm with Tushar):** a punch is bulk-confirmable when it is a phone punch,
    `flagged`, its `reason_codes` are exactly `["OUTSIDE_PLANT"]`, a face matched (`employee_id` set) and it has no
    review. The spec's "outside work allowed on the punch date" is NOT checked again against today's switch: the
    engine writes `OUTSIDE_PLANT` only while outside work is allowed, and the daily job switches it OFF when the
    until date passes, which would otherwise make every old punch of that visit un-confirmable in a batch.
56. **Bulk confirm answers (P3):** `POST /reviews/bulk-confirm`, 1 to 100 items (101 = `VALIDATION_FAILED`, also for the
    same punch twice or a note over 300 characters), Super Admin only (`FORBIDDEN` for the others). Each item has its own
    transaction. Per-item codes: `NOT_FOUND`, `REVIEW_CHANGED`, `REVIEW_NOT_ALLOWED` (a refused punch), `NOT_BULK_CONFIRMABLE`
    (also a punch that already has a review, even when the screen knew it). The note becomes the `reason` of each
    `confirmed` row and of the audit row; audit `punch_review.confirm` carries `bulk: true`.
57. **Review list rule for phone refusals (P3):** the "Rejected" tab and the sidebar number list a refused phone punch only when it
    names an employee (`employee_id` or `claimed_employee_id`); gate refusals are all listed as before. `channel=phone` on
    `GET /reviews` is a plain filter on top of the tabs. `OUTSIDE_PLANT` reaches the flag counts of `/reviews/summary`
    through the existing `by_code` count, and the screen's code filter list.
58. **Outside-work reason (P3, to confirm with Tushar):** `outside_reason` of a review item = the reason of the latest audit
    entry `phone_access.outside_on` of that employee made before the punch (the reason is kept in the audit log only, as
    the spec says); null when there is none. It is not a new column.
59. **Phone position visibility (P3, to confirm with Tushar):** for a phone punch `PunchDetail.location` (lat, lon, accuracy) is
    sent only to the Super Admin; the other roles get `location: null` and the new `location_accuracy_m` plus the
    existing `geofence_distance_m`. Gate punches keep the M2/M4 rule (every role with the punch log sees the position).
60. **New punch-log fields (P3):** `channel`, `outside_plant`, `phone_browser` ("Chrome on Android", browser and system only),
    `location_plant` (the plant whose fence matched, only when it is not the home plant). A phone punch inside another
    plant's fence stays in the HOME plant's log (a Plant Head of the visited plant does not see it, spec 10 answer 6).
    The Excel export gains the columns "Channel" ("Attendance device" or "Phone") and "Outside plant" (Yes/No) at the end.
61. **Employees list, audit, cards (P3):** `GET /employees?phone=on|off` and `phone_punch_enabled` on every item; audit entries
    of `actor_type = employee` carry `actor_name` (full name) and the new `actor_code`; the QR card list items carry
    `phone_punch_enabled` and `/qr-cards/expiring-count` carries `phone_on_count`.
62. **Settings labels (P3):** the ten `phone` and phone-code settings have `settings.items.<key>` labels and a
    `settings.groups.phone` title in `common.json`; the settings page does not show the group until P4 adds the card.
63. **Phone area in the frontend (P4):** `/phone/*` is one lazy area (`frontend/src/features/phone/`, every file starts with `phone-`
    so the size budget can name them). It has its own layout and is not in the admin menu. The passkey page is at `/phone/passkey`
    (the mock-up proposal). `/phone` alone opens the home page. The face check of the password step and the face punch use the gate's
    tested pieces (`kiosk/attendance/camera.ts`, `face-sequence.ts`, `face-capture.ts`, `qr-reader.ts`) and start by themselves as soon
    as the camera shows a picture, so the person does not tap "Begin" (the mock-up had no extra button).
64. **Phone result and problem texts (P4, to confirm with Tushar):** `phone.punch.<CODE>.title|message|next` are written for every code of
    the P3 list, reusing the gate wording; refusals end "Please visit the plant office.", camera, location and timing hints end "Please
    try again.". New wording that no spec line gives: `GATE_CODE_INVALID` "This phone code is not valid.", `GATE_CODE_EXPIRED` "The phone code
    has changed. Please scan the code again.", `EMPLOYEE_NOT_FACE` "Punching with the phone code is not for you.", `EMPLOYEE_NOT_QR` "Punching
    with your face is not set for you.", `GEOFENCE_NOT_SET` "This plant is not set up for phone punching yet.", `COOLDOWN_ACTIVE` and
    `OUT_TOO_SOON` without a time (the phone answer carries no last punch), `FACE_QUALITY_LOW` "The picture is too dark or blurry. Please try
    again." (the gate says "switch on the gate light"), `WRONG_PLANT` uses the face text "You are registered at another plant." for the phone
    (mock-up open question 1), `PHONE_FACE_NOT_READY` uses the section 9 text "...not set up for attendance..." everywhere (open question 2),
    the sign-in link and the lock text keep both sentences of the spec ("First time or forgot your password?").
65. **Accepted result has a Back button and no timer (P4, to confirm with Tushar):** mock-up open question 4. The phone result stays until the
    person taps "Back". "Outside work ended" shows the same refusal as outside work off (open question 5); no extra sentence.
66. **Gate phone code panel (P4):** the panel is one small component on the idle gate screen (`phone-code-panel.tsx`, `use-gate-code.ts`). It
    uses `POST /kiosk/gate-code` (decision 47), asks again at `refresh_in_seconds` (at least 3 s), shows "Phone code not available now" after 15 s
    without a fresh code and when the shown code has expired, and draws the server's SVG through an `<img src="data:image/svg+xml">` (an image
    never runs scripts). The card reader says `kiosk.attendance.phoneCodeAtDevice` for a `UPG1.` text and sends nothing. The gate chunk is 61.1 kB
    gzip of the 63.5 kB budget: no raise was needed.
67. **Size budgets (P4):** new entry "Phone pages (loaded only on /phone)" for the files named `phone-*.js`: measured 24.9 kB, limit 27.9 kB (measured plus
    10 percent). The "Styles" budget goes from 14500 to 16000 bytes (measured 14.2 kB): the phone screens add Tailwind classes to the one shared
    style file (to confirm with Tushar, same kind of decision as lines 20 and 21).
68. **Vercel headers for /phone (P4, S-47):** two rules (`/phone`, `/phone/:path*`) after the catch-all rule, with the CSP of the spec (script-src
    `'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `worker-src 'self' blob:`), `font-src
    'self' data:`, `manifest-src 'self'`, `object-src 'none'`, and `style-src 'self' 'unsafe-inline'` (the oval and the timer bar use inline style
    values; the plan said "only if needed"). `Permissions-Policy` has camera, geolocation and both passkey permissions; `Referrer-Policy: no-referrer`.
    A Vitest test reads `vercel.json` and checks the order and the values. The dev server sends no such headers, so the Playwright run cannot count
    CSP violations (AC-58 second half stays for a check on the real Vercel address after deploy; to confirm with Tushar).
69. **Home screen (F-74):** `public/phone.webmanifest` (scope `/phone`, start `/phone`, two icons) is linked only while a phone page is open, and the
    home page shows "Add to home screen" only when Chrome offers it (`beforeinstallprompt`). There is no service worker for the phone area (the gate
    keeps the only one, scope `/attendance`).
70. **Admin side (P4):** the "Phone attendance" card sits in the Details tab of the employee page, under the QR card panel. Every change asks for a
    reason (3 to 300 characters). A left employee shows the card with disabled switches and no buttons (mock-up open point 3). The "Phone" filter of
    "Needs review" is a select ("Any channel" / "Phone"), not a segmented control; the bulk check boxes exist only on the "To check" tab with the Phone
    filter, 100 at most; a failed row is listed in words under the bar after the call. Punch log: new filters "Channel" and "Outside plant", the
    method "Phone code", the column "Channel" instead of "Attendance device". The map position of an outside punch in the punch log detail is NOT
    built (the Needs-review sheet already has the map); the detail shows the distance and, for other roles, the "position is only for the Super Admin"
    line (to confirm with Tushar).
71. **S-49 memory check (P4):** `face_memory_check.py phone` signs in 8 phones and sends 4 phone face punches at the same moment against the 512 MB
    container (the throw-away database now also holds 8 extra phone employees and a phone password for every face employee). A sign-in may answer 429
    (the semaphore of rule 9); any 5xx or other answer fails. The CI step runs before the existing peak-memory step, which now covers both. The
    Playwright phone project is Pixel 7 (Chromium); an iPhone project is not possible with the virtual authenticator (WebKit), so the iPhone 13 size is
    only checked in `responsive.spec.ts`.
72. **Bug found by the e2e run (P4):** after a sign-in the top bar did not show the name and the Menu button, because the sign-in cleared the data with
    `removeQueries` while the bar watched the old query. The pages now reset the queries (`forgetPhoneData`) and a unit test covers it.
73. **Review fixes, backend (2026-11-02, after /review-milestone; the lead said "fix everything").**
    - **Proof limits:** only a failed FACE proof (it used the face worker) counts towards the 60-in-10-minutes company-wide limit. A card text
      that is not a real card (bad shape or signature) counts only against the per-IP limit. A genuinely signed card that is refused
      (revoked, expired, phone off) counts per card serial: 10 in 10 minutes, then `TOO_MANY_REQUESTS`.
    - **Selfie without a face (to confirm with Tushar):** a phone gate-code punch is still accepted on a readable JPEG, as before. When F-30
      later finds no face on that selfie, the Super Admin gets the bell notice `phone_selfie_no_face` (one per plant and day, a count
      and the plant code only, no name or code; migration 0029 adds the kind) and the daily review digest has `phone_selfie_no_face` per
      plant. The decision of the punch never changes. Should such a punch be refused or flagged instead? Asked of Tushar.
    - **Phone positions:** for a phone punch the other roles now also get `location_accuracy_m: null` and `geofence_distance_m: null`
      (they say where the person was); this changes line 59 (to confirm with Tushar). The Super Admin opening a phone punch position
      (punch detail or review panel) writes the audit entry `punch.location_view`, like `snapshot.view`.
    - **A code naming no device** leaves the audit entry `phone_punch.gate_code_unknown_device` (employee and sha256 of the text, never the text).
    - **Timing and shape:** a locked account runs the dummy password check before answering `PHONE_ACCOUNT_LOCKED`; a code with no
      passkey (or no such code) gets one made-up credential id (HMAC of the code) in the passkey options.
    - **90-day clean-up (line 43):** a kept sign-in row (the notice trail or a punch points at it) loses ip, browser, system and user agent
      (browser and system become empty text: the columns are required). `punches.ip` of a phone punch stays: the append-only trigger of
      `punches` refuses any change (open point 2 of docs/compliance/m5-m4b-open-points.md).
    - **One range check:** `check_date_range(from, to, max)` answers `REPORT_RANGE_TOO_LONG` for "Choose at most N days." (before: `VALIDATION_FAILED` for
      corrections and the punch approvals) and `VALIDATION_FAILED` for an end before the start (the corrections list used to answer an empty list).
    - **Renames and refactors, no behaviour change:** `face_service.lock_and_decide_in_out` (was `after_identity`), `attendance_service.DayLoader`,
      public `role_path`, `describe_day`, `row_from_request` of the corrections service, `users/names.py` `user_names`.
    - **Open points that need the client, HR or legal advice** (not code): docs/compliance/m5-m4b-open-points.md.
74. **Review fixes, frontend (2026-11-02, after /review-milestone; the lead said "fix everything").**
    - **Selfie alert:** the kinds `phone_selfie_no_face` and `phone_many_phones` (it was missing from the Super Admin's email list) have a name, an icon,
      a text and a link in the bell and on the Notifications page. The daily digest card shows "Phone selfies without a face N" for a plant when
      the number is above 0. Nothing is shown for the heads (the server sends these to the Super Admin only).
    - **Phone positions for the heads:** the punch detail already hid empty accuracy and distance; with both `null` it shows no row at all (nothing
      like "null"). The line "The exact position is only for the Super Admin" stays where the distance row was; for a head it is now shown
      only if the server sends a distance, so it can disappear (**to confirm with Tushar**: should the line always show for a phone punch?).
    - **Audit viewer actions:** not changed. The audit page shows the raw action name (`punch.location_view`) for every action and has no label
      list, so the new actions follow the same rule (the reviewer's finding assumed labels that do not exist).
    - **Errors 4 and 5:** the corrections page and the punch approvals already show `errors.REPORT_RANGE_TOO_LONG` through `describeError`, and
      the card proof of the phone shows `phone.punch.TOO_MANY_REQUESTS` ("PLEASE WAIT"); a test covers the second. Its message is now "This was NOT
      saved." (it said "Your punch", wrong for a card proof).
    - **Plain gate and phone words:** `SERVER_NO_ANSWER` is "No answer in time. Scan your card again." (the old "If it was saved, you will see
      it" is gone); the gate "server is starting" is "Please wait. This can take up to a minute."; the gate `CHALLENGE_INVALID` message is "The check
      could not be finished."; `PUBLIC_KEY_INVALID`, `DEVICE_SIGNATURE_INVALID`, `DATABASE_UNAVAILABLE`, `ITEM_SIGNATURE_INVALID` say what to do, not
      how it failed. `errors.GATE_CODE_INVALID`, `GATE_CODE_EXPIRED`, `NOT_A_GATE_CODE` were added (the phone screens use their own `phone.punch.*`).
    - **Location refusal texts are NOT changed:** no spec forbids naming the location problem. M2 FR-20 hides the detailed reason of a refusal
      (for example the revoke reason), and M4b §9 says "camera and location hints" are allowed (decisions 0013, 0022, 0025, 0035 say nothing against it).
      Gate and phone keep "You are not at the plant." and the like (**to confirm with Tushar**: if the client wants one neutral sentence for
      every location refusal, it is five text keys).
    - **Checks:** `i18n:check` already compared every server `ApiError` code with `errors.<CODE>` (`check-error-codes.mjs`, the review looked only at
      `check-translations.mjs`). New: `check-translations.mjs` checks that every group under `kiosk.punch`, `phone.punch` and `kiosk.problem` has
      its title, message and next line (or steps). The gate and phone codes cannot be listed from the backend (they are rejection reasons
      built in code), so completeness of the groups is the check.
    - **Layout:** the period boxes of the punctuality page and the time and month boxes of the corrections, employee and leave screens grow with
      their label (`min-w`, no fixed width); the day drawer title and subtitle have a `title` tooltip. The gate "Phone code" sentence already wraps
      centred in the full-screen view of a phone, so it is not shortened.
    - **Tests added:** AC-52 (a unit test and a Playwright check), AC-38, AC-48 (no storage written), `responsive.spec.ts` now also measures the
      employee page with its Phone attendance card and Attendance tab at 360 px and 768 px (all other M5 and M4b pages were already listed).
    - **Reports page:** `ReportCard` is split into `useReportDownload`, `ReportFilters` and `ReportMessage`; `LIMITS` moved to the top. No change in
      behaviour.
