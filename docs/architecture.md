# Upasthiti – Architecture

Status: Approved (Part B planning, 2026-10-11; updated 2026-10-12 with the client's answers,
decision 0004: phone punching in M4b, three roles, free tiers stay unless they are not enough). Stack details: docs/decisions/0001-tech-stack.md.
Hosting: docs/decisions/0002-hosting.md. Requirements: docs/SRS.md.

## 1. Big picture

```
 Plant gate                                   Office / HR
┌──────────────────────────┐               ┌──────────────────────────┐
│ Kiosk tablet (browser)   │               │ Admin browser            │
│  /kiosk                  │               │  /admin                  │
│  camera · MediaPipe UX   │               │  dashboard · setup ·     │
│  QR scan · offline queue │               │  reports · audit         │
│  device key (P-256)      │               └────────────┬─────────────┘
└────────────┬─────────────┘                            │ session cookie
             │ signed requests (HTTPS)                  │ (HttpOnly)
             ▼                                          ▼
      ┌───────────────────────────────────────────────────────┐
      │ Same origin: Vercel serves the SPA, rewrites /api/* → │
      │ backend on Render                                     │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
      ┌───────────────────────────────────────────────────────┐
      │ FastAPI backend (Python 3.12) – one deployable app    │
      │  auth · org · kiosks · employees · enrolment · qr     │
      │  punch → antiproxy engine → face pipeline             │
      │  attendance · dashboard (SSE) · reports · audit       │
      │  settings · salary (M7) · jobs (APScheduler)          │
      └───────────────┬───────────────────────┬───────────────┘
                      ▼                       ▼
            PostgreSQL (Supabase)      File storage for QR snapshots
                                       (Supabase Storage)
```

Principles:
- **The server decides.** The kiosk only collects evidence: frames, QR payload, GPS,
  device time, signature.
- **One backend app, split into modules.** Students deploy and debug one thing.
- **Same origin for the SPA and the API.** Plain cookies, no CORS headaches.
- **Everything is configured through `.env`.** The app can move to another host if ever
  needed.

## 2. Kiosk registration (pairing)
1. HR/plant admin creates a kiosk → `POST /api/v1/kiosks` → server returns a 6-digit
   one-time pairing code (stored hashed, valid 10 minutes, single use).
2. On the tablet, open `/kiosk`. The page:
   - generates an ECDSA P-256 key pair with WebCrypto (`extractable: false`, stored in
     IndexedDB);
   - asks for camera and location permission;
   - sends `POST /api/v1/kiosk/register` with the code, the public key (SPKI), and its GPS
     position and accuracy.
3. The server checks:
   - the code is valid and unused;
   - the GPS accuracy is within the limit;
   - the position is inside the plant geofence;
   - the IP is in the plant allow-list (if one is set).

   It then stores the public key and marks the kiosk active. The admin's screen updates.
4. **Every later kiosk request** carries `X-Kiosk-Id`, `X-Kiosk-Nonce` and `X-Kiosk-Signature`.
   The signature covers the method, path, body hash, nonce and device counter. The server
   verifies it, rejects reused nonces, and can revoke the kiosk at any time.

## 3. QR punch (temporary workers)
1. The kiosk camera sees a card. `barcode-detector` reads the payload:
   `UPS1.<card_id>.<valid_until>.<ed25519_signature>`.
2. The kiosk takes a 320 px JPEG snapshot and sends a signed `POST /api/v1/punch/kiosk`
   containing `{method: "qr", qr_payload, snapshot, gps, device_time, nonce, counter}`.
3. The anti-proxy engine runs its rules in order. Each rule returns pass or a reason code:
   1. `DEVICE_SIGNATURE_INVALID` / `NONCE_REUSED` / `DEVICE_REVOKED`
   2. `NETWORK_NOT_ALLOWED` (plant IP allow-list)
   3. `GPS_ACCURACY_TOO_LOW` / `OUTSIDE_GEOFENCE`
   4. `QR_SIGNATURE_INVALID` / `QR_EXPIRED` / `QR_REVOKED` / `EMPLOYEE_INACTIVE`
   5. `COOLDOWN_ACTIVE` (server clock)
   6. `IMPOSSIBLE_TRAVEL` (last punch at another plant too recently for the distance)
4. The server decides IN or OUT from the employee's last accepted punch and shift. It then
   writes:
   - the `punches` row: accepted, rejected or flagged, plus the reason codes;
   - the `punch_snapshots` row, which expires 60 days later (a setting);
   - the audit entry.
5. The response goes back: `{result, direction, employee_display_name, server_time, message_key}`.
   The kiosk shows the result screen. Rejections show a simple worker-safe message; the
   detailed reason is visible only to HR.

