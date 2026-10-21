# Upasthiti – Smart Attendance

Gate-kiosk attendance for Sheet Shapers' plants. Permanent employees punch with face +
liveness; temporary workers show a signed QR card. The server checks every punch
(anti-proxy). One website: `/kiosk` for the gate tablet, `/admin` for HR and admins.

Project context and rules: [CLAUDE.md](CLAUDE.md) · requirements: [docs/SRS.md](docs/SRS.md) ·
design: [docs/architecture.md](docs/architecture.md)

## Folders

| Folder | What is inside |
|---|---|
| `backend/` | FastAPI app (Python 3.14, uv), Alembic migrations, pytest tests, Dockerfile |
| `frontend/` | Vite + React + TypeScript SPA (`/kiosk` and `/admin`), Vitest tests |
| `e2e/` | Playwright end-to-end tests (they start backend and frontend themselves) |
| `deploy/` | Hosting config (Render, Vercel), filled in M1 |
| `docs/` | Specs, plans, decisions, SRS, architecture, design references |
| `scripts/` | `dev.ps1` / `dev.sh`: start backend + frontend together |
| `.claude/` | Claude Code subagents and commands (`/spec`, `/plan`, `/review-milestone`, `/ship`) |

## First-time setup (Windows)

1. Install [Git](https://git-scm.com/), [Node.js 24 LTS](https://nodejs.org/) and **uv**
   (it also installs Python 3.14 for the project):
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
   Close and reopen the terminal afterwards. Do **not** use the plain `python` command: on
   some laptops it is an old version. `uv run ...` always uses Python 3.14.
2. Clone and install the git hooks (they format code and block secrets before each commit):
   ```powershell
   git clone https://github.com/TusharGawande123/Upasthiti.git
   cd Upasthiti
   uv tool install pre-commit
   pre-commit install
   ```
3. Copy the settings file: `copy .env.example .env` (Git Bash: `cp .env.example .env`).
   The defaults work with the local database below.
4. Install packages:
   ```powershell
   cd backend;  uv sync;      cd ..
   cd frontend; npm install;  cd ..
   cd e2e;      npm install;  npx playwright install chromium;  cd ..
   ```

### Database (PostgreSQL 17)

- **With Docker Desktop** (easiest): `docker compose up -d`. Stop with `docker compose down`;
  the data is kept. It listens only on your own laptop (127.0.0.1).
- **Without Docker:** install [PostgreSQL 17](https://www.postgresql.org/download/windows/),
  then create the user and database (in "SQL Shell (psql)"):
  ```sql
  CREATE USER upasthiti WITH PASSWORD 'upasthiti';
  CREATE DATABASE upasthiti OWNER upasthiti;
  ```

Then create the tables: `cd backend; uv run alembic upgrade head`.

### QR card and photo keys (from M2)

Issuing QR cards and storing punch photos need two keys of your own. Make them once and paste
each printed line into `.env` (they are secret: never commit or share them):

```powershell
cd backend
uv run python -m app.scripts.make_qr_key        # QR_SIGNING_KEY=...
uv run python -m app.scripts.make_snapshot_key  # SNAPSHOT_ENCRYPTION_KEY=...
```

Without them the app still starts locally, but issuing a card answers
`QR_SIGNING_NOT_CONFIGURED`. Locally the encrypted punch photos are saved in
`backend/.storage/` (git-ignored, `STORAGE_BACKEND=local`); the live site uses a private
Supabase Storage bucket ([deploy/README.md](deploy/README.md)).

## Run it

```powershell
.\scripts\dev.ps1        # Git Bash / Linux / macOS: ./scripts/dev.sh
```

- Admin: <http://localhost:5173/admin> opens the login page. There is no default account:
  create the first Super Admin once with
  `cd backend; uv run python -m app.scripts.create_super_admin` (it asks in the terminal).
- Kiosk: <http://localhost:5173/kiosk> (pairing, then the punch screen; see the
  [kiosk setup guide](docs/guides/kiosk-setup.md)). The camera works on `localhost` without https.
- API docs: <http://localhost:8000/api/docs>
- Test data: `cd backend; uv run python -m app.scripts.make_fake_data` fills an empty
  development database with the 7 plants and 650 invented employees. It refuses to run in
  production.

Or start them yourself in two terminals: `cd backend; uv run fastapi dev app/main.py` and
`cd frontend; npm run dev`.

**Port already in use?** Start the backend on another port
(`uv run fastapi dev app/main.py --port 8001`) and tell the frontend in `frontend/.env`:
`VITE_API_PROXY_TARGET=http://localhost:8001`. The frontend can use `npm run dev -- --port 5174`.

## Everyday commands

| Where | Command | What it does |
|---|---|---|
| `backend/` | `uv run pytest` | Tests + coverage (must stay ≥ 75%). Database tests need `TEST_DATABASE_URL` (a database whose name ends in `_test`, see `.env.example`) and skip without it |
| `backend/` | `uv run ruff check . ; uv run ruff format .` | Lint and format |
| `backend/` | `uv run pyright` | Type check |
| `backend/` | `uv run alembic upgrade head` | Apply database migrations |
| `backend/` | `uv run alembic revision --autogenerate --rev-id 0002 -m "add plants"` | New migration (number them in order) |
| `frontend/` | `npm test` | Vitest tests + coverage |
| `frontend/` | `npm run lint` / `npm run lint:fix` | Biome lint and format |
| `frontend/` | `npm run typecheck` · `npm run build` | TypeScript check · production build |
| `frontend/` | `npm run size` | After `npm run build`: bundle size budgets, and no kiosk code in the admin's first load |
| `frontend/` | `npm run i18n:check` | Every text key used in code exists in `public/locales/en/common.json` |
| `e2e/` | `npx playwright test` | End-to-end tests (own database `upasthiti_e2e`, wiped on every run; add `--headed` to watch the browser) |
| root | `pre-commit run --all-files` | Every git hook on every file |
| `backend/` | `uv run python loadtest/prepare_data.py`, then Locust | Load test of the kiosk punch (by hand, not in CI): [backend/loadtest/README.md](backend/loadtest/README.md) |

## How we work (CLAUDE.md §8)

1. `/spec M<n>`: the spec in `docs/specs/`; the lead approves it.
2. `/plan M<n>`: the plan in `docs/plans/`; the lead approves it.
3. Build on branch `milestone/M<n>-<name>` with small Conventional Commits
   (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`).
4. `/review-milestone`, then `/ship`: the PR needs green CI (`backend`, `frontend`, `e2e`,
   `docker`, `hooks`) and one approval.

Rules that matter most: everything must be **free**; **never commit secrets or real
employee data** (this repository is public); all UI text goes in the translation file;
times are stored in UTC and shown in IST.

## After handover (for Sheet Shapers)

- **Dependabot** opens update PRs every Monday. Merge them when CI is green.
- **Keep-alive:** GitHub pauses scheduled workflows after 60 days without repository activity.
  If the backend starts sleeping during the day, open Actions → "Keep backend awake" →
  "Enable workflow".
- Hosting details and limits: [docs/decisions/0002-hosting.md](docs/decisions/0002-hosting.md).
