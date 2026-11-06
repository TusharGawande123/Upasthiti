# Deployment findings (facts and checklists for the later deployment session)

Spec: `docs/specs/M6-testing-security-docs.md`, section 7.9 (requirement R-14, AC-M6-46).
**This is a fact sheet, not a deployment.** No deployment step was done in M6. The words "to fill" are numbers that the M6 load test report supplies
(`docs/reports/M6-test-report.md`).

## 1. Where the setup stops being free-tier shaped

| Today (free tiers) | On the client's own server | Notes |
|---|---|---|
| Vercel serves the website and `frontend/vercel.json` does three jobs: rewrites `/api/*` to the backend, sets the security headers (strict CSP for `/phone`), keeps the `/phone` rule after the catch-all rule | A reverse proxy (nginx or Caddy) must do the same three jobs | Samples: `docs/guides/proxy-samples/` |
| Render runs the backend; `RUN_MIGRATIONS_ON_START` runs database changes; a GitHub keep-alive workflow stops it sleeping | A normal service that restarts by itself; the daily job (`RUN_SCHEDULER=true`) stays inside the backend; no keep-alive needed | Run `alembic upgrade head` yourself on updates |
| `STORAGE_BACKEND=supabase` | `STORAGE_BACKEND=local` (a folder: size it, back it up) or another S3-style store | Photos are kept 60 days |
| Supabase Postgres (Mumbai) | Self-run PostgreSQL 17, with backups. **Row-Level Security stays on** (migrations create it) | Backups: section 7 |
| Render's 512 MB limit | Much more memory | Face model `buffalo_s` was chosen for 512 MB; changing the model means enrolling everyone again |

## 2. Environment variables

The full table with "what happens if lost" is in `docs/guides/runbook.md`, section 3. Summary for planning:

| Variable | Required | Make with | If lost |
|---|---|---|---|
| `DATABASE_URL` | Yes | – | Not started |
| `APP_SECRET_KEY` | Yes | `secrets.token_urlsafe(48)` | Pairing and phone gate codes reset |
| `APP_PUBLIC_ORIGIN` | Yes | – | Writes refused |
| `TRUSTED_PROXY_HOPS` / `CLIENT_IP_HEADER` | Yes / optional | – | Wrong IP in limits and audit |
| `QR_SIGNING_KEY` (+ `_ID`) | Yes | `make_qr_key` | All cards re-issued |
| `SNAPSHOT_ENCRYPTION_KEY` | Yes | `make_snapshot_key` | Photos unreadable |
| `FACE_TEMPLATE_KEY` | Yes | `make_face_key` | Everyone enrolled again |
| `OFFLINE_EVIDENCE_KEY` (+ `_ID`) | Yes | `make_offline_key` | Waiting offline punches unreadable |
| `BACKUP_KEY` | Yes for backups | `make_backup_key` | Backups unreadable |
| `STORAGE_BACKEND` and storage settings | Yes | – | Photos not saved |
| `SMTP_*` | Optional | – | E-mail off, bell stays |
| `RUN_SCHEDULER`, `RUN_MIGRATIONS_ON_START`, `LOG_LEVEL`, `APP_VERSION`, `FACE_*` | Optional | – | – |

All values go into the password manager. The keys travel to the new server by hand, never by chat or email.

## 3. Proxy and client IP per topology

Same table as the runbook, section 8:

| Topology | Setting | Proxy rule |
|---|---|---|
| Vercel plus Render | hops 4 (measured) and a Vercel header if verified | – |
| One proxy | `TRUSTED_PROXY_HOPS=1` | Overwrite `X-Forwarded-For`, never append |
| Two proxies | `TRUSTED_PROXY_HOPS=2` | Outer overwrites |
| No proxy | `TRUSTED_PROXY_HOPS=0` | Port not reachable from outside |
| Own header | `CLIENT_IP_HEADER=<name>` | Proxy sets it and deletes the caller's value |

Verify after every change: sign in, compare the IP in the audit log with your computer's address. The Vercel header that
works is to be verified in the deployment session and recorded here: **[to fill]**.

## 4. HTTPS, certificates and time

1. **HTTPS is mandatory.** The camera and the location need a secure address.
2. A **company-internal certificate** must be trusted on every attendance device and every phone. Test this on the real devices
   first (checklist items MC-1, MC-7).
