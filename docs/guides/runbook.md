# Upasthiti runbook

For the client's IT person. Every step is numbered. Anything marked **[Confirm]** is a command or name that the
team checks before release.

Never write a real key, password or employee name into this file, into chat or into email. The repository is public.

Related guides: `docs/guides/face-privacy-handover.md` (face data and privacy), `docs/guides/deployment-findings.md`
(facts for moving to your own server), `docs/guides/proxy-samples/` (proxy settings).

## 1. What the system is made of

| Part | What it does |
|---|---|
| Website (admin, gate page `/attendance`, phone pages `/phone`) | What people see in the browser |
| Backend (one FastAPI program, started from `deploy/Dockerfile`) | Decides every punch, makes reports |
| PostgreSQL database (version 17) | All records |
| File storage | Encrypted punch photos |
| Face models (downloaded files) | Face check, loaded into memory |
| Daily job (inside the backend) | Cleans photos, builds attendance days, sends notices |

## 2. Start, stop, check

1. **Start.** Start the database first, then the backend, then the proxy or web server. [Confirm: exact commands for
   your server type]
2. **Stop.** Stop the proxy first, then the backend, then the database. Never stop the database while the backend runs.
3. **Check it is alive.** Open `https://<your address>/api/v1/health` in a browser. It shows the version and
   `face.state`. `ready` is good. `starting` means wait one minute after a start. `failed` means the face models
   did not load: see section 12.
4. **After a start**, open each attendance device's gate page once so it loads the new version.
5. The backend runs database changes by itself when `RUN_MIGRATIONS_ON_START=true`. On your own server it is safer to
   run them yourself: `uv run alembic upgrade head` from the `backend` folder. [Confirm]

## 3. Settings and keys (names only, never values)

All settings are environment variables, kept in the backend's `.env` file or the service settings. Never commit `.env`.

| Variable | Needed? | What it is | If lost |
|---|---|---|---|
| `APP_ENV` | Leave unset in production | Unset means production. Switches off `/api/docs` | – |
| `APP_VERSION` | Optional | Shown by the health page | – |
| `DATABASE_URL` | Required | Where the database is | App will not start |
| `LOG_LEVEL` | Optional | INFO, WARNING, ... | – |
| `APP_SECRET_KEY` | Required | Protects pairing codes; gate-code keys come from it | All pairing codes and phone gate codes stop working: people pair or sign in again |
| `APP_PUBLIC_ORIGIN` | Required | The website address people type, for example `https://attendance.example.com` | Writes from the website are refused |
| `TRUSTED_PROXY_HOPS` | Required for your setup | Number of proxies in front of the backend (section 8) | Limits and logs use a wrong address |
| `CLIENT_IP_HEADER` | Optional (M6) | A header that your proxy sets and callers cannot write (section 8) | – |
| `RUN_MIGRATIONS_ON_START` | Optional | true = run database changes at start | – |
| `RUN_SCHEDULER` | Optional | true = daily job runs inside the backend | Cleaning and notices stop |
| `QR_SIGNING_KEY`, `QR_SIGNING_KEY_ID` | Required | Signs QR cards | **Every printed card must be re-issued** |
| `SNAPSHOT_ENCRYPTION_KEY` | Required | Encrypts punch photos | **Stored photos can no longer be opened** |
| `STORAGE_BACKEND` | Required | `local` (a folder) or `supabase` | – |
| `STORAGE_LOCAL_DIR`, `SNAPSHOT_BUCKET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Depends on storage | Where photos go | Photos cannot be saved |
| `FACE_TEMPLATE_KEY` | Required | Encrypts face records | **Every employee must be enrolled again** |
| `FACE_MODEL_PACK`, `FACE_DETECTOR_INPUT`, `FACE_MODELS_DIR` | Optional | Face model settings | Changing the model pack means enrolling everyone again |
| `OFFLINE_EVIDENCE_KEY`, `OFFLINE_EVIDENCE_KEY_ID` | Required | Opens punches saved on devices while offline | Punches still waiting on devices cannot be read |
| `BACKUP_KEY`, `BACKUP_KEY_ID` | Required for backups | Encrypts backups | **Backups cannot be restored** |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURITY` | Optional | E-mail for alerts. If unset, e-mail is off and only the bell works | – |

**Keep every key in the company password manager, with two people who know where.** Never send keys by chat or email.

