# M3 – Face enrolment and face attendance at the gate: Implementation Plan

Status: Approved by Tushar Gawande (lead) on 2026-10-24 · Spec: docs/specs/M3-face-attendance.md (Approved
2026-10-24) · Decisions: 0016, 0017 · Branch: `milestone/M3-face-attendance`

## Context
M2 is live: QR cards, the signed gate punch, the first anti-proxy rules (`app/antiproxy/`),
encrypted snapshots in Supabase, the punch log. Permanent employees (about 300) can still lend a
card, so M3 adds what cannot be lent: the **face**.

The approved spec delivers: consent on screen (English, Marathi, Hindi text), enrolment by the
Super Admin in the admin site (8 server-checked shots, only an AES-256-GCM template kept), a
"Punch with face" button at the gate with a server-chosen head turn, server-side liveness +
anti-spoof + 1:N match, the employee-code fallback (1:1), template deletion at once on leaving /
withdrawal / method change, and the extras F-30, F-39, F-40, F-41, F-43 (setting), S-30–S-33.

The biggest risk is **Render Free: 512 MB RAM and 0.1 CPU**. So slice 1 is a measured proof, and
**nothing else is built until the lead says "go"** on its numbers.

Choices for this plan (2026-10-24, Tushar):
- **Design gate: HTML mockup screenshots** (as M2), made by ui-designer from our design system;
  code starts only after the lead approves them.
- **Build order:** slice 1 (proof) → feature slices A–D, as in M2. Each slice is backend + screens
  + tests, demo-able alone, committed and pushed at its end (handoff rule).
- **Slice 1 measures the engine inside the container, not through `/punch/kiosk`** (the endpoint
  does not exist yet). The benchmark runs the exact pipeline the endpoint will call, including JSON
  + base64 decoding of 3 frames. AC-1 is confirmed again through the real endpoint in slice D (CI
  memory test S-30 + Locust run). This is the only deviation from spec §8.3 step 3.

Every step is one small Conventional Commit (no Claude co-author / "Generated with" lines). Every
new file starts with a one-line purpose comment.

## Cross-cutting decisions
- **Module layout:** face maths in `app/face/` (no database); database work in a new module
  `app/modules/face/` (`models`, `schemas`, `consent_service`, `enrolment_service`,
  `template_service`, `gallery_cache`, `presenter`, `router`); punch code stays in
  `app/modules/punches/`; rules in `app/antiproxy/rules/face_*.py`.
- **No `insightface` package.** Our own small code: SCRFD output decoding + NMS, 5-point similarity
  alignment to the ArcFace 112 × 112 template (`cv2.estimateAffinePartial2D`), ArcFace embedding,
  anti-spoof crop. onnxruntime `InferenceSession` with `intra_op_num_threads=1`,
  `inter_op_num_threads=1`, memory arena options chosen in slice 1.
- **Face engine (`app/face/engine.py`):** loaded in a background thread at start (state `loading`
  → `ready` / `failed`), one warm-up run on a built-in synthetic picture, one worker thread with a
  bounded queue (4 waiting, 8 s wait → `FACE_SERVICE_BUSY`). `FACE_ENGINE=fake` (only with
  `APP_ENV=test`) swaps in `app/face/fake_engine.py`, which returns set detections, keypoints and
  embeddings encoded in synthetic test images (unit tests, API tests, e2e).
- **Models:** `backend/scripts/models.json` lists each file (URL, sha256, size, licence);
  `backend/scripts/download_models.py` downloads into `FACE_MODELS_DIR` (default `/app/models`),
  checks sha256, extracts only the needed files from a pack zip, stops on any mismatch. A
  multi-stage Dockerfile downloads (and, for INT8, quantises with `onnxruntime.quantization`) in a
  build stage; the runtime stage copies the read-only files only, so `onnx` never ships.
  `.gitignore` covers `models/`, `*.onnx`, `*.task`; a CI step fails if one is tracked.
  If an upstream file is missing or unstable, a copy goes to a GitHub Release of our repo (licence
  kept beside it) and is pinned by sha256 (spec §7 rule 6).
- **Config (`app/core/config.py`):** `face_template_key` (required in production, same
  "Missing required setting: …" pattern), `face_model_pack` (default from slice 1), `face_models_dir`,
  `face_engine` (`real`/`fake`; `fake` refused unless `APP_ENV=test`). Without the key in
  development: `FACE_NOT_CONFIGURED`.
- **Crypto (`app/core/crypto.py`):** `encrypt_vector(vector, aad, key)` / `decrypt_vector(...)`
  (AES-256-GCM, key-id byte + nonce stored in columns) with AAD helpers for template (employee id +
  model id + key id), shot (session id + pose) and pending match (pending id + kiosk id).
  `app/scripts/make_face_key.py` like `make_snapshot_key.py`.
