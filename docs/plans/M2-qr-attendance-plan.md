# M2 – QR attendance at the kiosk: Implementation Plan

Status: Approved by Anuradha on 2026-10-20 (delegated by Tushar; reset to Draft and re-checked after the audit in decision 0009) · Spec: docs/specs/M2-qr-attendance.md · Decisions: 0008, 0009
Branch: `milestone/M2-qr-attendance`

Changes (2026-10-20, audit 0009; one line per change):
- R1 any-plant cards → back to own plant only: `WRONG_PLANT` rule returns; no `employee_plant_id`, no "visiting" badge.
- R2 plant printed on the card again; `printed_plant_id` column and "reprint needed" badge.
- R3 card printing is Super Admin only; no `PRINT_QR_CARDS` capability; no Plant Head print scope.
- R4 snapshot view and compare are Super Admin only.
- R5 cards only for employees whose punch method is QR (`EMPLOYEE_NOT_QR`).
- R6 no "Tap to start" screen: scanning starts by itself; optional tap for sound and full screen.
- R7 S-25 usage meter and F-36 online badge removed from M2 (pending Tushar); settings 13 new → 9 new.
- C1 kiosk heartbeat stays 60 s (spec now says the same); C2–C4 spec fixed to match this plan.
- Names: the answers and approvals came from Anuradha, not Tushar; wording fixed.

## Context
M1 is live: three admin roles with a capability matrix, plants with geofences, paired kiosks
that sign every request (P-256, counter replay guard, `require_kiosk`), employees with plant
history, an append-only audit log, settings by definition, a daily job, and the light design
system. Nobody can punch yet.

The approved M2 spec delivers the first real attendance:
- Super Admin issues, revokes, ends, extends and prints Ed25519-signed QR cards (CR80 / A4
  PDFs, plant printed on the card); a card works only at the employee's current plant and only
  for employees whose punch method is QR;
- the gate kiosk reads a card, takes a 320 px snapshot and sends a signed punch; the server runs
  the first anti-proxy rules, decides accepted / rejected and IN / OUT, and stores the punch
  (append-only) with an encrypted snapshot (local disk or Supabase Storage, purged after 60 days);
- big result screens with tones and a spoken line without the name;
- a punch log (photo views and compare for the Super Admin only, audited) with Excel export;
  gate notices; and the approved extras F-1, F-6, F-25, F-27, F-29, F-31, F-33–F-35, F-38,
  S-22–S-24, S-26–S-29. S-25 and F-36 wait for Tushar (decision 0009).

First demo (exit criterion): on the live site, a valid card is accepted and a revoked card is
rejected with `QR_REVOKED`.

Choices for this plan (2026-10-20, Anuradha):
- **Build order: feature slices**, as in M1. Each slice is backend + screens + tests and can be
  demoed on its own.
- **Design gate: HTML mockup screenshots only** (no Figma; the connector is not authorised).
  Screens are coded only after the team approves the screenshots.

Every step below is one small Conventional Commit (no Claude co-author / "Generated with" lines).
Every new file starts with a one-line purpose comment (CLAUDE.md §3).

## Cross-cutting decisions (apply to all slices)
- **Module pattern as M1:** `app/modules/<name>/{models,schemas,service,router}.py`. Each new
  `models.py` is imported in `app/modules/all_models.py`, and each router is added in
  `app/main.py` (`api_router.include_router`). Routers stay thin. New modules: `qr_cards`,
  `punches`, `notices`, `system`, `printing`.
- **Roles:** the 8 new capabilities of spec §7 rule 1 (`VIEW_QR_CARDS`, `MANAGE_QR_CARDS` which
  also covers printing, `VIEW_PUNCHES`, `VIEW_SNAPSHOTS`, `EXPORT_PUNCHES`, `VIEW_NOTICES`,
  `MANAGE_NOTICES`, `DOWNLOAD_GATE_POSTER`) are added to `Capability` and `PERMISSIONS` in
  `app/modules/auth/permissions.py`. Routes use `require(cap)`; queries use `plant_filter` /
  `ensure_plant_in_scope` (`app/modules/auth/scope.py`). A card works only at the employee's
  plant, so the punch's plant is both the kiosk's and the employee's plant and the Plant Head's
  scope is the normal `plant_filter`; no special punch-scope helper is needed.
- **Audit:** `record_audit(...)` (`app/modules/audit/service.py`) is called in the same
  transaction for every action in spec §8. Punches get no audit row.
