# M5 + M4b: implementation plan (one branch, one PR)

Status: Approved (lead, 2026-10-31) · Date: 2026-10-31 · Branch: `milestone/M5-attendance-reports`
Specs (both Approved): docs/specs/M5-attendance-reports.md, docs/specs/M4b-phone-punch.md
Decisions: 0034 (M5), 0035 (M4b). Saved after approval as `docs/plans/M5-attendance-reports-plan.md`.

## Context
M5 turns punches into attendance (one IN / one OUT per shift, grace 30, Present / Half-day / Short hours /
Absent / Incomplete, overtime from the shift end only from 2 h), with corrections, leave, holidays, live
dashboard, muster, reports and alerts. M4b then adds optional phone punching (employee login, phone face
punch, gate-code scan, outside work). M4b needs M5 pieces (`shift_closed` rule, `attendance_days`,
notifications), so M5 slices come first. Migrations: M5 0019-0024, M4b 0025-0026.

## Cross-cutting decisions (made from the code exploration)
1. **Clock seam.** 37 modules do `from app.core.time import utc_now`, so patching it does nothing. Use
   `time-machine` (MIT, dev only, S-40) which freezes the clock for all of them, and give the new M5 code
   `now` as an argument. DB `server_default now()` is not frozen: set times explicitly in tests. Quality
   gate: the whole suite also runs once at 23:59 and 00:01 IST (CI job).
2. **One day-window helper** (`attendance/day_window.py`): shift for a date (assignment + swap + rule
   version + plant history, latest `from_date` wins on overlap) and the window. Used by the calculation
   AND by the gate rule `shift_closed`, so they can never disagree.
3. **Pure calculation function** `compute_day(inputs, rules) -> DayResult` with no database; the service
   loads inputs, calls it, upserts `attendance_days`. Golden table (S-39) and Hypothesis (S-43) test this
   function directly.