- **Roles:** `VIEW_FACE_ENROLMENT`, `MANAGE_FACE_ENROLMENT`, `VIEW_FACE_SCORES` in
  `app/modules/auth/permissions.py`; routes use `require(cap)`, queries `plant_filter` /
  `ensure_plant_in_scope`.
- **Audit:** `record_audit` in the same transaction for every entry of spec §8.2.
- **Errors and texts:** `ApiError`; every code of spec §7 rule 18 gets its texts in
  `frontend/public/locales/en/common.json` (`errors.*`, `kiosk.punch.<CODE>.{title,message,next,voice}`,
  `punchReasons.*`); `npm run i18n:check` stays green; no "kiosk" in people-facing text.
- **Settings:** `CURRENT_MILESTONE = 3`; the keys of spec §7 rule 13 as `SettingDefinition`s
  (floats allowed); the floor ≤ threshold check in `settings/service.py` (`SETTING_INVALID`).
  `privacy_contact` is filled once from the first Super Admin (in `create_super_admin` and by a
  data step in migration 0011 for the live database). A `FaceLimits` dataclass is read once per
  punch, like `PunchLimits`.
- **Cache invalidation:** one function `invalidate_plant_gallery(plant_id)` called after commit by
  enrol, delete, withdraw, mark-left, transfer and method change, plus the stamp query before each
  face punch (spec §7 rule 8).
- **Body limits (`app/core/body_limit.py`):** `/api/v1/punch/kiosk` 384 KB, `/punch/kiosk/code`
  2 KB, enrolment shots 256 KB; other kiosk paths keep 64 KB; a `method: "qr"` body over 64 KB is
  refused in the route from its `Content-Length` (`PAYLOAD_TOO_LARGE`).
- **Never logged or stored:** frames, crops, embeddings, templates, tokens, nonces, typed codes.
  A log-scrub test (AC-26) guards it.
- **Frontend:** `src/lib/face-guide/` (lazy MediaPipe Face Landmarker; wasm + `face_landmarker.task`
  served from our own `dist/`, the `.task` file fetched with a sha256 check by a `prebuild` script,
  git-ignored), shared by the gate and the wizard; not in the admin first load (size-limit check).
- **Design gates:** A gate screens, B admin enrolment, C punch log / settings / dashboard / poster /
  `/privacy`. Screenshots to the lead; links go into spec §4; copied components into
  `docs/decisions/ui-component-sources.md`.

## Build steps

### 0. Plan doc – `docs:`
Save this plan as `docs/plans/M3-face-attendance-plan.md` (Status: Approved), with the Status
section at the bottom.

### Slice 1 – Face engine proof: memory and speed (GO / NO-GO)
1. `build(backend):` add onnxruntime (MIT), opencv-python-headless (Apache-2.0), numpy (BSD-3).
   First check that all three have Python 3.14 wheels on Linux and Windows; if not, switch
   `requires-python`, `.python-version` and the Dockerfile to 3.13 and write decision 0018
   (spec §14 answer 3).
2. `build(backend):` `scripts/models.json` + `scripts/download_models.py` (sha256, extract,
   refuse mismatch; AC-2), `scripts/quantise_models.py` (INT8 dynamic quantisation, S-33),
   multi-stage Dockerfile, `.gitignore`, CI "no model file tracked" step.
3. `feat(face):` `app/face/` engine: `detector.py` (SCRFD, input size as a parameter),
   `alignment.py`, `embedder.py`, `antispoof.py` (MiniFASNet; the CelebA-Spoof candidate behind the
   same interface), `quality.py` (blur, brightness, yaw / pitch from 5 keypoints), `matcher.py`
   (cosine, gallery matrix, decision table), `engine.py` (load, warm-up, state, single worker
   queue), `fake_engine.py`. Unit tests with the fake engine; real-model tests marked
   `face_models` (skipped when models are absent).
4. `test(face):` `app/scripts/face_benchmark.py`: downloads a small sha256-pinned set of public face
   images, builds 3-frame requests (JSON + base64), runs 50 decisions one at a time then 1 every
   2 s, and prints one JSON result: cold load, warm-up, p50 / p95 per stage, peak memory from the
   cgroup (`memory.peak`). `FACE_BENCHMARK_ON_START=true` makes `scripts/start.sh` run it once and
   log the result before the server starts (Render Free has no shell).
5. **Local measurement** (Docker Desktop, `--memory=512m --cpus=0.1`): `buffalo_l` and `buffalo_s`,
   each FP32 and INT8, detector input 640 and 320, 2 and 3 frames, both anti-spoof candidates
   (speed + memory only; spoof accuracy comes in slice D).
