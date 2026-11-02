# 0035 – M4b decisions: optional phone punching with employee login

Date: 2026-10-31 · Decided by: Tushar Gawande (project lead), in chat · Status: Accepted.
Details: docs/specs/M4b-phone-punch.md (Approved). Builds on decisions 0004 (phone punching per employee),
0016/0017/0023 (face), 0025 (location, flags, review) and 0034 (M5).

## Order
1. M4b is built in the same branch (`milestone/M5-attendance-reports`) and the same PR as M5, after the M5
   slices. Decision 0034 item 1 is amended.

## Sign-in (changes "employees never log in")
2. An employee whose phone punching is ON signs in on the `/phone` web pages with **employee code +
   password**. No pairing code and no QR from the Super Admin (too much work for many phones). Employees
   with phone punching OFF cannot sign in. Admin and employee sessions are fully separate.
3. **The employee makes the first password** after proving who they are, with no admin step: a face
   employee by face + liveness with a 1:1 match; a temporary (QR) employee by scanning their own valid ID
   card. A forgotten password uses the same proof. Passwords: 8+ characters, not only digits.
4. **Any phone may be used** (no binding to one registered phone; this replaces "only the employee's
   registered phone" in decision 0004 and SRS FR-44). Only **one phone signed in at a time**: a new sign-in
   signs the older phone out. The Super Admin can sign an employee out of all phones and require a new
   password.

## Punching
5. The Super Admin switches phone punching ON/OFF per employee (permanent and temporary), with a reason,
   audited, default OFF.
6. Face employees punch on the phone with face + liveness (same server checks as the gate face path).
   Temporary (QR) employees scan the **changing code shown on the gate attendance device screen** with their
   phone; a photo is saved like a card punch. A valid ID card is NOT needed for a phone punch (login is
   enough); "Cards ending soon" shows "Phone punching on" as a reminder.
7. **Outside the plant:** per employee switch "Outside work allowed" (Super Admin, reason, optional until
   date). ON: a phone punch outside the own plant's fence is accepted, GPS saved, flagged `OUTSIDE_PLANT`
   and reviewed. Inside ANOTHER Sheet Shapers plant's fence it is accepted without a flag; that person
   counts in that plant's "Inside now" and muster (with name, code and home plant, for safety) while the
   register stays with the own plant. OFF: a phone punch outside the own fence is rejected
   (`OUTSIDE_GEOFENCE`), like the gate.
8. Every phone punch goes through the server rule engine and the M5 rules (one IN/one OUT, too soon to
   OUT 30 minutes, `SHIFT_ALREADY_CLOSED`). Every phone punch is in the punch log ("Phone" filter);
   "Needs review" lists only flagged phone punches and refused ones that name an employee.
9. No offline phone punching.
10. An IN tagged "Outside plant" does not count as inside any plant (M5 spec §7 rules 17, 19, 29 amended,
    lead approved).

## CLAUDE.md (changed in the M5 PR, lead approves the diff)
- "Employees never log in" becomes: employees sign in only for phone punching (M4b).
- The "every page reachable from the phone menu" rule applies to admin pages; `/phone` pages must still
  fit 360 px and be in `responsive.spec.ts`.
- New backend package `webauthn` (py_webauthn, BSD-3-Clause) for the optional passkey sign-in (F-80).

## Extras (list: accepted-extras.md)
Approved: F-69, F-70, F-73, F-74, F-76, F-80, S-46, S-47, S-49. Later: F-71, F-72, F-75, F-77, F-78, F-79,
F-81, S-45, S-48.
