# M0 – Setup: Specification

Status: Approved (2026-10-12, Tushar Gawande) · Author: spec-writer · Date: 2026-10-12
Related: docs/SRS.md (§11 M0 row, NFR-03, NFR-07, NFR-08, NFR-09), docs/architecture.md §1 and §8,
docs/decisions/0001-tech-stack.md, 0002-hosting.md, CLAUDE.md §2, §4, §7, §8, §9

> Write in simple, clear English. No application code. Kiosk is the only punch channel.

## 1. Problem and goal
Four students will build Upasthiti and then hand it to Sheet Shapers, who
cannot rely on us for long-term maintenance. Before any feature is built, the repo needs a
skeleton that every teammate can run the same way, and automatic checks that catch mistakes
early.

M0 delivers:
- an empty but working monorepo (frontend, backend, e2e) that follows docs/architecture.md §8;
- CI on GitHub Actions, pre-commit hooks and Dependabot;
- `.env.example` and a keep-alive workflow.

**Done means:**
- a teammate on a fresh Windows laptop can clone the repo, follow the README, and see the
  admin placeholder page say "Server connected" within 30 minutes;
- a pull request shows all CI checks green;
- the team approves the docs (SRS, architecture, ADRs, this spec).

## 2. Scope

**Already done before this spec** (verify only; see the git history):
- GitHub repo (public), `main` protected with PR + 1 approval, labels.
- Plugins (`.claude/settings.json`), MCP servers (`.mcp.json`), 12 subagents (`.claude/agents/`).
- docs/SRS.md, docs/architecture.md, ADRs 0000–0002, docs/specs/_TEMPLATE.md.

**In scope (still to build):**
1. **Monorepo skeleton** exactly as in docs/architecture.md §8:
   - `backend/`: uv project (Python 3.12), FastAPI app with `app/main.py`, `app/core/`
     (config, db, time, errors), one `health` module, empty folders with a README line for
     `app/modules/`, `app/antiproxy/`, `app/face/`, `app/jobs/`, `scripts/`.
   - `frontend/`: Vite + React + TypeScript SPA with React Router, TanStack Query, Tailwind
     CSS 4 and react-i18next; routes `/admin` and `/kiosk` (placeholders); `/` redirects to
     `/admin`; Vite dev server proxies `/api` to the local backend.
   - `e2e/`: Playwright project with one smoke test.
   - `deploy/`: folder with a README line ("filled in M1").
2. **Backend foundations that every later module reuses:**
   - settings loaded only from environment variables (`.env` locally);
   - the standard error format `{ "error": { "code", "message", "details" } }` for all
     errors, including validation errors and unknown routes;
   - UTC/IST time helpers;
   - SQLAlchemy 2.1 engine/session setup and Alembic, with an empty baseline migration;
   - health endpoints (§5);
   - OpenAPI at `/api/v1/openapi.json`, docs at `/api/docs`, both turned off when
     `APP_ENV=production`.
3. **Frontend foundations:**
   - i18n setup with `public/locales/en/common.json`; every visible text comes from it;
   - en-IN / IST formatting helpers (date `DD/MM/YYYY`, time `HH:mm` IST, Indian number
     grouping `1,00,000`, `Rs`/`₹` currency);
   - a small API client that reads the standard error format.
4. **Backend Dockerfile** (`backend/Dockerfile`, used by Render in M1): Python 3.12 slim,
   uv, non-root user, listens on `$PORT`. CI builds it and checks `/api/v1/health`.
5. **CI** (`.github/workflows/ci.yml`), on every pull request and every push to `main`:
   - `backend`: `uv sync --locked`, Ruff lint, Ruff format check, pyright, pytest, and
     `alembic upgrade head` against a Postgres service container;
   - `frontend`: `npm ci`, Biome check, TypeScript check, Vitest, `npm run build`;
   - `e2e`: starts backend + frontend, runs the Playwright smoke test (Chromium only);
   - `docker`: builds the backend image and calls its health endpoint;
   - `hooks`: runs every pre-commit hook on all files (added in the plan, 2026-10-12).
6. **Pre-commit** (`.pre-commit-config.yaml`): Ruff (lint + format), Biome, trailing
   whitespace, end-of-file, YAML/JSON/TOML checks, merge-conflict markers, private-key
   detection, large-file block (> 1 MB, so face models and photos are never committed).
7. **Dependabot** (`.github/dependabot.yml`): weekly; ecosystems `uv` (backend), `npm`
   (frontend, e2e), `github-actions`, `docker`; minor and patch updates grouped into one PR
   per ecosystem.
