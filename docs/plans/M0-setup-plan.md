# M0 – Setup: Implementation Plan

Status: Approved (2026-10-12, Tushar Gawande) · Spec: docs/specs/M0-setup.md

## Context
The M0 spec (`docs/specs/M0-setup.md`, Approved 2026-10-12, commit `6e24a06` on branch
`milestone/M0-setup`) asks for:
- an empty but working monorepo;
- CI, pre-commit, Dependabot, `.env.example` and a keep-alive workflow;
- 12 approved tooling extras (S-1 … S-12).

The repo has only docs today; no code exists. The goal is that a teammate can clone the repo
and run it, every PR gets green checks, and M1 can start on solid shared foundations:
- config;
- the error format;
- time helpers;
- i18n;
- an API client.

Product features F-1…F-16 are **not** part of M0.

Work happens on `milestone/M0-setup`, in small Conventional Commits with **no Claude
co-author or "Generated with" lines** (team rule). Step 0 copies this plan to
`docs/plans/M0-setup-plan.md` (CLAUDE.md §8).

## Build steps (one commit each, roughly)

### 0. Housekeeping – `docs:` / `chore:`
- Copy this plan to `docs/plans/M0-setup-plan.md`.
- S-11: `git mv KICKOFF_PROMPT.md README_FIRST.md docs/archive/`.
- Add `docs/decisions/ui-component-sources.md` (empty table: component, source URL, licence,
  date, files).
- Add `docs/decisions/0003-dev-tooling.md` (short record of the M0 tooling choices).
- Add `deploy/README.md` ("filled in M1").

### 1. Backend skeleton – `feat(backend):`
`backend/` is a uv project:
- `.python-version` = 3.12;
- `pyproject.toml` holds the deps from spec §13 and the Ruff, pyright (basic) and pytest
  config (`--cov=app --cov-fail-under=60`);
- `uv.lock` is committed.

Files, each starting with a one-line purpose comment:
- `app/main.py`: `create_app()` does the following:
  - loads settings;
  - sets up logging;
  - adds the request-ID middleware;
  - registers the error handlers;
  - mounts the `/api/v1` router;
  - sets `docs_url="/api/docs"` and `openapi_url="/api/v1/openapi.json"`, both `None` when
    `APP_ENV=production`.
- `app/core/config.py`: a pydantic-settings `Settings` with `APP_ENV`, `APP_VERSION`,
  `DATABASE_URL` and `LOG_LEVEL`.
  - A missing `DATABASE_URL` → a clear exit message naming the variable, never its value
    (AC-6).
- `app/core/errors.py`:
  - an `ApiError(code, message, status, details)` exception;
  - handlers for `ApiError`, `RequestValidationError` → `VALIDATION_FAILED`, Starlette 404/405
    → `NOT_FOUND`/`METHOD_NOT_ALLOWED`, and catch-all → `INTERNAL_ERROR` (logged, no stack
    trace in the body) (AC-4).
- `app/core/time.py`: `utc_now()` and `to_ist()` (Asia/Kolkata via `zoneinfo`).
  - On Windows, `zoneinfo` needs the `tzdata` package (Apache-2.0); add it and note it in
    §13.
- `app/core/db.py`:
  - `MetaData` with the naming convention (`pk_`/`fk_`/`uq_`/`ix_`/`ck_`);
  - `Base`;
  - a lazy engine with `pool_pre_ping` (it never connects at import, so `/health` and e2e
    work without Postgres);
  - a `get_session` dependency.
- `app/core/logging.py`:
  - a JSON formatter on the standard library `logging`;
  - a request-ID middleware that reads or creates `X-Request-ID`, puts it in a contextvar,
    adds it to every log line and to the response header (S-7, AC-23).
- `app/modules/health/{schemas,router}.py`:
  - `GET /health` → `{status, version, server_time}`, with no database use (AC-2);
  - `GET /health/ready` → `SELECT 1` with a 3 s timeout, or 503 `DATABASE_UNAVAILABLE`
    with no connection details in the body (AC-3).
