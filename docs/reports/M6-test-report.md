# M6 test report

Status: Final for the PR (2026-11-06). Section 1 is the baseline, sections 2 to 9 are the end of M6.
Spec: docs/specs/M6-testing-security-docs.md · Plan: docs/plans/M6-testing-security-docs-plan.md

## 1. Baseline (before any M6 change)

Measured on 2026-11-05 on branch `milestone/M6-testing-security-docs` at commit `29ef31e` (main at `b7566d6`, nothing
else changed). The three suites ran one after another, never together.

| Item | Value |
|---|---|
| Machine | Windows 11 Home, lead's laptop |
| Python / uv | 3.14.8 / 0.13.0 |
| Node | 24.20.0 |
| Docker | 29.9.2 (Postgres 17 from `docker-compose.yml`) |
| Test database | local Postgres, `upasthiti_test` (backend), `upasthiti_e2e` (e2e, wiped each run) |

| Suite | Command | Result | Coverage | Time |
|---|---|---|---|---|
| Backend (pytest) | `uv run pytest -q` | 1703 passed, 0 failed, 0 skipped | 91.63 % (floor 84 %) | 13 min 30 s |
| Frontend (Vitest) | `npm test` | 112 files, 1011 tests passed | lines 89.71 %, branches 84.71 %, functions 85.67 %, statements 90.99 % (floor 84 % each) | 79 s |
| End-to-end (Playwright, headed) | `npx playwright test --headed` | 78 passed, 0 failed, 0 flaky | not measured | 12 min 48 s |

Notes:
- Frontend branch coverage (84.71 %) is only 0.7 points above the floor. Plan phase 10 raises the floors to
  "measured minus 1" after the new tests.
- The backend has 72 warnings and no skipped tests. The real-face-model tests (`-m face_models`) are not part of the
  default run; they are covered by the CI `docker` job and the face accuracy report (docs/reports/M3-face-accuracy.md).
- Known hygiene risks found before the sweep (plan phase 1): about 22 unordered `select(AuditLog)` list reads and about
  35 test files that use the real clock without freezing it.

## 2. Final results (2026-11-06, branch `milestone/M6-testing-security-docs`)

| Suite | Result | Coverage (floor, set to measured minus 1) |
|---|---|---|
| Backend (pytest, `uv run pytest -q`) | 1937 passed, 1 failed, 7 skipped | 91.34 % (floor 90 %) |
| Frontend (Vitest, `npm test`) | 120 files, 1059 tests passed | statements 89.77, branches 84.68, functions 85.79, lines 91.06 (floors 88, 83, 84, 90) |
| End-to-end, existing specs (Playwright, headless like CI) | all green: 73 passed in the full run and the remaining 13 (`responsive`, `smoke`) in a second run, after one timeout was raised | not measured |
| Journeys (Playwright, headed, `--project=journeys`) | J-03, J-04, J-11, J-12, J-13, J-14, J-15, J-18 pass | not measured |

- **The one backend failure:** `test_m4b_phone_history.py::test_ac_51_...` failed in the full run (which took 3 h 15 min because
  the laptop had about 1 GB of free memory, several agents and Playwright were running). Run alone it passes (4 passed). It is a
  load-timing failure; the CI run on a clean runner decides. Not an app bug as far as we can tell.
- **Midnight clock:** `pytest -m time_sensitive` with `TEST_CLOCK_START_IST` 2026-11-04T23:59:30 gave 1201 passed and with
  2026-11-05T00:00:30 gave 1200 passed, 1 skipped (before the M6 streams were merged). Not repeated after the merge; CI does it.
- **Flaky sweep (R-5):** the AST guard `test_m6_test_hygiene.py` fails on unordered list reads of the audit and attendance tables,
  on `date.today()` / `datetime.now()` in tests and on a clock-using file without the `time_sensitive` marker. Order-dependent reads
  and unpinned dates were fixed before the guard went in. `pytest-randomly` is installed but off by default (`-p randomly` turns it
  on); a random-order run of the whole suite was NOT done in M6 (only a few light files). The nightly workflow
  (`.github/workflows/nightly.yml`, five clock starts, random order, chaos, recompute check, dump-restore, pip-audit) was written
  but has NOT run on GitHub yet.

## 3. Acceptance criteria of the earlier milestones (AC matrix)
`docs/reports/M6-ac-matrix.md`: 356 criteria, 0 problems, no `GAP` row left (`test_m6_ac_matrix.py` runs the check). At the start:
299 Covered, 24 Manual, 6 Superseded, 2 Accepted gap, 25 GAP. The 25 GAP rows were closed by new tests (22 by backend and Vitest
tests, M1 AC-35 by the axe page list, M4b AC-57 by `e2e/tests/phone-gate-code.spec.ts`, M1 AC-3 and M4b AC-58 by the role
matrix and header tests). M5c AC-8 needed an app fix (decision 0037, 0038): the one-employee Excel and PDF of a permanent person
have no overtime column or total.

