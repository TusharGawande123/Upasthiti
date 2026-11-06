#!/bin/sh
# Upasthiti - one-command install on a Linux server with Docker (own-server install).
# Run from deploy/prod:   sudo ./install.sh        (safe to run again; never overwrites .env)
# It checks Docker, asks for the address name (DuckDNS or the client's own), makes .env with fresh
# keys, builds and starts everything, sets the firewall (ufw, if present) and the nightly backup
# (cron), runs the preflight check and asks you to create the first Super Admin.
# Moving from another computer:  sudo ./install.sh --restore-from /path/to/file.upsbak
# (the .env of the old computer must already be in this folder: same keys; guide section 10).
set -eu
cd "$(dirname "$0")"
RESTORE_FROM=""
if [ "${1:-}" = "--restore-from" ]; then RESTORE_FROM="${2:-}"; fi

step() { printf '\n== %s\n' "$1"; }
stop() { printf '\nSTOP: %s\n' "$1"; exit 1; }
ask() { printf '%s [%s]: ' "$1" "$2" >&2; read -r answer; echo "${answer:-$2}"; }

step "1. Checking this computer"
command -v docker >/dev/null 2>&1 || stop "Docker is not installed (guide section 3)."
docker info >/dev/null 2>&1 || stop "Docker is not running or you are not allowed to use it (try sudo)."
docker compose version >/dev/null 2>&1 || stop "'docker compose' plugin is missing."
FREE_GB=$(df -P . | awk 'NR==2 {print int($4/1024/1024)}')
[ "$FREE_GB" -ge 20 ] || stop "Only $FREE_GB GB free here. At least 20 GB is needed."
echo "Docker works. Free disk: ${FREE_GB} GB."

# Compose wants every secret present even to build: throw-away values for the build command only.
BUILD_ONLY="POSTGRES_PASSWORD=x APP_SECRET_KEY=x QR_SIGNING_KEY=x SNAPSHOT_ENCRYPTION_KEY=x FACE_TEMPLATE_KEY=x OFFLINE_EVIDENCE_KEY=x BACKUP_KEY=x APP_PUBLIC_ORIGIN=https://build-only.invalid SITE_ADDRESS=build-only.invalid"

step "2. Settings and secret keys"
if [ -f .env ]; then
  echo ".env already exists: keeping it (your keys stay the same)."