## 4. Face punch (permanent staff)
1. The kiosk detects a face locally with MediaPipe and calls `POST /api/v1/punch/challenge`.
   The server returns a nonce (10 s life, single use) and a random challenge: blink and/or
   a head turn left or right.
2. The kiosk guides the worker and captures about 6 frames (640×480 JPEG): frontal, the peak
   of the blink, and the peak of each turn. It then sends a signed `POST /api/v1/punch/kiosk`
   with `{method: "face", frames[], challenge_nonce, gps, device_time, nonce, counter}`.
3. The server runs device/network/geo rules 1–3 (same as the QR punch), then the face
   pipeline:
   1. InsightFace SCRFD finds exactly one face per frame (`NO_FACE` / `MULTIPLE_FACES`).
   2. The head-pose change between frames matches the challenge (`LIVENESS_FAILED`).
   3. The anti-spoof score (model chosen in M3) on the frontal frames is above the threshold
      (`SPOOF_SUSPECTED`).
   4. InsightFace ArcFace `buffalo_l` 512-d embeddings show every frame is the same person
      (`FACE_INCONSISTENT`).
   5. 1:N match against the plant's decrypted templates. The best score must be at least
      the threshold **and** beat the second-best by the set margin.
      - If it does: accepted.
      - If it is unsure: `NEED_EMPLOYEE_CODE`. The kiosk asks for the 4-digit code and
        re-sends, and the server does a 1:1 match.
      - If it is clearly no match: `FACE_NOT_RECOGNISED`.
4. Then cool-down and impossible travel, the IN/OUT decision, the punch row and the audit
   entry. **Frames are never stored.**

## 5. Offline sync
- When a punch call fails because there is no network:
  - the kiosk stores the signed punch in Dexie (IndexedDB);
  - it shows an amber banner and "Saved – will be confirmed when online";
  - its counter keeps increasing.
- When the network returns, the kiosk sends `POST /api/v1/kiosk/sync` with batches of up to
  50.
- The server re-runs **every** rule:
  - Its receive time is recorded.
  - `device_claimed_at` is accepted as the punch time only if it falls within the offline
    window and the counters are in order. Otherwise the punch is `flagged` for HR review.
  - Face punches made offline can't be matched until synced; they are checked at sync time
    from the stored frames, which are deleted after the check.
- Per-punch results go back and the kiosk clears its queue.

## 5b. Phone punch (M4b, only for employees an admin allows)
- An admin switches phone punching on for one employee (with a reason; audited). The
  employee registers their phone once: like a kiosk, the phone makes a non-extractable P-256
  key and the server stores the public key against that employee.
- Each phone punch is a signed request with face frames (liveness challenge from the
  server), GPS position and accuracy. The server runs the same rules as for a kiosk punch,
  with these differences:
  - **at the employee's own plant:** the plant geofence is enforced;
  - **outside the plant** (official work elsewhere): the GPS position is saved, not enforced,
    and the punch is tagged `outside_plant`.
- Every phone punch is listed for review. The phone, like the kiosk, is never trusted:
  the server decides.
- Temporary workers (FR-45): the gate screen shows a QR that changes every few seconds; the
  worker scans it with their phone, which proves they are at the gate at that moment.
- Details (exact checks, limits, reason codes) are written in the M4b spec.

## 6. Background jobs (APScheduler; a GitHub Actions cron calls the same endpoints as backup)
- **Snapshot purge** (daily): delete files and set `purged_at` where `expires_at < now`.
- **Attendance processing:** live during the day for the dashboard, and a nightly full
  recompute of `attendance_days`.
- **Face template removal:** when an employee is marked as left.
- **Kiosk health:** mark a kiosk offline when no heartbeat arrives for N minutes.

## 7. Data model (table dictionary)
Conventions:
- UUID primary keys.
- `created_at` / `updated_at` in UTC; shown in IST.
- Money in `numeric(12,2)`.
- Soft delete (`status` / `deleted_at`) for people and setup data.
- `punches` and `audit_logs` are append-only, never deleted.

