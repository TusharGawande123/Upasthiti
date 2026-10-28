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
