# M6 backup and restore drill (F-93)

Date: 2026-11-05. Run by Claude on the lead's laptop (Windows 11), local Docker Postgres 17
(`upasthiti-postgres-1`). Only throw-away databases were used (`upasthiti_drill_src`,
`upasthiti_drill_restore`, both dropped afterwards); `upasthiti`, `upasthiti_test` and
`upasthiti_e2e` were never touched. Keys were made for the drill only and discarded.
Commands: `docs/guides/backup-restore.md`.

## What was done

1. Created `upasthiti_drill_src`, ran `alembic upgrade head` (revision 0033).
2. Filled it with the fake data of `make_fake_data` (7 plants, 650 fake employees), plus one
   admin, one consent and one sealed face template (made with a drill-only `FACE_TEMPLATE_KEY`),
   and 200 fake snapshot files of 50 KB in a local snapshot folder.
3. `backup create --via-docker` (pg_dump ran inside the container).
4. Restore checks, then a real restore into `upasthiti_drill_restore`.
5. Dropped both databases and deleted every drill file.

## Timings and sizes

| Step | Time | Size / result |
|---|---|---|
| alembic upgrade head (empty database) | 3.2 s | 33 migrations |
| make_fake_data | 11.6 s | 650 employees |
| backup create (dump + manifest + tar + encrypt) | 3.4 s | dump 424 KB, snapshots 10 MB (200 files), encrypted file 10.8 MB (10,783,085 bytes) |
| restore dry run (decrypt + hash check + plan) | 1.3 s | nothing changed |
| restore --confirm (create DB, pg_restore, 200 snapshots, verify) | 2.3 s | 3 of 3 checks OK |

(Times include starting `uv` and Python, about 1 s.)

## Verification output (real restore)

    The backup is readable and unchanged.
    Backup made 2026-11-05T13:18:27+00:00 (app dev, migration 0033).
    It holds 49 tables and 3363 rows.
    Snapshot files restored: 200.
    [OK] row counts equal the manifest: 49 tables, 3363 rows
    [OK] migration revision is the newest: restored 0033, manifest 0033, code 0033
    [OK] one face template opens with FACE_TEMPLATE_KEY: opened

A restored snapshot file was byte for byte equal to the original (`cmp`).

## Refusals tried for real

| Try | Result |
|---|---|
| target `upasthiti_test` with `--confirm` | refused, name does not end in `_restore` or `_drill`; nothing created |
| wrong `BACKUP_KEY` | "Cannot read the backup", no database created |
| one byte changed in the middle of the file | same refusal, no database created |
| restore into the already restored database | refused, "already has tables" |
| no `--confirm` | dry run only |

## Problems and fixes

- First attempt of a unit test password in a URL was flagged by gitleaks; the test now builds
  the URL from a fake password and an allow comment.
- No real problem in the drill itself; it worked on the first run.
- A changed or renamed file gives the same message on purpose (it never tells an attacker which
  one it was). The file name is part of the encryption, so a renamed backup cannot be read.
- Counts in the manifest are read just after the dump. A write between the two (a live
  system) would show as a FAIL on one table. Documented: run at night, run again if it happens.

## Not proven yet (to do on the client's server)

- Size and speed with real data: this was 3,363 rows and 10 MB. The real system will hold
  months of punches and thousands of photos; the encryption streams in 1 MB chunks so memory
  stays small, but time and disk must be measured there.
- `pg_dump` / `pg_restore` run directly (without `--via-docker`) with the client's PostgreSQL
  version; the tool version must be the same major version as the server or newer.
- The nightly schedule (Task Scheduler or cron) and its log, over several real nights.
- Restore of the real `STORAGE_BACKEND=local` photo folder of that server, and a restore with the
  real face key (the drill used a drill-only key).
- A full recovery on a second machine (new empty database, `--confirm-any-name`), done by a
  teammate following only the runbook (AC-M6-40).
- The Supabase free database and Supabase Storage are not covered by this script's snapshot
  copy (storage is skipped when not local). If the team keeps Supabase, its own backup tools
  are needed.