6. **Outward step (Tushar does, I give the exact clicks):** create a temporary second Render Free
   web service from this branch (Docker, `rootDir: backend`, env `FACE_BENCHMARK_ON_START=true`,
   `FACE_MODEL_PACK=<candidate>`, throw-away keys, no real `DATABASE_URL`), read the JSON line in
   its logs for each candidate (change the env var → redeploy), then **delete the service the same
   day**.
7. `docs:` `docs/reports/M3-face-accuracy.md` §"Memory and speed" (numbers only) + the go / no-go
   line added to decision 0016. **STOP: I show the numbers and wait for the lead's "go".**
   No-go means: stop and the lead chooses between Oracle Always Free and the client's server
   (decision 0016 item 16).

### Slice A – Consent and enrolment (backend + admin)
8. `feat(backend):` config fields + production check (AC-31), vector crypto, `make_face_key`,
   `.env.example`, settings definitions + `SETTING_INVALID` rule (AC-30), `CURRENT_MILESTONE = 3`.
9. `feat(face):` migrations `0011_face_consents_and_templates` (with `privacy_contact` data step)
   and `0012_face_enrolment_sessions`, each with RLS + `deny_all`; models in `all_models.py`;
   `tests/test_row_level_security.py` extended.
10. `feat(face):` consent: `app/face/consent_texts/face-consent-v1.{en,mr,hi}.txt`, fixed-hash test
    (AC-33), `GET /face/consent-texts/{version}`, consent give / decline (method → QR, audited) /
    withdraw (template deleted, open session cancelled, method → QR, cache cleared) (AC-3, AC-4,
    AC-20). The Marathi and Hindi texts are drafted by me and marked "to be checked by a reader"
    in the handover checklist (decision 0017).
11. `feat(face):` enrolment sessions + shots (8 server checks of spec §7 rule 4, AC-7), finish
    (mean template, duplicate check F-39 with override, AC-35), cancel; template delete;
    `GET /employees/{id}/face` with history; `face_state` filter on `GET /employees`;
    `GET /face/enrolment-progress` (F-40).
12. `feat(employees):` hooks: `mark_left` deletes the template and closes consent in the same
    transaction (AC-19); punch-method change face → QR (direct edit and approved change request in
    `approvals/service.py`) deletes it (`method_changed`); transfer clears both plant caches.
13. `feat(jobs):` 5-minute face cleanup job (pending matches, expired sessions + shots, old
    challenges) in the scheduler, plus "clean own rows first" on every new session (AC-8).
14. **Design gate B:** face panel (all states), consent dialog (language switch, equal buttons),
    enrolment wizard (camera check, 5 poses, retake, finish, duplicate warning), employees list
    "Face" column.
15. `feat(frontend):` `src/lib/face-guide/` (+ `prebuild` model fetch); `src/features/face/`
    (panel, consent dialog, wizard, hooks); employees list column + filter; Vitest tests (camera
    not started before "I agree", decline path, retake, duplicate reason, cancel on close, role
    hiding).
16. `test(e2e):` `face-enrolment.spec.ts` with `FACE_ENGINE=fake` and a synthetic `.y4m` clip
    (`app/scripts/e2e_face_video.py`, refuses unless `APP_ENV=test`): consent → 5 shots →
    "Enrolled"; decline → QR; withdraw → QR; Plant Head / Corporate Head read-only. Push.

### Slice B – Face punch at the gate
17. `feat(punches):` migration `0013_face_punches` (`punch_challenges`, `face_pending_matches`
    with RLS; `punches` new columns and checks; `punch_snapshots.reason`, `face_found`).
18. `feat(antiproxy):` rules `face_challenge`, `face_frames`, `face_liveness` (one or two steps,
    F-43), `face_antispoof`, `face_consistency`, `face_match`; `FACE_RULES` + `run_face_rules` in
    `engine.py` (cooldown reused); `PunchContext` gains the face fields. Each rule unit-tested
    alone, plus the order test (AC-11, AC-12).
19. `feat(punches):` `POST /punch/challenge` (rate limit 30/min); `method: "face"` branch of
    `POST /punch/kiosk` (`record_face_punch` in a new `punches/face_service.py`: receive time
    before the queue, model work before the transaction, employee row locked only for cooldown,
    snapshot from the first frontal frame for rejected / `needs_code`, pending match); gallery
    cache + stamp (AC-21, AC-22); idempotency as M2.
20. `feat(punches):` `POST /punch/kiosk/code` (1:1, 2 tries, same answer and ≥ 300 ms for every
    failure, `WRONG_PLANT`, `follows_punch_id`, `claimed_employee_id`; rate limit 10/min)
    (AC-13–AC-16); `/kiosk/me` face block; `/health` face block (S-31, AC-40); body limits
    (AC-27); busy / unavailable (AC-28, AC-29).