- **Errors:** `ApiError` (`app/core/errors.py`). Every new code in spec §9 gets `errors.<CODE>`
  (admin) and `kiosk.punch.<CODE>.{title,message,next,voice}` (kiosk) in
  `frontend/public/locales/en/common.json`. Decided punches answer 200 with `reason_code`.
- **Config (`app/core/config.py`):** new fields `qr_signing_key`, `qr_signing_key_id` (default
  `A`), `snapshot_encryption_key`, `storage_backend` (`local`/`supabase`), `storage_local_dir`,
  `supabase_url`, `supabase_service_key`, `snapshot_bucket`. The production requirement follows
  the existing `require_origin_in_production` pattern (the field name is the last word of the
  message, so "Missing required setting: …" never prints a value). In production
  `QR_SIGNING_KEY`, `SNAPSHOT_ENCRYPTION_KEY` and `STORAGE_BACKEND` are required, and when the
  backend is `supabase` also `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SNAPSHOT_BUCKET`.
  Development and tests default to `local` storage. Missing keys in development give
  `QR_SIGNING_NOT_CONFIGURED`.
- **Crypto (`app/core/crypto.py`, new):** Ed25519 sign/verify; base32 upper case without
  padding; AES-256-GCM `encrypt_snapshot(data, punch_id)` / `decrypt_snapshot(blob, punch_id)`.
  The file layout is key-id byte + 12-byte nonce + ciphertext + tag, with the punch ID as AAD.
  Everything uses `cryptography`, which is already installed.
- **Storage (`app/core/storage.py`, new):** a `Storage` protocol with `save(key, bytes)`,
  `read(key)` and `delete(keys)`, two classes `LocalStorage` and `SupabaseStorage`, and a cached
  `get_storage()`.
  - Supabase is reached through its Storage REST API with **httpx2**, moved from dev to runtime
    (already in the lockfile, BSD-3). Each call has a 5 s timeout and one retry.
  - Tests override `get_storage` with an in-memory fake or a failing fake.
- **Kiosk endpoints:** they reuse `require_kiosk` (`app/modules/kiosks/dependencies.py`)
  unchanged. A small `limit_body(64 KB)` dependency checks `Content-Length` before
  `require_kiosk` reads the body. New in-memory `RateLimiter`s (`app/modules/auth/rate_limit.py`):
  60 punches per minute per kiosk and 20 reports per hour per kiosk. They are added to the
  `fresh_rate_limits` fixture.
- **Settings:** `CURRENT_MILESTONE = 2` (the two existing M2 settings, cool-down and snapshot
  retention, become editable) and 9 new `SettingDefinition`s: `min_minutes_before_out`,
  `open_in_max_hours`, `snapshot_dark_threshold`, `qr_card_default_validity_months`,
  `qr_card_expiring_soon_days`, `kiosk_voice_enabled`, `kiosk_sound_enabled`,
  `kiosk_result_seconds`, `kiosk_reject_seconds` (`app/modules/settings/definitions.py`). No
  migration is needed. A new group `cards` is added to `GROUP_ORDER` in the frontend.
- **Snapshot transport:** base64 inside the signed JSON body, as spec §5.2. The existing
  `signedRequest` (`frontend/src/kiosk/signer.ts`) works unchanged, so no multipart is needed.
- **Kiosk polling:** the M1 60 s heartbeat (`GET /kiosk/me`) is kept, and the spec says the same
  (changed from 5 min on 2026-10-20). It also carries notices, kiosk settings and revocation.
- **Bundle split (S-28):** `/kiosk` and `/admin` become lazy routes in `app/router.tsx`.
  `barcode-detector` is imported dynamically only inside the kiosk scanner. The ZXing `.wasm`
  file is served from our own `dist/` (Vite `?url` import + `setZXingModuleOverrides`), never
  from a CDN.
- **Version file (S-27):** a tiny inline Vite plugin writes `dist/version.json`
  (`{ "version": VITE_APP_VERSION }`). `VITE_APP_VERSION` comes from Vercel's
  `VERCEL_GIT_COMMIT_SHA` (falling back to `dev`). `vercel.json` gives `/version.json`
  `Cache-Control: no-cache`.
- **Test helpers:**
  - The kiosk `Device` signer moves from `tests/test_kiosks_api.py` to `tests/kiosk_helpers.py`.
  - Synthetic images (colour patterns, no faces) are made with Pillow in
    `tests/image_helpers.py`.
  - Frontend tests mock camera, speech, audio and wake lock with `vi.stubGlobal`, next to the
    existing `mockApi`.
