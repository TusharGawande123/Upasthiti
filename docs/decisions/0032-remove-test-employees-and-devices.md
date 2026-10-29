# 0032 – One-time removal of test employees and test devices in plant K134

Date: 2026-10-29 · Asked by: Anuradha · Approved by: Tushar Gawande (lead), who alone may make an
exception to CLAUDE.md section 5 · Status: Accepted, **one exception, not a new habit**.

## Why
During the real-device check of M4 (decision 0030) Anuradha made seven test employees (codes 101 to 107:
with face or with QR cards C000007 to C000009), their face data, cards, punches and punch
log entries, and two test attendance devices (`plant1`, `plant2`) in the REAL plant K134. Tushar has
not tested yet and wants the live site clean first. `remove_demo_plant` refuses a plant whose code does
not start with DEMO, and the screens never delete people or punches (labour-law record keeping).

## What
- New tool `uv run python -m app.scripts.remove_test_employees --plant-code K134 --employee-codes 101
  102 103 104 105 106 107 --device-names plant1 plant2` (add `--confirm` to delete).
- It deletes ONLY the typed employee codes and device names, inside the named plant: their face data,
  QR cards, punches, reviews, snapshots (database rows first, photo files after the commit), shifts,
  plant history, change requests, device health samples and pairing codes.
- Rails: a code or name that does not exist in that plant stops the run; at most 20 employees per run;
  a punch of somebody NOT in the list at a typed device stops the run; a punch that stays but points at
  a punch that goes stops the run; without `--confirm` it only shows; with it the plant code is typed
  again; one transaction; the punches protection is off inside it only and on again after (tested).
- **The audit log is never touched.** One line `test_data.removed` (counts only, no names) is added.
- Tushar runs it on his laptop with the production values set for that one command (the Supabase
  keys are in his account), first without `--confirm` to read the list, then with it.
- Tests: `backend/tests/test_remove_test_employees.py` (named rows only, plant and others stay,
  protection on again, typo, other plant, other person's punch, too many).

## What does not change
The rule "never hard-delete attendance, audit or employee records" stays for everyone and everything
else. This tool is not linked from any screen or API and never runs by itself. CLAUDE.md section 9 gets
one line for it in the next milestone's CLAUDE.md update (not edited outside a milestone PR).

## Addition (2026-10-30): refused scans that name nobody
The first live run refused: 5 punches at `plant1` / `plant2` named nobody (refused scans of unknown
cards or failed faces during the test). They are test noise at a test device, not anybody's attendance.
The tool now lists such punches (time, decision, reason code, no names) and deletes them only when the
run adds `--include-unidentified-punches`. A punch that names another employee is still always refused,
with or without the flag (tested).