- Placeholder folders, each with a short `README.md` line: `app/modules/`, `app/antiproxy/`,
  `app/face/`, `app/jobs/`, `scripts/`.
- `migrations/`:
  - Alembic `env.py` reads `DATABASE_URL` from `Settings` and uses `Base.metadata`;
  - the revision `0001_baseline` is empty (AC-10);
  - `script.py.mako` uses numbered file names.
- `tests/`:
  - `conftest.py` sets the env and creates a `TestClient`;
  - test files: `test_config.py`, `test_time.py`, `test_errors.py`, `test_health.py`
    (ready OK is mocked; the failing case uses a broken URL), `test_docs_toggle.py`,
    `test_request_id.py`.

### 2. Docker – `build(backend):`
- `backend/Dockerfile`:
  - based on `python:3.12-slim`;
  - copies the `uv` binary from `ghcr.io/astral-sh/uv`;
  - runs `uv sync --locked --no-dev`;
  - runs as a non-root `app` user;
  - starts with `CMD fastapi run app/main.py --host 0.0.0.0 --port ${PORT:-8000}`
    (shell form, so `$PORT` works) (AC-15).
- `backend/.dockerignore` excludes `.env*`, `tests/`, `.venv/`, caches and `.git`.

### 3. Frontend skeleton – `feat(frontend):`
Vite 8 + React 19 + TypeScript (strict) in `frontend/`:
- `package.json`: `engines.node` set to 24; scripts `dev`, `build`, `test`
  (`vitest run --coverage`), `lint` (`biome check`), `typecheck` (`tsc -b`) and `i18n:check`.
- `vite.config.ts`:
  - React plugin and `@tailwindcss/vite`;
  - dev proxy `/api` → `loadEnv().VITE_API_PROXY_TARGET ?? "http://localhost:8000"`;
  - Vitest config: jsdom, setup file, v8 coverage with a 60% floor.
- `biome.json` (formatter + linter, LF line endings) and `.env.example`.
- `src/main.tsx` wraps `QueryClientProvider` + `RouterProvider`.
- `src/app/router.tsx`: React Router data mode, with `/` → redirect `/admin`, `/admin`,
  `/kiosk` and `*` → NotFound (AC-8).
- `src/app/i18n.ts`: i18next + react-i18next + http backend loading
  `/locales/{lng}/{ns}.json`, default `en`.
  - The test setup uses inline resources instead.
- `public/locales/en/common.json` holds every visible string: `health.*`, `admin.*`,
  `kiosk.*`, `common.notFound`.
- `src/lib/format.ts`:
  - `formatDate` (DD/MM/YYYY, IST);
  - `formatTime` (HH:mm, IST);
  - `formatNumber` (en-IN, giving 1,00,000);
  - `formatRupees`;
  - all built on `Intl` with `timeZone: "Asia/Kolkata"` (AC-9).
- `src/lib/api-client.ts`:
  - `apiGet<T>(path)` uses relative `/api/v1` paths;
  - it turns the error envelope into an `ApiError` class carrying `code`.
- `src/features/health/use-health.ts`: a TanStack Query hook.
- `src/features/health/health-status.tsx`: the three states, each with a Lucide icon + word,
  inside an `aria-live="polite"` region (AC-7).
- Pages:
  - `src/features/admin/admin-placeholder-page.tsx`;
  - `src/kiosk/kiosk-placeholder-page.tsx` (text ≥ 24 px);
  - `src/app/not-found-page.tsx`.
- `src/styles.css`: Tailwind 4 `@import "tailwindcss"` and a light background. No design
  system yet (M1).
- Tests: `format.test.ts`, `health-status.test.tsx` (mocked fetch: loading, success and
  error) and `router.test.tsx`.
- S-9: `i18next.config.ts` for `i18next-cli`.
  - `npm run i18n:check` runs its CI mode, which fails when code uses a key missing from
    `en/common.json` (AC-25).
  - **Check the exact command and flags with context7 during the build.**

