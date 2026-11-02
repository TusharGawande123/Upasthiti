# Accepted extras (CLAUDE.md §11)

One line per extra: milestone · ID · what · status · date. Details live in each milestone spec, §12.

## M0 – Setup (docs/specs/M0-setup.md)
On 2026-10-12 the lead (Tushar Gawande) let Claude Code choose; the choices below were then recorded.

- M0 · S-1 · GitHub secret scanning + push protection, CodeQL workflow · Approved · 2026-10-12
- M0 · S-2 · gitleaks in pre-commit and CI · Approved · 2026-10-12
- M0 · S-3 · PR title Conventional Commits check · Approved · 2026-10-12
- M0 · S-4 · PR template, issue templates, CODEOWNERS · Approved · 2026-10-12
- M0 · S-5 · Claude commands /spec, /plan, /review-milestone, /ship · Approved · 2026-10-12
- M0 · S-6 · One-command local start scripts (dev.ps1, dev.sh) · Approved · 2026-10-12
- M0 · S-7 · Request ID + JSON logging (standard library only) · Approved · 2026-10-12
- M0 · S-8 · Coverage reports in CI, 60% floor rising per milestone · Approved · 2026-10-12
- M0 · S-9 · Translation key check in CI (own script; i18next-cli dropped, its native module fails on some Windows setups) · Approved · 2026-10-12
- M0 · S-10 · docker-compose Postgres for local work + native install steps · Approved · 2026-10-12
- M0 · S-11 · Move starter-kit files to docs/archive/ · Approved · 2026-10-12
- M0 · S-12 · Shared VS Code extensions and settings · Approved · 2026-10-12
- M0 · S-13 · Encrypted nightly database backup · Later (M6; must not use public CI artifacts) · 2026-10-12
- M0 · S-14 · Release tags + auto changelog (release-please) · Later · 2026-10-12

## Product features proposed in the M0 spec (built in their own milestones)
Chosen by the lead in chat on 2026-10-12.

- M2 · F-1 · Voice + sound feedback at the kiosk · Approved · 2026-10-12
- M5 · F-4 · Still-inside safety alert (no check-out 1 h after shift end) · Approved · 2026-10-12
- M1 · F-5 · First-time setup wizard · Approved · 2026-10-12
- M1/M2 · F-6 · Ctrl+K smart search + bulk actions · Approved · 2026-10-12
- M5 · F-7 · Alerts / notification centre (optional SMTP email) · Approved · 2026-10-12
- M5 · F-9 · Punctuality analytics · Approved · 2026-10-12
- M6 · F-15 · Full data export to the admin's own computer (never through GitHub) · Approved · 2026-10-12
- Later: F-2 "My month" line, F-3 kiosk health monitor+, F-8 overtime approval, F-10 buddy-punch
  detection, F-11 canteen headcount, F-12 weekly digest, F-13 demo mode (lead will ask when
  needed), F-14 free-tier health page, F-16 shift roster planner · 2026-10-12

## Other M0 answers (2026-10-12)
- No licence file for now (all rights reserved).
- `e2e` is a required CI check on every PR.
- `enforce_admins` stays off on `main`.
- CODEOWNERS lists only the lead until teammates' GitHub usernames are known.

## M1 – Foundation (docs/specs/M1-foundation.md)
Chosen by the lead in chat on 2026-10-13.

- M1 · S-15 · Fake test-data command: 650 employees across the 7 plants (~300 permanent, ~350 temporary); refuses in production · Approved · 2026-10-13
- M1 · S-17 · axe accessibility scan in Playwright · Approved · 2026-10-13
- M1 · S-18 · Post-deploy smoke test on the live URL · Approved · 2026-10-13
- M1 · S-20 · Keep-alive checks the database once a day (Supabase pause guard) · Approved · 2026-10-13
- M1 · F-17 · Plant readiness card · Approved · 2026-10-13
- M1 · F-18 · Kiosk pairing by QR · Approved · 2026-10-13
- M1 · F-19 · Employee timeline (from the audit log) · Approved · 2026-10-13
- M1 · F-20 · Plant transfer with effective date + plant history · Approved · 2026-10-13
- M1 · F-23 · Active sessions + force logout · Approved · 2026-10-13
- M2 · F-25 · Gate notice board on the kiosk idle screen · Approved · 2026-10-13
- M5 · F-26 · Emergency muster list (SRS FR-34) · Approved · 2026-10-13
- Rejected: F-21 Excel update mode (import stays create-only); F-22 automatic "left" by end
  date (only the Super Admin marks people as left and expires QR cards, by hand) · 2026-10-13
- Later: S-16 API type generation, S-19 migration round-trip check, S-21 strict CSP,
  F-24 two-step login (TOTP) · 2026-10-13
