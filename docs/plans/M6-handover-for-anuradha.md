# M6 handover (2026-11-05): where the work stands and what is left

Written when the lead's Claude usage limit was almost used up. Read together with
`docs/plans/M6-testing-security-docs-plan.md` (the approved plan), `docs/specs/M6-testing-security-docs.md`
(approved spec) and `docs/decisions/0038-m6-build-choices.md` (the lead's choices and trims).

## Where the code is
Milestone branch: `milestone/M6-testing-security-docs` (pushed). Six agents worked in parallel, each in its own git
worktree. Their branches are pushed to origin as `m6/<id>`. All of them started from main or from an early commit of the
milestone branch, so they will merge with a few conflicts in docs files (take the milestone branch version of docs
and re-apply the agent's change).

| Branch on origin | Stream | State |
|---|---|---|
| `milestone/M6-testing-security-docs` | Phase 0 and Phase 1 (flaky sweep, `time_sensitive` marker, ci.yml) | committed (3 commits `e07d965`, `6199e2c`, `bff6b9c`). **Not verified to the end** (see "Verify first") |
| `m6/adab3eeaa14011d4c` | A: Phase 2 security | 2.1 client IP, 2.2 HMAC of typed codes, 2.3 headers and CSP and proxy samples done and committed; role matrix started (WIP commit) |
| `m6/a145d0aa5b346c1ab` | B: Phase 3 data requests and export | 3.1 migration 0034 + data-request module + due notices committed; full export backend written (WIP commit, has no tests yet); frontend not started |
| `m6/a8abbb617a8fbcec5` | C: Phase 4 Marathi and Hindi | notice v2 texts (en, mr, hi) + test committed; phone language switch, mr/hi locale files, `check-translations` extended (WIP commit, not linted or built); backend `notice.py` v2 wiring and the poster (4.3) not done |
| `m6/a6b87e1c3b91ca3b2` | D: Phase 9 documents | all drafts committed (compliance answers, manual checklist, user manual and worker guide in en/mr/hi, runbook, deployment findings, report chapters, PDF script) |
| `m6/abfa2e3c4161c397d` | E: Phase 8 backup and restore | finished and committed, drill ran (docs/reports/M6-backup-drill.md) |
| `m6/af4a544f5d461ce56` | F: gap tests | 5 gaps closed and committed, six server messages say "attendance device" now, a no-"kiosk" text test; `test_m6_gaps_sync.py` (M4 AC-10) is WIP |

Test baseline (before M6): backend 1703 passed (91.63 %), frontend 1011 passed, e2e 78 passed
(docs/reports/M6-test-report.md). Parallel rule (decision 0038): pytest and Vitest may run together, Playwright runs
alone, never two runs of the same kind.

## Verify first (Phase 1 was stopped before its final checks)
On the milestone branch, from `backend/` with `uv run`: `ruff check . && ruff format . && pyright`, the new guard
`pytest tests/test_m6_test_hygiene.py`, then once `TEST_CLOCK_START_IST=2026-11-04T23:59:30 pytest -q --no-cov -m time_sensitive`
and the same with `2026-11-05T00:00:30`, then the full `pytest -q` (about 13 minutes). Fix tests, never the app, unless a
real app bug shows up (then ask the lead).

## Merge order and hazards
1. Verify Phase 1 (above). 2. Merge E (clean), then D (docs only), then F, A, C, B in that order (`git merge --no-ff`, resolve
conflicts). 3. Migration number: B owns `0034`; nothing else may add a migration before it. 4. After each merge run the
touched tests; after all merges run the full backend and frontend suites.
Each agent worked with its own test database (`upasthiti_<letter>_test`); you need only the normal `upasthiti_test`.

## What is left (in this order)
1. **A (security), finish:** role matrix for every route (`backend/tests/role_matrix.py`, `test_m6_role_matrix.py`: a route
   without a row must fail the test), then `test_m6_plant_scoping.py`, `test_m6_csrf.py`, `test_m6_downloads.py`,
   `test_m6_injection.py`, missing session cases; `Cache-Control: no-store` on `/api/v1` (check `security_headers.py`);
   2.6 dependency audit (`uvx pip-audit`, `npm audit` in frontend and e2e, `docs/reports/M6-audit-exceptions.md`);
   2.7 ZAP scripts (optional, 10 minutes at most); 2.8 run the `security-reviewer` agent and write
   `docs/reports/M6-security-review.md`. The repo is PUBLIC: an open Critical or High finding goes to the lead in chat
   only; the report lists fixed or accepted items. No finding was recorded so far.
2. **B (export and screens), finish:** tests `test_m6_full_export.py` (ZIP opens, manifest counts and sha256 match,
   forbidden data absent, each error code, no temp file left); frontend `src/features/privacy-requests/` and
   `src/features/data-export/`, routes, `NAV_ITEMS`, locale keys including `errors.DATA_REQUEST_*` and `errors.EXPORT_*`,
   Vitest, and the two paths in `e2e/tests/responsive.spec.ts`.
3. **C (Marathi and Hindi), finish:** `backend/app/modules/phone/notice.py` to version v2 with `?language=`; run
   `npm run lint`, `typecheck`, `i18n:check`, `build`, `size`; then 4.3 the gate poster in three languages (Noto Sans
   Devanagari, OFL; `uharfbuzz` Apache-2.0 for shaping; `?language=`; picker on the print page; check the 450 MB memory
   check and the Docker image). The lead (native reader) reviews all Marathi and Hindi texts before merge.
4. **F (gap tests), finish:** close the rest of the `GAP` rows in `docs/reports/M6-ac-matrix.md` (list them with
   `grep "| GAP |"`); the matrix row of each closed gap becomes `Gap added` with the test as evidence;
   **M5c AC-8 needs an app fix** (permanent employee: no overtime column or total in the one-employee Excel and PDF,
   decision 0037); M1 AC-3 and M4b AC-58 are covered by agent A's role matrix and header tests. When no `GAP` is left,
   add `backend/tests/test_m6_ac_matrix.py` (runs `scripts/ac_matrix.py --check`).
5. **Phase 5 rest:** 5.3 chaos test of the offline sync (Hypothesis state machine, S-61); 5.4 migration round-trip test and
   the nightly dump-restore step (S-62); 5.5 `app/scripts/recompute_check.py` and `export_memory_check.py` (S-64);
   5.6 `.test-run.lock` per suite kind (pytest, Vitest; Playwright exclusive), e2e seed refuses a non-local host;
   `nightly.yml` (5 clock starts, random order with `pytest-randomly`, S-55; add `pytest-randomly` and fix order-dependent
   tests).
6. **Phase 6:** `e2e/tests/page-list.ts` with every route and a router guard (AC-M6-27); responsive plus axe at 360 and
   768 px on every page; Lighthouse CI (S-60, in the frontend job); journeys: **only the journeys that no existing e2e spec
   already proves** (decision 0038); run Playwright headed, one session only.
7. **Phase 7:** Locust, `face_memory_check`, export memory under Docker 512 MB, sizing at 1, 2, 4 CPU; results in the
   test report and `backend/loadtest/README.md`. Nothing else should run on the laptop meanwhile.
8. **Phase 10:** fix the `kiosk-setup.md` file name (`docs/guides/`) to `device-setup.md` and its links; the `/review-milestone`
   agents; coverage floors to measured minus 1 (`backend/pyproject.toml`, `frontend/vite.config.ts`); SRS salary parts
   removed; **CLAUDE.md diff shown to the lead first** (M7 shown as cancelled, not ticked; M6 line; new commands and
   variables `CLIENT_IP_HEADER`, `BACKUP_KEY`, `BACKUP_KEY_ID`, `make_backup_key`, `backup.py`, `uharfbuzz`, nightly
   workflow, the parallel test rule of decision 0038); full test report `docs/reports/M6-test-report.md`; the full
   command list of the plan before the PR; then `/ship` and stop (the lead merges).

## Questions for the lead (ask in chat)
- Rename `kiosk-setup.md` to `device-setup.md` (people never see the word kiosk)? Recommended: yes.
- Supabase storage is not copied by the backup script (database dump only); fine for the client's own server?
- Whether the client gets the source code is undecided: write nothing about it.
- The lead must read the Marathi and Hindi texts (manuals, worker guides, notice v2, poster) before merge.

## Rules to keep
CLAUDE.md rules win. No Co-Authored-By or "Generated with" lines. Never `git add -A` in the main checkout
(`docs/decisions/0030*` and `0031*` stay untracked on purpose). Test only on throw-away databases and DEMO data, never the
live site. All agents use Sonnet 5.5 at medium effort unless the lead says otherwise. Explain to the lead in simple
Hinglish, repo files stay English. Ask every product question in chat (AskUserQuestion).
