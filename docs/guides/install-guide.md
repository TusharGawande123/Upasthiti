# Upasthiti install guide (for the IT team of Sheet Shapers)

Version for the own-server install. It works for a test computer and for the main server. Read sections 1 to 8
once before you start. Section 10 explains how to move the running system from the test computer to the main server.
A one-page checklist is in [install-checklist.md](install-checklist.md).

Words: in this guide, the tablet, phone or PC that stands at a plant gate and records attendance is called an
**attendance device**. The page it shows is **Gate attendance** (`/attendance`).

## 1. What you get

One website, run by three programs that start together with Docker:

| Part | What it does | Where its data lives |
|---|---|---|
| `postgres` | the database (PostgreSQL 17) | Docker volume `postgres-data` |
| `backend` | the application (checks every punch, face recognition) | Docker volume `snapshots` (punch photos) |
| `caddy` | the front door: HTTPS, the website, passes `/api` to the backend | Docker volume `caddy-data` (certificate) |

People and devices open **one address**: `https://<your name>` (admin: `/admin`, attendance device: `/attendance`,
employee phone pages: `/phone`).

Everything in the install folder `deploy/prod/` is made for this. Nothing you install costs money.

## 2. What you need

| Item | Needed | Notes |
|---|---|---|
| Computer or server | 64-bit, 4 CPU cores or more is comfortable (the system was measured on 1 to 4 cores), **8 GB RAM**, **at least 20 GB free disk** (plan 100 GB: database, photos, backups) | Windows 10/11 Pro, Windows Server, or Linux (Ubuntu or Debian) |
| Administrator access | Yes | The install changes the firewall and makes scheduled tasks |
| Internet on this computer | Yes, at install and for the certificate every 60 days; later also for updates | After the install the plants can keep working without internet for up to 72 hours (attendance devices save punches and send them later) |
| A name for HTTPS | Yes, see section 4 | The camera does **not** work on a plain address like `http://192.168.1.20` |
| A fixed network address for this computer | Strongly recommended | Ask the router or network admin to always give this computer the same address (a "DHCP reservation") |
| Backup place | Yes | Another disk or a network share. Not the same disk as the data if possible |
| A password manager | Yes, used by two people | Section 8 |
| Time sync (NTP) | Yes | Windows: Settings, Time and language, "Set time automatically" on. Linux: `timedatectl set-ntp true` |

## 3. Install Docker

**Windows 10/11 Pro (and similar):**
1. Switch on virtualization in the BIOS if it is off (Task Manager, tab Performance, CPU: "Virtualization: Enabled").
2. Install Docker Desktop (docker.com). During install keep "Use WSL 2" ticked. Restart when asked.
3. Start Docker Desktop. In its settings: General, tick **"Start Docker Desktop when you sign in"**.
4. Limit its memory so the computer stays comfortable on 8 GB: create the file `C:\Users\<user>\.wslconfig` with
   these two lines, then run `wsl --shutdown` and start Docker Desktop again:

       [wsl2]
       memory=5GB

5. Check in PowerShell. Expected: version numbers, no red text.

       docker --version
       docker compose version

6. **Switch on automatic sign-in** for this computer (Docker Desktop only starts after a sign-in): press Win+R,
   type `netplwiz`, untick "Users must enter a user name and password", choose the account. Do this only if the
   computer stands in a locked room.

**Linux:** install Docker Engine and the compose plugin from the Docker documentation for your system, then
`sudo systemctl enable --now docker`. Nothing else is needed for starting after a reboot.

**Windows Server where Docker is not allowed:** use appendix A (native install).

## 4. Get a name for HTTPS

Camera and location only work on a secure address. Choose one way:

**A. Free DuckDNS name (recommended, default of the scripts).** No public address and no open port to the internet
are needed: Caddy proves to Let's Encrypt that it owns the name by writing a small DNS record through DuckDNS.
1. Open duckdns.org and sign in (Google, GitHub or other). Use an account of the company, not a personal one.
2. In "domains" type a name, for example `upasthiti-sheetshapers`, and press "add domain". You now own
   `upasthiti-sheetshapers.duckdns.org`. Names are first come first served; try another if it is taken.