21. **Design gate A:** idle with "Punch with face" (ready / starting / unavailable), oval guidance
    + hints, challenge arrow, checking, code pad (digits / ABC, countdown), results (IN, OUT,
    needs code, every face rejection with retry), new footer text.
22. `feat(kiosk):` attendance machine extended (`face-guide` → `challenge` → `capture` →
    `checking` → `code-pad` / `result`; card scanning paused during a face punch); `face-capture.ts`
    (640 × 480 unmirrored JPEG frames, timed fallback without MediaPipe), challenge renewal once,
    `code-pad.tsx`, result texts, voice lines; Vitest tests.
23. `test(e2e):` `kiosk-face-punch.spec.ts`: IN → already IN; fake "unsure" → code → accepted;
    wrong code twice → not recognised; button hidden for a plant without enrolled faces; axe on
    the gate face screens and code pad. Push.

### Slice C – Admin views and extras
24. `feat(punches):` punch log: method / match-mode filters, "Asked for code", "No face in photo",
    new summary counts, Super Admin `face` detail block (AC-24); `/snapshot` serves the
    `needs_code` row's photo for a code-path row; snapshot reasons in the purge (AC-23).
25. `feat(punches):` F-30 background face-in-photo check after a QR punch commit (skipped when the
    engine is busy or off) (AC-37); F-41 re-enrol hint computed on read (AC-38).
26. **Design gate C:** punch log face columns + detail, settings "Face recognition" + "Privacy"
    cards, dashboard enrolment card, gate poster, `/privacy` page.
27. `feat(frontend):` punch log additions, settings groups (report value beside each threshold,
    warning text), dashboard card (F-40), Ctrl+K entries, poster text (`poster_pdf.py`), public
    static `/privacy` page (SPDI Rule 4); new pages added to `e2e/tests/responsive.spec.ts`;
    Vitest + e2e (`admin-face.spec.ts`: progress card, "Not enrolled" filter, score detail hidden
    for other roles). Push.

### Slice D – Accuracy, CI, docs, finish
28. `test(face):` accuracy tool `app/scripts/face_accuracy.py` (S-32): reads a data folder outside
    the repo (refuses one inside), runs the real engine, writes only numbers + the threshold curve
    into the report (AC-41). Runs (with the face-accuracy-evaluator agent): team faces (written
    consent first) + LFW downloaded at test time → FAR / FRR / code-path rate (AC-18); spoof sets
    at the real gate devices → APCER / BPCER for both anti-spoof candidates, pick one (AC-17).
    The settings defaults are set to the report's values.
29. `ci:` S-30 in the `docker` job: models cached (`actions/cache`), a Postgres service, a seed +
    signed-client script `app/scripts/face_memory_check.py` sends 20 face punches through the real
    endpoint with `--memory=512m`, fails above 450 MB (AC-39). Locust gets a face task (AC-1
    re-check through the endpoint).
30. `test:` coverage floor 75 → 80 (backend + frontend) (AC-34); log-scrub test (AC-26).
31. `docs:` spec §15 changes (SRS FR-11/12/16/18, §1.3, §9; architecture §3, §4, §7),
    `deploy/README.md` + `render.yaml` (`FACE_TEMPLATE_KEY`, `FACE_MODEL_PACK`), kiosk setup guide
    (face light, camera height), handover privacy notes (manual data-request procedure, §8.4
    incident steps, processor agreements, translation check, test-face consents), README.
32. **Outward step (Tushar, before the merge):** `make_face_key` on the laptop → set
    `FACE_TEMPLATE_KEY` (and `FACE_MODEL_PACK`) on Render, store the key in the password manager;
    after deploy set `company_address` and check `privacy_contact` in Settings.
33. Reviews via `/review-milestone`: test-engineer, code-quality-reviewer, security-reviewer
    (anti-spoof bypass, code guessing, crypto, logs), compliance-auditor (consent, retention,
    deletion), i18n-reviewer. Fix findings, manual checks, CLAUDE.md diff (lead approves first) +
    decision lines, then `/ship`. **After the merge:** first face demo on the live site.

## Model and effort per step (I say it again before each step and wait for "ok")
| Step | Model / effort | Why |
|---|---|---|
| Slice 1 engine code + go/no-go | Opus, high | face maths and the memory decision are expensive to get wrong |
| Slice A consent / crypto / deletion; Slice B rules, matching, code path | Opus, high | privacy + anti-proxy |
| Design gates, frontend screens, admin views (Slice C), e2e | Sonnet, medium | routine UI work |
| Accuracy runs (step 28) | Opus, high | thresholds decide FAR/FRR |
| CI, coverage, docs (29–31) | Sonnet, medium/low | routine |
| security-reviewer, compliance-auditor | Opus, high | biometric + DPDP |
| test-engineer, code-quality, i18n reviewers | Sonnet, medium | routine checks |
A `/compact` (or a fresh session) after each slice keeps the cost down: the plan's Status section
carries the hand-over.