### 3.1 Make a new key
Run from the `backend` folder (needs `uv`). Each command prints one line for the `.env` file.

| Key | Command |
|---|---|
| Card signing key | `uv run python -m app.scripts.make_qr_key` |
| Photo key | `uv run python -m app.scripts.make_snapshot_key` |
| Face key | `uv run python -m app.scripts.make_face_key` |
| Offline key | `uv run python -m app.scripts.make_offline_key` |
| Backup key | `uv run python -m app.scripts.make_backup_key` |
| App secret | `uv run python -c "import secrets; print(secrets.token_urlsafe(48))"` |

Changing a key has a cost (see the "If lost" column). Plan it. Change a key only after a leak or on a planned day.

**The offline key cannot be rotated.** The server opens offline punches with the current `OFFLINE_EVIDENCE_KEY` only,
and `OFFLINE_EVIDENCE_KEY_ID` is just a label. To change the key, first make sure every attendance device has sent its
waiting punches (**Attendance devices** shows 0 waiting), then change the key. Punches still waiting at that moment are lost.

### 3.2 First Super Admin
Run `uv run python -m app.scripts.create_super_admin` and answer the questions. There is no default account.

## 4. Add a plant
1. Sign in as Super Admin. Open **Plants**, press **Add a plant**. Give the code and name.
2. Open the plant, then **Geofence**. Draw the plant area on the map (use **Show my location** and satellite view
   on site).
3. Check the departments, shifts and categories of the new plant (the categories Staff, Worker, Operator, Helper are
   made by default).
4. Add the attendance device (section 5).
5. Print the gate poster: **Plants**, the plant, **Download gate poster (A4 PDF)**.

## 5. Replace or add an attendance device
1. Open **Attendance devices**. If the old device still works, check it shows **0 punches waiting**.
2. Press **Revoke** on the old device (give a reason). A lost or stolen device is revoked at once.
3. Press **Add device**, choose the plant, give a name, press **Make pairing code**. The code works once, for 10 minutes.
4. On the new device (Chrome or Edge, latest; HTTPS; **Location on**) open `/attendance` and type the code or scan the QR.
   Stand at the gate until it says **Paired**.
5. Put the browser in full screen. Details: the attendance device setup guide (`docs/guides/device-setup.md`).
6. Clearing the browser's site data on a device removes its key: pair it again.

## 6. Answer a data request (30-day target)
A person may ask what data you hold, ask for a correction, ask for deletion, take back consent, or complain.
Our target is to answer within **30 days** (the phone notice and the consent text say so). Deadlines and who must
be told come from the client's policy and the law; the client's HR or legal adviser confirms them.
1. Write it in **Data requests** (Super Admin menu) the same day: kind, person (employee code), how it came, date
   received. Do not write health details in the free-text note, and never in the "left reason" of an employee.
2. Check identity in person with the ID card, or through the person's phone sign-in.
3. The Super Admin acts: for face data open the employee, **Face** panel, **Delete face data** or **Withdraw consent**.
   For a correction edit the employee.
4. Punch, attendance and audit records are **kept** as the Labour Codes require, for the period the client's legal
   adviser confirms (working figure: at least 5 years, see `docs/compliance/m6-recommended-answers.md`). Say so in
   the answer.
5. Send the answer within the target. Close the request with the outcome. A deletion request closes as "partly done".
6. The grievance officer (named by the client) signs the answer. The name is set in **Settings**, **Privacy**.

### 6.1 One person asks for their own data (access request)
There is no one-person export. Do it by hand:
1. Make the full export (section 7).
2. Open the CSV files and keep only the rows of that employee code. Check every file in the ZIP.
3. Send only those rows to that person, after the identity check. **Never send the whole export to one person.**
4. Delete the export copy after at most 30 days. Write the date of the deletion in the request.

Full steps for each kind: `docs/guides/face-privacy-handover.md`, section 4.

## 7. The full export: where to keep the file
1. Only the Super Admin can start it (menu **Data export**), with a reason and his password.
2. The file is a ZIP of CSV files. It holds **personal data of everyone**.
3. Save it on an **encrypted drive** that belongs to the company. Never email it, never chat it, never put it on
   GitHub or any public place.
4. Face records, passwords, keys and stored photos are never inside it.
5. Delete old copies when the reason ends (at most 30 days for a data request). Every export is written in the audit log.

