# M6 test report

Status: In progress (written slice by slice during M6; the final version is written in plan phase 9).
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

## 2. Later sections
Filled in by the later slices: AC matrix result, flaky sweep and repeat runs, security, load and memory, journeys,
accessibility, manual checklist status, documents.
