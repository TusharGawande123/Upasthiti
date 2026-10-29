# 0026 – M4: design gate A (the gate screens: location, offline, saved)

Date: 2026-10-28 · Decided by: Tushar Gawande (lead), in chat, after looking at the gate A mockups ·
Status: Accepted. Mockups: `docs/design-refs/m4/gate-a/` (31 states at 360, 768 and 1280 px, no
sideways scroll). Changes spec §4.1–§4.6.

1. **Gate A approved.**
2. **Phone footer:** on phones the privacy text is folded behind a "Privacy" row (tap to open); tablet
   and PC show it in full. "Need help? Ask the plant office." stays above the fold.
3. **Prefix keys on the offline code pad** (EMP-, T-, C-): the starts remembered from the last
   `/kiosk/me` (starts only, never whole codes), shown while the code is empty. The online M3 pad gets
   the same row of keys in slice A (small change).
4. **"Checking again…" line** with a spinner on every "needs its location" screen; it disappears with
   the screen when a good reading arrives.
5. **Offline SAVED has its own soft tone**, not the IN tone; voice "Saved."
6. Small deviations accepted: Lucide icons instead of emoji, a satellite-dish icon for "weak", test
   card rows say "Working" / "Not working", the result clock box says "Time (offline)", a legend under
   the F-53 sketch, long admin codes break after an underscore. The "Switched off" screen is a redraw
   from the M1 words: compare with the live screen when slice B builds the revoked-with-queue text.

## Build notes (slice A, 2026-10-28)
7. **Gate size budget** in `frontend/size-budgets.json` went from 57,000 to 61,000 bytes gzip: the
   location watcher, the on-device fence distance, the F-53 sketch and the needs-location screen add
   about 1 kB; the rest is headroom for slice B (offline queue) before the service worker is split out.
8. **Prefix keys on the online code pad** already existed since M3 (decision 0019); no change needed.
9. **A test card is never refused for the device's place**: it skips the location rules and the
   self-test answer says "Location ✓" or "Location ✗ (CODE)" instead (spec §5.1), so a guard can test
   a device whose location is wrong.
10. **Gate size budget** went on from 61,000 to 65,000 bytes gzip (slice B): the offline queue, the
    sealing (WebCrypto), the time anchor, the sync runner and the offline screens add about 2 kB.
11. **Offline face punch** starts at the code pad when the gate knows it is offline; when the
    internet is lost only during a face punch (the challenge request fails), the gate switches to
    the code pad by itself. The device picks the head turn with `crypto.getRandomValues`, using the
    `challenge_steps` the server sends in `kiosk_settings.offline`.
12. **A saved punch is shown as a "failed" screen with its own look** (`OFFLINE_SAVED`, slate blue):
    nothing is decided yet, so it has no green or red and never a name or IN/OUT.