8. **`.env.example`** at the repo root (backend values) and `frontend/.env.example` (Vite
   values). Every variable has a comment. No real values.
9. **Keep-alive workflow** (`.github/workflows/keepalive.yml`): every 10 minutes between
   05:30 and 22:00 IST it calls `GET <BACKEND_HEALTH_URL>`. Until the repository variable
   `BACKEND_HEALTH_URL` is set (in M1, after the first deploy) it skips cleanly with a notice.
10. **Repo docs:**
    - root `README.md`: what Upasthiti is, the folder map, setup on Windows, the commands
      from CLAUDE.md §9, the workflow from CLAUDE.md §8;
    - `docs/decisions/ui-component-sources.md` (empty log with column headers);
    - `docs/decisions/0003-dev-tooling.md`: short record of the M0 tooling choices.
11. **Version pins:** `backend/.python-version` = 3.12; `frontend/package.json` `engines`
    = Node 24 LTS; `.nvmrc` = 24; lockfiles (`uv.lock`, `package-lock.json`) committed.
12. **Branch protection update:** after the first green CI run, mark the five CI jobs as
    required status checks on `main`.
13. **Custom commands folder:** `.claude/commands/` exists (CLAUDE.md §2 fixed folders).
    Its contents are an extra (S-5).
14. **Approved extras** (approved by the lead on 2026-10-12; details in §12; logged in
    docs/decisions/accepted-extras.md):
    - S-1 GitHub secret scanning + push protection turned on; CodeQL workflow
      (`.github/workflows/codeql.yml`, Python + JavaScript/TypeScript, on PRs and weekly);
    - S-2 gitleaks in pre-commit and as a CI step;
    - S-3 PR title Conventional Commits check (`.github/workflows/pr-title.yml`);
    - S-4 `.github/pull_request_template.md`, issue templates (bug, feature) and
      `.github/CODEOWNERS`;
    - S-5 `.claude/commands/`: `spec.md`, `plan.md`, `review-milestone.md`, `ship.md`;
    - S-6 `scripts/dev.ps1` and `scripts/dev.sh` start backend + frontend together;
    - S-7 request ID middleware (`X-Request-ID` header, generated if missing) and JSON log
      lines using Python's standard `logging` (no new dependency);
    - S-8 coverage in CI: pytest-cov and Vitest v8 coverage, floor 60% for M0 (raised each
      milestone);
    - S-9 translation key check in CI (`frontend/scripts/check-translations.mjs`);
    - S-10 `docker-compose.yml` with Postgres 17 for local work, plus README steps for a
      native Postgres install (the fallback for laptops without Docker);
    - S-11 starter-kit files moved to `docs/archive/`;
    - S-12 `.vscode/extensions.json` and `.vscode/settings.json` committed (`.gitignore`
      updated to allow only these two files).

**Out of scope:**
- Any feature screen, login, roles, database tables or design system (M1).
- shadcn/ui setup and theme tokens (M1, together with the design system).
- Real deployment: Vercel, Render, Supabase accounts, `vercel.json`, `render.yaml` (M1).
- Face models and `scripts/download_models.py` content (M3).
- Everything in CLAUDE.md §1 "Future scope" and every non-kiosk punch path.

## 3. Users and user stories
In M0 the users are the team itself and the people who maintain the app after handover.

| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Teammate on a new laptop | clone the repo and run backend + frontend with a few documented commands | I can start working on day one without asking the lead | NFR-07 |
| US-2 | Project lead | see CI pass or fail on every pull request | broken or badly formatted code never reaches `main` | NFR-07 |
| US-3 | Developer | have hooks fix formatting and block secrets before I commit | the public repo never gets a secret, a face model or a real photo | NFR-03, NFR-04 |
| US-4 | Developer building M1+ | reuse ready config, error format, time helpers and i18n | every module looks and behaves the same | NFR-06, NFR-07 |
| US-5 | Future maintainer at Sheet Shapers | get dependency update PRs automatically | security fixes are not missed after the students leave | NFR-03, NFR-07 |
| US-6 | Project lead | configure the app only through environment variables | the app can move to another free host or the client's server | NFR-08 |
| US-7 | Kiosk at the gate (from M1) | have the backend awake during shift hours | the first punch of the day is not slow | NFR-01, NFR-02 |

## 4. Screens and UX (light, modern, premium; English first)
M0 has only two **placeholder** pages. They prove routing, i18n, Tailwind and the `/api`
proxy work. Real design starts in M1 (decision 0000).

