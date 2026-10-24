# 0018 – M3: five enrolment poses, no on-screen timer

Date: 2026-10-24 · Decided by: Tushar Gawande (lead), through Anuradha in chat, after design gate B ·
Status: Accepted. Changes decision 0016 item 10 and spec §4.9, §7.

1. **Five enrolment shots, not eight:** straight, left, right, up, down. The poses "a little closer",
   "a little farther" and "wearing what you wear at the gate (helmet, glasses)" are removed.
2. **No countdown on the enrolment screen.** The "have the helmet and glasses ready" tip is removed.
3. **Session limit:** the 15-minute limit is replaced by **1 hour without activity**. The server
   still closes an abandoned session after that, so half-finished face data is not kept
   (DPDP storage limit); the admin sees no timer. "This enrolment took too long. Start again." stays
   as the fallback text.
4. Template = mean of the 5 shots. Backend change needed: `ENROLMENT_POSES`, the pose and
   `shot_count` check constraints (new migration), `SESSION_MINUTES`, enrolment checks, tests.
   (Open: done after the lead's "ok", see the plan Status.)
