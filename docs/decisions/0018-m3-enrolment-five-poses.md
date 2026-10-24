# 0018 – M3: five enrolment poses, no on-screen timer

Date: 2026-10-24 · Decided by: Tushar Gawande (lead), through Anuradha in chat, after design gate B ·
Status: Accepted. Changes decision 0016 item 10 and spec §4.9, §7.

1. **Five enrolment shots, not eight:** straight, left, right, up, down. The poses "a little closer",
   "a little farther" and "wearing what you wear at the gate (helmet, glasses)" are removed.
2. **No countdown on the enrolment screen.** The "have the helmet and glasses ready" tip is removed.
3. **No time limit while the admin works.** Leaving the wizard cancels the session at once. The
   15-minute limit is replaced by a clean-up only: **2 hours without activity** (each shot restarts
   the clock), so half-finished face data of a closed browser is not kept (DPDP storage limit). No
   timer and no "took too long" screen; a wizard that finds its session closed goes back quietly
   to the camera check. (Changed from 1 hour on the lead's instruction.)
4. Template = mean of the 5 shots. Backend change needed: `ENROLMENT_POSES`, the pose and
   `shot_count` check constraints (new migration), `SESSION_IDLE_MINUTES`, enrolment checks, tests.
   Done in session 2.
