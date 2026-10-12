# CLAUDE.md – Upasthiti Project Context

## 0. Source Documents (read first)
- docs/client/Sheet_Shapers_Smart_Attendance_Proposal.pdf: what the client approved.
- docs/client/Upasthiti_Project_Blueprint.pdf: full project blueprint.
- If the proposal and this file differ, THIS FILE and the blueprint win: they hold
  the team's latest decisions (e.g. kiosk-only, no employee phone app).

## 1. Project Context / Overview
- Product: Upasthiti – Smart Attendance. Client: Sheet Shapers (manufacturing, India).
  Final-year engineering sponsored project, team of 4, lead: Tushar Gawande.
- Problem: employees mark proxy attendance from outside the premises; temporary
  hourly workers change often, so face enrolment is impractical for them.
- Solution: ONE website; the gate KIOSK is the main attendance channel.
  - Kiosk: a tablet/phone/laptop with camera fixed at each plant gate, running
    our kiosk screen in full-screen. All employees punch here (check-in/out).
  - Permanent employees -> face recognition + liveness (blink / head turn).
  - Temporary / hourly workers -> unique signed QR code on an ID card, shown to
    the kiosk camera. A photo snapshot is saved at each QR punch for admin review.
  - Phone punching is OPTIONAL per employee: an admin switches it on when the
    employee asks. At the own plant the geofence is enforced; on official work
    outside, GPS is saved and the punch is tagged. Built in M4b (decision 0004).
  - Admin dashboard (same website): setup, employees, QR cards, face enrolment,
    live headcount, reports, corrections, salary estimate (built last).
  - The server re-checks every punch (anti-proxy engine). Never trust the client.
- Roles (client's choice): exactly Super Admin, Corporate Head, Plant Head (+ KIOSK
  device identity); NO HR or supervisor users. Exact permissions: M1 spec.
- Client facts: 7 plants, all of Sheet Shapers (one company), in MIDC Waluj; one gate
  each for now; about 650 people (300 permanent, 350 temporary):
  docs/client/client-answers-2026-10.md.
- Must: zero cost (no paid APIs/licences), Indian compliance (DPDP Act 2023,
  IT Act 43A, Labour Codes), simple to run after handover (students cannot
  provide long-term maintenance).
- Scope = client-approved proposal v1.1 + the decisions in this file = the
  MINIMUM to deliver. It is a floor, not a ceiling: Claude Code is encouraged
  to add extra features that make the product better (see section 11).
  Future scope (NOT now): full payroll, automatic PF/ESIC/PT/TDS calculation,
  statutory reports, challans, Form 16, tax filing, payslips, employee document
  storage, compliance due-date reminders, regulatory-change alerts.

## 2. Architecture & Project Structure
- Approved 2026-10-11; full detail in docs/architecture.md (flows, table
  dictionary) and docs/SRS.md (requirements FR-xx / NFR-xx).
- Monorepo: frontend/ (Vite + React SPA: /kiosk and /admin), backend/ (one
  FastAPI app split into modules), e2e/ (Playwright), deploy/ (render.yaml,
  backend Dockerfile used by Render), .github/workflows/.
- Backend layout: app/core (config, db, security, crypto, time, storage),
  app/modules/<name>/{models,schemas,service,router}.py, app/antiproxy/
  (one rule per file + engine.py), app/face/ (detector, embedder,
  antispoof, matcher), app/jobs/, migrations/ (Alembic), tests/.