## Files (representative)
- **Backend new:** `app/face/{detector,alignment,embedder,antispoof,quality,matcher,engine,fake_engine}.py`,
  `app/face/consent_texts/*.txt`, `app/modules/face/*`, `app/antiproxy/rules/face_*.py`,
  `app/modules/punches/face_service.py`, `app/scripts/{make_face_key,face_benchmark,face_accuracy,face_memory_check,e2e_face_video}.py`,
  `scripts/{models.json,download_models.py,quantise_models.py}`,
  `migrations/versions/0011_…`, `0012_…`, `0013_…`, tests per module.
- **Backend changed:** `Dockerfile`, `scripts/start.sh`, `pyproject.toml`, `uv.lock`,
  `app/main.py`, `app/core/{config,crypto,body_limit}.py`, `app/antiproxy/{context,engine}.py`,
  `auth/{permissions,rate_limit}.py`, `employees/{operations,queries,router}.py`,
  `approvals/service.py`, `punches/{router,schemas,models,answers,admin_service,presenter,retention}.py`,
  `kiosks/router.py` (`/kiosk/me`), `health/router.py`, `settings/{definitions,service}.py`,
  `jobs/daily.py`, `scripts/create_super_admin.py`, `modules/printing/poster_pdf.py`.
- **Frontend new:** `src/lib/face-guide/*`, `src/features/face/*`, `src/kiosk/attendance/{face-capture,code-pad,face-views}.*`,
  `src/features/privacy/privacy-page.tsx`, `scripts/fetch-face-model.mjs`.
- **Frontend changed:** `attendance-machine.ts`, `use-attendance.ts`, `scanning-view.tsx`,
  `result-view.tsx`, `punch-client.ts`, `punch-types.ts`, `features/{employees,punches,settings,admin,search}/…`,
  `app/router.tsx`, `public/locales/en/common.json`, `vite.config.ts` (coverage 80),
  `.size-limit.json`, `package.json`.
- **E2E / CI / docs:** `e2e/tests/{face-enrolment,kiosk-face-punch,admin-face}.spec.ts`,
  `responsive.spec.ts`, `helpers.ts`, `playwright.config.ts` (`FACE_ENGINE=fake`, test key);
  `.github/workflows/ci.yml`; `docs/reports/M3-face-accuracy.md`; `docs/SRS.md`,
  `docs/architecture.md`, `deploy/*`, `docs/guides/kiosk-setup.md`, handover privacy notes, README.

## Reused code
- `require_kiosk`, `signed_message`: `backend/app/modules/kiosks/{dependencies,crypto}.py`.
- `PunchContext`, `RuleResult`, `run_qr_rules` pattern, `check_in_out`: `backend/app/antiproxy/`.
- `record_kiosk_punch` flow (idempotency, IntegrityError race, `_store_snapshot`, `_upload`,
  `_delete_file_quietly`): `backend/app/modules/punches/service.py`.
- `inspect_snapshot` (pixel limit, re-encode, brightness): `punches/snapshots.py`.
- `encrypt_snapshot`, `decode_key`, `generate_key_text`: `app/core/crypto.py`.
- `BodyLimitMiddleware`, `body_limit_for`: `app/core/body_limit.py`.
- `RateLimiter` + `fresh_rate_limits` fixture: `auth/rate_limit.py`, `tests/conftest.py`.
- `record_audit`, `Actor`, `SYSTEM_ACTOR`; `require`, `plant_filter`, `ensure_plant_in_scope`.
- `mark_left`, `revoke_card_of_leaver`: `employees/operations.py`; approvals apply in
  `approvals/service.py`.
- `get_setting`, `get_int_setting`, `SettingDefinition`, `PunchLimits` pattern.
- `start_scheduler`, `run_daily_jobs`: `app/jobs/daily.py`; purge in `punches/retention.py`.
- `loadtest/` (Locust) and the M2 Docker `--memory=512m --cpus=0.1` recipe.
- Tests: `tests/{kiosk_helpers,image_helpers,factories,people_helpers}.py`, `db_client`,
  `make_user`, `log_in`, `client_for`.
- Frontend: `signedRequest`, `usePairing`, `camera.ts`, `camera-preference.ts`, `feedback.ts`,
  `voice.ts`, `sound.ts`, `result-view.tsx`, `ReasonDialog`, `mockApi`, `renderRoute`, settings
  `GROUP_ORDER`, `CommandPalette`; e2e `logIn`, `expectNoSeriousAccessibilityIssues`, the fake
  camera helper from `kiosk-punch.spec.ts`.