### 4.1 `/admin` placeholder
- **Purpose:** show the product name and whether the backend is reachable.
- **Layout:** centred card on a light background: "Upasthiti – Smart Attendance", a short
  line "Admin dashboard – coming in M1", and a server status line.
- **States** (status line, always icon + word, never colour alone):
  - loading: spinner + "Checking server…" (`health.checking`);
  - success: check icon + "Server connected" + server time in IST (`health.connected`);
  - error: warning icon + "Server not reachable. Is the backend running?"
    (`health.unreachable`);
  - empty: not applicable.
- **Accessibility:** the status line is a polite live region; text contrast at least 4.5:1.

### 4.2 `/kiosk` placeholder
- **Purpose:** reserve the route; no camera, no punch.
- **Layout:** full-screen light page, large text "Upasthiti Kiosk" and "Gate screen –
  coming in M2" (at least 24 px, NFR-06).
- **States:** none beyond the static page.

### 4.3 Unknown route
- "Page not found" with a link back to `/admin` (`common.notFound`).

Design reference: none needed for placeholders.

## 5. API contract
Conventions: REST under `/api/v1`, JSON, error format `{ "error": { "code", "message", "details" } }`,
pagination `?page=&page_size=`.

| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/health | public | – | `200 { "status": "ok", "version": "<APP_VERSION>", "server_time": "<ISO 8601 UTC>" }` | – |
| GET | /api/v1/health/ready | public | – | `200 { "status": "ok", "database": "ok" }` | `503 DATABASE_UNAVAILABLE` |
| GET | /api/v1/openapi.json | public (off in production) | – | OpenAPI document | `404 NOT_FOUND` in production |
| GET | /api/docs | public (off in production) | – | Swagger UI | `404 NOT_FOUND` in production |

Rules for these endpoints:
- `/health` never touches the database, so the keep-alive call is cheap and does not fail
  when Supabase is slow.
- `/health/ready` runs `SELECT 1` with a 3-second timeout. Its error response never contains
  the database host, user or driver message.
- Global error codes defined in M0 and reused by every module:
  - `VALIDATION_FAILED` (422) – request body or query is invalid; `details` lists the fields;
  - `NOT_FOUND` (404) – unknown route or resource;
  - `METHOD_NOT_ALLOWED` (405);
  - `INTERNAL_ERROR` (500) – unexpected error; no stack trace in the response;
  - `DATABASE_UNAVAILABLE` (503).
- Admin-docs-for-admins-only in production (SRS §5.c) needs login, so it is finished in M1;
  in M0 the docs are simply off in production.

## 6. Data model changes
- **No tables.** Alembic is initialised in `backend/migrations/` with one empty baseline
  revision `0001` (file `0001_baseline.py`).
- The SQLAlchemy `MetaData` gets a fixed constraint naming convention (`pk_`, `fk_`, `uq_`,
  `ix_`, `ck_`), so later Alembic migrations have stable, readable names.
- Migration file names: `<4-digit number>_<short_snake_case_what>.py`, created with
  `--rev-id <number>` so the revision ID is the number.
- Reminders for M1+: UUID keys, UTC `timestamptz`, `numeric(12,2)` for money, no hard
  deletes of punch, attendance or audit rows.

## 7. Business rules
M0 has no attendance rules. These are the engineering rules the skeleton enforces:

1. **Configuration only from the environment.** The backend reads every setting from
   environment variables (and `.env` in development). No host names, keys or URLs are
   hard-coded.
2. **Fail fast.** If a required variable is missing, the backend stops at start-up with a
   clear message naming the variable (but never printing its value).
3. **Variables in M0:**

   | Variable | Where | Required | Default (dev) | Meaning |
   |---|---|---|---|---|
   | `APP_ENV` | backend | no | `production` (fail safe; `.env.example` sets `development`) | `development`, `test` or `production` |
   | `APP_VERSION` | backend | no | `dev` | shown by `/health`; CI/Render set it to the git commit |
   | `DATABASE_URL` | backend | yes | `postgresql+psycopg://upasthiti:upasthiti@localhost:5432/upasthiti` | Postgres connection |
   | `LOG_LEVEL` | backend | no | `INFO` | log detail |
   | `VITE_API_PROXY_TARGET` | frontend (dev only) | no | `http://localhost:8000` | where Vite sends `/api` in development |
   | `BACKEND_HEALTH_URL` | GitHub repo variable | no | – | keep-alive target, set in M1 |

4. **Time:** the backend always works in UTC (`datetime.now(UTC)`); conversion to IST
   (Asia/Kolkata) happens only for display. Helpers live in `app/core/time.py` and
   `frontend/src/lib/format.ts`.