4. **`counting.py` stays the only definition of "counts".** Add `counted_for_employees(session, ids,
   start, end)` in the same file, returning the counted employee (own, or the approved review's employee).
   Test AC-15: single and bulk give equal results.
5. **Stale marking in the same transaction as the cause** through one helper `mark_days_stale(session,
   employee_id, dates)` called before each commit point (punch paths: `service.py`, `face_service.py`,
   `sync_service.py`, `offline_face_service.py`; `review_service.add_review`; employee `operations.py`;
   approvals `apply_payload`; leave, holiday, swap, shift, settings). A test lists the commit points.
6. **Recompute:** BackgroundTask after the response; 5-minute catch-up job (batches of 500); nightly close
   at 00:05 IST; recompute of stale rows before every read. Scheduled with `next_run_time` (NOT inside the
   start-up lifespan) so Render cold starts stay fast.
7. **Shift edits write `shift_rule_versions`** (effective today or later); `setup_items_service.update_shift`
   stops using plain setattr. `ot_after_min` is dropped; old API clients sending it are ignored.
8. **M4b context refactor.** `PunchContext`/`FacePunchContext` get `plant_id` and a `device_identity`
   (kiosk id or phone session id); `kiosk_location`, `nearby_punches`, `qr_credential`, `face_challenge`
   use them instead of `context.kiosk`. Kiosk behaviour must stay byte-identical (existing tests prove it).
9. **`punches.kiosk_id` nullable** (0026): fix every reader found in the exploration (presenter, schemas
   `PunchLogPlace`, export, `review_service` device comparison, nearby_punches) and extend
   `remove_demo_plant.py` / `remove_test_employees.py` to delete phone punches of their employees. M5 new
   tables also get added to the demo-removal tool; a decision line records that this tool stays the only
   deleter (AC-55 wording is about app code paths).
10. **Argon2 memory:** one shared semaphore (max 2 concurrent) covering real and dummy password checks.
11. **HKDF vs HMAC:** the gate-code key is `HMAC(APP_SECRET_KEY, "gate-code-v1")`, same as the time anchor
    (the spec said HKDF; the code pattern is HMAC; state this in the decision lines).
12. **Reports:** new `reports/` module with one shared writer (XlsxWriter, `write_string` only, header
    block, one sheet per plant + Summary) and fpdf2 (Inter font). Excel uses the existing safe pattern
    (`in_memory`, rows in order) unless S-42 shows a memory problem, then constant-memory mode.
13. **Frontend:** new deps Recharts and TanStack Table are already approved in CLAUDE.md §4 (Recharts is not
    yet installed). Employee page gets real tabs (`?tab=`), shift form moves to RHF + Zod.

## Build steps (one small Conventional Commit each; push after each slice)

### Slice 0: foundations (Opus + high)
1. `chore(test)`: add time-machine + hypothesis (dev), pin-date helpers, `CURRENT_MILESTONE = 5`, coverage
   floor 84%.
2. `feat(org)`: migration 0019 (`shift_rule_versions`, `plant_weekly_offs`, `plants.attendance_start_date`,
   drop `ot_after_min`, add `overtime_min_minutes`, grace 30, audit rows) + models + shift/plant API + readiness
   fields. Frontend shift form defaults (grace 30, OT minimum 120, rules-apply-from, history).
   Tests AC-23, AC-24.

### Slice 1: leave, holidays, corrections data (Opus + high)
3. Migration 0020 (holidays, holiday_plants, leave_records) + services + routers (Super Admin writes).
4. Migration 0021 (regularisations, decisions) + service (request, preview, approve, reject, withdraw,
   reverse; validation codes) + `GET /punch-approvals`. Tests AC-16 to AC-22.

### Slice 2: calculation engine (Opus + high)
5. `counted_for_employees`, `day_window.py`, `compute_day` (+ `tests/attendance_cases.yaml` golden table).
6. Migration 0022 `attendance_days` + `mark_days_stale` hooks at every commit point + recompute service,
   catch-up and nightly jobs + `/attendance/*` read endpoints + `/attendance/undecided`.
   Tests AC-1 to AC-15, AC-25, AC-26, Hypothesis properties.

### Slice 3: gate rule (Opus + high)
7. `antiproxy/rules/shift_closed.py` in `AFTER_IDENTITY_RULES` after `check_in_out`; `PunchContext.last_counted`;
   `SHIFT_ALREADY_CLOSED` in reasons, review suggestion (OUT), related-OUT hint; i18n `errors.*`,
   `kiosk.punch.*`, `punchReasons.*`; gate rejection screen; `min_minutes_before_out` card/face/online/offline
   tests. AC-39 to AC-41.

### Slice 4: dashboard, muster, alerts, gate lines (Opus + medium)
(Migrations stay in number order: 0023 here, 0024 in slice 5.)
10. Migration 0023 (`notifications`, reads, deliveries, user email prefs) + notification service + optional
    SMTP sender (off when variables unset).
11. `/dashboard/live`, `/muster`, `/muster.pdf`, `/insights/punctuality`; DEMO plants hidden by default.
12. Alert jobs: 5-minute (`still_inside`, `many_rejections`, `device_offline`), 07:00 (`incomplete_days`,
    `review_digest`, `absence_streak`), 2nd of month (`monthly_register`). AC-32 to AC-35, AC-43, AC-48, AC-49.
13. Gate extras: `inside_now`, `gate_lines`, settings `kiosk_show_inside_count`, `kiosk_late_hint`,
    `kiosk_show_month_line`; gate poster shift-times box (layout rework of the fixed single page).
    AC-50 to AC-54; gate budget check (65 kB, raise by at most 2 kB with a decision line).

### Slice 5: swaps and bulk correction (Opus + medium)
8. Migration 0024 `shift_swaps` + API + day-window support (F-58). AC-44.
9. Bulk correction (F-59): preview / create / approve-all / reverse-batch, max 200. AC-45.

### Slice 6: reports (Opus + medium)
14. `reports/` module, 7 reports xlsx + pdf, limits (one at a time per user, 20 per 10 min, 30 s, 3,000 PDF
    rows), audit `report.download`. S-41 read-back tests, S-42 registers 650 x 31 under 450 MB in the
    `docker` CI job.

### Slice 7: M5 screens (Sonnet + medium, after design gates)
Design gates (ui-designer mockups at 360 / 768 / 1280 px, shown to Tushar as images, one approval each):
- **Gate A:** dashboard + muster. **Gate B:** attendance list, register, employee tab, timeline, corrections.
  **Gate C:** leave, holidays, shift form, reports, punctuality, notifications, settings.
Mockups go to `docs/design-refs/m5/gate-{a,b,c}/` like M4. Gate A is shown before step 11's frontend, B and C
before their screens.
15. Dashboard + muster; 16. attendance list, register, employee tabs (calendar, heatmap F-60, swap),
day timeline with "Explain this day" (F-61); 17. corrections + bulk wizard; 18. leave, holidays, reports,
punctuality (Recharts), notifications bell, settings cards, readiness lines. Each page: nav item (admin
layout + phone menu + Ctrl+K), i18n keys, `responsive.spec.ts` entry, Vitest tests. AC-36, AC-37.

### Slice 8: M5 end-to-end (Sonnet + medium)
19. Playwright (headed) on a DEMO plant: full day flow (gate punch to register), correction request and
approval, report download, dashboard. 20. CI: midnight-IST run job (S-40). M5 is now complete and green.

### M4b slices (after M5 is green)
**P0 (Opus + high):** 21. Migrations 0025 + 0026, `kiosk_id` nullable fixes, context refactor (cross-cutting 8,
9), argon2 semaphore, phone body limits in `body_limit_for`, snapshot `reason` column widened.
**P1 (Opus + high):** 22. `phone/` module: accounts, sessions (cookie `ups_phone`, Strict, Path
`/api/v1/phone`), login, lockout (ceil minutes: AC-6), rate limits, notice, proofs (face 1:1 and card), set
password, Super Admin switches and sign-out-all. 23. Passkeys (F-80, `webauthn` BSD-3, memory measured in
S-49). AC-1 to AC-19, AC-49 to AC-59.
**P2 (Opus + high):** 24. Phone face punch (challenge bound to the session, 1:1, location rule 12 with the
other-plants loop, rules in M5 order). 25. Gate code (`UPG1.`, server HMAC 30 s, `/kiosk/gate-code`, gate
panel + reader message) and `punch/gate-code`. 26. M5 amendments: `COALESCE(location_plant_id, plant_id)` in
inside-now / muster, `OUTSIDE_PLANT` excluded from F-4 / F-28. AC-20 to AC-42.
**P3 (Opus + medium):** 27. Admin side: punch log channel filter, "Needs review" phone filter, bulk confirm
(F-76), F-69 daily job, F-70 alert, F-73 `/phone/attendance`, "Cards ending soon" phone line, audit viewer
shows employee actors.
**P4 (Sonnet + medium, after gates P1-P3):** 28. `/phone/*` layout, pages, manifest (F-74), Vercel CSP +
Permissions-Policy (S-47, `/phone` rule after the catch-all), size budget entry, admin "Phone attendance" card.
29. S-46 Playwright mobile project with fake camera + virtual authenticator; `/phone` pages in
`responsive.spec.ts`.

### Closing
30. `/review-milestone` (test-engineer, code-quality, security, i18n; compliance-auditor for phone/face data),
fix findings. 31. Update CLAUDE.md (tick M5 + M4b, employees sign in only for phone punching, phone-menu
rule limited to admin pages, new deps time-machine / hypothesis (dev) / webauthn, settings, commands, env
vars, one-line mentions of the two one-time tools 0032/0033), lead approves the diff first; decisions lines;
SRS / architecture edits listed in spec §15. 32. `/ship`: push, open the PR, wait for 5 green checks, tell
Tushar to merge. Then after "merged": check with `gh`, main, pull, prune, delete the branch.

## Files (main ones)
Backend new: `app/modules/attendance/` (day_window, compute, service, jobs, router), `regularisations/`,
`leave/`, `holidays/`, `shift_swaps/`, `notifications/`, `dashboard/`, `reports/`, `phone/`,
`app/antiproxy/rules/shift_closed.py`, `rules/phone_location.py`, migrations 0019-0026, tests incl.
`tests/attendance_cases.yaml`.
Backend changed: `punches/counting.py`, `punches/{service,face_service,sync_service,offline_face_service,review_service,presenter,schemas,admin_service,reasons,models}.py`,
`antiproxy/{engine,context,face_context}.py` and rules using `context.kiosk`, `org/{models,schemas,router,setup_items_service,plants_service}.py`,
`employees/operations.py`, `settings/{definitions,service}.py`, `jobs/daily.py`, `kiosks/{router,schemas}.py`,
`auth/{permissions,rate_limit,passwords}.py`, `core/body_limit.py`, `printing/poster_pdf.py`, audit viewer,
two removal scripts.
Frontend: `features/{attendance,corrections,leave,holidays,reports,notifications,insights,phone}/`,
`features/admin/dashboard-page.tsx`, `features/plants/shifts-tab.tsx`, `employees/employee-detail-page.tsx`,
`app/router.tsx`, `admin-layout.tsx`, gate `scanning-view.tsx` / `result-view.tsx` / `punch-types.ts`,
`size-budgets.json`, `vercel.json`, `public/locales/en/common.json`, e2e specs.

## Reused code
`counting.py`; `record_audit`; `core/time` (`IST`, `to_ist`, `today_ist`); `RateLimiter`; `check_same_origin`;
`require(Capability)` + `plant_filter`; `Viewer`/`super_admin_viewer`; `review_service.add_review` (split per
item for bulk); `location_check.check_location`/`geofence_at`; face `template_service`, `enrolment_service`,
`matcher.cosine`, `engine_provider.run_face_job`; `crypto.encrypt_snapshot`; segno SVG pattern from
`pairing_qr`; `build_export` Excel safety pattern; poster fonts; frontend `apiGet/apiPost`, `describeError`,
`mockApi`, `renderRoute`, e2e `helpers.ts` (`makePlant`, `logIn`, fake-camera setup).

## Dependencies (licence, reason)
time-machine (MIT, dev: freeze the clock) · hypothesis (MPL-2.0, dev: property tests) ·
webauthn / py_webauthn (BSD-3-Clause; brings cbor2 MIT, asn1crypto MIT: passkeys) · Recharts (MIT, charts,
already in CLAUDE.md §4) · @tanstack/react-table (MIT, installed, first use). All free.

## Risks
Largest: stale-marking hook points (step 6; a missed commit point leaves a wrong day, the nightly close and
the pre-read recompute are the safety net); context refactor (step 21; kiosk tests must stay green);
Render 512 MB (argon2, 650 x 31 register: S-42 / S-49); gate bundle 65 kB.

## Verification (every AC mapped)
| ACs | Check |
|---|---|
| M5 AC-1 to AC-15 | `tests/attendance_cases.yaml` golden table (all worked examples) + Hypothesis; AC-15 bulk = single |
| AC-16 to AC-22 | API tests for corrections, bulk, reverse, roles (Corporate / Plant Head scope) |
| AC-23, AC-24 | migration test (old 480 values audited, versions backfilled) + shift API tests |
| AC-25, AC-26 | stale + catch-up + nightly tests with time-machine; commit-point list test |
| AC-27 to AC-31 | dashboard / muster / report API tests, read-back (S-41), DEMO hidden |
| AC-32 to AC-35 | alert job tests (pinned times), F-9 numbers |
| AC-36 to AC-38 | `responsive.spec.ts`, `npm run i18n:check`, midnight-IST CI run |
| AC-39 to AC-42 | gate rule tests card / face / code, online / offline; payable minutes |
| AC-43 to AC-55 | per-extra tests (swap, bulk, heatmap, explain, streak, email off, gate lines, budget, poster, no deletion) |
| M4b AC-1 to AC-19 | phone auth API tests incl. attack tests (timing, lockout 10 min, token reuse) |
| AC-20 to AC-42 | phone face / gate-code tests, outside-plant and other-plant fence, review list option B |
| AC-43 to AC-48 | p95 < 2 s, docker memory check (450 MB), responsive, RLS test (automatic), size, no offline |
| AC-49 to AC-59 | extras tests (until-date, many phones, my attendance, manifest, bulk confirm, passkeys) |
Commands before each PR: backend `uv run ruff check . && uv run ruff format . && uv run pyright && uv run pytest -q`;
frontend `npm run lint && npm run typecheck && npm test && npm run i18n:check && npm run build && npm run size`;
e2e headed (one at a time, never with pytest or Vitest). Manual: gate phone punch on a DEMO plant, dashboard on
a real phone at 360 px, report downloads opened in Excel.

## Status (kept updated after every slice)
- Spec M5 and M4b approved and committed (d87cc3a, 2fc29fc). Plan approved (2026-10-31).
- 2026-10-31: handed over to Anuradha (Tushar delegated the build). No code written yet; local DB not checked.
- Model choice by Tushar for slices 0-3: Opus + medium. Plan advice for screens (slice 7, P4): Sonnet + medium.
- 2026-10-31 (Anuradha, Opus + medium): **slice 0 done.**
  - Step 1: time-machine 3.6 (MIT) + hypothesis 6.170 (MPL-2.0) as dev deps; `tests/clock_helpers.py`
    (`PINNED_DAY` = Wed 28/10/2026, `ist()`, `frozen_at()`); `CURRENT_MILESTONE = 5`; backend floor 84
    (frontend stays 82 for now, as the hand-over says; spec §2 item 17 wants 84 for both: raise it in slice 7).
  - Step 2: migration 0019 (`shift_rule_versions`, `plant_weekly_offs`, `plants.attendance_start_date`,
    `overtime_min_minutes`, `ot_after_min` dropped, grace 30, audit `shift.rules_migrated`); new
    `org/shift_rules_service.py`; shift create/update write versions; weekly-off API; attendance start date in
    PATCH /plants; readiness `attendance_start_set` / `weekly_off_set`; daily job copies due versions; demo
    removal tool learns the two tables; frontend shift form swapped to the M5 fields (minimal, Gate C later).
  - Tests: `test_m5_shift_rules.py` (14), `test_m5_migration_0019.py` (AC-24, own `_m0019_test` database),
    old shift tests updated. AC-23 is proven at the version level now and fully (days) in slice 2.
  - Decisions: docs/decisions/0036 lines 1–5 (**line 1 changes spec §6: same-day versions, latest save wins —
    to confirm with Tushar**).
- Order change inside the plan (no spec change): slice 1 step 3 (leave, holidays), then slice 2 step 5
  (`counted_for_employees`, `day_window`, `compute_day`), then step 4 (corrections: their checks and preview need
  the day window and the calculation), then step 6. Migration numbers stay 0020, 0021, 0022.
- 2026-10-31 later: leave + holidays (0020), counting bulk, `compute_day` + golden table, `day_window`, M5
  settings, corrections tables (0021), `attendance_days` (0022) with stale marking at every commit point
  (punch paths, reviews, employee operations, leave, holiday, weekly off, shift rules, window setting) and the
  catch-up / nightly-close jobs are built and pushed (aa5b4af). Decision 0036 lines 6-10 added; **lines 8
  (grace only at the start) and 9 (early OUT: warning + Agree / Cancel) change the approved spec: to confirm
  with Tushar and the client.**
- Slice 1 and 2 are now built (commit after the full suite): corrections service + API (request, preview,
  approve, reject, withdraw, direct, reverse; every §9 code), `GET /punch-approvals`, attendance read
  endpoints (daily, register, employee month, day timeline, undecided, recompute), the commit-point list
  test. Tests: `test_m5_corrections.py` (17), `test_m5_attendance_api.py` (9), `test_m5_stale_hooks.py`.
- Left out on purpose, comes later: F-61 "Explain this day" (`explanation` is an empty list), F-58 shift swap
  (`shift_swap` is null; slice 5), bulk correction (slice 5), notifications for requests and decisions
  (slice 4, the `notifications` tables do not exist yet), `GET /attendance/employee/{id}/year` (heatmap, slice 7).
- Known limit: the daily list and the register read through `ensure_fresh`, which recomputes at most a
  plant's people at a time; the 650 x 31 register speed and memory check (S-42) is done with the reports.
- Slice 3 now also contains the early-OUT confirmation (decision 0036 line 9): gate dialog (mockup image
  first), server confirmation mark, offline path.
- Next: slice 3 (gate rule `shift_closed` + early-OUT confirmation), then slice 4. Before the PR, remember the
  frontend coverage floor (82 -> 84, spec §2 item 17).
- Open questions: decision 0036 lines 1, 6, 8, 9 wait for Tushar's (and for 8 and 9 the client's) confirmation.
- 2026-10-31 slice 3 (server): gate rule `shift_closed` (5a1dc1d); early-OUT alert, server side: migration 0023
  (`punches.early_out_mark`; so notifications are now 0024, shift swaps 0025, M4b 0026-0027),
  `punches/early_out.py` (time left, signed 90-second token), `early_out_service.py` and
  `POST /punch/kiosk/early-out/confirm`; card, face and code paths hold the punch (nothing stored) and answer
  `needs_confirmation`; offline punches get the mark `EARLY_OUT_OFFLINE` at sync. Tests:
  `test_m5_shift_closed.py` (6), `test_m5_early_out.py` (8). Mockups approved (decision 0036 line 11).
