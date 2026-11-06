#!/bin/sh
# Upasthiti backup helper (Linux). Run from deploy/prod (cron does this).
#   ./backup.sh create          make an encrypted backup, delete backups older than KEEP_DAYS (default 30)
#   ./backup.sh test-restore    restore the newest backup into a throw-away database and check it
# Backup files go to BACKUP_DIR of .env. BACKUP_KEY is NOT in the backup: keep it in the password manager.
set -eu
cd "$(dirname "$0")"
ACTION="${1:-create}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_DIR="$(grep '^BACKUP_DIR=' .env | cut -d= -f2-)"
[ -n "$BACKUP_DIR" ] || { echo "BACKUP_DIR is not set in .env"; exit 1; }
LOG="$BACKUP_DIR/backup.log"
log() { echo "$(date -Iseconds) $1" >> "$LOG"; }

case "$ACTION" in
  create)
    log "backup starting"
    if ! docker compose exec -T backend python -m app.scripts.backup create --output-dir /backups >> "$LOG" 2>&1; then
      log "BACKUP FAILED"; exit 1
    fi
    # The script never deletes: the age rule lives here (file and manifest).
    find "$BACKUP_DIR" -maxdepth 1 -name 'upasthiti-backup-*' -mtime +"$KEEP_DAYS" -delete
    log "backup finished, files older than $KEEP_DAYS days removed"
    ;;
  test-restore)
    NEWEST="$(ls -t "$BACKUP_DIR"/*.upsbak 2>/dev/null | head -n 1)"
    [ -n "$NEWEST" ] || { echo "No backup file found in $BACKUP_DIR"; exit 1; }
    echo "Restoring $(basename "$NEWEST") into the throw-away database upasthiti_drill ..."
    docker compose exec -T postgres psql -U upasthiti -d postgres -c "DROP DATABASE IF EXISTS upasthiti_drill" >/dev/null
    set +e
    docker compose exec -T backend python -m app.scripts.backup restore \
      --file "/backups/$(basename "$NEWEST")" --target-database upasthiti_drill --confirm
    CODE=$?
    set -e
    docker compose exec -T postgres psql -U upasthiti -d postgres -c "DROP DATABASE IF EXISTS upasthiti_drill" >/dev/null
    if [ "$CODE" -eq 0 ]; then echo "RESTORE TEST PASSED"; else echo "RESTORE TEST FAILED"; fi
    exit "$CODE"
    ;;
  *) echo "Use: ./backup.sh create | test-restore"; exit 2 ;;
esac