- Role matrix, approvals inbox, no network allow-list, Super Admin kiosk approval, OT rate
  per employee, required category: decision 0005 (not extras) · 2026-10-13

## M2 – QR attendance (docs/specs/M2-qr-attendance.md)
Chosen in chat on 2026-10-19 by Anuradha (team member). Two rows pull a "Later" item (decided by
the lead, 2026-10-12) forward; they wait for Tushar (decision 0009).

- M2 · F-1 · Voice + sound feedback at the kiosk: device voices only, says no names (decision 0008) · In scope · 2026-10-19
- M2 · F-6 · M2 part: bulk issue / print / revoke of QR cards + Ctrl+K entries for cards · In scope · 2026-10-19
- M2 · F-25 · Gate notice board on the kiosk idle screen (Super Admin any plant, Plant Head own plant) · In scope · 2026-10-19
- M2 · S-22 · Locust load test of the punch endpoint (Render-like container + live backend off-hours) · Approved · 2026-10-19
- M2 · S-23 · Print-and-scan CI test of the card PDF (QR version ≤ 7) · Approved · 2026-10-19
- M2 · S-24 · Encrypt snapshots (AES-256-GCM) before upload · Approved · 2026-10-19
- M2 · S-25 · Storage and database usage meter (M2 part of Later item F-14) · Pending Tushar (not in M2 until he agrees) · 2026-10-20
- M2 · S-26 · Kiosk error reports to the server log (no images) · Approved · 2026-10-19
- M2 · S-27 · Kiosk self-update when the frontend version changes · Approved · 2026-10-19
- M2 · S-28 · Bundle-size check + lazy-loaded kiosk code and QR decoder · Approved · 2026-10-19
- M2 · S-29 · Kiosk device setup guide + screen wake lock · Approved · 2026-10-19
- M2 · F-27 · Kiosk test card / self-test (never counted as attendance) · Approved · 2026-10-19
- M2 · F-29 · Side-by-side photo review (last 3 photos of the card) · Approved · 2026-10-19
- M2 · F-31 · Low-light hint at the kiosk + dark-photo count for the admin · Approved · 2026-10-19
- M2 · F-33 · "Cards ending soon" badge and list · Approved · 2026-10-19
- M2 · F-34 · Printable gate poster (how to punch + privacy notice) · Approved · 2026-10-19
- M2 · F-35 · Punch log Excel export (one day, one plant) · Approved · 2026-10-19
- M2 · F-36 · Kiosk online/offline badge (small part of Later item F-3) · Pending Tushar (not in M2 until he agrees) · 2026-10-20
- M2 · F-38 · "Issue and print cards" step after an Excel import · Approved · 2026-10-19
- Later: F-28 "inside now" count on the kiosk (M5), F-30 face-in-photo check (M3), F-37 gentle
  late hint (M5, off by default), F-32 employee photo on the ID card (privacy risk) · 2026-10-19

## M3 – Face attendance (docs/specs/M3-face-attendance.md)
Chosen by the lead (Tushar Gawande) in chat on 2026-10-24 (decision 0016).

- M3 · F-39 · Duplicate face check at enrolment (Super Admin override with reason, audited) · Approved · 2026-10-24
- M3 · F-40 · Enrolment progress: dashboard card per plant, "Not enrolled" filter, Ctrl+K · Approved · 2026-10-24
- M3 · F-30 · Face-in-photo check on QR punch photos (a mark only, never a rejection) · Approved · 2026-10-24
- M3 · F-41 · "Re-enrol suggested" hint when match scores fall or code entry is frequent · Approved · 2026-10-24
- M3 · S-30 · 512 MB memory test of the backend container in CI · Approved · 2026-10-24
- M3 · S-31 · Face model state on the health check + model warm-up at start · Approved · 2026-10-24
- M3 · S-32 · Face accuracy report tool (FAR/FRR, threshold curve) · Approved · 2026-10-24
- M3 · F-43 · Two-step head-turn challenge as a setting (`face_challenge_steps`, default 1 = off) · Approved · 2026-10-24
- M3 · S-33 · INT8-quantised models measured in slice 1 · Approved · 2026-10-24
- Later: F-42 DPDP consent register export + "face data deleted" receipt PDF; F-44 office-verified
  punch (M5, inside the regularisation flow) · 2026-10-24

## M4 – Anti-proxy engine + offline (docs/specs/M4-anti-proxy-offline.md)
Chosen by the lead (Tushar Gawande) in chat on 2026-10-28 (decision 0025).