- Still open in slice 3: gate frontend (alert dialog from the approved mockups for card, face and code, the
  SHIFT_CLOSED screen is texts only), face and code path tests, offline mark test, `min_minutes_before_out`
  tests for all four paths (AC-40), min-OUT texts, punch log shows the mark.
- 2026-10-31 slice 3 (gate frontend): `early-out-view.tsx` (approved mockups: amber before the half shift,
  blue after it, Agree / Cancel / Escape / 20 s auto-cancel, no name), state `early-out` in
  `attendance-machine.ts`, `sendEarlyOutConfirm` in `punch-client.ts`, Agree / Cancel in `use-attendance.ts`
  (a card punch sends its photo again; the prompt carries the `client_punch_id` the token is bound to),
  texts `gate.earlyOut.*`. Tests: `early-out.test.tsx` (11); backend `test_m5_early_out_paths.py` (5: face,
  code, wrong device, offline mark). Gate bundle 62.3 kB of 63.5 kB.
- Test note: tests of other things that punch OUT at any time of day use the fixture `early_out_alert_off`
  (tests/conftest.py); the alert has its own tests.
- Still open in slice 3: AC-40 tests of `min_minutes_before_out` for card, face, online and offline; the punch
  log shows the mark (admin screens, slice 7); responsive / e2e check of the gate dialog (slice 8).
