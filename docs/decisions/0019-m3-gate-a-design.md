# 0019 – M3: design gate A (the face screens at the attendance device)

Date: 2026-10-24 · Decided by: Anuradha (chat), after looking at the gate A screenshots ·
Status: Accepted. Mockups: `docs/design-refs/m3/gate-a/`. Changes spec §4.1, §4.4, §4.5 and §5.2.

1. **Gate A approved** (43 states at 360, 768 and 1280 px, no sideways scroll).
2. **One-tap code prefixes on the code pad.** `GET /kiosk/me` gets one more field,
   `kiosk_settings.face.code_prefixes` (a list of at most 3 strings): the most common starts of the
   employee codes of the kiosk's plant (up to the first `-` or `/`, e.g. "EMP-"), counted over active
   employees with a face. Only the starts are sent, never a whole code. The pad shows them as keys.
3. **Busy / starting results are amber "PLEASE WAIT"**, not red (`FACE_SERVICE_UNAVAILABLE`,
   `FACE_SERVICE_BUSY`). `TOO_MANY_REQUESTS` on the gate changes to amber too.
4. **Code display font: JetBrains Mono** (free, SIL OFL 1.1), a small self-hosted subset, loaded only
   on the gate screen; logged in `docs/decisions/ui-component-sources.md`.
5. **Where the mockups differ from spec text** (the spec follows the mockups):
   - the footer privacy line is the clean §8.1 text (§4.1 had a repeated sentence);
   - the "server is starting" line reuses the live key `kiosk.attendance.serverWaking`;
   - no Cancel button while the pictures are being checked (they are already sent);
   - the countdown on result screens with "Try again" is 10 s (a constant, not a setting);
   - face rejections that can be retried say "NOT ACCEPTED" with a "Try again" button;
   - on a phone the idle page scrolls down to the long privacy footer; the camera, the card
     instruction and "Punch with face" stay visible without scrolling.