### 4. End-to-end – `test(e2e):`
- `e2e/` has its own `package.json` with `@playwright/test`.
- `playwright.config.ts` (Chromium only) uses a `webServer` array:
  - the backend via `uv run fastapi run app/main.py --port 8000`, with a dummy
    `DATABASE_URL` (the engine is lazy);
  - the frontend via `npm run dev -- --port 5173`;
  - both checked through their health URLs.
- `tests/smoke.spec.ts`:
  - open `/admin` → "Server connected" is visible (this proves the `/api` proxy);
  - `/kiosk` renders;
  - an unknown route shows "Page not found".

### 5. Local dev tooling – `chore:`
- Root files:
  - `.nvmrc` (24) and `.editorconfig`.
  - `.env.example` with every backend variable from spec §7 rule 3, each commented (AC-16).
  - `docker-compose.yml` (S-10): `postgres:17`, user/db `upasthiti`, port 5432, a named
    volume, a healthcheck.
- S-6:
  - `scripts/dev.ps1` starts the backend and frontend as two processes, with all paths
    quoted because the project folder has spaces;
  - `scripts/dev.sh` is the same for Git Bash/Linux.
- S-12: `.vscode/extensions.json` (Ruff, Biome, Tailwind, Python/Pylance, Playwright) and
  `.vscode/settings.json` (format on save, Biome for TS, Ruff for Python).
  - `.gitignore`: replace `.vscode/` with `.vscode/*` + `!.vscode/extensions.json` +
    `!.vscode/settings.json`.
- `.pre-commit-config.yaml`:
  - pre-commit-hooks: trailing-whitespace, end-of-file-fixer, check-yaml/json/toml,
    check-merge-conflict, detect-private-key, `check-added-large-files --maxkb=1024`;
  - ruff-pre-commit (lint `--fix` + format);
  - gitleaks (S-2);
  - a local Biome hook (`npx --prefix frontend biome check --write`).

### 6. GitHub automation – `ci:`
All workflows use `permissions: contents: read` (more only where needed), `concurrency` with
cancel-in-progress, and no path filters on required jobs.
- `.github/workflows/ci.yml`, run on `pull_request` and `push: main`. Jobs:
  - `backend`:
    - `astral-sh/setup-uv` → `uv sync --locked`;
    - `ruff check`, `ruff format --check`, `pyright`;
    - `pytest` (coverage appended to `$GITHUB_STEP_SUMMARY`);
    - `alembic upgrade head` against a `postgres:17` service.
  - `frontend`:
    - `setup-node` (24, npm cache) → `npm ci`;
    - `biome ci`, `typecheck`, `i18n:check`;
    - `vitest --coverage` (summary to the step summary), then `build`.
  - `e2e`:
    - uv + node setup;
    - `npx playwright install --with-deps chromium`;
    - `npx playwright test`;
    - upload the report **only on failure**. It has no personal data, since all test data
      is synthetic.
  - `docker`:
    - `docker build backend`;
    - run it with `PORT=10000` and a dummy `DATABASE_URL`;
    - poll `curl /api/v1/health`;
    - check `docker exec … id -u` ≠ 0.
  - `hooks`: `pre-commit run --all-files` (this covers gitleaks, the private-key check and
    the large-file block, AC-12).
    - **This is a 5th job:** update spec §2 item 5 and AC-11 from "four jobs" to five.
- `codeql.yml` (S-1): CodeQL default queries for `python` + `javascript-typescript`, run on
  PRs, on pushes to `main`, and weekly.
- `pr-title.yml` (S-3): `amannn/action-semantic-pull-request@v5` on `pull_request_target`
  (types opened/edited/synchronize), with permission `pull-requests: read`.
- `keepalive.yml`:
  - triggers: `schedule: "*/10 0-16 * * *"` + `workflow_dispatch`;
  - if `vars.BACKEND_HEALTH_URL` is empty → `::notice::` "skipped", exit 0;
  - otherwise `curl --fail --retry 3 --retry-delay 30 --retry-all-errors --max-time 60`
    (AC-14).