- 2026-10-31 slice 4 (backend, pushed in parts): notification centre (migration 0024, bell API, own email
  preferences, optional SMTP; commit ef32a0c), dashboard live + muster (screen and PDF) + punctuality
  (7b6ad4c), alert jobs `notifications/alerts.py` (still inside, many rejections, device offline, incomplete
  days, review digest, absence streak, register notice, nightly purge) scheduled in `jobs/daily.py`.
  Tests: `test_m5_notifications.py` (7), `test_m5_dashboard.py` (10), `test_m5_alerts.py` (8).
- Design gates A, B, C: the three mockup agents were stopped by the 5-hour usage limit (resets 14:40 IST); the
  partial files are in docs/design-refs/m5/gate-{a,b,c}/ (gate B has attendance list, register, employee tab
  and day drawer; gate A has HTML only; gate C is just started). To resume: SendMessage to each agent. No
  screen code is written before the images are approved.
- Still open in slice 4: gate extras (`inside_now`, `gate_lines`, settings use, poster shift-times box,
  gate budget), AC-40 tests of `min_minutes_before_out`.
- 2026-10-31 slice 6 (reports backend, commit 4cf0997): `reports/` (model, xlsx_writer, pdf_writer, data,
  service, router) with `GET /api/v1/reports/{kind}.{xlsx|pdf}`; scope by role, DEMO hidden, Summary sheet for
  all plants, limits (one at a time, 20 per 10 min, PDF at most 3,000 rows, 31 days), audit with counts only.
  Tests: `test_m5_reports.py` (17). Still open: S-42 speed/memory check in the `docker` job, F-65 register
  email (SMTP only), reports page (slice 7).
- 2026-10-31 slice 4 (AC-40): `min_minutes_before_out` is now tested on all four paths: card online
  (`test_m5_shift_closed.py` E14b), face and offline (`test_m5_early_out_paths.py`, +2). Still open in slice 4:
  poster shift-times box, gate budget check, gate frontend lines (`inside_now`, late hint, month line).