## 4. Security (R-3)
`docs/reports/M6-security-review.md` lists the fixed and accepted items; `docs/reports/M6-audit-exceptions.md` the dependency audit.
- **Tests added:** role matrix of every route for six callers, plant scoping, CSRF/origin on every write route, downloads
  (role, no-store, safe file names, upload limit), injection (SQL gluing scan, hostile filters and free text, Excel/PDF read-back,
  request-id and log forging), sessions, client IP (`CLIENT_IP_HEADER`), HMAC of unknown typed codes.
- **Real bugs found and fixed:** a NUL byte in a search box gave a 500 (now 422); a Plant Head could read another plant's muster
  (now 404); a table scroll box was not reachable by keyboard (axe, fixed).
- **Review agents (code quality, security, compliance, i18n):** no Critical and no High finding. The findings were fixed (data-request
  row lock, paging, translated table label, plural texts, backup file modes, export audit safety, orphan-export sweep every five
  minutes, client-IP warning, documents) or recorded in decision 0038 and the runbook.
- **Not done:** the ZAP baseline scripts (S-58) and the licence lists were skipped; Lighthouse CI is configured (`npm run lighthouse`,
  a step in the CI frontend job) but was not run locally.
- **Open for the lead:** six npm audit items in `vite-plugin-pwa` / `workbox-build` (build time only; the suggested fix is an older
  major that would break the gate's service worker): sign-off pending in `M6-audit-exceptions.md`.

## 5. Load and memory (R-4)
Numbers in `backend/loadtest/README.md` (05/11/2026, image built from this branch):
- **1 CPU or more:** one gate p95 0.22 to 0.29 s; seven gates at the design maximum p95 0.69 to 1.2 s; 0 failures; peak memory 270 to
  400 MB. NFR-01 (under 2 s) is met.
- **0.1 CPU (Render Free):** one gate p95 2.9 s, seven gates build a queue (median 20 s). **NFR-01 is missed at 0.1 CPU**, about three
  to four times slower than on 21/10/2026 (one gate p95 was 0.5 s). Peak memory stays at 279 to 369 MB (limit 450 MB).
- **Not run locally:** the 20 face punches and the phone rush through the real face models, and the one-year register and full export
  under 512 MB (`export_memory_check`). The first runs in the CI `docker` job; the second is in the nightly workflow.
- **Dashboard (M5 AC-27):** `GET /dashboard/live` for 650 fake people took about 133 queries and 1.1 s for one plant and 5.7 s for
  all seven plants on the busy laptop (the spec asks 0.5 s and 1.5 s). The test guards at 2 s and 10 s. Decision for the lead:
  optimise (batch the per-plant queries) or relax the criterion.

## 6. Journeys, accessibility, texts (R-2, R-6)
- `e2e/tests/page-list.ts` lists every route (guarded by a Vitest test that fails when `router.tsx` and the list differ);
  `responsive.spec.ts` runs the list at 360, 390 and 768 px with axe (serious and critical) and the phone-menu reach check.
- Journeys (decision 0038): written only where no existing spec proves the same thing. Written: J-03, 04, 11, 12, 13 (with the
  alert on a non-DEMO plant, AC-M6-8), 14, 15, 18. J-06, 08, 16 are covered by existing specs; J-01, 02, 05, 07, 09, 10, 17 partly;
  J-19 (`remove_demo_plant`) by the backend tests: details in `docs/reports/M6-journey-coverage.md`.
- Headed Chromium made two painted-camera face tests slow when the window was behind others; they pass headless (like CI). Journeys
  and the other specs were run headed.
- Texts: `test_m6_texts.py` and `npm run i18n:check` pass; a no-"kiosk" scan covers server messages. Known small items: the
  "1 people" plural of bell texts was fixed with plural keys; `kiosk_*.csv` file names inside the export are explained in its README.

## 7. Backup and restore (F-93)
Drill on local Docker Postgres with fake data: `docs/reports/M6-backup-drill.md` (encrypted backup, restore into a `_drill` database,
counts, migration head and one face template checked). Supabase storage files are not part of the script (database dump and snapshot
folder only).

## 8. Manual and real-device checks (still open)
`docs/guides/m6-manual-checklist.md` lists MC-1 to MC-12 with exact steps (all open real-device checks of M1 to M4, including the
gate phone and PC, one hour offline, the real geofence of each plant, the Marathi and Hindi reading). Owner and date are filled by the
team when each one is done.

## 9. Other open points
- Carry-over decisions (client IP, revoked-device audit rows, gate notice text, orphan storage sweep, backdating window, leaked offline
  key, M4 section 8.3 risks, key rotation) are recorded in decision 0038; four of them are "accepted by Claude, proposed to the lead".
- Compliance questions for the client's HR or legal adviser: retention periods, the exact wording of the phone notice on photos kept
  after a code-path face punch, whether a face template is deleted when someone is marked as left, the CERT-In and DPDP breach
  deadlines. Listed in `docs/compliance/m6-recommended-answers.md`.
- Marathi and Hindi texts (phone notice v2, poster, phone pages, manuals, worker guides) have to be read by the lead before they are
  used.
- The runbook still carries a few `[Confirm]` marks (for example how to start the daily job by hand and `scripts/check-headers.sh`).