## Dependencies (all free)
- **Backend runtime:** onnxruntime (MIT) – runs the models; opencv-python-headless (Apache-2.0) –
  decode, resize, align, Laplacian; numpy (BSD-3) – vector maths.
- **Image build stage only:** onnx (Apache-2.0) – needed by the INT8 quantiser; not in the
  runtime image.
- **Models (downloaded, never committed):** InsightFace `buffalo_l` / `buffalo_s` (InsightFace
  model licence), MiniFASNet (Apache-2.0), one CelebA-Spoof model (licence recorded in the report).
- **Frontend:** @mediapipe/tasks-vision (Apache-2.0) + `face_landmarker.task` – guidance only.
- **Test data:** LFW (downloaded at test time, never committed); the team's own faces (on laptops).

## Verification (AC → test)
| AC | How |
|---|---|
| AC-1 | slice 1 benchmark locally + temporary Render service (go / no-go); re-checked through the endpoint by the S-30 CI job and Locust (slice D) |
| AC-2 | pytest `download_models` with a wrong sha256 → exit ≠ 0; CI step: no `*.onnx` / `*.task` tracked |
| AC-3, AC-4 | pytest consent give / decline (hash, language, audit, method → QR); Vitest: camera not started before "I agree"; e2e consent + decline |
| AC-5 | pytest generated role matrix over every new endpoint |
| AC-6, AC-7 | pytest with the fake engine: 8 accepted shots, template decrypts only with the right employee + model id, no image in storage / disk / DB; each `ENROL_*` refusal then a retake; `face_models` test on public images |
| AC-8 | pytest cleanup job + "clean own rows first" |
| AC-9, AC-10 | pytest full signed challenge → face punch (no snapshot row); Vitest idle with / without the button; e2e IN; manual stopwatch on the live site |
| AC-11, AC-12 | pytest each rule alone (frozen time: 11 s → `CHALLENGE_EXPIRED`; reused / other kiosk → `CHALLENGE_INVALID`; wrong-way turn, two faces, no face, swapped face); Vitest challenge renewal once |
| AC-13–AC-16 | pytest code path: right / wrong / unknown / QR worker / other plant / expiry / other kiosk / retry same try / ≥ 300 ms / 11th try 429; pending ciphertext fails with another id |
| AC-17 | manual spoof runs at a phone and a PC gate device, recorded in the report; automated run on the local recorded frame sets |
| AC-18, AC-41 | accuracy tool run (laptop) → report; pytest: tool refuses a folder inside the repo, output has no names / paths |
| AC-19, AC-20 | pytest mark-left / withdraw in one transaction, shared request ID, next punch `FACE_NOT_RECOGNISED` |
| AC-21, AC-22 | pytest old-model template ignored; cache rebuilt after enrol / delete / transfer / left / method change |
| AC-23 | pytest snapshot reasons, 60-day `expires_at`, purge, Super Admin only |
| AC-24, AC-25 | pytest `face` block only for the Super Admin; scope for Plant Head; JSON scan for ciphertext; Vitest hiding; e2e read-only roles |
| AC-26 | pytest log capture over a run of face punches + storage folder scan |
| AC-27 | pytest body limits (384 KB face, 64 KB qr, 70 KB frame, 1280 × 960, 5 frames, no turn frame) |
| AC-28, AC-29, AC-40 | pytest engine `loading` → 503 while card punches pass; 6 parallel → 4 wait, rest busy, challenge not used; health answers during loading without DB |
| AC-30 | pytest ranges + floor rule + next punch uses the new value; Vitest report values |
| AC-31 | pytest config without the key in production; `make_face_key` output decodes to 32 bytes |
| AC-32 | CI `i18n:check` + Vitest: every face code has title / message / next / voice; no "kiosk" in gate texts |
| AC-33 | pytest fixed hash of `face-consent-v1.en.txt` (and `.mr`, `.hi`) |
| AC-34 | CI coverage 80; responsive spec includes the new pages; axe scans |
| AC-35 | pytest duplicate block, override + audit, own re-enrolment not a duplicate |
| AC-36 | pytest progress counts + scope; Vitest card + link; e2e filter |
| AC-37 | pytest F-30: decision unchanged, `face_found` false later; engine off → null |
| AC-38 | pytest both hint reasons and the reset after re-enrolment |
| AC-39 | CI `docker` job memory check |

Local run (Windows): `docker compose up -d` → `cd backend; uv sync; uv run python scripts/download_models.py`
→ `uv run pytest` (add `-m face_models` for the real-model tests) → `uv run python -m app.scripts.make_face_key`
into `.env` → `.\scripts\dev.ps1` → enrol a teammate at http://localhost:5173/admin and punch at
/attendance → `cd e2e; npx playwright test --headed` → `pre-commit run --all-files`.