3. Copy the **token** shown at the top of the DuckDNS page. It is a secret (it is the password of this name). The
   install script asks for it and writes it only into the `.env` file on the server.
4. The script then sets the name to point to this computer's **network address** (for example 192.168.1.20). That is
   fine: the name works inside the plant network. If you reinstall on another computer later, run the script again
   or change the address on the DuckDNS page.

**B. The client's own name and certificate** (for example `attendance.sheetshapers.example`). The network team creates
the name in the company DNS, pointing to this computer. Put the certificate files `fullchain.pem` and `privkey.pem`
in `deploy/prod/certs/` and in `.env` set `CADDYFILE=Caddyfile.own-certificate`. Every attendance device and phone must
trust the certificate issuer (a company certificate must be installed on each device first; test on one phone and one
PC before the rollout).

**C. DuckDNS name, but the network blocks DuckDNS (certificate made elsewhere).** Some plant networks refuse to
resolve `duckdns.org`, so this computer cannot get the certificate itself. Make the certificate on any computer that
can reach DuckDNS and copy the two files in:
1. On that computer run Caddy once with the DuckDNS plugin for the name (the image `upasthiti-caddy:prod` has it) and a
   one-site Caddyfile with `tls { dns duckdns {env.DUCKDNS_TOKEN} }`. When the log says `certificate obtained
   successfully`, copy `<name>.crt` as `fullchain.pem` and `<name>.key` as `privkey.pem` out of `/data/caddy/certificates/`.
2. Put both files in `deploy/prod/certs/` on the server. Treat `privkey.pem` as a secret (never chat or email).
3. Run the install and **press Enter at the DuckDNS token question**. The script then uses `Caddyfile.own-certificate`.
4. The certificate lasts **90 days** and does **not** renew itself in this mode. Put the end date in a calendar
   (15 days before). To make it automatic, ask the network team to allow `duckdns.org`, `www.duckdns.org`,
   `acme-v02.api.letsencrypt.org` (port 443) and DNS port 53 to `1.1.1.1` / `8.8.8.8`, then in `.env` set
   `DUCKDNS_TOKEN=<token>` and `CADDYFILE=Caddyfile.duckdns` and run `docker compose up -d`.

## 5. Run the install

Get the project folder onto the computer (the folder that contains `backend`, `frontend` and `deploy`) and open a
terminal in `deploy/prod`.

**Windows** (PowerShell, "Run as administrator"):

    cd <project folder>\deploy\prod
    powershell -ExecutionPolicy Bypass -File .\install.ps1

**Linux:**

    cd <project folder>/deploy/prod
    sudo ./install.sh

The script asks:
1. **Address name** without `https://` (example `upasthiti-sheetshapers.duckdns.org`).
2. **HTTPS port**: press Enter for 443. If another program already uses 443, type `8443` (then people open
   `https://<name>:8443`).
3. **DuckDNS token** (hidden while you type). Press Enter with nothing if you use certificate files (option C).
4. **Backup folder** (choose another disk or a shared folder).
5. Whether to set the DuckDNS name to this computer's network address now: answer `y`.