- M4 · F-36 · "Attendance device offline" badge in the admin top bar and sidebar · Approved · 2026-10-28
- M4 · F-46 · In-app alert when an attendance device is offline > 10 min during a shift (email later with F-7) · Approved · 2026-10-28
- M4 · F-55 · Gate "last sync" line ("All punches sent" / "N waiting since …") · Approved · 2026-10-28
- M4 · F-53 · "Why paused?" fence sketch on the gate's needs-location screen (no map tiles) · Approved · 2026-10-28
- M4 · F-3 · Attendance device health monitor+ (battery, camera, storage, 7-day online/offline timeline) · Approved · 2026-10-28
- M4 · F-48 · Daily review digest card on the dashboard · Approved · 2026-10-28
- M4 · F-54 · Repeat-pattern hints on the review screen · Approved · 2026-10-28
- M4 · S-38 · Gate storage self-check (quota at start, reported in the heartbeat) · Approved · 2026-10-28
- Rejected: F-51 "Retire after sync" (a revoked device deletes its queue at once; the revoke dialog
  warns about waiting punches) · 2026-10-28
- Later: F-45 offline drill mode, F-47 location drift chart, F-49 review shortcuts + bulk confirm,
  F-50 sync history per device, F-52 flag every offline face punch, S-34 outage simulation helper,
  S-35 spoof-test suite tool (the attack tests themselves stay core), S-36 property tests,
  S-37 sync load test · 2026-10-28

## M5 – Attendance processing, dashboards, reports (docs/specs/M5-attendance-reports.md)
Chosen by the lead (Tushar Gawande) in chat on 2026-10-30 (decision 0034).

- M5 · F-4 · Still-inside safety alert · Approved (2026-10-12) · in scope
- M5 · F-7 · Notification centre: in-app bell; email only when SMTP variables are set · Approved · in scope
- M5 · F-9 · Punctuality analytics · Approved (2026-10-12) · in scope
- M5 · F-26 · Emergency muster list · Approved (2026-10-13) · in scope
- M5 · F-58 · One-day shift swap · Approved · 2026-10-30
- M5 · F-59 · Bulk correction after a gate outage · Approved · 2026-10-30
- M5 · F-60 · Attendance calendar heatmap on the employee page · Approved · 2026-10-30
- M5 · F-61 · "Explain this day" sentence in the timeline · Approved · 2026-10-30
- M5 · F-62 · Absence streak alert · Approved · 2026-10-30
- M5 · F-65 · Monthly register email (only when SMTP is set) · Approved · 2026-10-30
- M5 · F-28 · "Inside now" count on the gate idle screen · Approved · 2026-10-30
- M5 · F-37 · Gentle late hint at the gate (default off) · Approved · 2026-10-30
- M5 · F-2 · "My month" line at the gate (no name, default off) · Approved · 2026-10-30
- M5 · S-39 · Golden scenario table · Approved · 2026-10-30
- M5 · S-40 · Midnight-IST CI run + time-machine (MIT, dev only) · Approved · 2026-10-30
- M5 · S-41 · Report read-back tests · Approved · 2026-10-30
- M5 · S-42 · Register performance check in 512 MB · Approved · 2026-10-30
- M5 · S-43 · Hypothesis property tests (MPL-2.0, dev only) · Approved · 2026-10-30
- Later: F-56 month close, F-57 muster roll-call ticks, F-63 overtime limit warning, F-64 weekly rest
  check, F-66 holiday list helpers, F-67 TV wall screen, F-8 overtime approval, F-16 shift roster planner,
  F-12 weekly digest, F-44 office-verified correction, S-44 nightly recompute check, S-25 storage meter
- Rejected: F-68 per-employee "Test" flag (only DEMO plants are left out of reports) · 2026-10-30

## M4b – Optional phone punching (docs/specs/M4b-phone-punch.md)
Chosen by the lead (Tushar Gawande) in chat on 2026-10-31 (decision 0035). Built in the M5 PR.

- M4b · F-69 · "Outside work until" date on the outside-work switch · Approved · 2026-10-31
- M4b · F-70 · Bell alert when one employee signs in on many phones · Approved · 2026-10-31
- M4b · F-73 · "My attendance" on the phone (last 31 days) · Approved · 2026-10-31
- M4b · F-74 · Add-to-home-screen manifest for /phone (no service worker) · Approved · 2026-10-31
- M4b · F-76 · Bulk confirm of clean outside-plant punches · Approved · 2026-10-31
- M4b · F-80 · Passkey (WebAuthn) as an optional sign-in; py_webauthn, BSD-3-Clause · Approved · 2026-10-31
- M4b · S-46 · Playwright mobile project with a fake camera · Approved · 2026-10-31
- M4b · S-47 · Strict CSP + Permissions-Policy for /phone · Approved · 2026-10-31
- M4b · S-49 · argon2 memory guard test (512 MB) · Approved · 2026-10-31
- Later: F-71 outside punch photo, F-72 near-the-device check, F-75 planned outside site, F-77 selfie
  compare, F-78/F-79 Marathi and Hindi phone pages and notice, F-81 muster "On outside work" list,
  S-45 gate-code load test, S-48 password strength meter
