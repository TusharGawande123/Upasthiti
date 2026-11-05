# Backup and restore (F-93)

What it is: one command makes an encrypted backup of the database and of the local snapshot
folder; another restores it into a throw-away database and proves it worked. A backup nobody
ever restored is not a backup: try the restore once a quarter (the drill).

## What is in a backup, and what is not

- In: the whole database (`pg_dump`, custom format) and, when `STORAGE_BACKEND=local`, the
  snapshot folder (`STORAGE_LOCAL_DIR`). The file also carries a manifest: migration revision,
  rows per table, sha256 of the dump, time (UTC) and app version.
- Not in: `.env` and the keys. They are never inside a backup (see "The key").
- When snapshots live in Supabase Storage (`STORAGE_BACKEND=supabase`) the script says so and
  skips them: copy that bucket with Supabase's own tools.
- The backup holds personal data and sealed face templates. Never put it on GitHub or send it
  by chat or email. Keep it on a drive the client chooses; keep the key somewhere else.

## The key

1. `uv run python -m app.scripts.make_backup_key` prints a `BACKUP_KEY=` line.
2. Put it in `.env` of the machine that makes backups, and a copy in the password manager,
   NOT on the backup drive. Lose the key and every backup made with it is unreadable.
3. To change the key: make a new one, set `BACKUP_KEY_ID` to the next letter, keep the old key
   until the old backups are not needed. A restore refuses a backup made with another key letter
   and says which letter it needs.
4. To restore face templates for real use, `FACE_TEMPLATE_KEY` is also needed (it is not in the
   backup). Without it the templates come back but cannot be opened.

## Make a backup

From `backend/` (the laptop has no `pg_dump`: add `--via-docker` to run it inside the local
Postgres container; a server with PostgreSQL client tools installed does not need the flag):

    uv run python -m app.scripts.backup create --output-dir D:/upasthiti-backups
    uv run python -m app.scripts.backup create --output-dir D:/upasthiti-backups --via-docker

It prints the file name (`upasthiti-backup-<UTC time>.upsbak`) and writes a readable
`<file>.manifest.json` next to it (counts and a hash only, no personal data).
Do not rename the `.upsbak` file: its name is part of the encryption, a renamed copy is refused.

Run it at night. The manifest counts are read just after the dump, so a write in between (the
daily job) can make the restore check complain about one table; run the backup again then.

## Restore (always into a throw-away database)

Default is a dry run: it decrypts, checks every byte, shows what it would do, changes nothing.

    uv run python -m app.scripts.backup restore --file F.upsbak --target-database upasthiti_restore
    uv run python -m app.scripts.backup restore --file F.upsbak --target-database upasthiti_restore --confirm

- The target name must end in `_restore` or `_drill`; otherwise the command refuses (so it can
  never overwrite `upasthiti`). A target that already has tables is refused too.
- `--snapshots-dir FOLDER` also puts the snapshot files back (otherwise they are only counted).
- `--via-docker` (and `--container NAME`, default `upasthiti-postgres-1`) as above.
- After `pg_restore` it verifies and prints OK or FAIL for: every table's row count equals the
  manifest; the migration revision equals the newest one in the code; one face template opens
  with `FACE_TEMPLATE_KEY` (skipped, and said so, if there is none or the key is not set).
  Exit code 0 only when all pass.
- A wrong key, a changed byte, a renamed or cut-short file stops the command before anything
  is written.

### A real recovery on a new server

Install the same app version, point `DATABASE_URL` at the new EMPTY database, put `BACKUP_KEY`
and `FACE_TEMPLATE_KEY` in `.env`, then restore with `--confirm-any-name` and the real database
name. Afterwards switch the app on and check the Super Admin can sign in and a punch works.

## Schedule (nightly)

The schedule is not in the app (a stopped app must not stop backups). Use the machine's own
scheduler.

Windows Task Scheduler (run daily 02:00, in the `backend` folder; adjust the paths):

    schtasks /Create /SC DAILY /ST 02:00 /TN "Upasthiti backup" /TR "cmd /c cd /d C:\upasthiti\backend && uv run python -m app.scripts.backup create --output-dir D:\upasthiti-backups >> D:\upasthiti-backups\backup.log 2>&1"

Linux cron (`crontab -e`):

    0 2 * * * cd /opt/upasthiti/backend && uv run python -m app.scripts.backup create --output-dir /backups/upasthiti >> /backups/upasthiti/backup.log 2>&1

Delete old backups by your own rule (for example keep 30 daily ones): the script never deletes.
Look at the log after the first night, and once a quarter do a restore drill into a
`_drill` database and check the three OK lines.

First proven run and timings: `docs/reports/M6-backup-drill.md`.