5. **Same origin:** the frontend calls relative paths `/api/v1/...` only. In development the
   Vite proxy forwards them; in production Vercel rewrites them (M1). No CORS setup.
6. **Text:** no visible UI string is written inside a component; it comes from the
   translation file.
7. **Keep-alive schedule:** cron `*/10 0-16 * * *` in UTC = every 10 minutes from 05:30 to
   about 22:20 IST. GitHub may delay scheduled runs; the kiosk offline queue (M4) and the
   UptimeRobot backup (decision 0002) cover gaps.
8. **Commits and branches:** Conventional Commits (CLAUDE.md §3); M0 work happens on branch
   `milestone/M0-setup` and reaches `main` only through a reviewed PR.
9. **No Claude co-author or "Generated with" lines** in commits or PRs (team preference).

## 8. Security, privacy and compliance
- **Public repository.** Everything committed, every CI log and every CI artifact is public.
  Therefore:
  - no secrets in code, config, tests or CI logs; `.env` stays git-ignored;
  - no real employee data, face images or face models in the repo; test data is synthetic;
  - CI never uploads database dumps or other personal data as artifacts.
- **Hooks:** private-key detection and the 1 MB file limit run in pre-commit (and again in CI
  through `pre-commit run --all-files`, so a skipped hook is still caught).
- **Endpoints:** only the public health endpoints exist. They reveal no internal details
  (no host names, driver errors or stack traces).
- **API docs off in production** (`APP_ENV=production`).
- **Docker image:** runs as a non-root user; `.dockerignore` excludes `.env`, tests, caches
  and `.git`.
- **CI permissions:** each workflow sets `permissions: contents: read` (least privilege);
  third-party actions are only from GitHub (`actions/*`) or well-known maintainers
  (`astral-sh/setup-uv`), pinned to a major version.