## 8. Client IP setting (important after every change of proxy)
The system uses the caller's IP address for limits (20 sign-ins and 10 pairing tries per 10 minutes per address) and
for the audit log. A caller can write his own `X-Forwarded-For` header, so the setting must match how your
proxies are arranged.

| Your arrangement | Set | Your proxy must |
|---|---|---|
| Vercel plus Render (the free setup) | `TRUSTED_PROXY_HOPS=4` (measured); a Vercel header with `CLIENT_IP_HEADER` if verified | – |
| One reverse proxy (nginx or Caddy) in front of the backend | `TRUSTED_PROXY_HOPS=1` | **Overwrite** `X-Forwarded-For` with the connecting address. Never append |
| Two proxies | `TRUSTED_PROXY_HOPS=2` | The outer proxy overwrites, the inner appends |
| No proxy | `TRUSTED_PROXY_HOPS=0` | The backend port must **not** be reachable from outside the company network |
| Proxy sets its own header (for example `X-Real-IP`) | `CLIENT_IP_HEADER=X-Real-IP` | Set it itself and delete any value the caller sent |

**How to verify (do it after every change):**
1. Sign out and sign in once from your own computer.
2. Open **Audit log**. Find your sign-in.
3. Compare the IP shown with the address of your computer (look it up on your network tools).
4. If they differ, the setting is wrong. Fix the setting or the proxy, then repeat.

## 9. Security headers
Vercel sets these today (`frontend/vercel.json`). On your own server your proxy must set the same.
Samples: `docs/guides/proxy-samples/` (nginx and Caddy). A local check script is planned: `scripts/check-headers.sh` **[Confirm]**.

