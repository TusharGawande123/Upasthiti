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
- Still open in slice 1-2: corrections service + API (step 4), attendance read endpoints (daily, register,
  employee, day, undecided, recompute), `GET /punch-approvals`, a test that lists the commit points, full suite.
- Slice 3 now also contains the early-OUT confirmation (decision 0036 line 9): gate dialog (mockup image
  first), server confirmation mark, offline path.
- Next: corrections service (step 4).
- Open questions: none (decision 0036 line 1 waits for Tushar's confirmation).