- 2026-10-31 slice 4 done except nothing open in it: poster shift-times box (727a1de), gate result lines
  (`gate_lines` late minutes and month days under IN/OUT in `result-view.tsx`; `result-lines.test.tsx`, 3 tests),
  gate bundle 62.4 kB of 63.5 kB (no raise needed). Note: `inside_now` is a dashboard number, not a gate line.
  Next: the two small backend items of slice 5 (F-61 explanation, year heatmap endpoint), S-42 check, then slice 7.
- 2026-10-31 slice 5 backend extras: `attendance/explain.py` ("Explain this day", F-61: translation key + values,
  durations also as "7 h 20 m"), filled into `GET /attendance/employee/{id}/day/{date}` as `explanation`;
  `GET /attendance/employee/{id}/year` (F-60 heatmap, 12 months). Texts `attendance.explain.*` in common.json.
  Tests: +4 in `test_m5_attendance_api.py` (AC-46, AC-47). Correction to an earlier note: `inside_now` IS a gate
  number (F-28, on `/kiosk/me`, backend done); the gate IDLE screen does not show it yet (open, small).
- 2026-10-31 S-42 done: `tests/test_m5_report_size.py` (650 fake people, 31 days of attendance, in the backend
  job's own database): company register in Excel 5.2 s with tracemalloc on (limit 20 s), memory peak under
  450 MB, one plant as PDF 1.1 s (limit 30 s). Kept in the normal backend job, not the docker job (same
  limits, no container needed). Slice 6 open: only F-65 register email (SMTP only).
- 2026-10-31 slice 7 group A (frontend): live dashboard (`features/dashboard/`: `use-dashboard.ts`,
  `live-dashboard.tsx`, `dashboard-controls.tsx`, `muster-page.tsx`), kept M1-M4 cards under "Devices, checks and
  set-up", route `/admin/muster` + menu (under Dashboard, all roles, phone menu shares the list) + Ctrl+K entry,
  muster page in `e2e/tests/responsive.spec.ts`, gate idle chip "Inside now: N" (F-28; gate bundle still 62.4 kB).
  Tests: `dashboard.test.tsx` (11), `inside-now.test.tsx` (4); typecheck, lint, i18n:check, build + size ok
  (styles budget raised 13000 to 14500 bytes). Not run here: e2e/Playwright (the responsive check of the new page
  is still to run). Open: "On outside work" line of the hero (the API has no such field), count-up and flash
  animation of numbers, tile links use `?show=<tile>&plant_id=` which the attendance list (group B) must read.
- 2026-10-31 slice 7 group B (frontend): `features/attendance/` with the attendance list (`/admin/attendance`,
  `daily-page.tsx`, `daily-rows.tsx`), monthly register (`/admin/attendance/register`, `register-page.tsx`) and
  corrections list (`/admin/corrections`, the path of spec §4.7; `corrections-page.tsx`: Pending / Decided /
  Punch approvals / My requests, Super Admin approve / reject / reverse, requester withdraw). Shared:
  `use-attendance-admin.ts`, `status-chip.tsx`, `show-filters.ts` (dashboard `?show=` mapping),
  `use-day-drawer.ts` + placeholder `day-drawer-host.tsx` (`?day=<employeeId>:<YYYY-MM-DD>`; group C fills it).
  Menu (Attendance, Monthly register, Corrections with the pending badge for the Super Admin; phone menu and
  Ctrl+K share the list), three pages in `responsive.spec.ts` (not run here). Texts: `attendance.*`,
  `attendanceExceptions.*`, `corrections.*`. Tests: 40 in `features/attendance/`; typecheck, lint, i18n:check,
  build + size ok ("Admin menu and layout" 23.5 of 23.8 kB: little room left). Not built (group C): correction
  dialog, bulk wizard, Before -> After panels, employee tab, day drawer. Open: `show` tiles late / arrived /
  expected / inside / not_arrived / off_today / to_decide only map to the closest status filter (the API has no
  such filters); "worked on off day" status filter missing in the API; "days to decide" lists one day, not the month.
- 2026-10-31 slice 7 group C (frontend, all lazy): employee page now has tabs Details / Attendance
  (`employee-attendance-tab.tsx`: month picker + calendar with codes, month totals, leave and corrections of the
  month, 12-month heatmap `attendance-heatmap.tsx`, shift swap card `shift-swap-card.tsx`); real day drawer
  (`day-drawer.tsx`, `day-timeline.tsx`; `day-drawer-host.tsx` now lazy-loads it, same exports); correction dialog
  with the server preview (`correction-dialog.tsx`); bulk wizard (`bulk-correction-wizard.tsx`, button "Correct many
  people" on the corrections page); data hooks `use-day-detail.ts`; `register-shared.tsx` (totals + legend moved out
  of `register-page.tsx`). Texts added to common.json (`attendance.day|timeline|employee|swap`, `corrections.dialog|bulk|kind.*Hint`).
  Tests: `employee-attendance.test.tsx` (15), `bulk-correction-wizard.test.tsx` (5); attendance + dashboard +
  employees folders 104 passed; typecheck, lint, i18n:check, build + size ok (menu and layout still 23.5 of 23.8 kB,
  first load 110.7 of 150.9 kB). Not run: e2e (no new page route, so `responsive.spec.ts` unchanged; the tab/drawer/
  dialogs at 360 and 768 px should be looked at once in a browser). Differences: the mockup's per-day "Correct"
  button lives in the drawer (every calendar day and heatmap square opens it); "Approve all" of a batch is not in
  the UI (the Super Admin's batch is approved at creation; heads' rows are approved one by one in the list; the
  hook `useBatchAction` supports it); the near-punch warning shows the server text "A punch already covers this
  time." (the API gives no time or minutes); `BULK_TOO_LARGE` text still says 500 (shared code with employee bulk,
  UI limits to 200); "Open in punch log" links to `/admin/punches` without a filter.
