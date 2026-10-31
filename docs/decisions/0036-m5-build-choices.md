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
