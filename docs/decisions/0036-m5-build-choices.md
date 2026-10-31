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
