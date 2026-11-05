# M6 – Testing, security review, documentation and handover findings: Implementation plan

Status: Approved (lead, 2026-11-05)
Spec: docs/specs/M6-testing-security-docs.md (Approved 2026-11-05) · Branch: milestone/M6-testing-security-docs
Next numbers: migration 0034, decisions 0038 (build choices) and 0039 (manual results).

## Context
M6 tests the whole product so the lead does not have to test by hand, reviews and fixes security (incl. the
client-IP open item), adds the two small Super Admin features the SRS needs (R-12 data-request register, R-13 full
export), F-99 Marathi/Hindi for phone/notice/poster, and writes people documents (manuals and worker guide in
English, Marathi, Hindi) plus handover findings for the later deployment on the client's own server (no deployment
in M6). Approved extras only: F-93, F-99, S-55, S-58, S-60, S-61, S-62, S-64 (F-97 rejected).

Rules for every slice: one small Conventional Commit per step, NO Co-Authored-By or "Generated with" lines (team
rule), push after each slice, update the Status section, never `git add -A`, every new file starts with a purpose
comment, "attendance device" in people-facing text, `errors.<CODE>` for every new code, pytest and Vitest may
run together, Playwright runs alone, never two of one kind (decision 0038), Playwright headed locally, dates and times pinned, each new test names its AC.
**Do not re-test what is already tested:** the AC matrix (phase 0) decides; new tests are written only for gaps.
Before each agent the lead is asked for model and effort (default Sonnet 5.5 medium).

