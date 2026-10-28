# M4 – Anti-proxy engine, location on every punch and offline gate sync: Implementation Plan

Status: Approved by Tushar Gawande (lead) on 2026-10-28 · Spec: docs/specs/M4-anti-proxy-offline.md (Approved 2026-10-28) ·
Decision: 0025 · Branch: `milestone/M4-anti-proxy-offline` · Saved after approval as
`docs/plans/M4-anti-proxy-offline-plan.md`.

## Context
M2 and M3 are live: signed gate requests (nonce + growing counter), card and face rules, cool-down,
IN/OUT. Three gaps remain (spec §1): a paired phone or PC taken home still punches (location is checked
only at pairing); the engine can only accept or reject (no "flagged"); no internet = no attendance.
M4 closes them: location on every punch, a FLAG outcome with edge / impossible-travel / two-device
rules, an offline queue with sealed evidence, a server time anchor and a signed sync, attendance device
status (heartbeat), and a Super Admin "Needs review" screen. Approved extras: F-3, F-36, F-46, F-48,
F-53, F-54, F-55, S-38.

Choices for this plan (lead, 2026-10-28, in chat):
- **Slice order:** A location + flags → B offline (the riskiest part, done early) → C device status →
  D review screen → E wrap-up.
- **Design gates: HTML mockup screenshots** (as M2/M3), made by ui-designer from our design system at
  360 / 768 / 1280 px. Gate A (all gate screens: location, offline, saved, warnings) before slice A's
  frontend; Gate C (devices page, badge, alert, health, readiness, dashboard, settings) before slice C's
  frontend; Gate B ("Needs review") before slice D's frontend. Code for a gate's screens starts only
  after the lead's OK.

Every step is one small Conventional Commit, with no Claude co-author or "Generated with" lines. Each
slice ends with commit + push and an update of the Status section (handoff rule). Every new file
starts with a one-line purpose comment.

**Model per phase (asked again before each slice):** slices A and B and the security review in E =
Opus + high effort (rules, constraints, crypto, time proof; a mistake opens a proxy path). Slices C
and D and the docs in E = Sonnet + medium (routine endpoints and screens on known patterns). A fresh
session at the start of each slice keeps usage low: the plan's Status section is the handoff.

## Cross-cutting decisions
- **Engine (`app/antiproxy/`):** `Outcome.FLAG` + `RuleResult.flagged(code)`; `EngineDecision` gets
  `flag_codes`; a rule never rejects silently (the existing guard stays). Decision mapping in one place:
  reject → `rejected` (rejection code first, then the flags collected before it); flags only →
  `flagged`; else `accepted`. `punch_answer` maps `flagged` → `"accepted"` for the gate.
- **One "what counts" function:** `app/modules/punches/counting.py` `counted_punches(...)`, used by
  `check_in_out`, the flag rules, the punch log review state and (later) M5. `punch_reviews` (migration
  0016) is created in slice A so this function is complete from day one; the review endpoints come in
  slice D.
- **Punch time:** stored generated column `punch_time`; every rule receives "now" = the punch time
  (`PunchContext.now` keeps its meaning: online = server time, offline = proven time).
- **Shared location check:** `_check_location` (`app/modules/kiosks/service.py`) moves into
  `app/modules/kiosks/location_check.py` returning a verdict (code, distance, fence version), used by
  pairing (raises as today) and by the new rule `rules/kiosk_location.py` (reject / flag / pass).
  Reuses `distance_to_geofence_m` and `current_geofence` / `geofence_versions`
  (`app/modules/org/geofence.py`, `geofence_service.py`).
- **Card and face punch cores:** `record_kiosk_punch` and `record_face_punch` are split into a
  "decide" part (rules → row) and a "store" part (insert, snapshot, race handling), so the sync service
  reuses both with an offline context (punch time, location age, time proof, device counter). No
  copy of the rule chain.