- **Audit log:** none yet (M1 adds `audit_logs` writes).
- **Personal or face data:** none touched in M0. No compliance-auditor review needed.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | Message (English, i18n key) |
|---|---|---|---|
| A teammate's plain `python` is 3.7 (lead's laptop) | `uv` reads `.python-version` and uses 3.12; README says to use `uv` or `py -3.12` | – | – |
| Project path contains spaces ("Upasthiti - Final Year Project") | All scripts, hooks and docs quote paths; CI also runs in a path with no assumptions | – | – |
| Windows line endings | `.gitattributes` keeps LF in the repo; Biome and Ruff do not fight over endings | – | – |
| `DATABASE_URL` missing | Backend refuses to start and names the missing variable | – | Console: "Missing required setting: DATABASE_URL" |
| Postgres not running locally | Backend still starts; `/health` = 200; `/health/ready` = 503 | `DATABASE_UNAVAILABLE` | – |
| Backend not running while frontend runs | `/admin` shows the error state | – | `health.unreachable` |
| Invalid JSON or wrong field type in any request | 422 with field list in the standard format | `VALIDATION_FAILED` | – |
| Unknown API path | 404 in the standard format (not FastAPI's default) | `NOT_FOUND` | – |
| Unhandled server error | 500, generic message, full error only in server logs | `INTERNAL_ERROR` | – |
| Port 8000 or 5173 already in use | README explains how to change the port (`--port`, `VITE_API_PROXY_TARGET`) | – | – |
| `BACKEND_HEALTH_URL` not set | Keep-alive job ends green with a notice "skipped" | – | – |
| Backend asleep on Render when keep-alive calls | Job retries 3 times over about 90 seconds before failing | – | – |
| GitHub disables scheduled workflows after 60 days with no repo activity | Noted in README "After handover"; re-enable from the Actions tab | – | – |
| Dependabot opens many PRs | Grouped minor/patch per ecosystem, max 5 open PRs per ecosystem | – | – |
| A developer skips pre-commit (`--no-verify`) | CI runs the same hooks and fails the PR | – | – |
| A required CI check is skipped by a path filter and blocks merge | No path filters on required jobs | – | – |
| Docker not installed locally (Windows Home) | Docker is optional for local work; CI builds the image | – | – |

## 10. Acceptance criteria (Given / When / Then)
- **AC-1** Given a fresh clone on Windows with uv and Node 24, when a teammate follows the
  README, then the backend runs on port 8000 and the frontend on port 5173 without editing
  any code.
- **AC-2** Given the backend is running, when `GET /api/v1/health` is called, then it returns
  200 with `status`, `version` and `server_time` in ISO 8601 UTC, and it does not open a
  database connection.
- **AC-3** Given Postgres is reachable, when `GET /api/v1/health/ready` is called, then it
  returns 200 `{ "status": "ok", "database": "ok" }`; given Postgres is down, then it returns
  503 with code `DATABASE_UNAVAILABLE` and no connection details in the body.
- **AC-4** Given any request to an unknown path, a bad body, or code that raises, when the
  backend answers, then the body matches `{ "error": { "code", "message", "details" } }`
  with codes `NOT_FOUND`, `VALIDATION_FAILED` and `INTERNAL_ERROR` respectively, and no
  stack trace is returned.
- **AC-5** Given `APP_ENV=production`, when `/api/docs` or `/api/v1/openapi.json` is
  requested, then the answer is 404; given `APP_ENV=development`, then both work.
- **AC-6** Given `DATABASE_URL` is not set, when the backend starts, then it exits with a
  message naming `DATABASE_URL`.
- **AC-7** Given the backend and frontend are running, when a user opens `/admin`, then the
  page shows "Server connected" and the server time in IST (`HH:mm`, DD/MM/YYYY), all text
  coming from `locales/en/common.json`; when the backend is stopped, then it shows "Server
  not reachable…".
- **AC-8** Given the frontend, when `/kiosk` is opened, then the kiosk placeholder shows;
  when `/` is opened, then the browser goes to `/admin`; when an unknown route is opened,
  then "Page not found" shows.
- **AC-9** Given the formatting helpers, when they format `2026-10-12T00:30:00Z`, then the
  date is `12/10/2026` and the time `06:00` (IST); when they format `100000`, then the
  result is `1,00,000`.
- **AC-10** Given an empty database, when `uv run alembic upgrade head` runs, then it
  succeeds and the database is at revision `0001` (file `0001_baseline.py`).
- **AC-11** Given a pull request to `main`, when CI runs, then the five jobs `backend`,
  `frontend`, `e2e`, `docker` and `hooks` all pass, and they are required status checks on `main`.
- **AC-12** Given a commit that adds a private key or a file larger than 1 MB, when the
  developer commits with pre-commit installed, then the commit is blocked; when they bypass
  the hook, then CI fails.
- **AC-13** Given `.github/dependabot.yml`, when GitHub reads it, then the Insights →
  Dependency graph → Dependabot page shows all five update configurations without errors.
- **AC-14** Given `BACKEND_HEALTH_URL` is not set, when the keep-alive workflow is run
  manually, then it finishes green with a "skipped" notice; given it is set to a working
  URL, then it gets a 200.
- **AC-15** Given the built Docker image, when it is started with `PORT=10000` and the
  required variables, then `GET /api/v1/health` on port 10000 returns 200 and the process
  runs as a non-root user.
- **AC-16** Given the repo, when a reviewer reads `.env.example` and `frontend/.env.example`,
  then every variable from §7 rule 3 is listed with a comment and no real secret.

Approved extras:
- **AC-17 (S-1)** Given the repo settings, when a push contains a known secret pattern, then
  GitHub push protection blocks it; and given a PR, when CI runs, then the CodeQL check
  runs for Python and JavaScript/TypeScript.
- **AC-18 (S-2)** Given a commit containing a fake token such as a Postgres URL with a
  password, when pre-commit runs, then gitleaks blocks it; when the hook is bypassed, then
  the CI gitleaks step fails.
- **AC-19 (S-3)** Given a PR titled "updated stuff", when CI runs, then the title check
  fails; given "feat: add health endpoint", then it passes.
- **AC-20 (S-4)** Given a new PR or issue, when it is opened on GitHub, then the matching
  template is pre-filled, and CODEOWNERS requests a review automatically.
- **AC-21 (S-5)** Given Claude Code in this repo, when a teammate types `/spec M1`, then the
  spec-writer workflow starts for M1; the other three commands work the same way.
- **AC-22 (S-6, S-10)** Given Docker is installed, when a teammate runs
  `docker compose up -d` and then `scripts/dev.ps1`, then backend and frontend both start
  and `/admin` shows "Server connected"; given no Docker, then the README's native Postgres
  steps reach the same result.
- **AC-23 (S-7)** Given any request, when the backend answers, then the response has an
  `X-Request-ID` header, the same ID appears in that request's log line, and log lines are
  valid JSON.
- **AC-24 (S-8)** Given a PR, when CI runs, then backend and frontend coverage are printed
  in the job summary, and the job fails if either is below 60%.
- **AC-25 (S-9)** Given a component that uses a key missing from `en/common.json`, when CI
  runs, then the frontend job fails and names the key.
- **AC-26 (S-11, S-12)** Given the repo root, when it is listed, then `KICKOFF_PROMPT.md`
  and `README_FIRST.md` are in `docs/archive/`, and `.vscode/extensions.json` and
  `.vscode/settings.json` are tracked while other `.vscode/` files stay ignored.

## 11. Test plan
- **Unit (pytest):** config loading and the missing-variable error (AC-6); time helpers;
  error handlers produce the standard format (AC-4).
- **API (pytest + httpx TestClient):** `/health` (AC-2), `/health/ready` with a working and
  a failing database (AC-3, the failing one via a broken URL), docs on/off by `APP_ENV`
  (AC-5).
- **Migration (CI only):** `alembic upgrade head` on the Postgres service container (AC-10).
- **Unit (Vitest + Testing Library):** formatting helpers (AC-9); `/admin` status line in
  loading, success and error states with a mocked API (AC-7); routes (AC-8).
- **End-to-end (Playwright, Chromium):** start backend + frontend, open `/admin`, expect
  "Server connected" — this proves the `/api` proxy and the whole chain (AC-7, AC-1 in CI).
- **CI/manual checks:**
  - open a test PR and confirm all five jobs pass and are required (AC-11);
  - try committing a dummy private key and a 2 MB file (AC-12);
  - check the Dependabot page (AC-13);
  - run keep-alive manually from the Actions tab (AC-14);
  - `docker` CI job covers AC-15;
  - one teammate other than the lead follows the README on their own laptop and times it
    (AC-1, AC-16).
- **Extras:**
  - pytest: request ID header and JSON log line (AC-23);
  - CI itself proves coverage floor and translation key check (AC-24, AC-25);
  - manual: fake-token commit and push (AC-17, AC-18), a badly titled test PR (AC-19),
    opening a PR and an issue (AC-20), running each Claude command once (AC-21),
    `docker compose up` + `scripts/dev.ps1` on the lead's laptop and the native-Postgres
    path on one teammate's laptop (AC-22), `git ls-files .vscode` (AC-26).

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** nothing in this section is built until the project lead approves it.
- Ask the lead about each suggestion directly in chat as a simple choice; don't leave
  questions only in this file.
- Mark each row as Approved / Rejected / Later.
- Copy approved items into the scope (§2), the acceptance criteria (§10) and
  docs/decisions/.

### 12.1 Tooling and repo extras for M0

| # | Suggestion | Why it helps | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|
| S-1 | Turn on GitHub secret scanning + push protection, and add the free CodeQL workflow (Python + JavaScript) | Free for public repos; catches leaked keys and common security bugs automatically, even after handover | S | Low (CodeQL adds ~5 min to CI) | Approved |
| S-2 | Add gitleaks (MIT) as a pre-commit hook and CI step | Finds secrets that "detect-private-key" misses (API keys, DB URLs with passwords) before they become public | S | Low (rare false positives, can be allow-listed) | Approved |
| S-3 | CI check that PR titles follow Conventional Commits (`amannn/action-semantic-pull-request`, MIT) | Keeps history clean with squash merges; makes changelogs possible later | S | Low | Approved |
| S-4 | PR template (spec link, AC checklist, tests, screenshots), issue templates (bug, feature) and CODEOWNERS | Every PR looks the same and asks for the review steps in CLAUDE.md §8 | S | Low | Approved |
| S-5 | Custom Claude commands in `.claude/commands/`: `/spec M<n>`, `/plan M<n>`, `/review-milestone`, `/ship` (each runs our workflow step with the right subagents) | All 4 teammates run the same workflow on the 2 shared Claude seats | S | Low | Approved |
| S-6 | One-command local start: `scripts/dev.ps1` (Windows) and `scripts/dev.sh` that start backend + frontend together | Faster onboarding; fewer "it doesn't run" questions | S | Low | Approved |
| S-7 | Request ID + structured (JSON) logging middleware in the backend | Each error log line can be traced to one request; very useful for debugging punches on Render later | S | Low | Approved |
| S-8 | Coverage reports in CI (pytest-cov, Vitest v8 coverage) with a floor that rises each milestone | Shows examiners and the client how well the code is tested | S | Low (a too-high floor slows work; start at 60%) | Approved |
| S-9 | Translation key check in CI (`i18next-cli`, MIT): fails if code uses a key missing from `en/common.json` | Prevents raw keys on the kiosk screen; makes adding Marathi/Hindi safe | S | Low | Approved |
| S-10 | Local Postgres with `docker-compose.yml` (for teammates with Docker) plus README steps for a native Postgres install | Every teammate has their own database; nobody breaks a shared one | M | Medium (Docker Desktop is heavy on Windows Home; native install is the fallback) | Approved |
| S-11 | Move the starter-kit files (`KICKOFF_PROMPT.md`, `README_FIRST.md`) to `docs/archive/` | The repo root stays clean; the new README is the single entry point | S | Low | Approved |
| S-12 | Shared VS Code setup: `.vscode/extensions.json` + `settings.json` (Ruff, Biome, Tailwind, Pylance), un-ignored in `.gitignore` | Format-on-save works the same for everyone | S | Low | Approved |
| S-13 | Database backup workflow (nightly `pg_dump`, **encrypted**, stored outside GitHub) | Supabase Free has no backups we control | M | **High in a public repo:** artifacts and logs are public, so it must be designed carefully. Suggest **Later (M6)** | Later (M6) |
| S-14 | Release tags + auto changelog (release-please, Apache-2.0) per milestone | Clear record of what was delivered at each milestone for the report and the client | M | Low | Later |


### 12.2 Product features for the whole project
These are **not built in M0**. Each approved feature goes into the spec of its target
milestone (scope, acceptance criteria) when that spec is written. Asked in chat on
2026-10-12.

| # | Feature | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-1 | Voice + sound feedback at the kiosk ("Check-in successful, Ramesh") using free browser speech or recorded audio; text keys stay i18n-ready | Works at a noisy gate and for workers who cannot read the screen quickly | M2 | S | Low (volume and noise; mute setting per kiosk) | Approved |
| F-2 | "My month" line on the result screen for 3 seconds ("18 days present this month") | Fewer salary disputes with HR, without a phone app | M5 | S | Medium (shows personal data on a shared screen) | Later |
| F-3 | Kiosk health monitor+: battery, camera working, app version, queue size, remote reload | HR knows a gate tablet is failing before workers queue up | M4 | M | Low | Later |
| F-4 | Still-inside safety alert: no check-out 1 hour after shift end → supervisor alert | Safety (someone may still be on the floor) and catches forgotten punches early | M5 | S | Low (night shifts and overtime must not cause false alerts) | Approved |
| F-5 | First-time setup wizard: plant → geofence → shift → kiosk → employees | The client can set up a new plant alone after handover | M1 | M | Low | Approved |
| F-6 | Ctrl+K smart search + bulk actions (e.g. change shift or revoke QR for 50 workers at once) | Saves HR time with 100s of temporary workers | M1/M2 | S | Low (bulk actions need a confirm step and audit entries) | Approved |
| F-7 | Alerts / notification centre (bell icon): late arrivals, absences, kiosk offline, many rejections; optional email through the client's SMTP | Problems reach the right person quickly, at zero cost (no SMS) | M5 | M | Low | Approved |
| F-8 | Overtime approval: OT counts only after a supervisor approves it | Labour Code friendly; stops accidental OT in salary estimates | M5 | M | Medium (adds a workflow step) | Later |
| F-9 | Punctuality analytics: late/absent trends, department heatmap, most-late list | Management sees patterns, not only daily numbers | M5 | M | Low | Approved |
| F-10 | Buddy-punch pattern detection: two QR cards always punched seconds apart at the same kiosk → flag for HR (timing only, no face data) | Catches card sharing that single-punch rules miss | M4 | M | Medium (false flags for friends arriving together; HR reviews, never auto-reject) | Later |
| F-11 | Canteen headcount from the live present count | Useful daily number for a factory canteen | M5 | S | Low | Later |
| F-12 | Weekly management digest (email/PDF every Monday) via the client's SMTP | Management stays informed without logging in | M5 | S | Low | Later |
| F-13 | Demo mode: one-click realistic fake data (tagged DEMO, removable, blocked on the production database) | Full dashboards for the viva and client demos; real employee data never used | M1 | S | Low | Later (lead will ask when needed) |
| F-14 | Free-tier health page: database size vs 500 MB, storage vs 1 GB, last job runs | Warns before Supabase free limits are hit after handover | M6 | S | Low | Later |
| F-15 | Full data export: admin downloads all data as an Excel/ZIP file straight to their own computer (never through GitHub) | The client keeps its own backup; safe for a public repo | M6 | M | Medium (personal data in a file: SUPER_ADMIN only, audited) | Approved |
| F-16 | Shift roster planner: weekly drag-and-drop calendar for shift assignment and swaps | Easier rotating shifts | M5 | M/L | Medium (changes the shift data model) | Later |

## 13. Dependencies to add
Exact versions are fixed by the lockfiles at build time; major versions follow ADR 0001.

| Package | Version | Licence | Reason |
|---|---|---|---|
| fastapi, fastapi-cli, uvicorn[standard] | 0.14x / latest / latest | MIT / MIT / BSD-3-Clause | Backend framework (ADR 0001) and the `fastapi dev`/`run` commands. We do **not** use `fastapi[standard]`: it also installs the FastAPI Cloud CLI, Sentry and OpenTelemetry, which we don't need and which waste the 512 MB on Render |
| pydantic-settings | 2.x | MIT | Reads settings from environment / `.env` with types and the missing-variable error. **New, not in ADR 0001** |
| sqlalchemy | 2.1.x | MIT | ORM (ADR 0001) |
| alembic | latest 1.x | MIT | Migrations (ADR 0001) |
| psycopg (`psycopg[binary]`) | 3.x | LGPL-3.0 (approved, unmodified) | Postgres driver (ADR 0001) |
| tzdata | latest | Apache-2.0 | Time-zone data for `zoneinfo` (Asia/Kolkata); Windows has no system copy. Added in the plan |
| ruff | latest | MIT | Lint + format (dev) |
| pyright | latest | MIT | Type check (dev) |
| pytest | 9.x | MIT | Tests (dev) |
| httpx2 | latest | BSD-3-Clause | Needed by FastAPI's TestClient (dev); Starlette now asks for `httpx2` (by the pydantic team) instead of `httpx` |
| vite, @vitejs/plugin-react | 8.x | MIT | Frontend build (ADR 0001) |
| react, react-dom | 19.x | MIT | UI (ADR 0001) |
| typescript | 7.x | Apache-2.0 | Types (7.x is the new native compiler; latest at build time) |
| react-router | 8.x | MIT | Routing, data mode (ADR 0001) |
| @tanstack/react-query | 5.x | MIT | Server state, used for the health call (ADR 0001) |
| tailwindcss, @tailwindcss/vite | 4.x | MIT | Styling (ADR 0001) |
| i18next, react-i18next, i18next-http-backend | 26.x / 17.x / latest | MIT | Translations loaded from `public/locales/` (ADR 0001); the http backend is **new** |
| lucide-react | latest | ISC | Status icons (ADR 0001) |
| @biomejs/biome | 2.x | MIT / Apache-2.0 | Lint + format (dev) |
| vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom | 5.x / latest | MIT | Frontend unit tests (dev); Testing Library and jsdom are **new** |
| @playwright/test | 1.64.x | Apache-2.0 | End-to-end tests (ADR 0001) |
| pre-commit | latest | MIT | Git hooks (ADR 0001) |
| pytest-cov | latest | MIT | Backend coverage (S-8, dev) |
| @vitest/coverage-v8 | same as vitest | MIT | Frontend coverage (S-8, dev) |
| ~~i18next-cli~~ | – | – | **Dropped during the build (2026-10-12):** its native SWC module refuses to load on some Windows setups. S-9 is done instead by a ~60-line script, `frontend/scripts/check-translations.mjs`, with no dependency |
| gitleaks (pre-commit hook + `gitleaks/gitleaks-action` or CLI in CI) | 8.x | MIT | Secret scanning (S-2). If the official action asks for a paid licence for any repo type, run the free CLI directly instead |
| amannn/action-semantic-pull-request | 5.x | MIT | PR title check (S-3) |
| github/codeql-action | 3.x | MIT (action); CodeQL is free for public repos | Security scanning (S-1) |
| postgres Docker image | 17 | PostgreSQL licence | Local database in `docker-compose.yml` and the CI service container (S-10) |

Other libraries in ADR 0001 (React Hook Form, Zod, shadcn/ui, Motion, Leaflet, etc.) are added
in the milestone that first needs them.

## 14. Open questions for the team
All questions were answered by the lead in chat on 2026-10-12:
1. **Repo licence:** no licence file (default "all rights reserved"); ownership can be
   decided with the client later.
2. **Local database and laptops:** decided when teammates join. At that time Claude writes
   a setup message for the team group (tools to install, Docker or native Postgres).
   The README documents both paths.
3. **Reviewers:** teammates' GitHub usernames are added later; until then
   `.github/CODEOWNERS` lists only the lead (`@TusharGawande123`).
4. **Required checks:** `e2e` runs on every PR and is a required check.
5. **Admin bypass:** `enforce_admins` stays off, so the lead can push an emergency fix.
6. **Node version:** Node 24 LTS; confirmed per laptop when teammates join (see 2).

No questions are open.