## Lead's choices (2026-11-05, in chat)
1. Typed unknown codes in the audit log: HMAC-SHA256 with a key derived (HKDF) from APP_SECRET_KEY; no new variable.
2. Strict CSP on /attendance: yes (verified by the offline and camera e2e specs before merge). No admin CSP (S-63 not approved).
3. `uharfbuzz` (Apache-2.0) as a runtime dependency for Devanagari shaping in the poster PDF: yes.
4. Journeys J-01..J-19: nightly workflow + local headed; existing e2e specs stay in the required e2e check.
5. Backup encryption: built in (cryptography AES-GCM, chunked) with a new `BACKUP_KEY` (`make_backup_key`).
6. Erasure request with legally kept rows: only `partly_done` (reason required).
7. Test-runner lock file for AC-M6-45: yes, only the lock (no run-all script).
8. Manual and guide PDFs: only Markdown in git; a script makes PDFs at release.
9. Recompute self-check mismatch: logged + nightly CI fails; no new notification kind (Claude's call, minor).

## Phase 0 – Baseline and AC matrix (R-1; AC-M6-1..4)
- 0.1 Run backend, frontend, e2e one after another; write the Baseline section of docs/reports/M6-test-report.md
  (counts, coverage, skips, durations, commit, environment).
- 0.2 `backend/scripts/ac_matrix.py` (stdlib): parses AC ids from docs/specs/M0..M5c, finds "M<x> AC-<n>" in test
  names/docstrings, `--check` fails on empty cells. `docs/reports/M6-ac-matrix.md` (~356 rows: id, current rule incl.
  superseding decision, status, evidence, gap). `backend/tests/test_m6_ac_matrix.py` runs `--check`.

## Phase 1 – Flaky sweep, marker, random order, nightly (R-5, S-55; AC-M6-25, 26)
- 1.1 `backend/tests/test_m6_test_hygiene.py`: AST guard — `select(T)` list reads of AuditLog, Punch, PunchReview,
  Notification, FaceEnrolmentShot, KioskHeartbeat, AttendanceDay, ChangeRequest, DataRequestEvent without
  `.order_by` fail; `date.today()`/`datetime.now()` in tests fail; a clock-using file without `time_sensitive` fails.
- 1.2 Fix ~22 unordered AuditLog reads (e.g. test_m4b_gate_code.py:573, test_m5_reports.py:269,
  test_punch_log_api.py:368, test_m4b_admin_side.py:231) and the other unordered reads; `[0]`/`.first()` on them.
- 1.3 Pin the 5 `date.today()` uses (test_kiosk_sound_and_poster.py:311, test_m4b_phone_proofs.py:478,
  test_m4b_phone_sign_in.py:207,452,470) with `clock_helpers.PINNED_DAY`/`frozen_at`; freeze the clock where it matters
  in the ~35 live-clock files.
- 1.4 Marker `time_sensitive` (pyproject); ci.yml midnight pass becomes `pytest -m time_sensitive` at 23:59:30 and
  00:00:30 (adds test_m5_reports, test_m5c_*, shift_rules, shift_swaps, inside_now).
- 1.5 `pytest-randomly` (dev; licence checked on PyPI at add time, free) — run 5 seeds, fix order-dependent tests.
- 1.6 `.github/workflows/nightly.yml` (cron + manual, SHA-pinned actions; not a required check): whole suite in random
  order at 5 clock starts (2026-11-04T23:59:30, 2026-11-05T00:00:30, 2026-11-30T23:59:30, 2026-12-31T23:59:30,
  2026-11-08T10:00 Sunday); later slices add chaos fuzz, recompute check, export memory, migration round-trip,
  pip-audit, journeys.

## Phase 2 – Security review and fixes (R-3; AC-M6-9..21)
- 2.1 Client IP: `CLIENT_IP_HEADER` (optional) in app/core/config.py + .env.example; `app/core/client_ip.py`
  single-value header mode, hops mode, else socket; fix `_pick_address` returning the caller-written first entry when
  hops >= list length (must use the connection address). Grep test: no `request.client.host`/`x-forwarded-for`
  outside client_ip.py. `test_m6_client_ip.py`: topologies (Vercel+Render hops 4, 1, 2, 0), forged entries, login
  (20) and pairing (10) limits not bypassable. Vercel header to use is verified in the deployment session (recorded).
- 2.2 HMAC of unknown typed codes + length in audit (phone sign-in, gate code fallback); update test_m4_log_scrub.py.
- 2.3 Headers: frontend/vercel.json — base headers on every rule, strict CSP on /attendance (copy of /phone + service
  worker, blob, wasm needs); app/core/security_headers.py `no-store` on /api/v1. `docs/guides/proxy-samples/`
  (nginx.conf, Caddyfile) and `scripts/check-headers.sh` (local targets only). Tests: backend headers, a vercel.json
  parser test (rule order, /phone and /attendance CSP), e2e header check.
- 2.4 `backend/tests/role_matrix.py` + `test_m6_role_matrix.py` (walks `app.routes`; route without a row fails; 6
  identities; never 500), split per module; `test_m6_plant_scoping.py`, `test_m6_csrf.py`, `test_m6_downloads.py`
  (role, no-store, safe Content-Disposition, upload limits). Reuse `modules/auth/permissions.py`, `scope.py`.
- 2.5 `test_m6_injection.py` (filters, free text, Excel/PDF read-back, header and log injection; no f-string `text(`),
  `test_m6_sessions.py` only for missing session cases; extend test_m4_spoof_attempts.py.
- 2.6 `uvx pip-audit`, `npm audit` (frontend, e2e), licence lists (run-only), gitleaks; fixes as `fix(deps):`;
  exceptions in docs/reports/M6-audit-exceptions.md; pip-audit in nightly.
- 2.7 S-58 `scripts/zap-baseline.ps1`/`.sh`: ZAP container against a local Caddy (sample Caddyfile) in front of
  `vite preview` + backend; refuses non-local targets; output gitignored.
- 2.8 security-reviewer agent pass; open Critical/High go to the lead privately first; `docs/reports/M6-security-review.md`
  lists only fixed/accepted; carry-over items (decisions 0010, 0012, 0028, M4 §8.3) one line each in 0038.

## Phase 3 – R-12 data requests and R-13 full export (AC-M6-29..36)
- 3.1 Migration `0034_m6_data_requests`: `data_requests`, `data_request_events` (checks, indexes, append-only trigger
  with `SET search_path = ''`, RLS + deny_all), notification kind `data_request_due` (pattern of 0029). Module
  `app/modules/data_requests/{models,schemas,service,router}.py` registered in all_models.py and main.py; setting
  `data_request_days` (privacy, 30, 7..90) with `CURRENT_MILESTONE = 6`; kind in KINDS and `_ALL_KINDS` (not HEAD_KINDS).
- 3.2 Service/API per spec §5: state from last event, order rules (DATA_REQUEST_STEP_INVALID, DATA_REQUEST_CLOSED,
  DATA_REQUEST_NOT_FOUND), close rules (erasure with kept rows → only `partly_done`), audit via `record_audit`
  (never the note). `test_m6_data_requests.py` with frozen time.
- 3.3 Daily job in app/jobs/daily.py: notice at due−5 and due day, dedupe key per request and day; banner via
  `GET /data-requests?overdue=`.
- 3.4 `app/modules/exports/` (service, router, schemas, csv_safe): allow-listed columns per table, `streaming.batches`,
  `zipfile` + `csv`, manifest with counts and sha256, FileResponse + `delete_file`; guards in order: Super Admin,
  reason, password (counts toward lockout, EXPORT_PASSWORD_WRONG), 3/hour, advisory lock (EXPORT_IN_PROGRESS), disk
  (EXPORT_NO_SPACE); audit start/end. `test_m6_full_export.py` (counts, hashes, no forbidden bytes, formula quoting,
  each error, no temp file left).
- 3.5 Frontend `src/features/privacy-requests/` and `src/features/data-export/`, routes in src/app/router.tsx,
  NAV_ITEMS (Super Admin), keys in public/locales/en/common.json; Vitest with `renderRoute` + `mockApi`.

## Phase 4 – F-99 Marathi and Hindi
- 4.1 `backend/app/phone/notice_texts/phone-notice-v2.{en,mr,hi}.txt` (exact GPS sentence + face-template sentence);
  `modules/phone/notice.py` v2, languages en/mr/hi, `?language=`, hash per language; everyone re-accepts (runbook).
- 4.2 `public/locales/{mr,hi}/common.json` with only `phone.*` (+ phone errors); language switch on the phone layout
  (localStorage), admin and gate stay English; `i18n:check` extended for the mr/hi phone scope; Vitest.
- 4.3 Poster: Noto Sans Devanagari (OFL, <1 MB) in modules/printing/fonts, `uharfbuzz`, texts out of
  poster_pdf.py, `?language=`; picker on the print page; tests (one page per language, font embedded); check Docker
  image size and the 450 MB memory check. The lead checks Devanagari by eye.

## Phase 5 – Gap tests, S-61, S-62, S-64, safety rules
- 5.1 Backend gap tests from the matrix (known: M4 AC-2, 8, 10, 23, 33, 37, 38, 40, 41, 44; M5c AC-21 refusals)
  and `test_m6_texts.py` (AC-M6-28: messages, refusal endings, no "kiosk" in people texts; fix poster and M1 leftovers).
- 5.2 Vitest gaps (M4 AC-21, 36), router-vs-page-list guard, no secret in local/session storage.
- 5.3 S-61 `test_m6_sync_chaos.py`: Hypothesis state machine on offline_helpers/kiosk_helpers (drops, duplicates,
  reorder, clock jumps, nonce reuse, revoke); small in CI, large in nightly.
- 5.4 S-62 `test_m6_migrations.py`: fresh upgrade, `alembic check`, 0034 down/up, table list vs architecture.md;
  nightly: fake data → pg_dump → restore → upgrade → counts.
- 5.5 S-64 `app/scripts/recompute_check.py` (read-only compare of stored `attendance_days` vs `compute_day`),
  nightly job + log; `app/scripts/export_memory_check.py` (one-year register + full export under 512 MB, ≤450 MB).
- 5.6 AC-M6-45: e2e seed refuses non-local host; journeys refuse non-local baseURL; `.test-run.lock` per suite kind (pytest, Vitest; Playwright takes an exclusive lock that also waits for the others) in the global setups ("Another test run is active. Wait for it to finish."). Rule changed by decision 0038.

## Phase 6 – Journeys, responsive + axe, Lighthouse (R-2, R-6; AC-M6-5..8, 27)
- 6.1 `e2e/tests/page-list.ts` with every route (missing: /admin/setup, /admin/plants/:id, /admin/employees/:id/edit,
  /admin/import, /admin/contractors, /admin/my-requests, /admin/sessions, /admin/login, /admin/new-password,
  /phone/setup/password, /phone/punch/gate-code, new M6 pages); responsive.spec.ts at 360 and 768 with axe and menu reach.
- 6.2 playwright.config.ts `headless: !!process.env.CI`, project `journeys` (e2e/journeys); `app/scripts/e2e_read_file.py`
  (xlsx/pdf/zip read-back, test-only); replace fixed waits.
- 6.3–6.6 Journeys J-01..J-19 reusing helpers.ts (logIn, adminApi, makePlant, makeWorkerWithCard, openKioskWithCard,
  punchWithFace, enrolFaceThroughApi); golden values in e2e/journeys/golden.ts; alerts on a non-DEMO plant in the
  throw-away DB; run 3× with `--retries=0`.
- 6.7 S-60 `@lhci/cli` (Apache-2.0, dev) inside the frontend job: a11y ≥ 0.95 error, others warnings.

## Phase 7 – Load and memory (R-4; AC-M6-22..24)
Locust (1 gate, 7 gates, design max; face p95 < 2 s), face_memory_check punch + phone, export memory, under Docker
`--cpus 0.1 --memory 512m`; sizing runs at 1/2/4 CPU for the client server; results vs 21/10/2026 in the report and
backend/loadtest/README.md. Never against the live site.

## Phase 8 – F-93 backup and restore drill
`backend/app/scripts/backup.py` (create: pg_dump -Fc + snapshot folder, encrypted with BACKUP_KEY, manifest; restore:
decrypt, pg_restore into a `_restore`/`_drill` DB, verify counts, alembic head, one template decrypts) and
`make_backup_key`; unit tests with a fake runner. Claude runs the drill on local Docker Postgres with DEMO fake data;
results in docs/reports/M6-backup-drill.md.

## Phase 9 – Documents (docs-writer)
docs/compliance/m6-recommended-answers.md (lead's answers; compliance-auditor review) · docs/guides/m6-manual-checklist.md
(MC-1..12 incl. all open M1–M4 real-device checks, exact steps, owner/date) · docs/guides/user-manual.{en,mr,hi}.md
(3 roles; screenshots from DEMO data, <1 MB each) · docs/guides/worker-guide.{en,mr,hi}.md (one A4) · PDF script for
release · docs/guides/runbook.md (incl. breach template, backup/restore, client IP per topology, headers, notice v2)
· docs/guides/deployment-findings.md (spec §7.9) · docs/report/design.md, docs/report/testing.md ·
docs/reports/M6-test-report.md final (all suites, repeat runs, clocks, flakes fixed, load, security, ZAP, Lighthouse,
manual items with owner and date).

## Phase 10 – Review and ship
Coverage floors to measured−1 (backend/pyproject.toml, frontend/vite.config.ts) · `/review-milestone` · SRS salary
parts removed · CLAUDE.md diff shown to the lead first (M7 `[ ]` CANCELLED, M6 line, client-IP line, new commands,
`CLIENT_IP_HEADER`, `BACKUP_KEY`, uharfbuzz, nightly, floors) · decisions 0038 complete · `/ship`, then stop.

## New dependencies
| Package | Where | Licence | Why |
|---|---|---|---|
| pytest-randomly | backend dev | MIT/BSD (checked at add) | S-55 |
| uharfbuzz | backend runtime | Apache-2.0 | Devanagari shaping, F-99 poster |
| Noto Sans Devanagari | font file | OFL-1.1 | poster |
| @lhci/cli | frontend dev | Apache-2.0 | S-60 |
| ZAP + Caddy images | Docker, local only | Apache-2.0 | S-58, header samples |
| pip-audit, pip-licenses, license-checker | run-only (uvx/npx) | Apache-2.0/MIT/BSD | audits, not added |

## Risks
Random order may expose many failures (phase 1 first) · uharfbuzz wheel/image size/memory · /attendance CSP vs
service worker and QR wasm · ZAP on Windows Docker · role matrix size (split per module) · Vercel IP header unverifiable
without deploy · notice v2 forces re-acceptance · full export on 0.1 CPU may hit proxy timeout (measure; if too slow,
ask the lead before any spec change) · files < 1 MB.

## Verification (AC → evidence)
1, 3 matrix + test_m6_ac_matrix · 2 gap tests (5.1, 5.2) · 4 baseline + floors · 5, 6 journeys J-01..J-19 3× ·
7 J-14/J-15 read-back vs golden.ts · 8 J-13 non-DEMO alerts · 9 role matrix · 10 plant scoping · 11 CSRF ·
12 sessions · 13, 14 client IP · 15 injection + csv_safe · 16 downloads · 17 headers tests + check-headers + ZAP ·
18 pip-audit/npm audit + exceptions + licences · 19 gitleaks + artefact scan · 20 regression tests + security review ·
21 carry-overs in 0038 · 22, 24 phase 7 tables · 23 memory checks · 25 repeat runs + nightly + `-m time_sensitive` ·
26 hygiene guard · 27 page-list + guard + responsive/axe · 28 test_m6_texts + i18n:check · 29–33 data-request tests,
job, RLS, trigger, J-18 · 34–36 full export tests + J-18 · 37 manual checklist + 0039 template · 38 teammate dry run ·
39 worker guides · 40 runbook + backup drill · 41 report chapters · 42 test report · 43 recommended answers ·
44 CLAUDE.md and SRS diff approved · 45 lock + refusals · 46 deployment findings, no deploy commits.
Commands before the PR: backend ruff, format, pyright, pytest; frontend lint, typecheck, test, i18n:check, build,
size; full e2e headed; `pre-commit run --all-files`; 5 green CI checks + CodeQL.

## Status
- 2026-11-05: spec and plan approved with the lead's 9 choices. Next: phase 0 (baseline run, AC matrix).
- 2026-11-05 Phase 0 done. Baseline (0.1): backend 1703 passed (91.63 %), frontend 1011 passed (branches 84.71 %),
  e2e 78 passed; all in docs/reports/M6-test-report.md. AC matrix (0.2): `backend/scripts/ac_matrix.py` and
  docs/reports/M6-ac-matrix.md: 356 criteria = 299 Covered, 24 Manual, 6 Superseded, 2 Accepted gap, 25 GAP.
  The 25 GAP rows are closed in phase 5 (each row names the test needed); `test_m6_ac_matrix.py` is added in phase 5
  when no GAP is left (until then `--check` fails on purpose). Next: phase 1 (flaky sweep).
  Open for the lead: M5 AC-49 (monthly register e-mail F-65 not built) and M5c AC-8 (employee Excel shows an
  overtime column for permanent staff).
- 2026-11-05 (late): work stopped because of the lead's usage limit. Phase 1 committed (not fully verified), streams A to F
  pushed as `m6/<id>` branches. Everything needed to continue is in docs/plans/M6-handover-for-anuradha.md.
