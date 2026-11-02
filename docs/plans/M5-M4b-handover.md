# M5 + M4b handover (for Tushar)

Written 2026-11-01 on the request of Anuradha: if her weekly Claude limit runs out, everything done is
committed and pushed, and this note says what is left. Branch: `milestone/M5-attendance-reports` (M5 and M4b
go into ONE pull request). Read `CLAUDE.md`, then `docs/plans/M5-attendance-reports-plan.md` (the "Status"
section at the bottom is the detailed log) and `docs/decisions/0036-m5-build-choices.md` (all build decisions).

## Done and pushed
- **M5 backend:** shift rules with history, holidays and leave, attendance calculation (stored `attendance_days`),
  corrections and bulk correction, early-OUT alert at the gate, shift swap, notification centre, dashboard,
  muster, punctuality, the seven reports (Excel and PDF), gate lines, poster with shift times.
- **M5 screens (slice 7, groups A to E):** dashboard, muster, attendance list, register, corrections, employee
  Attendance tab, day drawer, leave, holidays, plant weekly off and start date, shift form, reports,
  punctuality (Recharts), notifications, settings cards.
- **Tests:** backend 1430 passed (coverage 90.7%, floor 84), frontend 897 passed (coverage 85%+, floor 84),
  e2e 55 passed (headed run on the lead's laptop).
- **M4b P0:** migrations 0026 and 0027, nullable `kiosk_id`, context refactor, password gate (2 argon2 checks at
  once), phone body limits, removal tools for phone rows.
- **M4b design gates P1, P2, P3:** approved (decision 34); mock-ups in `docs/design-refs/m4b/gate-p1`, `gate-p2`,
  `gate-p3`.
- **M4b P1 backend:** phone module, sessions (`ups_phone` cookie), login and lockout, notice, face and card proofs,
  password, Super Admin switches, passkeys (webauthn 3.0.1), cleanup jobs, migration 0028 (`sign_in_method`),
  decision lines 35 to 44, 71 new tests (AC-1 to AC-19, AC-49, AC-50, AC-54 to AC-56, AC-59). Full backend suite
  at the end of P1: 1501 passed, coverage 91.07%.
- **M4b P2 backend (2026-11-02):** phone face punch (challenge bound to the sign-in, 1:1 match, location rule 12 with
  other plants and `OUTSIDE_PLANT`), gate code `UPG1.` + `/kiosk/gate-code` + gate-code punch, F-73 reads,
  settings with the cool-down cross-check, M5 amendments (inside now / muster / alert by where the person
  stands, `on_outside_work`, many-rejections filter), texts. Decisions 0036 lines 45 to 54, 60 new tests; full backend suite 1573 passed, coverage 91.24 %.
  Details and "What P3 must know" are in the plan Status section.

## Stopped here
- After P2 the backend of M4b is complete except P3 (admin side). Start P3 from the plan Status section.

## Left to do (in this order)
1. **M4b P3** (admin side: punch log channel
   filter and phone fields, Needs review phone filter and bulk confirm F-76, employees list `phone` filter, audit
   viewer; F-69, F-70 and F-73 are already done), **P4**
   (frontend `/phone/*` pages, admin Phone attendance card, Vercel CSP and Permissions-Policy, size budget,
   S-46 Playwright mobile project, S-49 memory check in the CI `docker` job). Spec: `docs/specs/M4b-phone-punch.md`
   (sections 4 to 11, acceptance criteria AC-1 to AC-59).
2. **M5 leftovers:** CI job for the midnight-IST run (S-40); F-65 register email (optional, SMTP only); optional
   backend extras (more filters on `/attendance/daily` for the dashboard tiles, leave list plant column,
   holidays edit, "saved by" in the rule history); re-render two gate P1 and P2 mock-up images
   (`01-login-locked`, `p2 03-start-face-not-ready`) after the last text decision (HTML is already right).
3. **Known problem:** e2e `kiosk-face-punch` test 1 and `admin-face` (code-path punch) pass on `main` but fail
   about two runs in three on this branch on the lead's laptop (`LIVEDEBUG` showed the gate's turn picture
   still shows the old head). See the plan Status entry of 2026-11-01. The CI `e2e` job decides: if it fails on
   these two, start there.
4. **Closing:** run `/review-milestone` and fix the findings; update `CLAUDE.md` (tick M5 and M4b, employees sign
   in only for phone punching, phone-menu rule limited to admin pages, new dependencies time-machine,
   hypothesis, webauthn, Recharts, new settings and env vars `SMTP_*`, commands, one line for the one-time tools
   of decisions 0032/0033); update the specs (M5 §4.10 and §4.17 "leave from" is the shift end; M4b texts of
   decisions 30 to 33); show the `CLAUDE.md` diff to the lead first; `/ship` (push, open the PR, wait for the
   five checks `backend`, `frontend`, `e2e`, `docker`, `hooks`).

## Decisions that need Tushar (or the client)
Marked "to confirm with Tushar" in `docs/decisions/0036-m5-build-choices.md`: lines 1, 6, 8, 9, 13, 15, and from
P2 45 (early-OUT on the phone), 47 (GET and POST for the phone code), 48 (a code that names no device is
answered without a row), 51 (many-rejections counts channel `kiosk` only) (8 and 9
also with the client), the poster privacy text at 11 pt, the absence-streak reading, the Styles and menu size
budgets (lines 20 and 21), poster layout (line 19), notice-acceptance clean-up (line 28), the phone texts
(lines 30 to 34, especially the DPDP notice wording, which is only a layout draft).

## How to run things
Backend (from `backend/`): `uv run pytest -q -p no:cacheprovider` (about 20 minutes), `uv run ruff check . && uv run
ruff format .`, `uv run pyright`. Frontend (from `frontend/`): `npm test` (coverage floor 84), `npm run lint`,
`npm run typecheck`, `npm run i18n:check`, `npm run build && npm run size`. E2E (from `e2e/`):
`npx playwright test` (needs `docker compose up -d`; do not run it together with the other suites).
Never `git add -A`: `docs/decisions/0030*` and `0031*` stay untracked on purpose.