- **Face work during sync:** `FaceEngine.try_run` (already exists, `app/face/engine.py`) runs a sync
  face item only when the worker is free; otherwise the item answers `retry_later`. This gives "live
  punches first" without a new queue.
- **Crypto:** `app/core/offline_crypto.py`: load the P-256 private key (PKCS#8 base64url), derive the
  public key, open sealed evidence (ECDH + HKDF-SHA256 + AES-256-GCM with the spec's associated data).
  `app/modules/kiosks/time_anchor.py`: HMAC-SHA256 anchor with a key derived from `APP_SECRET_KEY`
  (label `offline-time-anchor-v1`). Both use the `cryptography` package already installed. One shared
  test vector file `frontend/src/kiosk/offline/test-vector.json` (fixed keys) is read by Vitest and by
  pytest, so the browser and server formats cannot drift.
- **Config:** `offline_evidence_key` (required in production, same "Missing required setting" pattern,
  value never printed), `offline_evidence_key_id` (default `A`). Without the key in development:
  `kiosk_settings.offline.enabled = false` and `/kiosk/sync` → `OFFLINE_NOT_CONFIGURED`.
- **Roles:** `REVIEW_PUNCHES` (Super Admin) and `VIEW_KIOSK_STATUS` (three roles, scoped) in
  `app/modules/auth/permissions.py`; queries use the existing plant scope helpers.
- **Audit:** `record_audit` in the same transaction: `punch_review.*`, `kiosk.sync` (counts only),
  `kiosk.sync_item_refused` (no item text).
- **Never logged:** signed item text, ciphertext, evidence, card text, codes, frames, anchor tokens,
  keys (AC-32 log-scrub test extends the M3 one).
- **Texts:** every code of spec §7 rule 18 in `frontend/public/locales/en/common.json`
  (`kiosk.punch.<CODE>.*`, `punchReasons.<CODE>` + `_help`, `errors.<CODE>`, `kiosk.location.*`,
  `kiosk.offline.*`, `kiosks.*`, `review.*`); `npm run i18n:check` green; "attendance device" in every
  people-facing text.
- **Frontend layout:** gate code in `src/kiosk/` (new `location/` and `offline/` folders); admin in
  `src/features/review/` and the existing `features/kiosks`, `punches`, `settings`, `admin`. The admin's
  first load stays free of gate and service-worker code (`npm run size`).
- **Settings:** `CURRENT_MILESTONE = 4`; the keys of spec §7 rule 17 as `SettingDefinition`s in
  `app/modules/settings/definitions.py`; the two cross-checks in `settings/service.py`
  (`SETTING_INVALID`).

## Build steps

### 0. Plan doc – `docs:`
Save this plan as `docs/plans/M4-anti-proxy-offline-plan.md` (Status: Approved) with a Status
section at the bottom; commit + push.

### Slice A – Location on every punch and flag rules (Opus, high)
1. **Design gate A** (ui-designer): all gate screens of spec §4.1–§4.6 (location chip, needs-location
   screen with the F-53 sketch, offline banner, saved / already saved / not saved, queue warnings,
   offline face code pad first, revoked with queue). Screenshots to the lead; links into spec §4;
   decision line in docs/decisions/.
2. `refactor(kiosks):` move the pairing location check into `kiosks/location_check.py` (verdict object);
   pairing behaviour unchanged (existing pairing tests stay green).
3. `feat(db):` migration `0015_punch_time_flags_and_offline` (new `punches` columns, generated
   `punch_time`, changed / new checks, partial unique `(kiosk_id, device_counter)`, index swap,
   snapshot reason `face_offline`) and `0016_punch_reviews` (append-only trigger with
   `SET search_path = ''`, RLS + deny_all). Models updated; migration tests: constraints, trigger still
   refuses UPDATE / DELETE, RLS test lists the new table (AC-5).
4. `feat(antiproxy):` FLAG outcome, `counted_punches`, `check_in_out` on punch time with *last* / *next*
   (offline `COOLDOWN_ACTIVE` and `SYNC_ORDER_CONFLICT` ready for slice B), decision mapping,
   `punch_answer` flagged → accepted.
5. `feat(antiproxy):` rules `kiosk_location.py` (reject / `LOCATION_AT_EDGE` / `LOCATION_STALE` for
   offline items), `impossible_travel.py`, `two_devices.py`; new rule order for card and face punches;
   the M3 code path reuses the location verdict of its `needs_code` row; self-test answers carry
   `details.location_check`.
6. `feat(settings):` M4 keys, ranges, groups, cross-checks; `CURRENT_MILESTONE = 4`.
7. `feat(kiosks):` `/kiosk/me` gains `kiosk_settings.location` (limit, max age, refresh, current fence).
8. `feat(kiosk):` gate location: `src/kiosk/location/` (`watch-location.ts`: watchPosition + refresh
   timer, states good / weak / none / denied / outside; `fence-distance.ts`: distance to the fence on
   the device, a small own function using the M1 projection maths, or the already installed Turf
   modules if they cover it; `fence-sketch.tsx`: F-53 plain SVG); location chip; needs-location
   screen; every punch sends `location` + `age_s`; texts.
9. `test:` pytest for the rules and decision mapping (AC-1–AC-7), Vitest for the watcher, distance and
   screen, e2e `kiosk-location.spec.ts` (Playwright geolocation: inside → punches; outside / weak →
   paused; edge → accepted and flagged in the punch log).
10. Slice end: commit, push, Status.

### Slice B – Offline queue, time anchor, sealed evidence, sync (Opus, high)
11. `feat(core):` `offline_evidence_key` config, `app/scripts/make_offline_key.py`,
    `app/core/offline_crypto.py`, `.env.example`; shared test vector + pytest (AC-31, AC-13).
12. `feat(kiosks):` `time_anchor` on every signed kiosk response (`/kiosk/me`, `/punch/kiosk`,
    `/punch/kiosk/code`, `/punch/challenge`, heartbeat and sync later); `kiosk_settings.offline` in
    `/kiosk/me` (public key, limits, enabled).
13. `feat(antiproxy):` `offline_time.py` (pure time-proof function + flags `OFFLINE_TIME_UNPROVEN`,
    `OFFLINE_TOO_OLD`), `offline_challenge.py`, `offline_code_match.py` (1:1 to the typed code, any
    plant, `WRONG_PLANT` / `FACE_NOT_RECOGNISED`); card, employee and plant facts judged at the punch
    time when anchored (plant history from M1 F-20).
14. `feat(punches):` `POST /kiosk/sync` (`sync_service.py`, `sync_router.py`): request signature as M1,
    per-item signature over `UPS-OFFLINE-1…`, parse, `already_saved`, counter checks, decrypt
    (`OFFLINE_EVIDENCE_UNREADABLE` row), sort by punch time, decide through the shared card / face
    cores, `try_run` for face items, 20 s budget → `retry_later`, body limit 1 MB, 30 requests a minute,
    audit `kiosk.sync` / `kiosk.sync_item_refused`, `face_offline` photo.
15. `feat(kiosk):` gate offline core `src/kiosk/offline/`: `sealer.ts` (WebCrypto ECDH + HKDF +
    AES-GCM, ephemeral non-extractable key), `time-anchor.ts`, `queue-store.ts` (Dexie version 2
    `queue` table + `device.anchor`, one transaction with the counter), `offline-mode.ts` (spec §7 rule 9
    detection), `sync-runner.ts` (batches of 20 / 1 MB, pauses during a punch, deletes on
    saved / already_saved / refused), storage self-check (S-38: `persist()` + `estimate()`).
16. `feat(kiosk):` offline screens: offline card punch (same steps, "already saved" in memory),
    offline face punch (code pad first, device-chosen challenge via `crypto.getRandomValues`), "Saved –
    will be confirmed", queue full / almost full, revoked with a queue (count shown, queue deleted),
    F-55 last-sync footer line, offline clock from the anchor; privacy footer sentence.
17. `build(frontend):` vite-plugin-pwa (MIT) + Workbox: service worker registered only by the gate,
    scope `/attendance`, precache the gate shell, runtime cache for MediaPipe files, `/api/*` and
    `/version.json` network only, manifest "Gate attendance"; size check keeps it out of the admin
    load. **First check that vite-plugin-pwa supports Vite 8**; if not, stop and ask the lead
    (fallback: a small hand-written service worker, no dependency).
18. `test:` pytest sync (AC-10–AC-18, AC-36), Vitest sealer (shared vector), queue, time anchor,
    offline mode, sync runner; e2e `kiosk-offline.spec.ts` (`context.setOffline`, Playwright clock moved
    1 hour, reload offline → page loads (AC-21), reconnect → punch log correct); headed run for the lead.
19. Slice end: commit, push, Status. **Tushar (outward):** create the live `OFFLINE_EVIDENCE_KEY` with
    `make_offline_key`, keep it in the password manager; it goes into Render before the merge (step 34).

### Slice C – Attendance device status and health (Sonnet, medium)
20. **Design gate C** (ui-designer): devices page status and columns, drawer with F-3 health and 7-day
    timeline, revoke-dialog warning, F-36 badge, F-46 banner, readiness lines, dashboard cards, settings
    cards. Lead's OK, links into spec §4, decision line.
21. `feat(db):` migrations `0017_kiosk_status` (device columns) and `0018_kiosk_heartbeats` (RLS +
    deny_all); daily job purges heartbeats older than 7 days (`app/jobs/daily.py`).
22. `feat(kiosks):` `POST /kiosk/heartbeat` (same body as `/kiosk/me`, sample row at most every 5 min
    or on a state change, 6 a minute), `last_punch_at` / `last_sync_at` updates, state computed on read
    (`kiosks/status.py`), list fields and `state` filter, `/kiosks/status-summary` (F-36, F-46 alerts in
    shift time), `/kiosks/{id}/health` (F-3 timeline), readiness lines; `VIEW_KIOSK_STATUS`.
23. `feat(kiosk):` gate heartbeat becomes POST with queue, location state, storage, battery, camera;
    404 fallback to `GET /kiosk/me` (spec §7 rule 19).
24. `feat(admin):` devices page status, columns, filter, drawer with health timeline (Recharts or plain
    bars), map of last position (Super Admin and own Plant Head), revoke warning, top-bar badge, sidebar
    count, offline alert banner ("Hide" per device in local storage), readiness lines.
25. `test:` pytest (AC-20, AC-22, AC-23, AC-37, AC-38, AC-41, AC-44), Vitest, e2e devices page and badge;
    responsive list updated. Slice end: commit, push, Status.

### Slice D – "Needs review", punch log, dashboard, settings (Sonnet, medium)
26. **Design gate B** (ui-designer): review list tabs and filters, detail panel (time proof, map, photo,
    related punch side by side, history, F-54 hints), confirm / not accepted / approve dialogs, empty
    states, phone layout. Lead's OK, links, decision line.
27. `feat(punches):` review endpoints (`/reviews`, `/reviews/summary`, `/reviews/digest` (F-48),
    `/punches/{id}/review-context` with related punches, suggestion, nearby counted punches and F-54
    hints, `POST /punches/{id}/reviews` with `expected_latest_review_id` → `REVIEW_CHANGED`), audit,
    `REVIEW_PUNCHES`; punch log / summary / detail / export additions (punch time, offline, flags, review
    state; read-only text for the Corporate Head and Plant Head).
28. `feat(admin):` `/admin/review` page (`src/features/review/`): tabs, filters, list, detail sheet, map
    (reuse the M1 geofence map component, lazy), side-by-side, dialogs, next row after an action,
    sidebar entry with count, Ctrl+K entries; punch log marks and filters; dashboard cards (to check,
    devices, F-48 digest); settings cards "Location and anti-proxy" and "Offline attendance devices"
    with the MIDC Waluj warning; gate poster texts (F-34).
29. `test:` pytest (AC-24–AC-30, AC-42, AC-43), Vitest, e2e `admin-review.spec.ts`; `/admin/review` in
    `e2e/tests/responsive.spec.ts`. Slice end: commit, push, Status.

### Slice E – Security, docs, reviews, ship
30. `test(security):` AC-34 attack tests in pytest (unknown key, outside position, replayed request,
    replayed / edited / re-signed item, forged anchor, another kiosk's item, revoked device, ciphertext
    moved), AC-32 log scrub, AC-35 coverage floor 82% (`backend/pyproject.toml`,
    `frontend/vite.config.ts`). (Opus, high)
31. `docs:` spec §15 changes: SRS, architecture, M2 spec note, `docs/guides/kiosk-setup.md`,
    `deploy/README.md` + `render.yaml` (`OFFLINE_EVIDENCE_KEY`), README; decision lines. (Sonnet)
32. **/review-milestone:** security-reviewer (Opus, high: sync, sealing, time proof, location rule),
    compliance-auditor (offline evidence on the device, DPDP), code-quality-reviewer, i18n-reviewer,
    test-engineer. Fixes and open points go into a decision file; open points are asked in chat.
33. **CLAUDE.md diff** (roadmap tick, `make_offline_key`, `OFFLINE_EVIDENCE_KEY`, vite-plugin-pwa,
    review screen and flags, heartbeats kept 7 days, coverage 82%) shown to the lead before commit.
34. **Tushar (outward):** set `OFFLINE_EVIDENCE_KEY` on Render; plan the deploy outside shift change;
    after the merge open each gate once (spec §7 rule 19). Real-device check: a gate phone and a gate
    PC, location good / outside, one hour offline with card and face punches, then sync (AC-10 on the
    live site, demo scenarios 3 and 5).
35. `/ship`: push, open the PR (no Claude lines), stop. After the lead says "merged": check the PR
    state with gh, switch to main, pull `--ff-only`, prune, delete the local branch.

## Files (main ones)
- Backend new: `app/antiproxy/rules/{kiosk_location,impossible_travel,two_devices,offline_time,
  offline_challenge,offline_code_match}.py`, `app/modules/punches/{counting,sync_service,sync_router,
  review_service,review_router}.py`, `app/modules/kiosks/{location_check,time_anchor,status,
  heartbeat_service}.py`, `app/core/offline_crypto.py`, `app/scripts/make_offline_key.py`, migrations
  `0015`–`0018`.
- Backend changed: `app/antiproxy/{context,engine}.py`, `rules/cooldown.py`,
  `app/modules/punches/{models,service,face_service,schemas,presenter,queries,admin_router,answers}.py`,
  `app/modules/kiosks/{service,router,schemas,models,dependencies}.py`, `app/core/{config,body_limit}.py`,
  `app/modules/settings/{definitions,service}.py`, `app/modules/auth/permissions.py`, `app/jobs/daily.py`.
- Frontend new: `src/kiosk/location/*`, `src/kiosk/offline/*` (+ `test-vector.json`),
  `src/features/review/*`, service worker config in `vite.config.ts`.
- Frontend changed: `src/kiosk/attendance/{use-attendance,use-face-punch,punch-client,use-heartbeat,
  top-bar,result-view,scanning-view}.ts(x)`, `src/kiosk/device-store.ts`, `src/features/{kiosks,
  punches,settings,admin,search}/*`, `public/locales/en/common.json`, `size-budgets.json`.
- e2e: `kiosk-location.spec.ts`, `kiosk-offline.spec.ts`, `admin-review.spec.ts`,
  `responsive.spec.ts`.

## Reused code
`require_kiosk` + `kiosks/crypto.verify_signature` (item signatures use the same key),
`takeNextCounter` / `signRequest` (`src/kiosk/signer.ts`, `device-store.ts`), `distance_to_geofence_m`,
`geofence_versions`, `FaceEngine.try_run`, `run_face_rules` and the M3 face rules, `punch_answer`,
`_store_snapshot` / snapshot encryption (`app/core/crypto.py`), `record_audit`, `ApiError`, the M3 code
pad and face view, the M1 geofence map, the punch log table and side sheet, M2 self-update (S-27),
settings page cards, `fake-indexeddb` in tests, the `FACE_ENGINE=fake` engine.

## Dependencies
| Package | Licence | Reason |
|---|---|---|
| vite-plugin-pwa (dev) + its Workbox packages | MIT | Gate page loads offline (spec §7 rule 13); planned in ADR 0001 |
| (no new backend package) | – | `cryptography` already has ECDH, HKDF, AES-GCM, HMAC |
Turf modules only if already installed; otherwise a small own distance function (no new package).

## Verification
| AC | Covered by |
|---|---|
| AC-1–AC-4, AC-36 | pytest `test_rule_kiosk_location.py`, punch API tests; e2e `kiosk-location.spec.ts` (Playwright geolocation) |
| AC-5 | migration + constraint tests, `test_row_level_security.py` |
| AC-6, AC-7 | pytest travel and two-device rules (online and offline) |
| AC-8, AC-9, AC-19, AC-21, AC-39, AC-44 | Vitest offline flows; e2e `kiosk-offline.spec.ts` (offline, clock +1 h, reload offline) |
| AC-10–AC-18 | pytest `test_kiosk_sync.py` (batch, already_saved, replay, edited / re-signed items, moved ciphertext, time proof, order conflict, judged at punch time, offline face 1:1, live-first with a busy fake worker) + e2e sync check |
| AC-20, AC-22, AC-23, AC-37, AC-38, AC-41 | pytest heartbeat / status / health / summary; Vitest devices page; e2e badge |
| AC-24–AC-29, AC-42, AC-43 | pytest review endpoints and digest / hints; e2e `admin-review.spec.ts`; FORBIDDEN tests for the other roles |
| AC-30 | pytest settings ranges and cross-checks; Vitest settings cards |
| AC-31 | pytest config (production without the key stops, value never printed) |
| AC-32 | log-scrub test over sync, heartbeat and review traffic |
| AC-33, AC-40 | `npm run i18n:check`, "no kiosk in gate texts" test, Vitest sketch |
| AC-34 | pytest attack suite (step 30) + security-reviewer against the deployed site |
| AC-35 | CI coverage 82%, `responsive.spec.ts` |
Commands each slice: backend `uv run pytest`, `uv run ruff check . && uv run ruff format .`,
`uv run pyright`; frontend `npm test`, `npm run lint`, `npm run typecheck`, `npm run i18n:check`,
`npm run build && npm run size`; e2e `npx playwright test --headed` (not at the same time as the other
suites). Manual: step 34 real-device check on the live site.

## Status
- Done: spec approved (2026-10-28), decision 0025, accepted extras logged, plan written.
- Done: step 0 (plan saved, 2026-10-28).
- Done (2026-10-28): slice A step 1, design gate A approved (decision 0026; mockups
  `docs/design-refs/m4/gate-a/`). Note for step 8: the online M3 code pad also gets the prefix-key row.
- Done: step 2 `kiosks/location_check.py` (`check_location`, `geofence_at`, `LocationVerdict`;
  pairing unchanged). Step 3 migrations 0015 + 0016, models (`Punch` M4 columns, generated
  `punch_time`, `PunchReview`, `ReviewAction`, snapshot reason `face_offline`), tests
  `tests/test_m4_punch_tables.py` (AC-5). The test found that `length(trim(NULL)) >= 3` passes a
  CHECK: `reason_required` now also says `reason IS NOT NULL`.
- Done (2026-10-28): **slice A complete** (steps 4-9).
  - Engine: `Outcome.FLAG`, `run_rules` collects flags (rejection code first, then flags), decision
    `flagged` counts and answers "accepted" at the gate. `punches/counting.py` = what counts (accepted,
    flagged unless "not accepted", rejected only when approved). `check_in_out` uses `punch_time`
    (offline: next punch within cool-down -> COOLDOWN_ACTIVE, else SYNC_ORDER_CONFLICT flag).
  - Rules: `kiosk_location.py` (location + LOCATION_STALE offline), `impossible_travel.py`,
    `two_devices.py` (shared `antiproxy/nearby_punches.py`); QR order read_card -> location -> photo ->
    card -> IN/OUT -> travel -> two devices; a test card skips location and reports
    `details.location_check`. Face: location before the face worker, IN/OUT + flags after; the code
    path reuses the place and LOCATION_* flags of its needs_code row.
  - Settings: 13 M4 keys (groups `antiproxy`, `offline`, `kiosk`), two order cross-checks,
    `CURRENT_MILESTONE = 4`. `/kiosk/me` sends `kiosk_settings.location` (limits + current fence).
  - Tools: `app/scripts/gate_fence_fixture.py` gives tests, the CI memory check and Locust a fence
    and a matching location.
  - Gate: `src/kiosk/location/` (`gate-location.ts` watcher + pure `judgeLocation`,
    `fence-distance.ts`, `fence-sketch.tsx` F-53, `needs-location.tsx` chip + screen); scanning and
    the face button wait for a usable reading; every punch sends `location` with `age_s`; self-test
    shows Location ✓/✗. Gate size budget 57,000 -> 61,000 bytes (decision 0026 item 7).
  - Tests: `test_m4_location_and_flags.py` (20), face location tests (3), `gate-location.test.ts`,
    `needs-location.test.tsx`, gate screen location tests, e2e `kiosk-location.spec.ts` (2).
- Done (2026-10-28/29): **slice B complete** (steps 11-18).
  - Server: `OFFLINE_EVIDENCE_KEY` (+ `_KEY_ID`) in config, `make_offline_key`, `core/offline_crypto.py`
    (ECDH P-256 + HKDF + AES-GCM, bound to kiosk|punch|method|key id), `kiosks/time_anchor.py` (HMAC,
    on every signed answer), `punches/offline_time.py` (proven vs unproven time), rules
    `offline_time.py` / `offline_face.py`, `facts_at_time.py` (card and employee judged at the punch
    time), `POST /kiosk/sync` (`sync_service.py`, `offline_face_service.py`, `sync_schemas.py`; 20 items,
    1 MB, 30 requests a minute, 20 s budget, per-item results), `/kiosk/me` sends
    `kiosk_settings.offline` (public key, limits, `challenge_steps`).
  - Gate: `src/kiosk/offline/` (`sealer`, `time-anchor`, `offline-queue`, `sync-runner`, `use-offline`
    with the S-38 storage check, `register-sw`, shared `test-vector.json`), Dexie version 2 `queue`,
    offline card punch (saved with the SAME id after a failed send), offline face punch (code pad
    first, device-chosen turn, switches by itself when the internet goes during the punch), SAVED
    screen (slate blue), queue chip, F-55 last-sync line, phone privacy fold, service worker
    (vite-plugin-pwa 2.0.0, MIT; scope /attendance; `scripts/check-service-worker.mjs` in `npm run
    size`; `Service-Worker-Allowed` header in vercel.json). Gate size budget 65,000 bytes.
  - Tests: sync 23 + face sync 9 + crypto/time 14 + spoof attempts (AC-34) 7 + shared vector on both
    sides; Vitest offline 24 + screens; e2e `kiosk-offline.spec.ts` (network cut in a real browser).
  - Known gaps: AC-21 (reload while offline) needs a production build with the service worker: it is
    covered by the build check and left for the real-device check (step 34). The revoked screen does
    not show "N saved punches could not be sent" yet (the queue IS deleted); the revoked-with-queue
    text and the "storage almost full" warning line are texts only so far.
  - Outward (Tushar): make the live `OFFLINE_EVIDENCE_KEY` with
    `uv run python -m app.scripts.make_offline_key`, keep it in the password manager, set it on Render
    before the merge. Without it the live backend will not start (production requires it).
- Done (2026-10-29): **slice C complete**: migrations 0017/0018, `POST /kiosk/heartbeat` (+ GET /kiosk/me
  fallback in the gate), `kiosks/status.py` (state computed on read), `status_service.py`,
  `GET /kiosks` new fields + `state` filter, `/kiosks/status-summary`, `/kiosks/{id}/health`,
  readiness `device_online` / `location_good`, `last_punch_at` / `last_sync_at`, 7-day heartbeat purge
  in the daily job; admin: state badges, drawer with health timeline, revoke warning, offline badge,
  alert banner, readiness lines, dashboard devices card. Design gates A, B, C mockups are in
  `docs/design-refs/m4/gate-{a,b,c}/` (not yet formally approved by the lead; build followed them).
  Gap: no map in the device drawer yet.
- IN PROGRESS (slice D, backend only, NOT TESTED, may not run): `punches/counting.py` got
  `latest_reviews` + `review_state`; `punches/queries.py` got filters `flagged` / `was_offline` /
  `review_state`, day = `punch_time`, summary counts flagged as IN/OUT and adds `flagged`, `offline`,
  `to_check`. Run `uv run ruff check . && uv run pyright && uv run pytest` first and fix.
- Next (slice D, steps 26-29): (1) finish punch log: add `punch_time`, `was_offline`, `review_state`,
  `review_direction`, `time_proof` etc. to `PunchLogItem` / `PunchDetail` (schemas.py, presenter.py),
  query params in `admin_router.punch_filters` (`flagged`, `was_offline`, `review_state`; decision may be
  "flagged"), summary fields, Excel columns (Punch time, Saved offline, Flags, Review); (2) review
  endpoints: capability `REVIEW_PUNCHES` (Super Admin), `GET /reviews`, `/reviews/summary`,
  `/reviews/digest` (F-48), `GET /punches/{id}/review-context` (related punches, suggestion, nearby
  counted, history, F-54 hints), `POST /punches/{id}/reviews` (confirm / not_accepted / approve,
  `expected_latest_review_id` -> REVIEW_CHANGED, audit `punch_review.*`), spec section 5.3 and 7 rules 6, 7,
  20; (3) frontend `/admin/review` page per the gate B mockups, punch log marks and filters (gate C
  03-punch-log), dashboard "To check" and digest cards, sidebar entry + Ctrl+K; (4) tests (AC-24 to
  AC-30, AC-42, AC-43), e2e `admin-review.spec.ts`, add `/admin/review` to `e2e/tests/responsive.spec.ts`.
  Then slice E (steps 30-35): coverage floor 82%, docs (spec section 15; fix the spec example "2.4 km in
  3 min = 48 km/h" which is under the 60 limit), `/review-milestone`, CLAUDE.md diff for the lead, then
  `/ship`. Outward steps for Tushar: make `OFFLINE_EVIDENCE_KEY` (`uv run python -m
  app.scripts.make_offline_key`), set it on Render before the merge; real-device checks (step 34).
- Local setup: start Docker Desktop, `docker compose up -d`, `cd backend && uv run alembic upgrade head`.
- Open questions: none.