Manual before the PR: enrolment on a laptop webcam and a phone; gate at night light; helmet and
safety glasses; spoof attempts (AC-17); voice and tones on the face results; keyboard-only wizard.

## Status
- Done (2026-10-24):
  - Slice 1: go for `buffalo_s` (p95 1.0-1.2 s, 127-197 MB on Render); `buffalo_l` no-go; INT8 not
    used; Python stays 3.14 (decision 0016 items 17-20, `docs/reports/M3-face-accuracy.md` section 1).
  - Slice A backend (steps 8-13): face key + config, sealed vectors, 20 face/privacy settings,
    migrations 0011-0012, consent texts en/mr/hi (hash-pinned), consent give/decline/withdraw,
    enrolment (8 checked shots, duplicate check F-39, finish, cancel), face panel, employees list
    face state + filter, progress (F-40), deletion on leave / method change, transfer cache
    clear, 5-minute face cleanup job.
  - Slice B backend (steps 17-20): migration 0013, the six face rules + FACE_RULES, challenge,
    face punch, employee-code path (1:1, 2 tries, >= 300 ms on failure), photos of failed and
    code-path punches, plant gallery cache with stamp, heartbeat and health face blocks, body
    limits (384 KB face, 2 KB code, 64 KB card), rate limits (30 challenges, 10 code tries).
  - Slice C backend (steps 24-25): punch log face filters, summary counts, Super Admin face
    detail, code-path photo, F-30 face-in-photo check (background), F-41 re-enrol hint.
  - Spec change: new error code `COMPANY_ADDRESS_MISSING` (consent needs the company address).
- Done (2026-10-24, session 2, Anuradha): design gate B mockups (`docs/design-refs/m3/gate-b/`,
  waiting for the lead's final look) and decision 0018: **5 enrolment poses** (straight, left, right,
  up, down), no timer on screen, session is cancelled when the admin leaves the wizard, plus a
  clean-up after **2 hours without activity** (every shot restarts the clock; no "took too long" screen), migration 0014, spec and tests updated. The "Old model" badge, filter and
  panel state stay: the state is computed from the template's stored model id against the running
  model (`buffalo_s`), so it is empty today.
- Done (session 2): gate B approved by the lead; **frontend step 15**: `src/features/face/`
  (face panel, consent dialog with en/mr/hi, 5-shot wizard with retake, duplicate warning, quiet
  restart, cancel on close), `src/lib/face-guide/` (MediaPipe hints + timed fallback), employees
  list Face column + filter, texts, size budgets. Consent text v1 now says "5 pictures".
- Done (session 2): **e2e step 16**: `e2e/tests/face-enrolment.spec.ts` (7 tests: consent, five shots,
  Enrolled; read-only for Corporate Head and Plant Head; Face column and filter; withdraw consent;
  "No, I prefer a QR card"; consent dialog and wizard at 360 px), `app/scripts/e2e_face_video.py`
  (5 poses, 3 s each, 640 x 480 .y4m, test only), `FACE_ENGINE=fake` + a test key in
  `e2e/backend-env.ts`. The test found a real accessibility bug (the scrolling consent text was not
  reachable by keyboard); fixed. Run headed: 7 passed.
- Done (session 2): **design gate A (step 21)** approved by Anuradha: `docs/design-refs/m3/gate-a/` (43 states x 360/768/1280 px, no sideways scroll), decision 0019 (code prefix keys via a new `code_prefixes` field in `/kiosk/me`, amber PLEASE WAIT for the 503 codes, JetBrains Mono for the code).
- Done (session 2): **steps 22 and 23**. Backend: `code_prefixes` (up to 3 common code starts) in
  `/kiosk/me` (decision 0019). Frontend (`src/kiosk/attendance/`): "Punch with face" button (ready /
  starting / not available / hidden), `face-view.tsx` (oval, hints, head-turn arrow, checking),
  `code-pad.tsx` (digits, letters, prefix keys, countdown ring, JetBrains Mono), `use-face-punch.ts`
  (guidance, challenge, pictures, one new challenge by itself, timed fallback without MediaPipe),
  `face-sequence.ts` (pure logic), face results with "Try again" (10 s) and amber PLEASE WAIT, face
  texts, sound and voice. e2e `kiosk-face-punch.spec.ts` (8 tests: IN then ALREADY IN, code pad accepted,
  wrong code twice, head that does not turn + Try again, stranger, hidden button, 360 and 768 px) with
  a browser-painted fake camera (no clip, no real face). Also: Settings texts for the 16 face settings
  (the raw keys made the Settings page too wide on a phone), `E2E_PAIRING_LIMIT` (test server only,
  production stays 10 per 10 minutes), the sideways-scroll check no longer fails on a headed
  browser's scrollbar.
