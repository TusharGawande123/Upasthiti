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
9. **Gate refuses an OUT before the shift end** (Anuradha, same chat; **to confirm with Tushar and the
   client**; built in slice 3). The refusal shows the time left ("Your shift ends at 17:00, 32 minutes left").
   The Super Admin can still approve such a punch in "Needs review" and corrections cover real early leaves.
   Open: how this applies to temporary workers (spec example T2 leaves at 12:00) and to offline punches.
