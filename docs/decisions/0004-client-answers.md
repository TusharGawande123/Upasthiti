# 0004 – Decisions after the client's answers (October 2026)

Date: 2026-10-12 · Decided by: Tushar Gawande (project lead) · Status: Accepted
Input: [docs/client/client-answers-2026-10.md](../client/client-answers-2026-10.md)
Changes: CLAUDE.md, docs/SRS.md, docs/architecture.md. Amends 0002 (hosting).

## Decisions

1. **Gate kiosk stays the main way to punch.**
2. **Phone punching is an option per employee (new milestone M4b, after M4).**
   - An employee asks; an admin switches phone punching on or off for that employee.
   - A phone punch can be made at the employee's own plant: then the plant geofence is
     enforced, as for kiosks.
   - It can also be made while on official work outside (another city or site): then the
     GPS position is saved but not enforced, and the punch is tagged "outside plant".
   - Safety checks: only the employee's registered phone; face + liveness on the phone;
     the server re-checks everything; every phone punch appears in the punch review list.
     The exact rules are written in the M4b spec.
3. **Temporary workers may also scan a changing QR shown on the gate screen with their own
   phone (proposal Q1 option B), built in M4b.** The ID card at the gate camera (option A)
   stays the default and is built in M2.
4. **Hosting stays on the free tiers** (decision 0002), for development and for production,
   as long as they handle the client's data well. Only if they are not enough does the
   system move to the client's own server. The app stays portable (configuration through
   environment variables, backend Dockerfile), so that move stays possible.
5. **One company:** all seven plants belong to Sheet Shapers, even though some carry other
   names (Precise Cuts, Siddharth Pressings, Tirupati Pressco). The data model keeps
   plants only; no separate company level.
6. **Roles: exactly three levels**, with no HR or supervisor users:
   - **Super Admin**;
   - **Corporate Head**: oversees permanent employees across plants;
   - **Plant Head**: one plant.
   The exact permissions are decided in the M1 spec. Tasks the earlier documents gave to
   "HR" or "supervisor" go to one of these three roles.
7. **Scale:** about 650 people in total (300 permanent, 350 temporary) across 7 plants.
   One gate per plant for now (a setting).
8. **Gate devices are phones and PCs.** A PC usually has no GPS, so a PC kiosk relies on its
   device key and the plant network allow-list; GPS is required only on devices that have
   it. Finalised in the M1 (pairing) and M4 (anti-proxy) specs.
9. **Shifts:** the default shift is 07:00–19:00. Admins can add new shifts at any time, and
   each shift has its own overtime start (after how many hours) and overtime rate. Nothing
   is hard-coded.
10. **Salary estimate (M7):** staff have a fixed monthly salary (CTC); workers, operators and
    helpers are paid by hourly rate. M7 still waits for the salary slip and the remaining Q9
    answers. Real salary slips are never committed (the repository is public).
11. **Face model fallback:** if the free backend cannot run the `buffalo_l` face model well
    (measured in M3), a smaller face model is one of the Plan B options (decision 0002),
    used only if it still meets the accuracy targets (NFR-05).