Then it works alone. Expected on the screen, in order (the first build takes 10 to 25 minutes because it downloads
the face models and builds the website):

    == 1. Checking this computer
    Docker works. Free disk on C: ... GB.
    == 2. Settings and secret keys
    == 2b. Building the images ...
    .env written with new keys.
    DuckDNS answered: OK (address set to this computer's network address ...).
    == 3. Starting the system
    Backend is healthy.
    == 4. Firewall: only the plant network may connect
    == 5. Nightly backup and start after sign-in
    == 6. Preflight check
    [OK  ] Settings: all required variables are set and valid
    [OK  ] Public address: starts with https:// and has no slash
    [OK  ] Client IP rule: one proxy (Caddy) in front
    [OK  ] Mode: production (API docs are off)
    [OK  ] Backup key: set (the text is never shown)
    [OK  ] Database: reachable, migrations are up to date (...)
    [OK  ] Face models: pack buffalo_s and both anti-spoof files are present
    [OK  ] Photo storage: write, read and delete worked
    [OK  ] Server clock: within ... s of a public clock
    [OK  ] HTTPS headers: certificate trusted, security headers present
    Preflight passed.
    == 7. First Super Admin

The last step asks for the first **Super Admin** (username, name, password at least 10 characters). There is no
default account. Write the password in the password manager.

At the very end the script prints the two addresses and reminds you about the keys (section 8). **Do that now.**

The script is safe to run again. It never replaces an existing `.env`.

### 5b. Install from ready-made images (delivery without source code)

If you received a folder with `upasthiti-images.tar` and `deploy-prod` (and no `backend` or `frontend` folders), use this.
Nothing is built: the images are loaded, so the install takes about 5 minutes once Docker works.

1. Copy the whole delivery folder to the computer (for example `C:\upasthiti-delivery`).
2. Optional check that the big file arrived whole (PowerShell): `Get-FileHash C:\upasthiti-delivery\upasthiti-images.tar`
   must print the same text as the file `upasthiti-images.tar.sha256`.
3. Run the install from `deploy-prod`, with the images file.

   Windows (PowerShell, as administrator):

       cd C:\upasthiti-delivery\deploy-prod
       powershell -ExecutionPolicy Bypass -File .\install.ps1 -ImagesFile ..\upasthiti-images.tar

   Linux:

       cd /path/upasthiti-delivery/deploy-prod
       sudo ./install.sh --images-file ../upasthiti-images.tar

   Everything else (questions, firewall, tasks, preflight, first Super Admin) is the same as in section 5. The script
   writes two extra lines into `.env` (`COMPOSE_FILE`, `COMPOSE_PATH_SEPARATOR`) so that every later `docker compose`
   command (backup, restart) uses the images too. Do not delete them.
4. **Updates** come as a new `upasthiti-images.tar`: make a backup, run `docker load -i <new file>`, then
   `docker compose up -d --no-build` in `deploy-prod`. Database changes are applied at start.
5. With this delivery, changes to the application code are not possible on your side. Problems must be reported to
   whoever delivered the images (agree this in writing). Keep the `.env` keys and the backups safe: they protect your data.

## 6. Network, firewall and devices

1. **Firewall.** Windows: the script made the rule "Upasthiti HTTPS" for the local network only. Linux: it asked for
   the plant network (CIDR such as `192.168.1.0/24`), used `ufw` and added a `DOCKER-USER` rule. **Docker publishes
   ports around ufw**, so ufw alone does not protect this port, and the `DOCKER-USER` rule is lost at reboot: make it
   permanent (for example with `iptables-persistent`) or, better, limit the port on the company network firewall. Do not open this port to the internet unless you
   have decided to allow phone punching from outside (section 11).
2. **All 7 plants** must be able to reach this computer's address from the gate devices. If the plants are on
   different networks, ask the network team to route them. Test from a device at each plant (section 7, step 6).
3. **DNS rebind protection.** Some routers and company DNS servers refuse to answer a public name (such as a
   DuckDNS name) with a private address. Symptom: the name does not open on a phone, but opens on the server
   itself. Fix: ask the network team to allow the name `<your name>.duckdns.org` (an "exception for DNS rebind
   protection"), or use option B in section 4.
4. **Devices.** On each attendance device open `https://<name>/attendance`, allow camera and location, and pair it
   with the pairing code from the admin website (menu **Attendance devices**). Details: `device-setup.md`.
5. **Power.** A power cut stops the system. With Linux or a server it starts again alone. A UPS (battery) is advised.

## 7. Check that it works (smoke test)

Do these in order. Each one must succeed before the next.

1. **Health.** On the server open `https://<name>/api/v1/health/ready`. Expected: a short answer with
   `"database":"ok"`.
2. **Certificate.** The browser shows the lock sign and no warning.
3. **Login.** Open `https://<name>/admin`, sign in with the Super Admin. The dashboard opens.
4. **One plant.** Menu **Plants**: add a plant (code, name). Draw its geofence on the map later, on site.
5. **One attendance device.** Menu **Attendance devices**: add a device for that plant, copy the pairing code.
   On the device open `/attendance`, enter the code. The device shows as paired.
6. **One QR punch.** Add a test employee (temporary), issue a QR card, show it at the device. The gate shows IN and
   a photo is saved.
7. **One face punch.** Enrol one permanent test employee (menu Employees, Face panel, record consent), then punch
   with the face at the device.
8. **Dashboard.** The live headcount shows the punches.
9. **Backup and restore test.** Windows: `.\backup.ps1 -Action create`, then `.\backup.ps1 -Action test-restore`.
   Linux: `./backup.sh create`, then `./backup.sh test-restore`. Expected last line: `RESTORE TEST PASSED`.
10. **Restart test.** Restart the computer (Windows: sign in again if automatic sign-in is off). After 3 to 5
    minutes open `https://<name>/api/v1/health/ready` again. It must answer without any command from you.

Remove the test employee and the test plant afterwards (the Super Admin marks people as "left"; a demo plant can be
removed with `app.scripts.remove_demo_plant`, see the runbook, section 13).

## 8. The keys (most important page)

The file `deploy/prod/.env` holds secret keys. It is never in git and never inside a backup. Copy these lines into the
company password manager (two people must know where):

| Key | If you lose it |
|---|---|
| `QR_SIGNING_KEY` | **Every printed QR card stops working. All cards must be issued and printed again.** |
| `SNAPSHOT_ENCRYPTION_KEY` | **Stored punch photos can never be opened again.** |
| `FACE_TEMPLATE_KEY` | **Every permanent employee must be enrolled again** (the face data cannot be opened) |
| `OFFLINE_EVIDENCE_KEY` | Punches still waiting on attendance devices cannot be read |
| `BACKUP_KEY` | **Every backup is unreadable.** A backup is useless without it |
| `POSTGRES_PASSWORD` | You can not open the database from outside the app (set a new one with a database admin) |
| `APP_SECRET_KEY` | Devices must be paired again and phone gate codes reset. Nothing else is lost |
| `DUCKDNS_TOKEN` | Get it again from the DuckDNS page |

Rules:

- Keep the keys **apart from the backups** (not on the same drive). Whoever has both can read everything.
- Never send keys by chat, email or photo. Never put `.env` in git.
- To move the data to another computer you need **the same keys** plus a backup (section 10). With new keys the
  old photos, cards, face data and backups cannot be read, and everybody must be enrolled again.
- Changing a key has the same cost as losing it. Change one only after a leak, on a planned day (runbook, section 3).

## 9. Backups and restore

- A backup is made **every night at 02:00** (Windows Task Scheduler task "Upasthiti backup", Linux cron). It is an
  encrypted file `upasthiti-backup-<time>.upsbak` plus a readable `.manifest.json` in the backup folder. Backups older
  than 30 days are deleted by the same task (change `KeepDays` / `KEEP_DAYS` if the client decides another time).
- Look at `backup.log` in the backup folder after the first night. A line `BACKUP FAILED` needs action.
- **Do not rename** a `.upsbak` file: the name is part of its protection.
- **Once a quarter** do the restore test (`backup.ps1 -Action test-restore` / `./backup.sh test-restore`). A backup
  nobody ever restored is not a backup.
- Copy the newest backup to a second place (another room, another computer) at least weekly.
- After a real restore read `backup-restore.md`, section "After a restore": face deletions and consent withdrawals
  made after the backup date must be done again.

**Restore on the same computer after a disaster** (the data is lost, the keys are safe): follow section 10 as if you
were moving, with the same computer as target.

## 10. Moving to the main server (test computer to main server)

The same package installs on the main server. The data moves with a backup. Plan a quiet time (Sunday) and tell the
plants: attendance devices keep punches for up to 72 hours while the server is off.

On the **test computer**:
1. Make a fresh backup: `.\backup.ps1 -Action create` (or `./backup.sh create`).
2. Note the newest file in the backup folder (`upasthiti-backup-....upsbak`).
3. Copy **three things** to a USB drive: that `.upsbak` file, and the file `deploy/prod/.env`. (The `.env` carries the
   keys. Do not use email or chat.) Keep the USB drive locked up and wipe it afterwards.
4. Stop the system so nobody punches into the old copy: `docker compose stop caddy`.

On the **main server**:
5. Install Docker (section 3) and put the project folder on it.
6. Copy `.env` into `deploy/prod/`. Edit these lines only if they change on the new server:
   - `SITE_ADDRESS` and `APP_PUBLIC_ORIGIN` (a new name means every attendance device and phone must be paired again,
     and passkeys must be made again, because they belong to the address; keep the **same name** if you can: change
     the DuckDNS address to the new server's network address instead),
   - `HTTPS_PORT`, `BACKUP_DIR`, `DUCKDNS_TOKEN` (same token is fine).
   Do **not** change any key or `POSTGRES_PASSWORD`.
7. Run the install with the restore option:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -RestoreFrom D:\upasthiti-backup-....upsbak`
   - Linux: `sudo ./install.sh --restore-from /path/upasthiti-backup-....upsbak`

   It builds, starts only the database, restores the backup (with the check lines below), then starts everything.
   Expected during the restore: lines ending with `OK` for row counts, migration revision, and one face template.
8. Run the **key check**: open one employee's Face panel and one punch photo. Both must open. If one does not, the
   key is wrong: stop and compare `.env` with the old one.
9. If the DuckDNS name stays the same, change its address to the new server's network address (DuckDNS page).
10. Run the smoke test (section 7, steps 1 to 3, 6, 7, 9, 10). Switch on the nightly backup (the script did).
11. Keep the old computer switched off but not erased for 30 days. Then erase it, **including the Docker volumes**
    (`docker compose down -v` on the old computer only, never on the new one).

## 11. Employees' phones outside the plant network (optional)

Phone punching works only for the employees the Super Admin switched on. Phones on the plant Wi-Fi work with the
set-up above. A phone on mobile data can only reach this server if it is reachable from the internet (a public address,
port forwarding on the company router, and a DuckDNS record that holds the **public** address). That is a security
decision for the client's IT: keep the firewall rule for the plant network until you decide. If you open it, set the
Windows firewall rule's remote address to `Any`, keep Windows and Docker updated, and watch the "Needs review" screen.

## 12. Updating to a new version

1. Make a backup (section 9).
2. Put the new project folder in place (keep the same `deploy/prod/.env`).
3. In `deploy/prod`: `docker compose up -d --build`. The database changes are applied at start.
4. Run the preflight: `docker compose exec backend python -m app.scripts.preflight`.

## 13. Everyday commands

Run in `deploy/prod`.

| Task | Command |
|---|---|
| See what runs | `docker compose ps` |
| Read the application log | `docker compose logs --tail 100 backend` |
| Restart one part | `docker compose restart backend` |
| Stop everything (data stays) | `docker compose stop` |
| Start again | `docker compose up -d` |
| Preflight check | `docker compose exec -T backend python -m app.scripts.preflight` |
| Make another Super Admin | not possible in the app: use the existing Super Admin. First one: `docker compose exec backend python -m app.scripts.create_super_admin` |

**Never** run `docker compose down -v` or `docker volume rm`: they delete the database and the photos.

## 14. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The script says Docker is not running | Docker Desktop is still starting | Wait until Docker Desktop shows "running", run again |
| Build stops with a network error | No internet or a proxy blocks GitHub/npm/Docker Hub | Test `Test-NetConnection github.com -Port 443`; ask the network team to allow `github.com`, `registry.npmjs.org`, `docker.io`, `pypi.org`; run the script again (it continues) |
| `port is already allocated` or "port already in use" | Another program uses 443 | Run the script on a fresh folder with port 8443, or stop that program. Set `HTTPS_PORT=8443` and `APP_PUBLIC_ORIGIN=https://<name>:8443` in `.env`, then `docker compose up -d` |
| Browser says "not secure" or no lock sign | The certificate is not made yet | `docker compose logs caddy`. Look for `obtain` and `error`. Usual causes: wrong DuckDNS token, no internet, the name is not yours |
| Caddy log: `dns.providers.duckdns` error | Wrong token or domain name | Check `DUCKDNS_TOKEN` and `SITE_ADDRESS` in `.env`; `docker compose up -d` |
| The name opens on the server but not on other devices | DNS rebind protection, or the DuckDNS address is not this computer's network address | Section 6, point 3; check the DuckDNS address with `nslookup <name>` |
| The website opens, but sign-in or saving is refused | `APP_PUBLIC_ORIGIN` differs from the address in the browser (for example missing `:8443`) | Make it exactly the address people type, no slash at the end; `docker compose up -d` |
| Camera does not start on a device | Not on the HTTPS name, or camera permission denied | Use `https://<name>/attendance`; allow the camera in the browser's site settings |
| Backend restarts again and again | A missing or wrong variable | `docker compose logs backend`: the app names the variable (never its value). Fix `.env`, `docker compose up -d` |
| `[FAIL] Server clock` in the preflight | The computer clock is wrong | Switch on time sync (NTP), restart the backend |
| `[WARN] HTTPS headers ... cannot open the public address` | The container cannot reach the public name (normal) | Open the gate page from a phone: a lock sign and a working camera prove the HTTPS part |
| After a reboot nothing works (Windows) | Nobody signed in, so Docker Desktop did not start | Sign in; or switch on automatic sign-in (section 3, step 6) |
| Backup log: `BACKUP FAILED` | Backup folder full or not writable, or the backend is stopped | Read `backup.log`; free space; `docker compose ps` |
| Restore refuses a file | Wrong key, a renamed file, or a changed byte | Use the original file name; compare `BACKUP_KEY` and `BACKUP_KEY_ID` with the old computer |
| Out of disk | Photos and backups grow | `docker system df`; delete old backups; the backup task already deletes after 30 days |

## 15. What can go wrong (and how to be ready)

- **Lost keys**: section 8. Prevention: password manager now.
- **Disk failure**: the data and the nightly backups on the same disk are lost together. Keep backups on another disk
  and a weekly copy elsewhere.
- **Power cut or forced shutdown**: PostgreSQL recovers by itself. Linux and server installs restart alone; a Windows
  desktop needs a sign-in.
- **Certificate not renewed**: Caddy renews 30 days before the end, but only while the computer is on and has
  internet. A certificate of 90 days that cannot renew shows a browser warning after it ends. Check `docker compose logs caddy`.
- **The name changes**: attendance devices and phones must be paired again; passkeys must be made again.
- **Wrong clock**: punches get wrong times. Keep NTP on.
- **Docker Desktop updates** sometimes ask for a restart: do it in a quiet hour.
- **A person is locked out**: the Super Admin resets passwords in the admin website. If the Super Admin password is
  lost and no other Super Admin exists, ask the project team (runbook, section 16).

## 16. Later steps (rollout, a separate job, not part of this install)

1. Import the employees from Excel (about 650: 300 permanent, 350 temporary), with the company's employee codes.
2. Enrol the faces of the permanent employees (about 1 to 2 minutes each, with consent, done by the Super Admin).
3. Issue and print the QR cards of the temporary workers.
4. Draw the geofence of each of the 7 plants on site (menu **Plants**), then pair one attendance device per gate.
5. Do the real-device checks: `m6-manual-checklist.md` and `m4-real-device-check.md`.
6. Train the plant staff with the worker guides in English, Marathi and Hindi.
7. Fix the retention years with the client, the backup owner, and the privacy contact.

## Appendix A. Windows Server without Docker (native install)

Use this only if Docker is not allowed. It needs more steps and the person doing it must be comfortable with Windows
services. The parts are the same: PostgreSQL 17, the backend (Python 3.14 with `uv`), the website files, and Caddy.

1. **PostgreSQL 17**: install the Windows installer from postgresql.org. Create the database and a user:

       psql -U postgres -c "CREATE USER upasthiti WITH PASSWORD '<letters and digits>' CREATEDB"
       psql -U postgres -c "CREATE DATABASE upasthiti OWNER upasthiti"

   (CREATEDB is needed for the restore test.) Set `DATABASE_URL` to the address of that database: driver `postgresql+psycopg`, user `upasthiti`, the password you chose, host `127.0.0.1`, port `5432`, database `upasthiti` (same shape as `DATABASE_URL` in `.env.example`).
2. **uv and the backend**: install `uv` (astral.sh). In `backend`: `uv sync --no-dev`. Download the models:
   `uv run python scripts/download_models.py --dest models --only buffalo_s,minifasnet_v2,minifasnet_v1se`, and set
   `FACE_MODELS_DIR` to that folder. Make the keys with `uv run python -m app.scripts.make_qr_key` and the
   other `make_*_key` commands (runbook, section 3.1).
3. **Settings**: put every variable of `deploy/prod/.env.production.example` that the backend uses into a `.env` in
   `backend` (`DATABASE_URL`, `APP_SECRET_KEY`, `APP_PUBLIC_ORIGIN`, `TRUSTED_PROXY_HOPS=1`, `STORAGE_BACKEND=local`,
   `STORAGE_LOCAL_DIR=D:\upasthiti\snapshots`, `RUN_MIGRATIONS_ON_START=true`, `RUN_SCHEDULER=true`, the keys).
   Leave `APP_ENV` out. Test: `uv run alembic upgrade head`, then `uv run python -m app.scripts.preflight --skip-network`.
4. **Website files**: on any computer with Node 24: `cd frontend; npm ci; npm run build`. Copy the `dist` folder to
   `D:\upasthiti\site`.
5. **Caddy**: download Caddy for Windows **with the DuckDNS module** from caddyserver.com/download (choose the
   module `github.com/caddy-dns/duckdns`), or use the standard Caddy and your own certificate. Copy
   `deploy/prod/caddy/*` to `D:\upasthiti\caddy`, set the machine variables `SITE_ADDRESS`, `DUCKDNS_TOKEN`,
   `BACKEND_UPSTREAM=127.0.0.1:8000`, `FRONTEND_DIR=D:\upasthiti\site`, and run
   `caddy run --config D:\upasthiti\caddy\Caddyfile.duckdns --adapter caddyfile` once to test.
6. **Services (NSSM, free)**: download NSSM (nssm.cc). Then, in an administrator PowerShell:

       nssm install UpasthitiBackend "<path to uv.exe>" "run uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log"
       nssm set UpasthitiBackend AppDirectory "D:\upasthiti\backend"
       nssm set UpasthitiBackend Start SERVICE_AUTO_START
       nssm install UpasthitiCaddy "<path to caddy.exe>" "run --config D:\upasthiti\caddy\Caddyfile.duckdns --adapter caddyfile"
       nssm set UpasthitiCaddy AppEnvironmentExtra SITE_ADDRESS=<name> DUCKDNS_TOKEN=<token> BACKEND_UPSTREAM=127.0.0.1:8000 FRONTEND_DIR=D:\upasthiti\site
       nssm set UpasthitiCaddy Start SERVICE_AUTO_START
       nssm start UpasthitiBackend
       nssm start UpasthitiCaddy

   These services start at boot, before anyone signs in (this is the advantage over Docker Desktop).
7. **Firewall and backup**: the same rule as section 6; the nightly task runs
   `uv run python -m app.scripts.backup create --output-dir D:\upasthiti-backups` in `backend`
   (`backup-restore.md`, section "Schedule").

## Appendix B. Uninstall or start again on the test computer

`docker compose down` stops the system and keeps the data. To erase **everything** on a test computer (never on the main
server): `docker compose down -v`, delete the `.env` and the backup folder. Erasing the data without the keys and
backups is final.