- **E2E fake camera:**
  - `app/scripts/e2e_card_video.py` (refuses unless `APP_ENV=test`) writes a `.y4m` clip of a
    card's QR: about 1.5 s of card, then 20 s of blank frames, using segno + Pillow. It signs
    with the fixed e2e `QR_SIGNING_KEY` set in the Playwright webServer env.
  - The Playwright helper `openKioskWithCard(browser, serial)` runs it, then launches Chromium
    with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
    --use-file-for-fake-video-capture=<clip>` and pairs the kiosk with the M1 helpers. Those
    helpers move into `e2e/tests/helpers.ts`.
  - Clips go to `e2e/.tmp/` (git-ignored) and are never committed.
- **Design gate per slice:** the ui-designer agent builds HTML mockups from the M1 design system
  and free components, and screenshots go to the lead. Coding starts after approval. Links go
  into spec §4, and copied components go into `docs/decisions/ui-component-sources.md`.

## Build steps

### 0. Plan doc – `docs:`
Save this plan as `docs/plans/M2-qr-attendance-plan.md` (Status: Approved).

### Slice A – QR cards and printing
1. `build(backend):` add fpdf2 (LGPL-3.0, unmodified) and Pillow (HPND); move httpx2 to runtime;
   dev: pypdfium2 (Apache-2.0/BSD-3), zxing-cpp (Apache-2.0); a separate dependency group
   `loadtest` with locust (MIT), not installed in CI. Bundle the Inter TTF Regular/Bold (OFL,
   each < 1 MB) under `app/modules/printing/fonts/`.
2. `feat(backend):` config fields + production checks; `app/core/crypto.py` (Ed25519 + AES-GCM);
   `app/scripts/make_qr_key.py` and `make_snapshot_key.py` (print a new key for `.env`);
   `.env.example` with comments; tests for AC-27.
3. `feat(qr-cards):` migration `0006_qr_cards` (`qr_credentials` incl. `printed_plant_id`,
   `qr_card_serial_seq`, partial unique index for one active card, check constraints). Module
   `app/modules/qr_cards/`:
   - `payload.py`: build/parse `UPS1.<key id>.<serial>.<sig>` and a strict regex;
   - `states.py`: computed state by IST day;
   - `service.py`: issue (only for employees whose punch method is QR, else `EMPLOYEE_NOT_QR`;
     replaces the old card in one transaction), revoke, change end date, bulk issue/revoke
     (≤ 500, skipped list), "reprint needed" state (current plant ≠ `printed_plant_id`), test
     cards;
   - router (spec §5.1), `GET /qr-cards/expiring-count`.
   Also: `mark_left` in `app/modules/employees/operations.py` revokes the active card
   (`revoke_kind = left`, same request ID).
4. `feat(printing):` `app/modules/printing/cards_pdf.py`: CR80 single card (name, code,
   contractor, plant name and code, serial, issue date, no end date) and A4 2 × 5 with cut marks;
   test-card band; the QR is drawn as vector squares from the segno matrix (error level Q).
   Print endpoints are Super Admin only; each print raises `print_count`, sets
   `printed_plant_id` and writes audit `qr_card.print`.
   `tests/test_card_pdf_scan.py` renders the PDF with pypdfium2, decodes the QR with zxing-cpp
   and asserts QR version ≤ 7 (S-23).
5. `feat(search):` `GET /search` matches card serials (`C` + digits) in
   `app/modules/employees/search_router.py`.
6. **Design gate A:** QR cards page (table, states incl. "Reprint needed", bulk bar, test-cards
   tab), employee card panel (with the "switched to face: revoke the card" reminder), issue /
   revoke / end-date dialogs, card PDF layouts (CR80 + A4, plant printed), dashboard "Cards
   ending soon" card.
7. `feat(frontend):` `src/features/qr-cards/`:
   - QR cards page with filters, bulk bar (Super Admin only; Corporate Head and Plant Head see
     the list read-only), and a Test cards tab;
   - `use-qr-cards.ts` hooks;
   - card panel on the employee detail page and the dialogs (reusing `ReasonDialog`);
   - PDF opened in a new tab via a blob;
   - nav item + Super Admin sidebar badge (F-33) + dashboard card;
   - Ctrl+K: serial results + a role-based "Actions" group;
   - Vitest tests.
8. `feat(import):` F-38. The import commit and the approval apply return `created_employee_ids`
   (additive; spec §5 updated in the same commit). The import result and the approved import
   request show "Issue and print cards for these N employees" for the Super Admin. It calls
   bulk issue, then A4 print.

### Slice B – Kiosk punch, snapshot, storage
9. `feat(backend):` `app/core/storage.py` (local + Supabase) with tests against a fake HTTP
   transport (upload, read, delete, timeout, retry); `.storage/` is git-ignored.
10. `feat(punches):` migrations `0007_punches` (`punches` + UPDATE/DELETE/TRUNCATE trigger, as in
    `0002`; `punch_snapshots`) and `0008_kiosk_notices_and_kiosk_fields` (`kiosk_notices`;
    `kiosk_devices.sound_muted`, `last_self_test_at`). Both migrations come now, because the
    self-test flow writes the kiosk field.
11. `feat(antiproxy):` `app/antiproxy/`:
    - `context.py`: `PunchContext` and the `RuleResult` pass / reject / self_test;
    - `engine.py`: fixed order, first reject wins;
    - rules `snapshot.py`, `qr_credential.py` (signature, state, employee active, punch method
      QR → `EMPLOYEE_NOT_QR`, employee's plant = kiosk's plant → `WRONG_PLANT`), `cooldown.py`
      (IN/OUT decision table, spec §7 rule 6, settings-driven). The device check is M1's
      `require_kiosk` dependency, not a rule file;
    - `punches/snapshots.py`: Pillow decode with a pixel limit, size and dimension checks,
      re-encode at q75 without metadata, brightness and `is_dark`.
    Each rule is unit-tested alone.
12. `feat(punches):` `POST /punch/kiosk`:
    - body limit, rate limit, then `require_kiosk`;
    - idempotency by `(kiosk, client_punch_id)`, including the unique-violation race;
    - the employee row is locked `FOR UPDATE`, then the engine runs;
    - the punch ID is made first; the snapshot is encrypted with it as AAD, uploaded (5 s, one
      retry; on failure the state is `upload_failed` and a warning is logged), then the punch and
      snapshot rows are inserted;
    - the self-test branch updates `last_self_test_at` and writes no punch row;
    - the response is rebuilt from stored rows for retries.
    `GET /kiosk/me` adds notices and kiosk settings; `POST /kiosk/report` writes a JSON log line
    only.
13. `feat(settings):` M2 setting definitions + milestone bump. Lowering `snapshot_retention_days`
    shortens `expires_at` of stored rows in the same save (hook called from settings `service`).
14. `feat(jobs):` `purge_expired_snapshots` in `app/jobs/daily.py`: batches of 500, deletes
    files, then marks rows `purged`; idempotent; `upload_failed` rows past retention are marked
    too.
15. **Design gate B:** kiosk idle (camera frame, notices, low-light line, privacy footer, the
    optional "tap once for sound and full screen" banner; there is no start screen),
    "look at the camera", checking / server waking, results (IN, OUT, already, rejected incl.
    `WRONG_PLANT` and `EMPLOYEE_NOT_QR`, KIOSK OK), connection and camera problems (with a "Start
    camera" fallback button). Rules: 24 px / 64 px / 7:1, colour + icon + word.
16. `refactor(kiosk):` extract `Frame`, `KioskButton`, `StatusChip`, `ServerClock` and
    `ProblemScreen` from `kiosk-pairing-page.tsx` into `src/kiosk/components/`; lazy `/kiosk`
    and `/admin` routes.
17. `feat(kiosk):` `src/kiosk/attendance/`:
    - `use-attendance.ts`: reducer state machine idle → read → checking → result → idle (the
      camera starts by itself after pairing, zero taps; the optional unlock banner only enables
      sound, full screen and the wake lock);
    - `camera.ts` (with the "Start camera" fallback when a browser needs a gesture);
    - `qr-reader.ts`: dynamic `barcode-detector`, self-hosted wasm, `UPS1.` prefix check, 5 s
      same-payload ignore;
    - `snapshot.ts`: 320 px canvas, quality loop down to ≤ 15 KB, minimum 0.4;
    - `brightness.ts`: low-light hint after 10 s;
    - `punch-client.ts`: `client_punch_id`, one automatic retry, `NONCE_REUSED` re-sign,
      server-waking after 5 s, error after 60 s;
    - result and problem screens; notices panel.
18. `feat(kiosk):` `sound.ts` (Web Audio tones) and `voice.ts` (Web Speech, `en-IN` → `en`,
    local voices preferred, never the name; respects both settings and `sound_muted`);
    `wake-lock.ts`; `error-reporter.ts` (S-26: kinds, counts, at most 20 per hour);
    `self-update.ts` + the Vite `version.json` plugin (S-27: checked every 5 min, reload after
    30 s idle); Vitest tests for all of these.
19. `test(e2e):`
    - `e2e_card_video` script and the helper `openKioskWithCard`, with the M1 kiosk helpers moved
      to `helpers.ts`;
    - `kiosk-pairing.spec.ts` updated (the paired screen is now the scanning screen);
    - new `kiosk-punch.spec.ts`: issue → IN → already IN → revoke → `QR_REVOKED`; the same card at
      another plant's kiosk → `WRONG_PLANT`; a face-method employee's card → `EMPLOYEE_NOT_QR`;
      TEST card → KIOSK OK; axe scan on the kiosk screens.

### Slice C – Admin views and extras
20. `feat(punches):` admin endpoints: list, summary, detail (read-only for Corporate Head and
    Plant Head in scope), `/snapshot` (Super Admin only; decrypt, no-store, audit
    `snapshot.view`, 410 / 404 / 503), `/compare` (Super Admin only; last 3 stored photos of the
    card),
    `export.xlsx` (XlsxWriter, injection-safe cells reusing `DANGEROUS_FIRST_CHARACTERS` from
    `import_excel.py`, max 5,000 rows, audit).
21. `feat(notices):` `app/modules/notices/` CRUD + end, with scope rules (Plant Head: own plant
    only; Super Admin: any plant or all plants), dates ≤ 90 days, plain text, and the visibility
    query used by `/kiosk/me`.
22. `feat(kiosks):` additive fields `last_self_test_at`, `sound_muted`; PATCH `sound_muted`.
    `feat(printing):` gate poster A4 (`poster_pdf.py`, Lucide SVG icons, ISC, logged in
    ui-component-sources).
23. **Design gate C:** punch log (chips, filters, photo state text; photo dialog and compare
    view for the Super Admin), gate notices list + form with live preview, kiosks list sound
    switch and last self-test, settings (new M2 settings), poster button.
24. `feat(frontend):` `src/features/punches/` (log page with 30 s refresh while viewing today,
    photo + compare dialog for the Super Admin, export), `src/features/notices/`, kiosks list
    and plant-kiosks tab additions, settings: new `cards` group, plant detail "Download gate
    poster"; Vitest tests.
25. `test(e2e):` `admin-punches.spec.ts`: punch log shows the punches from step 19, view photo
    (Super Admin), the Plant Head sees the list without photo actions, export download; Plant
    Head adds a notice → it appears on the kiosk; the Plant Head has no print button and the print
    endpoint refuses; bulk issue + A4 print for 12 workers; import → "Issue and print cards";
    axe on every new page.

### Slice D – Tooling, docs, finish
26. `ci:` size-limit (MIT) + `@size-limit/preset-app`. `.size-limit.json` sets budgets for the
    admin entry, the kiosk chunk and the decoder wasm at the measured size + 10%. The `frontend`
    job runs `npm run size` after the build and asserts the admin entry has no zxing or
    `src/kiosk` code (AC-46).
27. `test(backend):` `backend/loadtest/locustfile.py` + `README.md` (S-22): 7 simulated kiosks ×
    300 punches in 10 minutes. It runs against
    `docker run --cpus=0.1 --memory=512m` locally, then once against the live backend outside
    working hours (outward step). Results go into the PR description.
28. `test:` coverage floor 70 → 75 (`backend/pyproject.toml`, `frontend/vite.config.ts`); fill
    the gaps the reports show.
29. `docs:` the document changes from spec §2 item 10:
    - SRS FR-14 (A4 sheet is core; the card shows the plant and no end date), §5.b (QR paths),
      §8 "Duplicate punch" row (`COOLDOWN_ACTIVE`, `OUT_TOO_SOON`);
    - architecture §3 (payload without dates, no audit row per punch, snapshot after the card is
      read) and §7 (new columns, `kiosk_notices`, test cards);
    - no change to the M1 spec or to the SRS transfer row (decision 0009);
    - `deploy/README.md` (Supabase bucket, Data API off, new Render env vars) and
      `deploy/render.yaml` (new keys, `sync: false`);
    - `docs/guides/kiosk-setup.md` extended (S-29): Chrome/Edge kiosk mode, autoplay, camera and
      location permissions, Android/Windows power settings, wake lock, the morning TEST card;
    - README (QR key commands, storage note);
    - gate poster how-to.
30. **Outward step (Tushar does, I guide), before the merge.** Production refuses to start
    without the new keys, so these must exist first:
    - create the private bucket `punch-snapshots` in Supabase;
    - switch off the Supabase Data API;
    - run `make_qr_key` and `make_snapshot_key` on the laptop;
    - set `QR_SIGNING_KEY`, `QR_SIGNING_KEY_ID`, `SNAPSHOT_ENCRYPTION_KEY`,
      `STORAGE_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SNAPSHOT_BUCKET`
      on Render;
    - store both keys in the password manager.
31. Reviews (CLAUDE.md §8 step 6) via `/review-milestone`: test-engineer,
    code-quality-reviewer, security-reviewer (card signing, snapshot crypto, Plant Head printing,
    kiosk endpoints), compliance-auditor (snapshots, retention, notices), i18n-reviewer. Fix the
    findings and run the manual checks below. Then the CLAUDE.md update (roadmap tick, new env
    vars, commands, libraries; the lead approves the diff first) and decision lines, then
    `/ship`. **After the merge:** first demo on the live site plus the live load test outside
    working hours.

## Files (representative)
- **Backend new:**
  - `app/core/{crypto,storage}.py`, `app/antiproxy/{context,engine}.py`,
    `app/antiproxy/rules/{snapshot,qr_credential,cooldown}.py`;
  - `app/modules/{qr_cards,punches,notices,printing}/…`, `printing/fonts/*.ttf`;
  - `app/scripts/{make_qr_key,make_snapshot_key,e2e_card_video}.py`;
  - `migrations/versions/0006_qr_cards.py`, `0007_punches.py`,
    `0008_kiosk_notices_and_kiosk_fields.py`;
  - `loadtest/`, `tests/{kiosk_helpers,image_helpers}.py`, `tests/test_*` per module.
- **Backend changed:** `app/main.py`, `app/core/config.py`, `app/modules/all_models.py`,
  `auth/{permissions,rate_limit}.py`, `kiosks/{router,service,models,schemas}.py`,
  `employees/{operations,search_router,import_excel}.py`, `approvals/service.py`,
  `settings/{definitions,service}.py`, `app/jobs/daily.py`, `tests/conftest.py`,
  `pyproject.toml`, `uv.lock`, `.gitignore`.
- **Frontend new:** `src/kiosk/components/*`, `src/kiosk/attendance/*`,
  `src/features/{qr-cards,punches,notices}/*`, `.size-limit.json`.
- **Frontend changed:**
  - `app/router.tsx` (lazy routes), `app/layouts/admin-layout.tsx` (nav + badges);
  - `features/{kiosks,settings,employees,admin,plants,search,approvals}/…`;
  - `kiosk/kiosk-pairing-page.tsx`, `public/locales/en/common.json`;
  - `vite.config.ts`, `vercel.json`, `package.json`.
- **E2E / CI / docs:** `e2e/tests/{helpers.ts,kiosk-pairing,kiosk-punch,admin-punches}.spec.ts`,
  `e2e/playwright.config.ts` (e2e QR + snapshot keys, local storage dir), `e2e/.gitignore`;
  `.github/workflows/ci.yml`, `deploy/{README.md,render.yaml}`, `docs/SRS.md`,
  `docs/architecture.md`, `docs/guides/kiosk-setup.md`, `README.md`,
  `docs/decisions/ui-component-sources.md`.

## Reused code
- `require_kiosk`, `signed_message`, `verify_signature`: `backend/app/modules/kiosks/{dependencies,crypto}.py`.
- `require`, `CurrentUser`, `plant_filter`, `ensure_plant_in_scope`, `PERMISSIONS`:
  `backend/app/modules/auth/`.
- `record_audit`, `Actor`, `SYSTEM_ACTOR`: `backend/app/modules/audit/service.py`.
- `RateLimiter`: `backend/app/modules/auth/rate_limit.py`.
- `ApiError`: `backend/app/core/errors.py`.
- `utc_now`, `to_ist`, `today_ist`, `IST`: `backend/app/core/time.py`.
- `page_params`, `fetch_page`, `Page`: `backend/app/core/pagination.py`.
- `get_setting` / `get_int_setting` and `SettingDefinition`: `backend/app/modules/settings/`.
- `run_daily_jobs` + scheduler: `backend/app/jobs/daily.py`.
- segno (already used for the pairing QR in `kiosks/router.py`).
- XlsxWriter + `DANGEROUS_FIRST_CHARACTERS`: `employees/import_excel.py`.
- `mark_left`: `employees/operations.py`.
- Search router: `employees/search_router.py`.
- Audit trigger SQL pattern: `migrations/versions/0002_auth_and_audit.py`.
- Test fixtures `db_session`, `db_client`, `fresh_rate_limits`, `make_user`, `log_in`,
  `client_for`, `create_plant`: `backend/tests/`.
- Frontend:
  - `signedRequest`, `takeNextCounter`, `usePairing` (paired state, server offset):
    `src/kiosk/`;
  - `apiGet/Post/Patch/Send`, `ApiError`, `describeError`: `src/lib/api-client.ts`,
    `features/auth/error-message.ts`;
  - `formatDate/Time/Number`, `todayIst`: `src/lib/format.ts`;
  - `ReasonDialog`: `features/users/user-dialogs.tsx`;
  - bulk-bar pattern: `features/employees/employees-page.tsx`;
  - audit page filter/detail pattern: `features/audit/audit-page.tsx`;
  - `KioskStatusBadge`, `usePlantFilter`, `CommandPalette`, `GROUP_ORDER` settings page;
  - test helpers `renderRoute`, `mockApi`, `apiError`, people fixtures.
- E2E: `logIn`, `expectNoSeriousAccessibilityIssues`, and the kiosk pairing helpers from
  `kiosk-pairing.spec.ts` (moved to `helpers.ts`).

## Dependencies
As spec §13, all free:
- **Backend runtime:**
  - fpdf2 2.8.x (LGPL-3.0, unmodified): card, test-card and poster PDFs;
  - Pillow (HPND): snapshot checks, re-encode, brightness;
  - httpx2 (BSD-3, moved from dev): Supabase Storage calls.
- **Backend dev:**
  - pypdfium2 (Apache-2.0/BSD-3) + zxing-cpp (Apache-2.0): S-23;
  - locust (MIT), in its own `loadtest` group: S-22.
- **Frontend:**
  - barcode-detector 3.x (MIT, with zxing-wasm, Apache-2.0 inside): QR reading;
  - dev: size-limit + @size-limit/preset-app (MIT): S-28.
- **Assets:** Inter TTF (OFL-1.1) for the PDFs; Lucide SVGs (ISC) for the poster.
- **Browser built-ins:** Web Speech, Web Audio, Screen Wake Lock, MediaDevices.

## Verification (AC → test)
| AC | How |
|---|---|
| AC-1, AC-2 | pytest API: issue with defaults (6 months − 1 day), audit; CH/PH `FORBIDDEN`; an employee with punch method face → `EMPLOYEE_NOT_QR`; replace revokes the old one; two parallel issues → one active (unique index) |
| AC-3 | pytest unit: payload deterministic, regex, verify, one-character change fails |
| AC-4, AC-41 | pytest: PDF one CR80 page, plant name and code printed, no end date text (pypdfium2 text extraction), 12 cards → 2 A4 pages, print_count + `printed_plant_id` + audit; "reprint needed" after a transfer; S-23 scan test (decode = payload, version ≤ 7) in CI |
| AC-5 | pytest role matrix: print, issue, revoke, extend → `FORBIDDEN` for Corporate Head and Plant Head; both can list cards read-only; e2e: no print button for the Plant Head |
| AC-6 | pytest: mark-left revokes the card with kind `left`, shared request ID |
| AC-7 | pytest full signed flow (accepted IN, encrypted snapshot, expires_at +60 d); Vitest IN screen + tone + "Checked in." spoken; e2e fake camera → green IN; manual on live site with a stopwatch (< 5 s) |
| AC-8, AC-9 | pytest decision table with frozen server time: 1 min `COOLDOWN_ACTIVE` (no snapshot), 10 min `OUT_TOO_SOON`, 9 h OUT, 19:00 → 07:05 OUT, 24 h → IN, exact 2 min / 30 min / 20 h boundaries |
| AC-11 | pytest: card at another plant's kiosk → `WRONG_PLANT` (rejected, snapshot stored, no name on the response); after a transfer the card works at the new plant from the effective date; e2e `WRONG_PLANT` screen |
| AC-10 | pytest revoked → `QR_REVOKED` + snapshot; Vitest reject screen (no name, admin code line); e2e revoke flow; **manual first demo on the live kiosk** |
| AC-12, AC-13, AC-14 | pytest: card of a face-method employee → `EMPLOYEE_NOT_QR` (rejected, snapshot stored); expired / not-yet-valid / bad signature / unknown serial, each stored as rejected with a snapshot and no employee on bad signature |
| AC-15 | pytest: tampered body / reused counter / revoked kiosk → request errors, zero punch rows |
| AC-16 | pytest: same `client_punch_id` re-signed → identical response, one row; race via two threads |
| AC-17 | pytest: missing, 100 KB (`PAYLOAD_TOO_LARGE`), PNG, too many pixels; decrypted file has no EXIF |
| AC-18 | pytest: device_time 3 h off → server time stored and returned |
| AC-19 | pytest raw SQL UPDATE/DELETE/TRUNCATE on `punches` raises; no `audit_logs` row after a punch |
| AC-20, AC-21 | pytest: local file exists and is not a JPEG; Supabase backend against a fake transport; failing storage → `upload_failed`; manual: real bucket private, public URL refused |
| AC-22 | pytest purge job: batches, idempotent, punch rows untouched, lowered retention |
| AC-23, AC-33 | pytest: snapshot no-store + one audit row per view; Plant Head and Corporate Head `FORBIDDEN` on `/snapshot` and `/compare`; no storage key in any response (JSON scan); compare returns 3 newest, 4 views → 4 audits; Vitest compare dialog (Super Admin) and no photo actions for other roles |
| AC-24 | pytest scope: a Plant Head sees only punches at kiosks of their plant; Corporate Head sees all (read-only); summary counts; Vitest 30 s refetch; e2e punch log |
| AC-25 | pytest settings range + cool-down 5 effect; M3+ keys still locked |
| AC-26 | CI `i18n:check` + a Vitest test that every server reason code has title/message/next/voice keys; grep test for removed codes |
| AC-27 | pytest config: production without each key exits with the field name, no value printed |
| AC-28 | CI coverage floor 75 (backend + frontend) |
| AC-29 | Vitest voice/sound with mocked `speechSynthesis` / `AudioContext`: lines never contain the name, switches off, no English voice → tones only; manual on Android + Windows |
| AC-30, AC-39 | pytest bulk issue 40 (3 skipped), revoke with shared request ID, A4 37 → 4 pages; Vitest bulk bar; e2e bulk + import → "Issue and print cards"; pytest search by serial |
| AC-31 | pytest notice visibility (plant, all-plants, time window, ended, max 3, important first) and PH scope; e2e notice on kiosk |
| AC-32 | pytest TEST card → `self_test`, no punch row, `last_self_test_at`, audit; revoked TEST → `QR_REVOKED`, no row; e2e KIOSK OK |
| AC-34 | pytest dark image → `is_dark`, summary count; Vitest low-light hint after 10 s and hides again (fake timers) |
| AC-35 | pytest expiring-count; Vitest dashboard card + badge + link filter |
| AC-36 | pytest poster PDF one A4 page with plant name + "60 days" text; PH other plant `PLANT_NOT_FOUND` |
| AC-37 | pytest export opened with openpyxl: columns, no IP/location, `=` name stored as text, audit |
| AC-38 | removed from M2 (F-36 online badge, pending Tushar, decision 0009); kiosks list still shows `last_self_test_at` (AC-32) |
| AC-40 | manual Locust run (local container + live off-hours), result table in the PR |
| AC-42 | pytest: stored blob not a JPEG; blob moved onto another punch ID → decrypt fails |
| AC-43 | removed from M2 (S-25 usage meter, pending Tushar, decision 0009) |
| AC-44 | pytest report → one JSON log line (caplog) without personal data; 21st → `TOO_MANY_REQUESTS` |
| AC-45 | Vitest self-update: new version waits for 30 s idle, never reloads mid-punch |
| AC-46 | CI size-limit + admin-bundle content check |
| AC-47 | manual: a teammate follows `docs/guides/kiosk-setup.md` on Android + Windows; 30 min idle without sleep |

Local run (Windows):
1. `docker compose up -d`
2. `cd backend; uv sync; uv run pytest` (with `TEST_DATABASE_URL`)
3. `uv run alembic upgrade head`
4. `uv run python -m app.scripts.make_qr_key` and `make_snapshot_key`, then put both keys in
   `.env`
5. `.\scripts\dev.ps1`
6. Pair a phone or laptop at http://localhost:5173/kiosk and issue + print a card
7. `cd e2e; npx playwright test --headed` (the team watches)
8. `pre-commit run --all-files`

Manual (before PR):
- printed cards on plain and laminated paper, scanned at 10 / 20 / 30 cm in daylight and under
  the gate light, plus a scratched card;
- tones and voice on Android Chrome and Windows Chrome / Edge;
- size of 100 test snapshots (confirm about 15 KB);
- keyboard-only walk through the new admin pages;
- kiosk setup guide followed by a teammate.

After merge: first demo on the live site (valid card accepted, revoked card rejected), and the
live load test outside working hours.
