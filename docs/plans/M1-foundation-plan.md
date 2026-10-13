# M1 – Foundation: Implementation Plan

Status: Approved (2026-10-13, Tushar Gawande) · Spec: docs/specs/M1-foundation.md · Decision: 0005
Branch: `milestone/M1-foundation` (spec commits 9a17d02, 6177fdb, 38e46c1 already there)

## Context
M0 left a working skeleton: FastAPI with config, error format, JSON logs and lazy DB engine
(`backend/app/core/*`), a React SPA with i18n, en-IN formatters and an `apiGet` client
(`frontend/src/lib/*`), Playwright smoke tests and 5 CI jobs. There are no tables, no login,
no design system, no deploy.

The approved M1 spec turns this into the real foundation: three admin roles with an approvals
inbox (Corporate Head changes need a Super Admin's OK), plants with map geofences, departments,
shifts, employee categories, settings, kiosk pairing (device key + accurate location inside the
geofence, no network check), employees and contractors with Excel import, transfer and
mark-as-left, an append-only audit log, the light premium design system, the extras F-5, F-6,
F-17–F-20, F-23, S-15, S-17, S-18, S-20, and the first free-tier deployment.

Lead's choices for this plan (2026-10-13):
- **Build order: feature by feature** (each slice = backend + screen + tests, demo-able).
- **Design review: both** browser mockup screenshots *and* Figma frames, approved before each
  slice's screens are coded.
- **Hosting accounts:** created by Tushar under his own GitHub sign-in (free, no card);
  ownership moves to the client in M6.

Every step below is one small Conventional Commit (no Claude co-author / "Generated with"
lines). Every new file starts with a one-line purpose comment (CLAUDE.md §3).

## Cross-cutting decisions (apply to all slices)
- **Module pattern:** copy `backend/app/modules/health/` → `app/modules/<name>/{models,schemas,
  service,router}.py`; routers added in `app/main.py` via `api_router.include_router`.
  Business logic lives in `service.py`; routers stay thin.
- **Transactions + audit:** each write service runs inside one transaction and calls
  `audit.record(session, actor, action, entity, before, after, reason, plant_id)` before
  `session.commit()` (spec §7 rule 14). `get_session` (`app/core/db.py`) stays as is.
- **Errors:** reuse `ApiError` (`app/core/errors.py`); add `401 → NOT_AUTHENTICATED`,
  `403 → FORBIDDEN`, `429 → TOO_MANY_REQUESTS` to `HTTP_STATUS_TO_CODE`. Every code in spec §9
  gets an i18n key in `frontend/public/locales/en/common.json` (`errors.<CODE>`).
- **Roles:** `app/modules/auth/permissions.py` holds the spec §7 rule 1 matrix as one readable
  table (`Capability` enum → allowed roles / "via approval" / "own plant"); dependencies
  `require(capability)` and helper `plant_scope(user)` are used by every router and service
  query. The "via approval" branch is decided here from the role only.
- **Money:** `Decimal` + `numeric(12,2)`; pydantic `condecimal`; frontend sends/receives strings
  and shows them with `formatRupees` (`frontend/src/lib/format.ts`).
- **Backend DB tests (new):** `tests/conftest.py` gets a `db_session` fixture that uses
  `TEST_DATABASE_URL` (CI: Postgres service DB `upasthiti_test`; local: `docker compose up -d`
  — Docker 29 is installed on the lead's laptop). Once per run: `alembic upgrade head`; per
  test: outer transaction + `join_transaction_mode="create_savepoint"`, rolled back after the
  test; `get_session` overridden in the app. Tests needing a DB are marked `@pytest.mark.db`
  and skip with a clear message when `TEST_DATABASE_URL` is unset (CI always sets it). The
  existing unreachable-URL default stays for non-DB tests.
- **Frontend foundations:** add `@/*` alias (tsconfig + `vite.config.ts`), `npx shadcn@latest
  init` (Tailwind 4), light tokens in `styles.css` (`@theme`), self-hosted font; extend
  `api-client.ts` with `apiPost/apiPatch/apiPut/apiDelete/apiUpload` (same `ApiError`
  handling, JSON + Origin is automatic same-origin); a QueryCache `onError` sends
  `NOT_AUTHENTICATED` to `/admin/login`. Add `renderWithProviders(ui)` next to `renderRoute`
  in `src/test/render.tsx`. Network mocks stay `vi.stubGlobal("fetch")` (no MSW).
- **E2E with a real DB:** `e2e/playwright.config.ts` backend webServer runs
  `alembic upgrade head && python -m app.scripts.e2e_seed && fastapi run` against
  `E2E_DATABASE_URL` (local docker compose DB `upasthiti_e2e`; CI: Postgres service added to
  the `e2e` job). `e2e_seed` (refuses unless `APP_ENV=test`) wipes and creates one user per
  role with fixed test passwords. Smoke tests updated: `/admin` now goes to login.
- **Design gate per slice:** before coding a slice's screens, the ui-designer agent builds HTML
  mockups from 21st.dev / shadcn components (Magic + shadcn MCP), screenshots go to the lead,
  and the figma-designer agent places the same screens as Figma frames (needs the Figma
  connector authorised). Coding starts after the lead approves; links go into spec §4 and
  copied components into `docs/decisions/ui-component-sources.md`.

## Build steps

### 0. Plan doc – `docs:`
Save this plan as `docs/plans/M1-foundation-plan.md` (Status: Approved).

### Slice A – Foundation: auth, audit, shell, deploy
1. `build(backend):` add deps (argon2-cffi, cryptography, shapely, openpyxl, xlsxwriter,
   python-multipart, segno, apscheduler 3; dev: faker) — licences per spec §13.
2. `feat(backend):` config fields `app_secret_key` (required, ≥ 32 chars), `app_public_origin`,
   `trusted_proxy_hops`, `run_migrations_on_start` in `app/core/config.py`; `.env.example`
   updated with comments; error codes 401/403/429; `app/core/client_ip.py` (X-Forwarded-For
   hop counting); security-headers middleware.
3. `test(backend):` DB test fixture + CI: `TEST_DATABASE_URL` in the `backend` job (create
   `upasthiti_test`), coverage floor → 70 (`pyproject.toml`, `vite.config.ts`).
4. `feat(audit):` migration `0002_auth_and_audit` (users, sessions, audit_logs + trigger
   refusing UPDATE/DELETE); `app/modules/audit/` (`record()`, secret-field hiding, diff of
   changed fields, `GET /audit` with filters + plant scope).
5. `feat(auth):` `app/modules/auth/` — Argon2id hashing, password rules, login by username or
   email, session cookie (token hash, idle 60 / max 12 h, `last_seen_at` updated at most once a
   minute), lockout + in-memory per-IP limiter, Origin check dependency, `me`,
   change-password, sessions list/delete (F-23), permissions matrix module.
6. `feat(users):` `app/modules/users/` — CRUD, deactivate/reactivate, reset password, force
   logout, last-Super-Admin guard; `app/scripts/create_super_admin.py` (interactive, refuses
   if one exists).
7. `feat(settings):` `app/modules/settings/` — definitions (keys, defaults, ranges,
   `used_from`), typed `get_setting()` used by other modules, `GET/PUT /settings` with reason +
   audit. The `settings` table moves from 0003 into `0002_auth_and_audit` so this slice works
   alone (spec §6 updated, names only, together with the migration-order note below).
8. **Design gate A:** login, admin shell, sessions, users, settings, audit viewer.
9. `feat(frontend):` design system — alias, shadcn init, tokens, font, base components
   (button, input, form, dialog, table, badge, toast/sonner, command, sheet, skeleton), empty /
   error states, status badge, diff view; `api-client` write methods; auth hooks
   (`useMe`, `useLogin`), `RequireAuth` layout route, login page, admin shell (sidebar, top
   bar, plant filter, user menu), sessions page, users page, settings page, audit page; i18n
   keys; Vitest tests.
10. `feat(deploy):` `backend/scripts/start.sh` (runs `alembic upgrade head` when
    `RUN_MIGRATIONS_ON_START=true`, then `fastapi run`), Dockerfile CMD uses it;
    `deploy/render.yaml` (Docker, Singapore, free, health `/api/v1/health`, env keys without
    values); `frontend/vercel.json` (SPA fallback, `/api/(.*)` rewrite to the Render URL,
    security headers; Vercel's project root is `frontend/`, so the file lives there and
    `deploy/README.md` explains); production `/api/docs` served only to a logged-in Super
    Admin. `deploy/README.md`: step-by-step for Tushar (Supabase Mumbai project → pooler
    session-mode URL; Render blueprint; Vercel project; `BACKEND_HEALTH_URL`; first
    `create_super_admin` via Render shell).
11. `ci:` keep-alive also calls `/api/v1/health/ready` once a day (S-20); new
    `post-deploy-smoke.yml` (S-18: on push to main, wait for the live `/api/v1/health` to show
    the new `APP_VERSION`, then a short Playwright check of the login page + `/health/ready`,
    URL from repo variable `LIVE_SITE_URL`).
12. `test(e2e):` e2e DB wiring, `e2e_seed`, login tests per role, smoke tests updated,
    `@axe-core/playwright` scan helper used on every page (S-17).
13. **Outward step (Tushar does, I guide):** create Supabase/Render/Vercel, set env vars,
    first deploy, set `BACKEND_HEALTH_URL` + `LIVE_SITE_URL`, record the measured
    `TRUSTED_PROXY_HOPS`.

### Slice B – Plants and setup
14. **Design gate B:** plants list/detail tabs, geofence editor, departments/shifts/categories
    tabs, readiness card, setup wizard.
15. `feat(org):` migration `0003_org_setup` (plants, user_plant_access, geofences,
    departments, shifts, employee_categories); `app/modules/org/` — plants CRUD +
    deactivate guard, new-plant defaults (General shift + 4 categories), client-plants seed
    (7 plants, idempotent), departments/shifts/categories CRUD with in-use guards,
    `crosses_midnight`.
16. `feat(geofence):` `app/modules/org/geofence.py` — validation (Shapely, 3–200 points,
    valid, area 100 m²–2 km², circle 20–1,000 m, margin 0–200), versioned save,
    `distance_to_geofence_m(point)` with local equirectangular projection (reused by M4).
17. `feat(org):` `GET /setup/status` (F-5), `GET /plants/{id}/readiness` (F-17).
18. `feat(frontend):` plants pages, Leaflet + Geoman free map component
    (`src/features/plants/geofence-map.tsx`, OSM attribution), version history, tabs, readiness
    card, setup wizard; read-only views for Corporate Head / Plant Head.

### Slice C – Kiosks
19. **Design gate C:** kiosks list, add-kiosk dialog (code + QR + countdown), kiosk pairing
    screen states (24 px / 64 px / 7:1).
20. `feat(kiosks):` migration `0005_kiosks` (after 0004 numbering, see note below);
    `app/modules/kiosks/` — create (requires geofence), pairing code (HMAC with
    `APP_SECRET_KEY`, 10 min, 5-try lock), re-issue, rename, revoke, `pairing-qr.svg` (segno,
    F-18), `POST /kiosk/register` (spec §7 rule 5: location required, accuracy ≤ setting,
    inside geofence), `app/modules/kiosks/signature.py` (raw r‖s → DER, P-256 verify, counter),
    `require_kiosk` dependency, `GET /kiosk/me`.
21. `feat(kiosk):` `src/kiosk/` — device key module (WebCrypto P-256 `extractable: false`,
    stored in Dexie), request signer, pairing screen (keypad, `?code=` prefill, best-of-20 s
    location with live accuracy, all error states), paired screen with live IST clock; admin
    kiosks pages.

Migration numbering note: spec lists 0004_people before 0005_kiosks. Because kiosks are built
before people, migrations are created in build order but keep the spec names: kiosks become
`0004_kiosks`, people `0005_people`. Spec §6 is updated in the same commit (names only).

### Slice D – Employees, contractors, approvals
22. **Design gate D:** employees list + bulk bar, employee form/detail + timeline + transfer,
    contractors, approvals inbox + My requests, import wizard, Ctrl+K palette.
23. `feat(people):` migration `0005_people` (contractors, employees, shift_assignments,
    employee_plant_history, change_requests); `app/modules/contractors/`;
    `app/modules/employees/` — code rules (1–12, upper-case, never reused), category/
    department/shift same-plant checks, temporary vs permanent rules, `ot_rate_per_hour`,
    shift history, mark-left (Super Admin), reactivate, transfer with effective date,
    timeline from audit (F-19), scoped list/filters, search endpoint.
24. `feat(approvals):` `app/modules/approvals/` — change request create (validate on send),
    approve (re-check + apply in one transaction, audit with approver + `change_request_id`),
    reject, withdraw, failed, pending count; employee endpoints return 202 for Corporate Head
    via the permissions branch; one-pending-per-employee + pending-code guard.
25. `feat(employees):` bulk actions (≤ 500, all-or-nothing, Corporate Head → one request).
26. `feat(import):` template download (XlsxWriter, dropdowns, notes sheet, dummy rows only),
    upload parse (openpyxl, read-only values, formula/injection refusal, 2 MB / 2,000 rows),
    dry run, all-or-nothing commit, Corporate Head → request with parsed rows.
27. `feat(jobs):` `app/jobs/scheduler.py` (APScheduler, started in app lifespan) — daily
    00:05 IST: apply due future transfers, delete sessions expired > 30 days; the same
    catch-up also runs at start-up (Render sleeps; keep-alive wakes it at 05:30 IST).
28. `feat(frontend):` employees, contractors, approvals, my requests, import wizard, bulk bar,
    transfer dialog, timeline, Ctrl+K command palette (cmdk via shadcn Command), "Send for
    approval" labels and toasts.

### Slice E – Fake data, docs, finish
29. `feat(scripts):` `app/scripts/make_fake_data.py` (S-15: Faker en_IN, 7 plants, exactly 650
    employees ≈ 300 permanent / 350 temporary, contractors, categories; refuses in
    production).
30. `docs:` README (login replaces "Server connected", create_super_admin, fake data, e2e DB),
    `deploy/README.md`, kiosk setup guide `docs/guides/kiosk-setup.md` (location on, browser
    permission, full-screen, what to do on each error), `ui-component-sources.md` entries.
31. Reviews (CLAUDE.md §8 step 6) via `/review-milestone`: test-engineer, code-quality-reviewer,
    security-reviewer, compliance-auditor (personal data, approvals, audit), i18n-reviewer;
    fix findings; manual tests (below); tick M1 in CLAUDE.md roadmap; `/ship`.

## Files (representative)
- Backend new: `app/modules/{auth,users,audit,settings,org,kiosks,contractors,employees,
  approvals}/…`, `app/core/client_ip.py`, `app/core/security_headers.py`, `app/jobs/
  scheduler.py`, `app/scripts/{create_super_admin,make_fake_data,e2e_seed}.py`,
  `migrations/versions/0002…0005_*.py`, `scripts/start.sh`.
- Backend changed: `app/main.py` (routers, middleware, lifespan, docs guard),
  `app/core/{config,errors}.py`, `migrations/env.py` (import models), `tests/conftest.py`,
  `Dockerfile`, `pyproject.toml`.
- Frontend new: `components.json`, `src/components/ui/*` (shadcn), `src/app/layouts/`,
  `src/features/{auth,users,settings,audit,plants,kiosks,employees,contractors,approvals,
  search,setup}/`, `src/kiosk/{device-key,signer,pairing-page}.ts(x)`, `vercel.json`.
- Frontend changed: `router.tsx` (layout + guarded routes), `main.tsx` (Toaster), `styles.css`,
  `lib/api-client.ts`, `test/render.tsx`, `tsconfig*.json`, `vite.config.ts`,
  `public/locales/en/common.json`.
- CI/deploy: `.github/workflows/{ci,keepalive,post-deploy-smoke}.yml`, `deploy/render.yaml`,
  `deploy/README.md`, `e2e/playwright.config.ts`, `e2e/tests/*`.

## Reused code
- `ApiError`, `error_response`, handlers — `backend/app/core/errors.py`
- `get_settings`/`load_settings_or_exit` — `backend/app/core/config.py`
- `Base` naming convention, `get_session`, lazy engine — `backend/app/core/db.py`
- `utc_now`, `to_ist` — `backend/app/core/time.py`; request ID + JSON logs —
  `backend/app/core/logging.py`
- `build_app` / `client` fixtures — `backend/tests/conftest.py`
- `ApiError`, `apiGet` — `frontend/src/lib/api-client.ts`; `formatDate/Time/Number/Rupees` —
  `frontend/src/lib/format.ts`; `sharedI18nOptions`; `renderRoute`; `check-translations.mjs`
- Postgres service + `docker-compose.yml`; Playwright webServer setup.

## Dependencies
As spec §13 (all free; licences listed there), plus: **APScheduler 3.x (MIT)** — daily jobs,
already in ADR 0001; **@fontsource-variable/inter or geist (OFL-1.1)** — picked at design
gate A. No react-leaflet (plain Leaflet).

## Verification (AC → test)
| AC | How |
|---|---|
| AC-1 | pytest: create_super_admin twice (second refuses); e2e login with it |
| AC-2, AC-5 | pytest API: login by username and email, cookie flags, lockout 6th try, idle/max expiry (time patched), password change ends other sessions |
| AC-3, AC-23 | pytest: generated endpoint × role matrix (allowed / 202 / FORBIDDEN / NOT_FOUND); plant-scope leakage checks on list, search, audit |
| AC-4 | pytest: foreign Origin → ORIGIN_NOT_ALLOWED |
| AC-6 | pytest: new plant defaults; client-plants seed twice = 7 |
| AC-7, AC-8 | pytest unit: geofence validation, versions, margin distances (inside / 20 m / 40 m); Plant Head save FORBIDDEN |
| AC-9, AC-10 | pytest API: change request create → approve / reject / failed re-check / already pending |
| AC-11 | pytest: crosses_midnight, start=end refused, no OT field on shift |
| AC-12 | pytest: settings range + audit 50→30; read-only for other roles |
| AC-13, AC-14, AC-15 | pytest: register decision table (accurate inside / outside / inaccurate / none / expired / used); e2e: fake geolocation inside → "Paired", outside → refused, no permission → "turn on location" |
| AC-16 | pytest: signature valid / tampered body / wrong key / repeated counter / revoked |
| AC-17 | Vitest: generated key `exportKey` rejects |
| AC-18, AC-19, AC-20 | pytest: code patterns, category plant check, decimal OT rate round-trip, shift history |
| AC-21 | pytest: mark-left by Super Admin; FORBIDDEN for others; code not reusable |
| AC-22 | pytest: import dry run errors, 422 commit with errors, 352 created; CH import → request → approve; e2e import flow |
| AC-24 | pytest: raw SQL UPDATE/DELETE on audit_logs raises |
| AC-25 | pytest: audit filters; no secret values in any row |
| AC-26 | CI `i18n:check`; Vitest formatter use |
| AC-27, AC-35 | e2e axe scan (serious/critical = 0) + manual keyboard walk |
| AC-28 | manual on live URL (after step 13) + S-18 workflow |
| AC-29 | pytest production mode docs 404 / Super Admin 200 |
| AC-30 | CI coverage floor 70 (backend + frontend) |
| AC-31 | Vitest wizard status + e2e wizard flow |
| AC-32, AC-33 | Vitest palette scoping; pytest bulk all-or-nothing + CH request |
| AC-34 | pytest: fake-data counts on test DB; refuses with APP_ENV=production |
| AC-36, AC-37 | first runs of post-deploy-smoke and keep-alive workflows |
| AC-38, AC-39 | Vitest readiness card; pytest QR svg only while code valid; e2e `?code=` prefill |
| AC-40, AC-41 | pytest timeline events + transfer dates (01/11/2026 case) |
| AC-42 | pytest sessions list/delete/force logout |

Local run (Windows): `docker compose up -d` → `cd backend; uv run pytest` (with
`TEST_DATABASE_URL`) → `uv run alembic upgrade head` → `uv run python -m
app.scripts.create_super_admin` → `.\scripts\dev.ps1` → log in at
http://localhost:5173/admin → `cd e2e; npx playwright test --headed` (lead watches) →
`pre-commit run --all-files`.

Manual (before PR): pair a real Android phone, a laptop and the client's gate PC at a test
location and record the accuracy reached; walk each role through its screens on the live site.