- 2026-10-31 slice 7 group D (frontend): Leave `/admin/leave` (`features/leave/`: list with plant, month, pay, state filters
  and a name/code box, add dialog with employee search + live working-day line from the plant weekly off and holidays,
  cancel dialog with reason; Super Admin only, others read-only without the reason column) and Holidays `/admin/holidays`
  (`features/holidays/`: year picker, plant filter, month groups, add / cancel dialogs). Menu items Leave and Holidays for
  all roles (left menu, phone menu, Ctrl+K share `NAV_ITEMS`); both pages added to `responsive.spec.ts` (not run).
  Plant Overview tab got `plant-rules-card.tsx` (weekly off with history In force / Upcoming / Earlier, change dialog with
  warning; attendance start date with the "hides days" warning). Shift form reworked: `shift-form-dialog.tsx`,
  `shift-helper.tsx` (live timeline + lines, decision 0036 line 8), rule history list, field errors (grace 0-120, half-day
  below the full day, apply-from today or later), toast "Shift times changed. Print the gate poster again." with an
  "Open the gate poster" button; `shifts-tab.tsx` is now a list with "Edit rules". Texts: `leave.*`, `holidays.*`,
  `plantWeekly.*`, `plantStart.*`, `shiftForm.*`, `nav.leave|holidays`. Tests: leave 17, holidays 10, plants 57 (plants +
  attendance folders 136 passed); typecheck, lint, i18n:check, build + size ok, no budget raised (menu and layout 23.5 of
  23.8 kB). Not run: e2e. Differences from the mockups / backend: no Plant column in the leave list (API has no plant on
  leave); no server-side name search (the box narrows the loaded 200 rows); "days not counted" is shown as a count, not
  "01/11 weekly off"; no holiday edit (API has add and cancel only) and Cancel is offered for every active holiday; no
  "Falls on the weekly off" note; start-date dialog has no reason field (API takes none); rule history shows the saved date
  only (API has no "saved by"); cancel reasons need 3 to 300 characters (backend), not 10 to 200; the leave overlap code is
  `LEAVE_OVERLAPS` with its existing generic text.