- Done (session 2): **design gate C (step 26)** approved (decision 0020, `docs/design-refs/m3/gate-c/`) and
  **step 27** built: backend `report_value` + `is_text` on settings, `followed_by_punch_id` on the punch
  log, `face_state` in quick search, public `GET /privacy-notice`, the gate poster with the face punch
  (`poster_pdf.py`, new `head-turn.svg`); frontend: Settings with five face sub-groups, report values,
  "Use" button, lowered-threshold warning, floor rule and the Privacy card (text settings); public
  `/privacy` page; dashboard card "Face enrolment"; Ctrl+K "Enrol face…", "Employees not enrolled",
  "Re-enrol suggested" (`?face=enrol` and `?face_state=` deep links); punch log with Method column,
  merged "Result and reason", "Asked for code" and "No face in photo" chips, Method filter, Details side
  sheet (scores only for the Super Admin); `punchReasons` texts for the face codes. e2e
  `admin-face.spec.ts` (6 tests) and `/privacy` in `responsive.spec.ts`.
- Done (session 3): **step 28, the tool**: `app/scripts/face_accuracy.py` (S-32) with
  `tests/test_face_accuracy.py` (fake engine, painted pictures). It refuses a data folder inside the
  repo, writes only numbers between markers in `docs/reports/M3-face-accuracy.md` (sections 2 and 3),
  measures FAR / FRR / code path / 1:1 code false accepts / threshold curve with 95 % upper bounds over
  galleries of 60, and APCER / BPCER for MiniFASNet V2, V1SE and both. The 1:N rule moved into
  `matcher.decide_match` so the tool uses the server's rule.
  **Step 28 runs for Tushar** (real faces, laptop with the models):
  1. `uv run python scripts/download_models.py`.
  2. Written consent of each team member; take about 5 enrolment-like + 5 gate-like pictures each
     (640 × 480, the gate device) into `D:/face-data/team/<any folder per person>/` (outside the repo).
  3. Download LFW by hand (official LFW page, research use) and unzip to `D:/face-data/lfw/`.
  4. `uv run python -m app.scripts.face_accuracy --faces D:/face-data/team --faces D:/face-data/lfw`
     (about 5 000 stranger attempts are needed before the 95 % bound can show < 0.1 %).
  5. Spoof set at each gate device: `D:/face-data/spoof/real/` and `attack/` (printed photo, phone
     screen, laptop screen), then `... face_accuracy --spoof D:/face-data/spoof`.
  6. Put the suggested values into `report_value` (and if the team agrees `default`) in
     `settings/definitions.py`; commit the report (numbers only). Delete the face data when done.
- Next: slice D: 29 (CI memory check), 30 (coverage floor 75 to 80), 31 (docs), 33 (reviews). Then
  Tushar: the step 28 runs above, step 32 (FACE_TEMPLATE_KEY on Render), CLAUDE.md approval, the PR.
- Notes for slice D and for Tushar: `report_value` of each setting (`settings/definitions.py`) is empty
  until the accuracy report fills it. The plan's "Gate C" settings screen shows "No report yet" until
  then. The Settings page, the punch log and the dashboard card have no real-people check yet.
  `qr-cards-bulk.test.tsx` "refuses more than 200 cards" failed once under load in a full run and
  passed alone (a timing flake, not related to M3).
- Reminders for slice D (real people, Tushar): the head-turn timing in `face-sequence.ts` uses a rough
  0.0175 turn per degree (MediaPipe to degrees) and the turn sign must be checked with real frames;
  nobody has tried the gate or the wizard with a real webcam or a phone yet (hints, 1-second hold,
  sunlight reading of the code pad). For the CLAUDE.md update: new variable `E2E_PAIRING_LIMIT`
  (honoured only when `APP_ENV=test`), new dependency `@fontsource/jetbrains-mono` (OFL, code pad).
- Test results (2026-10-24, after step 27): backend 942 passed, 7 skipped (coverage 90.3%); frontend
  499 passed, lint + typecheck + i18n:check + build size budgets green; e2e (headed): the whole suite,
  57 tests, passed in one run (10 minutes).
- Open questions: none blocking. Reminders: `buffalo_s` accuracy (NFR-05) is measured in slice D;
  the head-turn sign (+ = the person's own left) must be confirmed with real team frames in slice
  D; the CelebA-Spoof candidate has no stable ONNX link yet; `FACE_TEMPLATE_KEY` must be set on
  Render before the merge (step 32). For the client before the first real enrolment: grievance
  officer, consent-record years, processor agreements, Marathi / Hindi text check (decision 0017).
