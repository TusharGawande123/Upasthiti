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
