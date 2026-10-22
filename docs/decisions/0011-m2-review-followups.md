# 0011 – M2 review follow-ups (Tushar's independent review of PR #14)

Fixed in PR "fix: M2 review follow-ups":
- A card that starts later is refused while the employee still has a non-revoked card
  (`QR_START_LATER_WITH_ACTIVE_CARD`, 409). Before, the old card was revoked at once and the
  worker could not punch until the new card started. Start today to replace; revoke first to
  start later.
- A failed kiosk login is logged (reason code, kiosk id if it parsed, client IP; never the body,
  signature, nonce or card text). `DEVICE_REVOKED` and `NONCE_REUSED` also write an audit row
  `kiosk.auth_refused`.
- A test card never creates a punch row: the card kind is read first (`read_card` step), and a
  refused test card writes the audit row `kiosk.test_card_refused` instead.
- 429 and 422 answers on `/punch/kiosk` are logged as warnings.
- The kiosk tries the wake lock again on load and on `visibilitychange`; the banner says one
  tap is needed after every update.
- The daily photo purge falls back to one-by-one deletes when a batch fails.
- `npm run size` works from a folder whose name has spaces.

Written down, not built:
- A card can be cloned by photographing it; the stored photo and its admin review are the only
  defence in M2. M4 must add a rule that flags the same card used at two kiosks within N minutes.
- Gate devices must run in locked full-screen kiosk mode; anyone with devtools on the gate PC can
  sign punch requests.
- Per-IP limit for repeated failed kiosk logins: not added. The client IP can still be faked
  through Vercel (CLAUDE.md §10), so a per-IP limit would be weak; to be done with the proxy fix
  in M6.
- A revoked tablet that keeps polling writes one audit row per request; if that gets noisy, add a
  once-per-hour limit per kiosk (M6).
