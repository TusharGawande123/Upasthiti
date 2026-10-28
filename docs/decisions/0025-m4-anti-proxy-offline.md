# 0025 – M4 decisions: location on every punch, flagged punches, offline queue

Date: 2026-10-28 · Decided by: Tushar Gawande (project lead), in chat before the M4 spec was written ·
Status: Accepted (the spec itself is still a draft)
Details: docs/specs/M4-anti-proxy-offline.md.

## What M2 and M3 already built (not re-specified in M4)
Signed device requests (nonce + always-growing counter, `NONCE_REUSED`, `DEVICE_REVOKED`), card
validity, the face rules (challenge, liveness, anti-spoof, match), cool-down and `OUT_TOO_SOON`
(server clock, any plant). Ready but unused: decision `flagged`, columns `was_offline` and
`device_claimed_at`, setting `impossible_travel_kmh` (60). The gate screen does not send a location
with a punch yet, and the server checks the location only at pairing.

## Decisions
1. **Location on every punch: the gate blocks first, the server rejects.** The gate screen keeps
   measuring its location. While it has no good reading (none, worse than `gps_accuracy_limit_m`, or
   outside the geofence as far as the device can tell), it shows a "needs its location" screen and
   takes no punches. The server still checks every punch: no location, too inaccurate or outside the
   geofence (plus margin) = rejected (`LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`,
   `OUTSIDE_GEOFENCE`). A reading inside the margin at the edge is accepted and flagged.
2. **Offline face punch = employee code + face pictures, checked at sync.** Offline, the gate asks for
   the employee code, then takes the face pictures with a head turn chosen by the device. The pictures
   are encrypted for the server only (the device cannot open them again), kept on the device until
   sync, then deleted. At sync the server runs the full face check with a 1:1 match against that code.
   This is a narrow exception to "gate frames are never stored": only encrypted, only on the device,
   only until sync.
3. **Flagged punches count at once and are reviewed later.** A flagged punch counts as IN/OUT straight
   away. The Super Admin confirms it or marks it "Not accepted" with a reason (audited). The punch row
   is never changed; the review is stored separately.
4. **The Super Admin may approve a rejected punch in M4**, with a reason (audited), when the punch
   names an employee (card read, code typed or face matched). Super Admin only (M1 spec §7 rule 1).
   This is a second correction path next to M5's regularisation; M5 must show both together.
5. **Impossible travel and "same card at two gates soon" (decision 0012) flag, never reject.**
6. **Offline punch time:** the device keeps the server's time and counts the elapsed seconds since
   then; its own clock is not trusted. An offline punch older than 72 hours, or one whose time cannot
   be proven (device restarted while offline), is flagged, not rejected.
7. **Still no plant network / IP allow-list** (decision 0005).

## Answers to spec §14 (2026-10-28, the lead in chat)
8. **Offline PC gate keeps its last good reading** of the same session (up to `offline_max_hours`);
   those punches get the new flag `LOCATION_STALE`. Online the live rule is unchanged.
9. **Revoked device with waiting punches:** the device deletes its queue at once; the revoke dialog
   shows how many punches are still waiting, so the admin can wait for the sync first. F-51 rejected.
10. **Approvable rejected punches:** any that names an employee, except `COOLDOWN_ACTIVE`.
11. **Corporate Head and Plant Head** see flags, "Saved offline" and review state as read-only text.
12. **Edge flag** = outside the drawn fence but inside the margin only (no accuracy-circle flag).
13. **After 72 hours offline** the gate keeps saving until its storage is full; such punches are
    flagged `OFFLINE_TOO_OLD`.

## Extras
Approved: F-36, F-46, F-55, F-53, F-3, F-48, F-54, S-38. Later: F-45, F-47, F-49, F-50, F-52, S-34,
S-35, S-36, S-37. Rejected: F-51. List: accepted-extras.md.