| Area | Table | Key columns |
|---|---|---|
| Organisation | `plants` | name, code, address, lat/lon, is_active |
| | `geofences` | plant_id, shape (polygon/circle), geojson, buffer_m, version, is_current |
| | `plant_networks` | plant_id, cidr, label |
| | `departments` | plant_id, name |
| | `shifts` | plant_id, name, start_time, end_time, crosses_midnight, grace_min, half_day_min, ot_after_min, ot_rate |
| | `shift_assignments` | employee_id, shift_id, from_date, to_date |
| | `holidays` | plant_id, date, name, is_paid |
| | `settings` | key, value (typed JSON), updated_by |
| People / access | `users` | name, email, password_hash (Argon2), role (super_admin / corporate_head / plant_head; decision 0004), is_active |
| | `user_plant_access` | user_id, plant_id |
| | `sessions` | user_id, token_hash, expires_at, ip, user_agent |
| | `contractors` | name, contact, is_active |
| | `employees` | employee_code (4–6 digit), name, type (permanent/temporary), plant_id, department_id, contractor_id, punch_method (face/qr), phone_punch_enabled (M4b), hourly_rate, status (active/left), joined_on, left_on |
| Enrolment | `face_consents` | employee_id, text_version, language, given_at, recorded_by, withdrawn_at |
| | `face_templates` | employee_id, model_id, ciphertext, nonce, key_id, created_at, deleted_at |
| | `qr_credentials` | employee_id, card_serial, valid_from, valid_until, revoked_at, revoke_reason |
| Kiosks | `kiosk_devices` | plant_id, name, public_key, status, last_seen_at, last_counter, app_version |
| | `kiosk_pairing_codes` | kiosk_id, code_hash, expires_at, used_at |
| | `employee_phones` (M4b) | employee_id, public_key, status, registered_at, last_seen_at |
| | `punch_challenges` | kiosk_id, nonce, challenge, expires_at, used_at |
| Punches | `punches` | employee_id?, kiosk_id? or employee_phone_id? (M4b), plant_id, method, outside_plant (M4b), direction, server_received_at, device_claimed_at, was_offline, lat, lon, accuracy_m, ip, decision (accepted/rejected/flagged), reason_codes[], match_score, liveness_score |
| | `punch_snapshots` | punch_id, storage_key, expires_at, purged_at |
| Attendance | `attendance_days` | employee_id, date, shift_id, first_in, last_out, worked_min, late_min, early_exit_min, overtime_min, status (present/absent/half_day/leave/holiday/weekly_off), computed_at |
| | `leave_records` | employee_id, from_date, to_date, kind, is_paid |
| | `regularisations` | employee_id, date, requested_change, reason, requested_by, status, decided_by, decided_at |
| Audit / privacy | `audit_logs` | actor_type (user/kiosk/system), actor_id, action, entity_type, entity_id, before, after, reason, ip, at |
| | `data_requests` | employee_id, kind (access/correction/erasure), status, handled_by |
| Salary (M7) | `salary_components` | code, name, is_active |
| | `salary_structures` | employee_id, effective_from, created_by |
| | `salary_structure_lines` | structure_id, component_id, amount |
| | `salary_runs` | month, plant_id, status (draft/final), settings_snapshot |
| | `salary_estimates` | run_id, employee_id, days_present, days_absent, leave_days, ot_hours, payable_days, earned, ot_pay, deductions_total, net_payable |
| | `manual_deductions` | run_id, employee_id, kind (PF/ESIC/TDS/advance/other), amount, note, entered_by |

Main relationships:
- Plant 1–N: geofences, networks, departments, shifts, kiosks, employees.
- Employee 1–N: consents, templates, QR credentials, punches, attendance days.
- Punch 1–0..1: snapshot.
- Salary run 1–N: estimates and deductions.

## 8. Folder structure

```
upasthiti/
  frontend/              Vite + React + TS
    src/app/             router, providers, layouts
    src/features/        auth, plants, kiosks, employees, enrolment, attendance,
                         dashboard, reports, audit, settings, salary
    src/kiosk/           camera, face-liveness, qr-scan, offline-queue, device-key, screens
    src/components/ui/   shadcn components (+ copied MIT components, logged)
    src/lib/             api client, i18n setup, en-IN / IST formatters
    public/locales/en/   translation JSON (mr/, hi/ later)
  backend/               FastAPI (uv)
    app/main.py
    app/core/            config (.env), db, security, crypto, time, storage
    app/modules/<name>/  models.py · schemas.py · service.py · router.py
    app/antiproxy/       rules/*.py (one rule per file) + engine.py
    app/face/            detector.py · embedder.py · antispoof.py · matcher.py
    app/jobs/            purge_snapshots.py · process_attendance.py
    migrations/          Alembic
    scripts/             download_models.py (verifies sha256; models are not committed)
    tests/
  e2e/                   Playwright
  deploy/                render.yaml, vercel.json (backend/Dockerfile is used by Render)
  docs/                  client, specs, plans, decisions, design-refs, SRS.md, architecture.md
  .github/workflows/     ci.yml, keepalive.yml
  .env.example
```