- `.github/dependabot.yml`:
  - ecosystems `uv` (/backend), `npm` (/frontend and /e2e), `github-actions` (/) and
    `docker` (/backend);
  - weekly, minor/patch grouped, `open-pull-requests-limit: 5` (AC-13).
- S-4:
  - `.github/pull_request_template.md`: spec link, AC checklist, tests run, screenshots, the
    review agents run (CLAUDE.md §8), and a note to keep it free of Claude trailers;
  - `.github/ISSUE_TEMPLATE/bug.yml` and `feature.yml`;
  - `.github/CODEOWNERS`: `* @TusharGawande123` (teammates added later).

### 7. Claude commands – `chore:` (S-5)
`.claude/commands/` gets four files:
- `spec.md`: argument `M<n>`; runs spec-writer; asks every question and suggestion in chat
  through AskUserQuestion; includes product features, not just tooling.
- `plan.md`: Plan Mode, then writes `docs/plans/M<n>-<name>-plan.md`.
- `review-milestone.md`: runs test-engineer, code-quality-reviewer and security-reviewer
  (plus compliance-auditor and i18n-reviewer when relevant).
- `ship.md`: runs git-committer for the commit + PR, with no Claude trailers.

### 8. README – `docs:`
Root `README.md` covers:
- what Upasthiti is (3 lines);
- the folder map;
- prerequisites (uv, Node 24, Git; Docker optional);
- setup for Windows (PowerShell) and Git Bash;
- Postgres the Docker way or the native way;
- `pre-commit install`;
- the commands from CLAUDE.md §9;
- `scripts/dev.ps1`;
- changing ports;
- the workflow from CLAUDE.md §8;
- an "After handover" section: re-enable the scheduled workflow after 60 days without
  activity, and watch Dependabot PRs.

### 9. GitHub settings, push, PR (outward-facing; done at the end)
- Turn on secret scanning + push protection:
  `gh api -X PATCH repos/TusharGawande123/Upasthiti` with `security_and_analysis` (S-1).
- `git push -u origin milestone/M0-setup`, then open a PR (title
  `feat: M0 project skeleton, CI and tooling`) with no Claude trailer.
- After the first green run, add `backend`, `frontend`, `e2e`, `docker` and `hooks` as
  required status checks on `main`. Keep the 1 approval; `enforce_admins` stays off.

### 10. Reviews before merge
- test-engineer: checks AC coverage.
- code-quality-reviewer and security-reviewer: review the diff.
- Fix their findings, then the lead approves the PR and merges.

## Reused / existing
- `.gitattributes` (LF) and `.gitignore` already exist; only extend them.
- The error codes, variable names and route paths come from spec §5 and §7; SRS §5.a is the
  contract.
- The folder layout follows docs/architecture.md §8 exactly.

## Verification
- **Locally on the lead's laptop (Windows):**
  - `cd backend; uv sync; uv run pytest` passes with coverage ≥ 60%;
  - `uv run ruff check .`, `uv run pyright`;
  - `uv run fastapi dev app/main.py`, then open `http://localhost:8000/api/v1/health`;
  - `cd frontend; npm install; npm test; npm run lint; npm run build`;
  - `npm run dev` → open `http://localhost:5173/admin` and see "Server connected" plus the
    IST time;
  - stop the backend → the page shows "Server not reachable".
- `cd e2e; npx playwright test` passes.
- If Docker is available: `docker compose up -d`, then
  `uv run alembic upgrade head` → revision `0001_baseline`, and `/health/ready` = 200.
  If Docker is missing, CI covers this.
- `pre-commit run --all-files` is clean.
- Negative checks, never committed:
  - a dummy private key and a 2 MB file are blocked;
  - a fake Postgres URL with a password is blocked by gitleaks.
- **On GitHub:**
  - all 5 CI jobs, CodeQL and the PR-title check are green on the PR;
  - the keep-alive manual run ends green with "skipped";
  - the Dependabot page shows 5 configurations with no errors;
  - the PR and issue templates appear.
- Tick every AC-1…AC-26 in the PR description checklist.