- Same origin for SPA and API (Vercel rewrites /api/* to the backend), so
  admin auth uses plain session cookies.
- The server decides every punch; the kiosk only sends signed evidence.
- Fixed folders: docs/ (client/, specs/, plans/, decisions/, design-refs/),
  .claude/agents/ (subagents), .claude/commands/ (custom commands).
- Modules: org setup (plants, geofences, kiosk devices, shifts), employees,
  enrolment (face, QR), kiosk punch, anti-proxy engine, attendance processing,
  dashboards, reports, audit, auth, phone punch (M4b), salary estimate (last).

## 3. Coding Style
- Readability first: code must be easy to read and understand for a student
  seeing it for the first time.
- Clear, descriptive names for variables, functions and files. No cryptic
  abbreviations.
- Small functions that do one thing. Avoid clever one-liners.
- Add comments where needed: explain WHY and any non-obvious logic
  (anti-proxy rules, attendance and salary calculations, face matching).
  Do not comment obvious lines.
- Each file/module starts with a short comment saying what it is for.
- Consistent formatting using the project's formatter and linter.
- Conventional Commits: feat:, fix:, docs:, test:, refactor:, chore:, ci:, build:.
  PR titles follow the same format (CI checks it); no Claude co-author or
  "Generated with" lines in commits or PRs (team rule).

## 4. Preferred Libraries & Tools
Approved stack (versions and reasons: docs/decisions/0001-tech-stack.md):
- Frontend: Vite 8, React 19, TypeScript, React Router 8 (data mode),
  TanStack Query 5, React Hook Form + Zod 4, Tailwind CSS 4, shadcn/ui,
  Lucide icons, Motion 14 (main animation engine), GSAP (special effects),
  react-i18next, TanStack Table, Recharts.
- Kiosk: MediaPipe Face Landmarker (liveness UX only), barcode-detector
  (QR scan), WebCrypto P-256 device key, vite-plugin-pwa + Workbox + Dexie
  (offline queue).
- Maps: Leaflet 1.9 + Leaflet-Geoman free + OpenStreetMap tiles.
- Backend: Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2.1 (sync) + Alembic,
  psycopg 3, PostgreSQL, argon2-cffi, cryptography (Ed25519 QR signing,
  ECDSA verify, AES-256-GCM templates), Shapely, segno, XlsxWriter,
  fpdf2, APScheduler 3.
- Face (server): InsightFace buffalo_l (SCRFD det_10g + ArcFace w600k_r50,
  512-d) via onnxruntime, anti-spoofing (MiniFASNet or a CelebA-Spoof model,
  the better one chosen in M3),
  opencv-python-headless.
- Tooling: uv, Ruff, pyright, pytest · Biome, Vitest, Playwright ·
  pre-commit, Dependabot, GitHub Actions.
- M0 choices that differ from the first plan (docs/decisions/0003-dev-tooling.md):
  TypeScript 7; `fastapi` + `fastapi-cli` + `uvicorn[standard]` (NOT
  `fastapi[standard]`: it adds Sentry/OpenTelemetry/cloud CLI that waste Render's
  512 MB); `httpx2` for tests; `tzdata` for IST on Windows; gitleaks for secrets;
  our own `frontend/scripts/check-translations.mjs` instead of i18next-cli (its
  native module fails on some Windows setups). One root `biome.json` covers
  `frontend/` and `e2e/`.
- Rule: modern, actively maintained, and FREE (no fees, no paid tier needed).

## 5. Critical Rules (What to Avoid)
- NEVER add anything that costs money: paid APIs, paid face/AI services,
  paid maps, paid SMS, paid auth, paid UI kits or paid tiers of animation
  libraries. The test is simply: is it free? If unsure about cost, ASK.
- Phone punching ONLY as the admin-controlled option of M4b, with the same
  server-side checks; no other non-kiosk punch path.
- NEVER send face data to any outside AI service; store encrypted face
  templates, not raw photos. QR-punch snapshots are auto-deleted after the
  retention period set by admin.
- NEVER trust client time, kiosk location or client face-match result;
  the server verifies every punch.
- NEVER hard-delete attendance or audit records.
- NEVER commit secrets; use .env (ignored) + .env.example.
- NEVER start building a milestone before its spec and plan are approved.
- NEVER build the legally risky future-scope items (section 1): automatic
  PF/ESIC/PT/TDS calculation, statutory reports, challans, Form 16, tax filing.
  Other extra ideas are WELCOME: follow section 11 (Creative Freedom).
- Money uses exact decimal arithmetic, never floating point. Salary screens
  and exports are labelled "Estimate".
- Keep the app portable: config via environment variables, no vendor-only
  features, so the app can move to another host (or the client's own server)
  if ever needed.
- Do not change an approved API contract without updating the spec.
- Do not add a new dependency without stating its licence and reason.

## 6. What Needs to Be Done (scope)
- Org setup: plants, geofence on a map, kiosk device registration, shifts (admins
  add shifts any time; each has its own overtime start and rate).
- Employees: permanent/temporary, contractors, Excel import, QR ID cards.
- Face enrolment with consent (done by an admin); face + liveness punch at kiosk.
- QR issue/revoke/expiry; QR punch at kiosk with photo snapshot.
- Anti-proxy engine: kiosk device token, kiosk GPS inside geofence, plant
  network allow-list, face/QR validity, server time + cool-down, impossible
  travel; rejection reasons stored.
- Offline kiosk: queue punches when internet drops, sync later (signed).
- Optional phone punch per employee (M4b), and temporary workers scanning the
  gate's changing QR with their phone.
- Attendance processing: check-in/out, late, early, overtime, hours worked.
- Dashboard (live headcount per plant), reports (Excel/PDF), roles, audit log.
- LAST: payable salary estimate:
  - Monthly salary = Basic + DA + HRA + Travel + other allowances (fixed
    structure per employee, saved by an admin, with effective-from date).
  - Per-day salary = monthly salary / salary days (26, 30 or actual: setting).
  - Payable days = present + paid leave + paid holidays/weekly offs (settings).
  - Earned = per-day x payable days; overtime pay = OT hours x OT rate.
  - Deductions (PF, ESIC, TDS, advances) are TYPED IN by the admin.
  - Net payable = earned + overtime - deductions.
  - Temporary workers: hours x hourly rate (+ overtime).
  - Output: monthly salary sheet on screen + Excel export.
  - Example: Rs 30,000 / 30 = Rs 1,000/day; 18 days = Rs 18,000; + 4 h OT x
    Rs 150 = Rs 600; - Rs 2,000 deductions = Rs 16,600.
  - Wait for the client's answers (proposal Q9, Q10) before building it.

## 7. Development Roadmap (milestones)
- [x] M0 Setup: repo, plugins, MCP, subagents, tech stack + SRS approved, CI
      (merged 2026-10-12, PR #1: monorepo skeleton, 5 CI jobs, pre-commit, Dependabot,
      spec docs/specs/M0-setup.md)
- [ ] M1 Foundation: login/roles, plants, kiosk devices, employees, design
      system; deploy skeleton to free tier
- [ ] M2 QR attendance end-to-end at the kiosk (with snapshot)
- [ ] M3 Face enrolment + face/liveness attendance at the kiosk
- [ ] M4 Anti-proxy engine + kiosk geofence + offline kiosk sync
- [ ] M4b Optional phone punching (admin-controlled per employee) + temp workers'
      phone scan of the gate QR
- [ ] M5 Attendance processing, dashboards, reports
- [ ] M6 Testing, security review, documentation, final free-tier deployment
      (client's own server only if the free tiers are not enough)
- [ ] M7 Payable salary estimate + Excel export (after the client's salary slip
      and the remaining Q9 answers)
- [ ] Future (not now): full payroll and statutory features

## 8. Workflow (Spec-Driven, milestone by milestone)
1. spec-writer -> docs/specs/M<n>-<name>.md
2. Team reviews spec -> Approved
3. Plan Mode -> docs/plans/M<n>-<name>-plan.md
4. Team reviews plan -> Approved
5. Build on branch milestone/M<n>-<name>; tests + small commits
6. test-engineer, code-quality-reviewer, security-reviewer + manual testing
7. Before the PR, on the same branch: update CLAUDE.md (tick the roadmap; new commands,
   libraries, rules; keep it short) and add decision lines to docs/decisions/. The lead
   approves the CLAUDE.md diff first. Never update CLAUDE.md after the merge.
8. PR -> lead approval -> merge
- Shortcuts: `/spec M<n>`, `/plan M<n>`, `/review-milestone`, `/ship`
  (.claude/commands/).
- A PR needs 1 approval and 5 green CI checks: `backend`, `frontend`, `e2e`, `docker`,
  `hooks` (CodeQL and the PR-title check also run). Merge with **Squash and merge**,
  so `main` gets one commit per milestone.
- Who does what: Claude pushes the branch and opens the PR, then stops. The lead merges
  and deletes the branch on GitHub himself. When he says "merged", Claude switches to
  `main`, pulls (`git pull --ff-only`), prunes (`git fetch --prune`) and deletes the
  local branch.
- The repo is public: never commit secrets, real employee data, face images or models.
  GitHub secret scanning + push protection, gitleaks and a 1 MB file limit guard this.
- When unsure, ask. Ask the lead every question in chat, not only in a file. Record
  decisions in docs/decisions/ (accepted extras: docs/decisions/accepted-extras.md).

## 9. Commands
The skeleton exists since M0; the README.md has the full first-time setup.
- First time: install uv (`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`),
  then `uv tool install pre-commit` and `pre-commit install` in the repo root. Copy
  `.env.example` to `.env`.
- Run everything: `.\scripts\dev.ps1` (Git Bash/Linux: `./scripts/dev.sh`) starts the
  backend (port 8000) and frontend (port 5173). Admin: http://localhost:5173/admin.
- Local database: `docker compose up -d` (Postgres 17, localhost only) or a native
  PostgreSQL install (README.md).
- Backend (from backend/):
  - `uv sync`: install dependencies.
  - `uv run fastapi dev app/main.py`: run the API locally (docs at /api/docs).
  - `uv run pytest`: run the tests (coverage floor 60%, raised each milestone).
  - `uv run ruff check . && uv run ruff format .`: lint and format.
  - `uv run pyright`: type check.
  - `uv run alembic upgrade head`: migrate the database.
  - `uv run alembic revision --autogenerate --rev-id <next number> -m "<what>"`: create
    a new migration (files are numbered: 0002_..., 0003_...).
  - `uv run python scripts/download_models.py`: download the face models (sha256 checked);
    added in M3.
- Frontend (from frontend/):
  - `npm install`, then `npm run dev` (Vite; proxies /api to the local backend).
  - `npm test` (Vitest + coverage), `npm run lint` / `npm run lint:fix` (Biome),
    `npm run typecheck`, `npm run build`.
  - `npm run i18n:check`: every text key used in code exists in
    `public/locales/en/common.json`.
- End-to-end (from e2e/): `npx playwright test` (starts backend + frontend itself; add
  `--headed` to watch the browser).
- Every git hook on every file: `pre-commit run --all-files`.
- Windows note: plain `python` on the lead's laptop is 3.7, so use `uv` or `py -3.12`.
  uv lives in `~/.local/bin`; Git Bash may need it added to PATH.
- Deploy (from M1):
  - Pushing to main deploys the frontend on Vercel and the backend on Render.
  - The database is Supabase (set `DATABASE_URL` in Render).
  - Set the GitHub repository variable `BACKEND_HEALTH_URL` after the first deploy, so the
    keep-alive workflow starts calling `/api/v1/health`.
  - The client's own server is used only if the free tiers cannot handle the data
    (decision 0004); the backend Dockerfile keeps that possible.

## 10. Configuration Notes
- Language: ENGLISH FIRST (English, India locale en-IN: DD/MM/YYYY dates,
  Indian number grouping 1,00,000, Rs). The whole website (kiosk + admin) is
  designed and built in English. Marathi and Hindi are OPTIONAL, added later
  through a language switch, so keep all UI text in translation files
  (i18n-ready) from day one, but do not design around Devanagari.
- All timestamps stored in UTC, shown in IST (Asia/Kolkata).
- Face match threshold, kiosk GPS accuracy limit, punch cool-down, snapshot
  retention, salary-day basis, paid-day and overtime rules are settings.
- Hosting (decisions 0002, 0004): free tiers for development AND production
  (frontend on Vercel Hobby; backend on Render Free, 512 MB, sleeps after 15 min,
  keep-alive cron; Postgres + snapshot storage on Supabase Free, Mumbai). Move to
  the client's own server only if the free tiers cannot handle the data. If the
  face model does not fit, Plan B includes a smaller model (only if it meets
  NFR-05). Camera needs HTTPS. The client should own these accounts at handover.
- Gate devices are phones and PCs. A PC usually has no GPS: it relies on its device
  key + plant network allow-list (GPS only where the device has it).
- Default shift 07:00–19:00; admins can add shifts (setting, never hard-coded).
- QR snapshot retention default: 60 days (a setting).
- Backend settings come only from environment variables (`.env` locally):
  `APP_ENV` (unset = production, which switches off /api/docs), `APP_VERSION`,
  `DATABASE_URL` (required), `LOG_LEVEL`. A missing required variable stops the app
  with a message that names it but never prints its value.
- Every error response: `{ "error": { "code", "message", "details" } }`.
  Server logs are JSON in UTC with an `X-Request-ID`; SQL parameter values are never
  logged (they can contain personal data).
- Design references: docs/design-refs/ (inspiration.md + screenshots).
  Inspiration: Godly, Dribbble, Awwwards, Mobbin, Figma Community and the other
  sites listed in inspiration.md (ideas only, never copy artwork).
  Code we copy in: any FREE component (shadcn/ui, Magic UI free, Motion
  Primitives, Kibo UI, Aceternity UI free, React Bits, Animate UI,
  shadcn/studio free blocks, free blocks from shadcnblocks/Skiper/Hover.dev,
  any free 21st.dev component, free LottieFiles animations) and GSAP. NOT allowed:
  anything paid (Magic UI Pro, Motion+, Rive paid exports, Skiper Premium,
  paid templates). Log every copied component in
  docs/decisions/ui-component-sources.md.
- Design direction: light, modern, premium; each screen designed inside its
  milestone (docs/decisions/0000-design-direction.md).

## 11. Creative Freedom: Extra Features (Claude Code is encouraged to improve the product)
The documents give you the IDEA of the project. You are free, and encouraged,
to think like a product owner and add features, screens, checks or polish that
make Upasthiti better for the client, even if nobody asked for them.

How to use this freedom:
- Think of ideas while writing every spec (examples: better dashboards,
  late-arrival alerts, shift swap handling, holiday calendar, bulk actions,
  smart search, dark mode, multi-language UI, health checks, data backup and
  restore, audit-log viewer, better error messages, kiosk status monitoring).
- Put every idea in the spec under "Proposed extras", each with: what it is,
  why it helps, effort (S/M/L) and risk. Then build the ones the team approves
  together with the spec. Small (S) extras that clearly fit may be built
  directly; mention them in the PR description.
- Large (L) extras, or anything that changes the data model or API contract a
  lot, must be approved by the team first.
- Record every accepted extra in docs/decisions/ (one short line is enough). The
  running list, including product features already approved for M1, M2, M5 and M6
  (F-1, F-4 to F-7, F-9, F-15), is docs/decisions/accepted-extras.md: read it when
  writing each spec.
- Core scope always comes first: never delay or break a core milestone for an
  extra.

Guardrails that still apply to extras (these protect the team and the client):
- Zero cost: free and open-source only (section 5).
- Privacy and security rules stay the same (face data, server-side checks).
- Kiosk first: phone punching only as decided in 0004 (admin-controlled, M4b).
- The legally risky payroll/statutory items in section 5 stay out.
- Keep the code readable and simple to maintain after handover.
