# 0006 – M1 build decisions (2026-10-14)

Decisions taken while building M1 (after the spec and decision 0005).

- **Design gates B, C, D approved** (mockups in `docs/design-refs/m1/gate-*`). Gate-level
  answers: half-day needs at least 4 h of work; the geofence margin is drawn with Turf (MIT);
  kiosk error screens show a small "For the admin: CODE" line; PC kiosks keep the touch keypad.
- **Employees:** the employee code is locked after creation; "mark as left" takes a free-text
  reason (3+ characters); bulk actions are the four in the spec (no "set OT rate" bulk action);
  the contractor office phone stays optional (a business number, never a worker's number).
- **Top-bar plant filter** is remembered in the browser between logins; a Plant Head is fixed
  to their own plant.
- **Pairing hardening** (security review): a global cap of 30 wrong pairing codes per 10 minutes
  on top of the per-IP limit (the client IP can be faked when the backend is reached directly);
  "revoked" is told only to a device that signed its request correctly.
- **API answers** carry `Cache-Control: no-store`; the server writes no access log (it would
  contain query strings such as pairing codes and search words).
- **End-to-end tests run one after another** (one shared database, slow password hash).
  `E2E_LOGIN_LIMIT` may raise the login limit only when `APP_ENV=test`.

## Left open for the lead / the client (not code)
- **Retention periods:** audit log, login IPs and kiosk coordinates (the audit log can never be
  deleted today; DPDP asks for erasure when the purpose ends). Client legal team to set them.
- **Account lockout:** anyone who knows a username can lock that account for 15 minutes (spec
  §7 rule 4). Decide whether to add a per-IP throttle or an unlock route later.
- **Content-Security-Policy** is not set yet (Leaflet and OpenStreetMap tiles need care).
- **Hosting regions** of Render and Vercel to be confirmed; public repository and client PDFs
  to be checked for personal information.
