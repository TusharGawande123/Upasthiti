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
- Solution: ONE website, ONE attendance channel = the gate KIOSK.
  - Kiosk: a tablet/phone/laptop with camera fixed at each plant gate, running
    our kiosk screen in full-screen. All employees punch here (check-in/out).
  - Permanent employees -> face recognition + liveness (blink / head turn).
  - Temporary / hourly workers -> unique signed QR code on an ID card, shown to
    the kiosk camera. A photo snapshot is saved at each QR punch for HR review.
  - No employee phone app for now: all punches happen at the kiosk.
    A mobile PWA may be added later, only if needed.
  - Admin dashboard (same website): setup, employees, QR cards, face enrolment,
    live headcount, reports, corrections, salary estimate (built last).
  - The server re-checks every punch (anti-proxy engine). Never trust the client.
- Roles: SUPER_ADMIN, PLANT_ADMIN, HR, SUPERVISOR (+ KIOSK device identity).
- Must: zero cost (no paid APIs/licences), Indian compliance (DPDP Act 2023,
  IT Act 43A, Labour Codes), simple to run after handover (students cannot
  provide long-term maintenance).
- Scope = client-approved proposal v1.1 + the decisions in this file = the
  MINIMUM to deliver. It is a floor, not a ceiling: Claude Code is encouraged
  to add extra features that make the product better (see section 11).
  Future scope (NOT now): full payroll, automatic PF/ESIC/PT/TDS calculation,
  statutory reports, challans, Form 16, tax filing, payslips, employee document
  storage, compliance due-date reminders, regulatory-change alerts,
  mobile PWA for phone punching (only if needed).

## 2. Architecture & Project Structure
- Approved 2026-10-11; full detail in docs/architecture.md (flows, table
  dictionary) and docs/SRS.md (requirements FR-xx / NFR-xx).
- Monorepo: frontend/ (Vite + React SPA: /kiosk and /admin), backend/ (one
  FastAPI app split into modules), e2e/ (Playwright), deploy/ (render.yaml,
  Caddyfile, docker-compose later), .github/workflows/.
- Backend layout: app/core (config, db, security, crypto, time, storage),
  app/modules/<name>/{models,schemas,service,router}.py, app/antiproxy/
  (one rule per file + engine.py), app/face/ (detector, embedder,
  antispoof, matcher), app/jobs/, migrations/ (Alembic), tests/.