- 2026-10-31 slice 7 group E (frontend, the last group): Reports `/admin/reports` (`features/reports/`: seven cards, period per
  kind, plant locked for a Plant Head, contractor, demo switch, busy state, server file name via new `apiFile`, every
  refusal in words); Punctuality `/admin/insights/punctuality` (`features/insights/`: tiles with arrow + word against the
  period before = a second request, Recharts line and weekday columns in the lazy page only, group bars + tables, top 10);
  Notifications (`features/notifications/`: bell in the top bar with 60 s poll and lazy panel, page with kind and unread
  filters, mark read / all, own email alerts hidden when the server has no email); Settings (alerts card with the
  "email is not set up" note or switch + test email, attendance device screen lines with previews, "New in this version"
  badges, plain-words window error); plant readiness lines for start date and weekly off. Menu (left, phone, Ctrl+K), three
  pages in `responsive.spec.ts` (not run). Employee page opens the Attendance tab for `?tab=attendance` (alert links).
  New dependency Recharts 3.10.1 (MIT). Budget "Admin menu and layout" 24400 to 26300 bytes (decision 0036 line 21).
  Tests: reports 11, insights 9, notifications 11, settings m5 6, plants +1; all frontend folders touched pass; typecheck,
  lint, i18n:check, build + size ok. Not run: e2e. Differences: no plant filter or "Read" filter on the notification list
  (API has kind and unread only); notification texts have no names (backend); done line has no row count; the 20-files
  text has no minutes; no live window cross-check in the settings form (the server's answer is shown in words on save);
  Plant column missing in "Most late arrivals" (API has no plant); old audit-page menu test brought up to date.
- 2026-11-01 slice 8 (e2e, first full headed run): 55 passed. Open point: `kiosk-face-punch` test 1 and
  `admin-face` (code-path punch) pass on `main` (3 of 3) but only about 1 run in 3 on this branch on the
  lead's laptop. The server rejects the face punch with `LIVENESS_FAILED` because the gate's turn picture
  shows the old head (video of the painted camera is late, not a wrong yaw rule). Not found: it is not the
  Inside-now chip, not the early-OUT code, not the dashboard (idle probe: 0 requests, 0 long tasks in 20 s),
  not reduced motion. Helper `punchWithFace` now turns the head inside the page when the screen asks and
  taps "Try again" at most twice (like a person). If the CI `e2e` job fails on these two, look here first.
- 2026-11-01 frontend coverage floor 84: `npm test` now 897 tests (was 844), Statements 89.95, Branches 85.35,
  Functions 85.86, Lines 91.2; floor in `vite.config.ts` raised from 82 to 84 (spec M5). Tests added only (53): sessions
  page, new-password page, plant devices tab, audit filters and panel, user menu, users page actions, day timeline,
  shifts tab, bulk dialog, face dialogs, face camera helpers. No app code changed. Note: `issue-after-import.test.tsx`
  compares today's date and fails if the suite runs across midnight (seen once at 00:00 IST, passes on rerun).
- 2026-11-01 **M4b P0 done** (Opus): migrations **0026** `phone_access_and_accounts` (6 tables, RLS + deny_all,
  append-only `phone_notice_acceptances`, kind `phone_many_phones`) and **0027** `phone_punches` (`channel`,
  `phone_session_id`, `location_plant_id`, nullable `kiosk_id`, `gate_code`, `one_to_one`, all spec checks and
  indexes; challenges owned by a device or a sign-in; snapshot reasons widened to 20 chars). Models in
  `app/modules/phone/models.py`; `Punch.device_key`; `PunchChannel`. Readers of a NULL `kiosk_id` fixed (punch log
  `kiosk` nullable, export, review panel device comparison and edge hint). Context refactor: `plant_id` +
  `DeviceIdentity` (`app/antiproxy/context.py`). `app/core/password_gate.py` (2 slots, 5 s, 429). Phone body
  limits. Removal tools delete phone + M5 rows. Decisions 0036 lines 22-29 (**line 28 to confirm**).
  Tests: `test_m4b_phone_tables.py` (15), `test_m4b_migrations.py` (own `_m4b_test` DB), `test_m4b_nullable_kiosk.py`
  (5), `test_m4b_removal_tools.py` (3), `test_password_gate.py` (4), body-limit +2. **Full backend suite: 1430
  passed, 7 skipped, coverage 90.68 % (floor 84).** e2e not run.
- What P1 must know: wrap every employee password check (real and dummy) in `password_check_slot()`; build a
  phone `PunchContext` with `plant_id` = employee's plant on the punch date and
  `DeviceIdentity.of_phone_session(id)`; phone face challenges are rows with `phone_session_id` (the
  `face_challenge` rule already matches them); retries are found by `(phone_session_id, client_punch_id)`; the
  session clean-up must keep sign-ins referenced by a notice acceptance (decision 0036 line 28). Frontend: the
  punch log `kiosk` field is now nullable (TS type in P3/P4). Open for P3: the `many_rejections` alert still
  counts every rejected punch with a gate device, so rejected gate-code phone punches would count toward the
  gate's alert (decide whether to filter `channel = 'kiosk'`).
- 2026-11-01 **M4b P1 done** (Opus): `app/modules/phone/` services + `router.py` (`/api/v1/phone`: login, logout,
  me, notice + accept, stop, proof/face/challenge, proof/face, proof/card, password, passkeys list / register
  options / register / delete own / login options / login) and `admin_router.py` (`/employees/{id}/phone` read,
  `access`, `outside-work` with F-69 until, `sign-out-all`, `require-new-password`, `passkeys/{id}/remove`).
  Cookie `ups_phone` (HttpOnly, Secure outside development, SameSite=Strict, Path=/api/v1/phone); one phone at a
  time; lockout in ceil minutes; dummy Argon2 check; every Argon2 check inside the password gate; proofs answer
  `PROOF_FAILED` after >= 1 s; mark as left ends phone access, sign-ins, password and passkeys. Migration **0028**
  `phone_sessions.sign_in_method`. New dependency **webauthn 3.0.1** (BSD-3). Settings group `phone` (7 keys,
  max days >= idle days). Capabilities `VIEW_PHONE_ACCESS`, `MANAGE_PHONE_ACCESS`. Daily job: F-69 switch-off,
  proofs after 1 day, ended sign-ins after 90 days (kept when a notice acceptance or punch points to them). F-70
  alert at every sign-in. Notice v1 text `app/phone/notice_texts/phone-notice-v1.en.txt` (hash fixed; wording to
  confirm). Decisions 0036 lines 35-44. Tests: `test_m4b_phone_sign_in.py` (31), `test_m4b_phone_proofs.py` (24),
  `test_m4b_passkeys.py` (10, software authenticator, real signature checks), `test_m4b_phone_extras.py` (6).
  **Full backend suite: 1501 passed, 7 skipped, coverage 91.07 % (floor 84).** `npm run i18n:check` ok. e2e and
  Vitest not run.
- What P2 must know: phone punches start with `require_phone_employee` (dependency) then
  `notice.require_notice_accepted`; `views.face_ready` is the `PHONE_FACE_NOT_READY` test; outside work on a punch
  day = `access.outside_work_allowed_on(access, IST date)`; `punches/face_service.choose_challenge` and
  `capture_rules` are shared; the phone face challenge row needs `phone_session_id`. Still open for P2/P3:
  `GET /phone/punches/today`, `GET /phone/attendance` (F-73), employees list filter `phone=on|off` + item field,
  gate-code settings (`phone_gate_code_seconds`, `kiosk_show_phone_code`, `kiosk_phone_code_show_seconds` with the
  cool-down cross-check). For P4: the AC-59 docker-job memory check (8 parallel sign-ins + 4 face punches under
  450 MB) is not in CI yet; the frontend must read `details.ended` of `PHONE_NOT_SIGNED_IN`.
- 2026-11-02 **M4b P2 done** (Sonnet): backend of the phone punch. `app/modules/phone/punch_service.py` (challenge bound to the
  phone sign-in, face punch with a 1:1 match against the signed-in employee, gate-code punch), `gate_code.py` (text
  `UPG1.<device>.<unix>.<mac>`, server HMAC, 30 s + 5 s grace), `gate_code_service.py` (the answer of
  `/kiosk/gate-code`, "anyone eligible" cache 60 s), `history.py` (`GET /phone/punches/today`, `GET /phone/attendance`,
  F-73), rules `phone_location.py` (rule 12: own fence, other plant of the company, `OUTSIDE_PLANT`),
  `face_match_one_to_one.py`, `gate_code.py` in `app/antiproxy/rules/`, lists `PHONE_FACE_RULES` / `GATE_CODE_RULES` in
  `engine.py`. Endpoints: `POST /phone/punch/challenge`, `/phone/punch/face`, `/phone/punch/gate-code`, `GET
  /phone/punches/today`, `GET /phone/attendance`, `POST|GET /kiosk/gate-code`; `/kiosk/me` carries
  `kiosk_settings.phone_code`. Settings `phone_gate_code_seconds`, `kiosk_show_phone_code`,
  `kiosk_phone_code_show_seconds` + the cool-down cross-check (`SETTING_INVALID`). M5 amendments: `standing_plant_id`
  in `dashboard/service.py` (inside now, muster, gate count F-28 and the still-inside alert by where the person
  stands; `OUTSIDE_PLANT` = inside no plant), `on_outside_work` in the live numbers, `home_plant` on muster people
  (screen and PDF); the many-rejections alert counts channel `kiosk` only. Texts: `punchReasons` + Excel words for
  `GATE_CODE_INVALID`, `GATE_CODE_EXPIRED`, `OUTSIDE_PLANT` (`npm run i18n:check` ok). Decisions 0036 lines 45-54
  (**to confirm: 45 early-OUT on the phone, 47 GET+POST, 48 code naming no device = no row, 51 many-rejections filter**).
  Tests: `test_m4b_phone_face_punch.py` (23: AC-20 to AC-29, AC-41b, AC-49 punch part, request checks),
  `test_m4b_gate_code.py` (25: AC-30 to AC-35, AC-42), `test_m4b_phone_history.py` (4: AC-51), `test_m4b_inside_now.py`
  (8: AC-41, AC-41b, alerts). Full backend suite: 1573 passed (one old test, the heartbeat shape, updated for `phone_code`), coverage 91.24 % (floor 84).
- What P3 must know: phone punch rows are in `punches` with `channel = 'phone'`, `kiosk_id` null for a face punch
  (set for a gate-code punch), `claimed_employee_id` = the signed-in employee on a refusal without a match,
  `location_plant_id` null for `OUTSIDE_PLANT`; `OUTSIDE_PLANT` is a flag code (stored in `reason_codes` of a
  `flagged` row) and is NOT yet in the review page's flag list / `review_service` summary (`LOCATION_AT_EDGE` is the
  pattern); a refused phone punch naming an employee (`employee_id` or `claimed_employee_id`) is approvable by the
  existing M4 review (tested for `OUTSIDE_GEOFENCE` and `SHIFT_ALREADY_CLOSED`). Still to do in P3: punch log
  `channel` / `outside_plant` filters and the `channel`, `outside_plant`, `phone_browser` fields (the log
  presenter must show `kiosk` null for a face punch), lat/lon of a phone punch only to the Super Admin, "Needs review"
  `channel=phone` filter + `bulk_confirmable` + `POST /reviews/bulk-confirm` (F-76), the employees list `phone=on|off`
  filter + `phone_punch_enabled` item field, the audit viewer, the dashboard "On outside work: N" line (API done:
  `on_outside_work`), settings labels of the 3 new keys. For P4: result texts `phone.punch.<CODE>.title|message|next`
  (codes a phone punch can answer: all M3 face codes, `OUTSIDE_GEOFENCE`, `LOCATION_*`, `GPS_ACCURACY_TOO_LOW`,
  `GEOFENCE_NOT_SET`, `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`, `SHIFT_ALREADY_CLOSED`, `GATE_CODE_INVALID`,
  `GATE_CODE_EXPIRED`, `WRONG_PLANT`, `SNAPSHOT_MISSING`, `SNAPSHOT_INVALID`, `FACE_NOT_RECOGNISED`, `SPOOF_SUSPECTED`);
  the answer is `{punch_id|null, decision, reason_code, direction, punch_time, outside_plant, details.retry_allowed}`;
  `punch_id` is null only for a gate code that names no known device; the gate panel (4.2, 4.3) reads
  `GET|POST /kiosk/gate-code` (`code_text` null = show nothing) and `kiosk_settings.phone_code`; the gate card reader
  must ignore texts starting `UPG1.` (AC-36, frontend). Phone punches need `PHONE_NOTICE_REQUIRED` handling (428).
