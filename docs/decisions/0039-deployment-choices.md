# 0039 – Deployment on the client's own computer: choices

Date: 2026-11-06 · Decided by: Tushar Gawande (lead), technical details by Claude Code · Status: Accepted
Follows: 0004 (option 2: own server), 0007, 0038. Input: `docs/guides/deployment-findings.md`.

## Situation

Sheet Shapers gave the team one separate computer (Windows 10 Pro 22H2, Intel i5, 8 GB RAM, 238 GB SSD) to look after,
because their main server runs 24 hours and cannot be stopped. We install there now. Later the client's IT installs the
same system on the main server. So there are two deliverables: the running system, and a package plus guide book that
the client's IT can use alone.

## Decisions

1. **Docker Compose is the install method** (`deploy/prod/`): PostgreSQL 17, the backend image, and a Caddy "front door"
   that also serves the built website. The same files run on Windows (Docker) and Linux. A native Windows way (no
   Docker) is written in the guide, appendix A, for a server where Docker is not allowed.
2. **HTTPS name: a free DuckDNS name with Caddy's DNS challenge** (Let's Encrypt certificate, no public address needed,
   the name points to the computer's network address). The client's own domain with their own certificate is the
   second entry file (`Caddyfile.own-certificate`). The camera needs HTTPS, so there is no "no name" option: a plain
   network address with HTTP blocks the camera.
3. **Caddy image** is built with xcaddy and `caddy-dns/duckdns` (MIT; Caddy itself is Apache-2.0). The website is built
   inside the image build (node:24 stage), so the server needs no Node. Header lists are shared with the proxy samples
   and checked by the header test.
4. **Backend settings on this install**: `APP_ENV` unset (production), `TRUSTED_PROXY_HOPS=1` (exactly Caddy, which
   overwrites `X-Forwarded-For`), `STORAGE_BACKEND=local` (a Docker volume), `RUN_MIGRATIONS_ON_START=true`,
   `RUN_SCHEDULER=true`. Every setting is named in the compose file (no `env_file`), so the DuckDNS token never reaches
   the backend.
5. **Face models**: only `buffalo_s` and the two anti-spoof models are baked into the image (no `buffalo_l`, no INT8
   copies, no sample faces): a smaller image, the same models the live system uses. The backend Dockerfile got an
   optional build argument `INSTALL_PG_TOOLS` (default false, so the Render image is unchanged) for `pg_dump` and
   `pg_restore`, and two folders owned by the app user (`/data/snapshots`, `/backups`).
6. **Backups run inside the backend container** (`backup.ps1` / `backup.sh`, nightly 02:00 by Task Scheduler or cron);
   the wrapper deletes backups older than 30 days (the backup script itself never deletes). A restore test restores
   the newest backup into a throw-away `upasthiti_drill` database and drops it again.
7. **Keys are made by our own backend image** (`make_*_key`) during install and written to `deploy/prod/.env`
   (git-ignored, owner-only). The install never overwrites an existing `.env`. Moving to another computer uses the SAME
   `.env` and `install.* --restore-from <file>` (restore into the empty database first, then start).
8. **Firewall**: Windows rule "Upasthiti HTTPS" for `LocalSubnet` only; Linux asks for the network and uses `ufw`.
9. **Preflight check** `app.scripts.preflight` (new, tested): settings, keys, database and migration, model files,
   photo folder write, server clock against a public clock, security headers of the public address.
10. **Windows start after reboot**: Docker Desktop starts containers only after someone signs in. The install makes
    the task "Upasthiti start" (at sign-in) and the guide tells IT to switch on automatic sign-in on this computer.
    A Linux server needs nothing (Docker starts at boot, containers have `restart: unless-stopped`).
11. **Source code handover** (to the client): not written anywhere, still undecided.

## Not changed

No spec, API or approved rule changed. No new paid thing. CLAUDE.md is not changed by this work (the lead approves any
change first).
