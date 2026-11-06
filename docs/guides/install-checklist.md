# Upasthiti install: one-page checklist

Full steps: [install-guide.md](install-guide.md). Tick each box. Date: ________ Computer: ____________ Done by: ____________

## Before
- [ ] 64-bit computer, 8 GB RAM, 20 GB free disk (100 GB advised), administrator access
- [ ] Internet works (github.com, npm, docker.io, pypi.org reachable)
- [ ] Time sync (NTP) is on
- [ ] Fixed network address for this computer (router reservation): ____________
- [ ] Docker installed and running (Windows: "start when you sign in" on, memory limit set, automatic sign-in on)
- [ ] Name chosen: ______________________  (DuckDNS name and token, or own name and certificate)
- [ ] Backup folder (another disk): ______________________
- [ ] Password manager ready; two people know where

## Install
- [ ] `install.ps1` (Windows, as administrator) or `sudo ./install.sh` (Linux) finished
- [ ] Preflight shows `Preflight passed.` (no FAIL line)
- [ ] First Super Admin made, password in the password manager

## Keys saved in the password manager (from `deploy/prod/.env`)
- [ ] QR_SIGNING_KEY  (lost: all cards printed again)
- [ ] SNAPSHOT_ENCRYPTION_KEY  (lost: photos unreadable)
- [ ] FACE_TEMPLATE_KEY  (lost: everyone enrolled again)
- [ ] OFFLINE_EVIDENCE_KEY
- [ ] BACKUP_KEY  (lost: backups unreadable; keep it apart from the backups)
- [ ] POSTGRES_PASSWORD, APP_SECRET_KEY, DUCKDNS_TOKEN
- [ ] Second person confirmed they can find them

## Smoke test
- [ ] `https://<name>/api/v1/health/ready` answers `"database":"ok"`; lock sign, no warning
- [ ] Sign in at `/admin`
- [ ] One plant added
- [ ] One attendance device paired (pairing code)
- [ ] One QR punch accepted (photo saved)
- [ ] One face punch accepted
- [ ] Dashboard shows the punches
- [ ] `backup create` then `test-restore` ends with `RESTORE TEST PASSED`
- [ ] Restart test: after a reboot the site answers by itself (3 to 5 minutes)
- [ ] Test employee and test plant cleaned up

## Network
- [ ] Firewall: plant network only
- [ ] Every plant can open `https://<name>/attendance` from a gate device
- [ ] Backup copy goes to a second place weekly (who: __________)

## Later (rollout, separate job)
- [ ] Excel import of about 650 employees
- [ ] Face enrolment of about 300 permanent employees
- [ ] QR cards of about 350 temporary workers printed
- [ ] Geofence of each of the 7 plants drawn on site
- [ ] Real-device checks (`m6-manual-checklist.md`)

## Moving to the main server (when it is time)
- [ ] Fresh backup + `.env` copied by USB (never by email or chat)
- [ ] `install.ps1 -RestoreFrom <file>` / `install.sh --restore-from <file>` on the main server
- [ ] Key check: one Face panel and one punch photo open
- [ ] Old computer kept off, not erased, for 30 days