- Same origin for SPA and API (Vercel rewrites /api/* to the backend; Caddy
  later), so admin auth uses plain session cookies.
- The server decides every punch; the kiosk only sends signed evidence.
- Fixed folders: docs/ (client/, specs/, plans/, decisions/, design-refs/),
  .claude/agents/ (subagents), .claude/commands/ (custom commands).
- Modules: org setup (plants, geofences, kiosk devices, shifts), employees,
  enrolment (face, QR), kiosk punch, anti-proxy engine, attendance processing,
  dashboards, reports, audit, auth, salary estimate (last).

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
- Conventional Commits: feat:, fix:, docs:, test:, refactor:, chore:.

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
  ReportLab, APScheduler 3.
- Face (server): InsightFace SCRFD + ArcFace via onnxruntime (buffalo_sc on
  Render, buffalo_l on the client server), MiniFASNet anti-spoofing,
  opencv-python-headless.
- Tooling: uv, Ruff, pyright, pytest · Biome, Vitest, Playwright ·
  pre-commit, Dependabot, GitHub Actions.
- Rule: modern, actively maintained, and FREE (no fees, no paid tier needed).

## 5. Critical Rules (What to Avoid)
- NEVER add anything that costs money: paid APIs, paid face/AI services,
  paid maps, paid SMS, paid auth, paid UI kits or paid tiers of animation
  libraries. The test is simply: is it free? If unsure about cost, ASK.
- Do NOT build an employee phone app or any non-kiosk punch path now
  (a mobile PWA is future scope, only if needed).
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
  features, so free-tier hosting can later move to Docker.
- Do not change an approved API contract without updating the spec.
- Do not add a new dependency without stating its licence and reason.

## 6. What Needs to Be Done (scope)
- Org setup: plants, geofence on a map, kiosk device registration, shifts.
- Employees: permanent/temporary, contractors, Excel import, QR ID cards.
- Face enrolment with consent (done by HR); face + liveness punch at kiosk.
- QR issue/revoke/expiry; QR punch at kiosk with photo snapshot.
- Anti-proxy engine: kiosk device token, kiosk GPS inside geofence, plant
  network allow-list, face/QR validity, server time + cool-down, impossible
  travel; rejection reasons stored.
- Offline kiosk: queue punches when internet drops, sync later (signed).
- Attendance processing: check-in/out, late, early, overtime, hours worked.
- Dashboard (live headcount per plant), reports (Excel/PDF), roles, audit log.
- LAST: payable salary estimate:
  - Monthly salary = Basic + DA + HRA + Travel + other allowances (fixed
    structure per employee, saved by HR, with effective-from date).
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
- [ ] M0 Setup: repo, plugins, MCP, subagents, tech stack + SRS approved, CI
- [ ] M1 Foundation: login/roles, plants, kiosk devices, employees, design
      system; deploy skeleton to free tier
- [ ] M2 QR attendance end-to-end at the kiosk (with snapshot)
- [ ] M3 Face enrolment + face/liveness attendance at the kiosk
- [ ] M4 Anti-proxy engine + kiosk geofence + offline kiosk sync
- [ ] M5 Attendance processing, dashboards, reports
- [ ] M6 Testing, security review, documentation, free-tier deployment
- [ ] M7 Payable salary estimate + Excel export (after client answers Q9/Q10)
- [ ] Later: Docker package for the company server
- [ ] Future (not now): full payroll and statutory features

## 8. Workflow (Spec-Driven, milestone by milestone)
1. spec-writer -> docs/specs/M<n>-<name>.md
2. Team reviews spec -> Approved
3. Plan Mode -> docs/plans/M<n>-<name>-plan.md
4. Team reviews plan -> Approved
5. Build on branch milestone/M<n>-<name>; tests + small commits
6. test-engineer, code-quality-reviewer, security-reviewer + manual testing
   -> PR -> teammate approval -> merge
- When unsure, ask. Record decisions in docs/decisions/.

## 9. Commands
The project skeleton is created in M0; until then these are the planned commands.
- Backend (from backend/):
  - `uv sync`: install dependencies.
  - `uv run fastapi dev app/main.py`: run the API locally.
  - `uv run pytest`: run the tests.
  - `uv run ruff check . && uv run ruff format .`: lint and format.
  - `uv run pyright`: type check.
  - `uv run alembic upgrade head`: migrate the database.
  - `uv run alembic revision --autogenerate -m "<what>"`: create a new migration.
  - `uv run python scripts/download_models.py`: download the face models (sha256 checked).
- Frontend (from frontend/):
  - `npm install`, then `npm run dev` (Vite; proxies /api to the local backend).
  - `npm test` (Vitest), `npm run lint` (Biome), `npm run build`.
- End-to-end (from e2e/): `npx playwright test`.
- Windows note: plain `python` on the lead's laptop is 3.7, so use `uv` or `py -3.12`.
- Deploy:
  - Pushing to main deploys the frontend on Vercel and the backend on Render.
  - The database is Supabase (set `DATABASE_URL` in Render).
  - Later: `docker compose up -d` from deploy/ on the client's server.

## 10. Configuration Notes
- Language: ENGLISH FIRST (English, India locale en-IN: DD/MM/YYYY dates,
  Indian number grouping 1,00,000, Rs). The whole website (kiosk + admin) is
  designed and built in English. Marathi and Hindi are OPTIONAL, added later
  through a language switch, so keep all UI text in translation files
  (i18n-ready) from day one, but do not design around Devanagari.
- All timestamps stored in UTC, shown in IST (Asia/Kolkata).
- Face match threshold, kiosk GPS accuracy limit, punch cool-down, snapshot
  retention, salary-day basis, paid-day and overtime rules are settings.
- Hosting now (docs/decisions/0002-hosting.md): frontend on Vercel Hobby,
  backend on Render Free (Docker, 512 MB, sleeps after 15 min; keep-alive
  cron), Postgres + snapshot storage on Supabase Free (Mumbai). Camera needs
  HTTPS. Later: Docker Compose on the company server.
- QR snapshot retention default: 60 days (a setting).
- Design references: docs/design-refs/ (inspiration.md + screenshots).
  Inspiration: Godly, Dribbble, Awwwards, Mobbin, Figma Community and the other
  sites listed in inspiration.md (ideas only, never copy artwork).
  Code we copy in: any FREE component (shadcn/ui, Magic UI free, Motion
  Primitives, Kibo UI, Aceternity UI free, React Bits, Animate UI,
  shadcn/studio free blocks, 21st.dev free items) and GSAP. NOT allowed:
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
- Record every accepted extra in docs/decisions/ (one short line is enough).
- Core scope always comes first: never delay or break a core milestone for an
  extra.

Guardrails that still apply to extras (these protect the team and the client):
- Zero cost: free and open-source only (section 5).
- Privacy and security rules stay the same (face data, server-side checks).
- Kiosk-only punching stays (no phone punching) unless the team decides
  otherwise.
- The legally risky payroll/statutory items in section 5 stay out.
- Keep the code readable and simple to maintain after handover.