3. Passkeys (phone sign-in) are tied to the address: a change of address means new passkeys.
4. The server's **date and time must be correct (NTP)**. The server decides every punch and the offline time proof uses it.
5. Camera and location also need the browser to allow them for the new address.

## 5. Sizing

| Profile | Median | p95 | p99 | Failures | Peak memory | Face punch time |
|---|---|---|---|---|---|---|
| 0.1 CPU / 512 MB (free tier shape) | to fill | to fill | to fill | to fill | to fill | to fill |
| 1 CPU / 1 GB | to fill | to fill | to fill | to fill | to fill | to fill |
| 2 CPU / 2 GB | to fill | to fill | to fill | to fill | to fill | to fill |
| 4 CPU / 8 GB (SRS reference) | to fill | to fill | to fill | to fill | to fill | to fill |

Other facts:
- Memory profile of the face model: the memory check stays at or below **450 MB** (`face_memory_check`).
- Disk growth (from the M2 and M5 specs): punch rows about **160 MB per year**, attendance days about **50 MB per year**.
  Punch photos are kept 60 days, so their size stays flat. Backups need space for several copies.
- Optional information: the model `buffalo_l` on the 4 CPU / 8 GB profile: **[to fill]**. Not used (decision 0016).

## 6. Network

1. All 7 plants need the server reachable from each gate device.
2. When the plant internet drops, the gate saves punches and sends them later (up to 72 hours offline).
3. **Phone punching needs the server reachable from the internet.** A server only on the company LAN cannot serve phones outside.
4. Gate devices need Wi-Fi on for location, even with a cable.
5. Firewall: allow HTTPS in; the backend's outbound calls are only the storage service (if used) and optional e-mail.

## 7. Backups and restore

- Built (F-93): nightly encrypted `pg_dump` plus a copy of the photo folder, restore script, drill. See `docs/guides/backup-restore.md`.
  Procedure: `docs/guides/runbook.md`, section 11. Result of the local drill: `docs/reports/M6-backup-drill.md`.
- If the script is not ready: manual `pg_dump -Fc`, `pg_restore` into a new database, copy the photo folder.
- Where the backups go and who holds `BACKUP_KEY`: **[ask the client]**.
- The password manager list of keys: runbook section 3.

## 8. Moving the data from Supabase to the own server

1. Choose a quiet time (Sunday) and tell the plants. Offline gates keep saving for up to 72 hours.
2. On the new server, install PostgreSQL 17 and create an empty database.
3. Dump the Supabase database (custom format) with a connection to the session pooler string. Use `pg_dump -Fc`.
4. Restore into the new database with `pg_restore`. Run `alembic upgrade head`: it must say nothing to do.
5. Copy the photo files from the Supabase bucket to the new storage. Photos are encrypted: they need the **same**
   `SNAPSHOT_ENCRYPTION_KEY`.
6. Set the same keys on the new server. **Key check:** open one employee's Face panel and one punch photo. Both must open.
7. Point the gate devices and phones to the new address (pair again if the address changed: the device key is
   tied to the browser's site data of the old address).
8. Keep the old system switched off but not deleted for 30 days.
9. Update the processor list and the consent and notice texts if the hosting country changes (a new notice version).

## 9. Accounts

| Account | Today | At handover |
|---|---|---|
| Vercel | Team's account | Move to the client, or close after the move |
| Render | Team's account | Move to the client, or close after the move |
| Supabase | Team's account | Move to the client, or close after the move |
| GitHub | Team's repository | Decision pending (not written here) |

Check that no key or password stays in a closed account's settings. Rotate any secret that a student knew when the
client asks for it.

## 10. Open points that only the client can answer

1. Server details: CPU, RAM, disk, operating system.
2. A fixed address or domain name, and the type of HTTPS certificate (public or company-internal).
3. Power backup (UPS), backup drive, and who is the administrator.
4. Is phone punching needed from outside the company network?
5. Where the backups go and who holds the backup key.
6. The name of the grievance officer (privacy contact).
7. The years to keep logs, consent records and attendance (working figure: attendance at least 5 years).
8. Who in the client's staff reads Marathi and Hindi texts for the notices.