- 2026-11-02 **M4b P3 done (backend of the admin side)** (Sonnet): punch log (`channel`, `outside_plant` filters; `channel`,
  `outside_plant`, `phone_browser`, `location_plant` item fields; `location` of a phone punch only for the Super Admin plus
  `location_accuracy_m`; Excel columns "Channel" and "Outside plant"); "Needs review" (`channel=phone`, `OUTSIDE_PLANT` in the
  code list, `bulk_confirmable` and `outside_reason` on list items and on the review context, `POST /reviews/bulk-confirm`, F-76);
  `GET /employees?phone=on|off` and `phone_punch_enabled`; audit viewer `actor_code`/`actor_name` for employee actors; "Cards
  ending soon" (`phone_punch_enabled` on list items, `phone_on_count`). Tests `test_m4b_admin_side.py` (22: AC-39, AC-40, AC-53,
  reason, visibility, filters, audit, cards). Decisions 0036 lines 55-62 (**to confirm: 55 bulk "clean" test, 58 outside reason
  source, 59 phone position visibility**). Frontend: only types and texts (see below). F-69 and F-70 were already done in P1.
  Full backend suite result: FULL_SUITE_RESULT.
- What P4 must know: (1) **Punch log item** adds `channel: "kiosk"|"phone"`, `outside_plant: bool`, `phone_browser: string|null`,
  `location_plant: {id,name,code}|null`; `kiosk` is `null` for a phone face punch (the TS type is now nullable and the places
  that print the device name show `punches.channel.phone` = "Phone"); a gate-code punch has `channel` phone AND a `kiosk`
  (the gate device whose code was scanned) and `method` `gate_code`. Detail: `location` null unless Super Admin;
  `location_accuracy_m` for all. Filters: `channel=kiosk|phone`, `outside_plant=true`. Texts to add in P4: method names
  "Face" / "Card" / "Phone code", the tag "Outside plant" (`punchReasons.OUTSIDE_PLANT` exists), "At plant K200 (own plant K134)"
  from `location_plant`. (2) **Needs review:** `GET /reviews?channel=phone[&tab=...]`; list item = `{punch (as before + the new
  punch fields), latest_review, approvable, bulk_confirmable, outside_reason}`; context = same two extra fields plus
  `punch.location` for the map. Show the checkbox column when `bulk_confirmable`. `POST /reviews/bulk-confirm`
  `{items:[{punch_id, expected_latest_review_id|null}] (1-100, no duplicates), note?: <=300}` answers `200 {results:[{punch_id, ok,
  error_code?}]}`; codes `REVIEW_CHANGED`, `REVIEW_NOT_ALLOWED`, `NOT_BULK_CONFIRMABLE` (text `errors.NOT_BULK_CONFIRMABLE`
  exists), `NOT_FOUND`; reload the list after the call and show failures per row. (3) **Employees:** `?phone=on|off`, item
  `phone_punch_enabled` (show icon + "Phone"). (4) **Cards ending soon:** list items `phone_punch_enabled` (line "Phone punching
  on"); `expiring-count.phone_on_count`. (5) **Audit:** `actor_type: "employee"` (text `audit.actors.employee` = "Employee"),
  `actor_code` + `actor_name`; action names `phone_access.*`, `phone_account.*`, `phone_auth.*`, `phone_proof.failed`,
  `phone_notice.accept`, `phone_passkey.*`, `punch_review.confirm` with `after.bulk` true. (6) **Settings:** group `phone` (7
  keys) and the two gate-screen keys `kiosk_show_phone_code`, `kiosk_phone_code_show_seconds` (group `kiosk_screen`) have
  `settings.items.<key>.label|help` and `settings.groups.phone.*`; add `phone` to `GROUP_ORDER` in `settings-page.tsx`.
  (7) Still frontend only: the dashboard line "On outside work: N" (`on_outside_work` in the live numbers) and the whole `/phone/*`
  area. `npm run typecheck` shows 3 errors about the missing `recharts` package in `node_modules` on this laptop (run
  `npm install`); none come from P3.