| Header | Value or rule |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (or `frame-ancestors 'none'` in the CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin`; `no-referrer` for `/phone` |
| `Permissions-Policy` | camera and geolocation for this site only; microphone off |
| `Content-Security-Policy` | strict policy for `/phone` (and for `/attendance` after M6); admin pages as released |
| `Cache-Control` | `no-store` for `/api` answers with personal data; `no-cache` for `/version.json` and the service worker `sw.js` |
| `Service-Worker-Allowed` | `/attendance` for `sw.js` |

The `/phone` rules must stay **after** the catch-all rule. The proxy must also send `/api/*` to the backend and every
other path to the website's `index.html`.

## 10. Re-accepting phone-notice-v2
The phone notice has a new version (`phone-notice-v2`: it names the exact place kept for work outside the plant and the
encrypted face record). A used version is never edited. After the release:
1. Tell the Super Admin that every employee with phone attendance will be asked to accept the new notice at the next sign-in.
2. Nothing else is needed. The employee reads the notice (English, Marathi or Hindi) and accepts.
3. To see who accepted, open the employee's phone attendance card. [Confirm]

## 11. Backup and restore
The backup holds personal data and encrypted records. It is encrypted with `BACKUP_KEY`. Keep the key **apart**
from the backup. Full guide with all options: `docs/guides/backup-restore.md`.

### 11.1 Make a backup (every night)
1. From the `backend` folder run `uv run python -m app.scripts.backup create --output-dir <backup folder>`
   (add `--via-docker` where there is no `pg_dump`).
2. It writes one encrypted `.upsbak` file and a readable manifest with counts. Do not rename the file.
3. Copy the folder to a place the client chose (another disk or another building). **Never GitHub.**
4. Look at the manifest once a week: the counts should grow.
5. Delete backups older than the maximum age (suggested 30 days, the client decides). The script never deletes.

### 11.2 Restore
1. Use a **new, empty** database first. Never restore over the live one before you have tested.
2. Dry run first, then apply: `uv run python -m app.scripts.backup restore --file <file>.upsbak --target-database upasthiti_restore`
   and again with `--confirm`. The target name must end in `_restore` or `_drill`.
3. The restore checks the row counts, the migration number and that one face record can be opened.
4. Start a test copy of the backend pointed at the new database. Sign in. Check the dashboard and the punch log.
5. For a real recovery see "A real recovery on a new server" in `backup-restore.md`.
6. **After a restore, do the steps in "After a restore"** (same file) before people use the system.

### 11.3 Practice
Do one restore drill every 3 months on a throw-away database. A backup never restored is not a backup.

## 12. Memory check and face problems
- **Memory check (needs the face models):** from the `backend` folder run `uv run python -m app.scripts.face_memory_check`.
  It fails above 450 MB. The `phone` option also tests phone sign-ins.
- **Download the face models:** `uv run python scripts/download_models.py`. The files are checked with sha256.
- **Health shows `failed`:** check the models folder (`FACE_MODELS_DIR`), disk space and memory, then restart the backend.
  Card punches work meanwhile.
- **Server clock:** the server decides every punch. Keep the time right (NTP). A wrong clock refuses or mis-times punches.

## 13. Remove a demo plant
`uv run python -m app.scripts.remove_demo_plant --plant-code DEMO --include-test-cards` shows what it would remove.
Add `--confirm` to do it. It works only for plants whose code starts with DEMO. It never touches the audit log.

## 14. If personal data is exposed (breach)
Examples: a key leaked, the database or the photo folder made public, a laptop with keys stolen.
Do these in order. Write the time of each step. The client's HR or legal adviser confirms who must be told and when.
1. **Write the incident note and keep the logs** at once (template below). Save the audit log and the server logs
   before anything is changed or deleted.
2. **Stop the harm.** Change the key or the access that leaked. For the face key use `make_face_key`, delete all face
   records and enrol again (`face-privacy-handover.md`, section 5).
3. **Tell the hosting provider** (Render, Supabase, Vercel or the client's own server host) if their service is involved.
4. **CERT-In:** the CERT-In directions of 2022 mention 6 hours. To be confirmed by the client's lawyer.
5. **Data Protection Board of India and each affected person:** HR or the lawyer informs them without delay. A detailed
   report to the Board follows (the DPDP rules mention 72 hours). To be confirmed by the client's lawyer.
6. Keep the note and the dates of every notice.

### 14.1 A stolen attendance device, or a leaked offline key
- **Stolen or lost device:** **Revoke** it at once (section 5). A revoked device is refused by the server. Its waiting
  punches are lost (the revoke dialog says how many). Check **Needs review** for punches from that device before the
  revoke, and use a correction for honest ones.
- **Leaked offline key (alone):** the key only opens punches waiting on devices, never sent ones. Ask each device to
  sync (0 waiting), then change the key (section 3.1; rotation is not supported, so there is no key-id switch).
- **Leaked key together with a stolen device:** revoke the device first, then change the key as above, then write the
  incident note (above) because face pictures waiting on the device may have been readable.

**Incident note template (copy, fill, keep on paper or a private drive)**
```text
Incident note
Date and time found:
Found by:
What happened (facts only):
What data and how many people:
Keys or accounts changed (names only, never values):
Time CERT-In informed (6 hours to be confirmed by the lawyer):
Hosting provider told (who, when):
Time Data Protection Board informed:
How and when the people were informed:
Who is in charge (grievance officer, name to be filled by the client):
Follow-up and date closed:
```

## 15. Daily, weekly and monthly checks

**Every day (5 minutes)**
1. Open the health page: version shown, `face.state` is `ready`.
2. Open the dashboard. Look at the red badge for devices that are offline.
3. Show the TEST card at each gate device (it must say the device works).
4. Open **Needs review** and **Notifications**.

**Every week**
1. Check the last backup file exists and its manifest counts grow.
2. Check free disk space and database size.
3. Check that the server time is right.

**Every month**
1. Open **Audit log** and look for strange sign-ins or exports.
2. Open **QR cards**: cards that end soon.
3. Check updates and security fixes of the system and the server software.
4. Check that the SSL certificate is valid for more than 30 days.

**Every 3 months**
1. Do the restore drill (section 11.3).
2. Check who holds each key and that the password manager is up to date.
3. Review the user list (**Users**): remove people who left.

## 16. When something breaks
| What you see | Likely reason | What to do |
|---|---|---|
| Nobody can sign in to the admin website | Backend or database stopped | Check the health page, then the services |
| Gate says "The server is starting. Please wait..." | Backend just started | Wait one minute |
| Gate says "This attendance device needs its location" | Location off or weak | Switch location on, Wi-Fi on, move nearer a window |
| Gate says "Switched off" | The device was revoked | Pair it again (section 5) |
| Punches are refused for one device only | Old page on the device | Reload the gate page |
| Reports say "preparing" for long | Server busy | Wait, try again; use fewer days |
| Everyone is refused with a time error | Server clock is wrong | Fix the server time |
| Disk is full | Photos or backups | Free space; never delete database files by hand |
| Face punches are refused for everyone | Face models not loaded or key changed | Section 12 |