else
  printf 'Address name WITHOUT https:// (example: yourname.duckdns.org): '; read -r SITE_NAME
  echo "$SITE_NAME" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || stop "That is not a valid name."
  PORT=$(ask "HTTPS port people will use (443, or 8443 if 443 is busy)" 443)
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then stop "Port $PORT is already in use. Run again and choose 8443."; fi
  printf 'DuckDNS token (typing is hidden; leave empty if you use your own certificate): '
  stty -echo; read -r DUCK_TOKEN; stty echo; echo
  BACKUP_FOLDER=$(ask "Folder for backup files (another disk if there is one)" /backups/upasthiti)
  mkdir -p "$BACKUP_FOLDER"
  # The backend runs as user 10001 inside the container and must write here.
  chown 10001 "$BACKUP_FOLDER" 2>/dev/null || chmod 777 "$BACKUP_FOLDER"
  ORIGIN="https://$SITE_NAME"; [ "$PORT" = "443" ] || ORIGIN="https://$SITE_NAME:$PORT"
  CADDYFILE=Caddyfile.duckdns; [ -n "$DUCK_TOKEN" ] || CADDYFILE=Caddyfile.own-certificate

  step "2b. Building the images (first time: 10 to 25 minutes, needs internet)"
  env $BUILD_ONLY docker compose build
  new_key() { docker run --rm upasthiti-backend:prod python -m "$1" | head -n 1; }
  POSTGRES_PASSWORD=$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  APP_SECRET=$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
  umask 077
  {
    echo "# Made by install.sh. SECRET: never commit, never send by chat or email."
    echo "SITE_ADDRESS=$SITE_NAME"
    echo "APP_PUBLIC_ORIGIN=$ORIGIN"
    echo "HTTPS_PORT=$PORT"
    echo "DUCKDNS_TOKEN=$DUCK_TOKEN"
    echo "CADDYFILE=$CADDYFILE"
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    echo "APP_SECRET_KEY=$APP_SECRET"
    new_key app.scripts.make_qr_key; echo "QR_SIGNING_KEY_ID=A"
    new_key app.scripts.make_snapshot_key
    new_key app.scripts.make_face_key
    new_key app.scripts.make_offline_key; echo "OFFLINE_EVIDENCE_KEY_ID=A"
    new_key app.scripts.make_backup_key; echo "BACKUP_KEY_ID=A"
    echo "BACKUP_DIR=$BACKUP_FOLDER"
    echo "CERT_DIR=./certs"
    echo "APP_VERSION=prod"
    echo "LOG_LEVEL=INFO"
  } > .env
  chmod 600 .env
  echo ".env written with new keys."
  if [ -n "$DUCK_TOKEN" ]; then
    LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    if [ "$(ask "Point $SITE_NAME to this computer's network address ($LAN_IP) on DuckDNS now? (y/n)" y)" = "y" ] && [ -n "$LAN_IP" ]; then
      echo "DuckDNS answered: $(curl -fsS "https://www.duckdns.org/update?domains=${SITE_NAME%.duckdns.org}&token=$DUCK_TOKEN&ip=$LAN_IP")"
    fi
  fi
fi

if [ -n "$RESTORE_FROM" ]; then
  step "2c. Restoring the backup of the old computer"
  [ -f "$RESTORE_FROM" ] || stop "Backup file not found: $RESTORE_FROM"
  BACKUP_FOLDER=$(grep '^BACKUP_DIR=' .env | cut -d= -f2-)
  mkdir -p "$BACKUP_FOLDER"
  cp "$RESTORE_FROM" "$BACKUP_FOLDER/"
  chown 10001 "$BACKUP_FOLDER" 2>/dev/null || chmod 777 "$BACKUP_FOLDER"
  docker compose build
  docker compose up -d postgres
  sleep 15
  # The file name is part of the encryption: it must stay as the old computer made it.
  docker compose run --rm --no-deps backend python -m app.scripts.backup restore     --file "/backups/$(basename "$RESTORE_FROM")" --target-database upasthiti --confirm-any-name --confirm     --snapshots-dir /data/snapshots || stop "The restore failed. Nothing was started. Read the lines above."
  echo "Restore finished and checked."
fi

step "3. Starting the system"
docker compose up -d --build
echo "Waiting for the backend to become healthy (up to 5 minutes)..."
i=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' upasthiti-backend-1 2>/dev/null)" = "healthy" ]; do
  i=$((i+1)); [ "$i" -le 60 ] || stop "The backend did not become healthy. Run: docker compose logs backend"
  sleep 5
done
echo "Backend is healthy."

step "4. Firewall"
PORT=$(grep '^HTTPS_PORT=' .env | cut -d= -f2)
if command -v ufw >/dev/null 2>&1; then
  SUBNET=$(ask "Plant network (CIDR, example 192.168.1.0/24; empty = skip)" "")
  if [ -n "$SUBNET" ]; then ufw allow from "$SUBNET" to any port "$PORT" proto tcp; else echo "Skipped: set the firewall yourself (guide section 6)."; fi
else
  echo "ufw not found: set the firewall yourself so only the plant network reaches port $PORT."
fi

step "5. Nightly backup (cron, 02:00)"
HERE=$(pwd)
( crontab -l 2>/dev/null | grep -v 'upasthiti-backup-job' ; echo "0 2 * * * cd $HERE && ./backup.sh create # upasthiti-backup-job" ) | crontab -
echo "Cron line added."

step "6. Preflight check"
docker compose exec -T backend python -m app.scripts.preflight || true

step "7. First Super Admin"
echo "It asks for a username, name and password (typing is hidden). It refuses if one already exists."
docker compose exec backend python -m app.scripts.create_super_admin || true

step "Done"
ORIGIN=$(grep '^APP_PUBLIC_ORIGIN=' .env | cut -d= -f2-)
echo "Admin website            : $ORIGIN/admin"
echo "Attendance device screen : $ORIGIN/attendance"
echo
echo "NOW, BEFORE ANYTHING ELSE: copy the keys of $(pwd)/.env into the company password manager:"
echo "QR_SIGNING_KEY, SNAPSHOT_ENCRYPTION_KEY, FACE_TEMPLATE_KEY, OFFLINE_EVIDENCE_KEY, BACKUP_KEY, POSTGRES_PASSWORD."
echo "Lost keys mean lost cards, photos, faces and backups. See docs/guides/install-guide.md, section 8."
