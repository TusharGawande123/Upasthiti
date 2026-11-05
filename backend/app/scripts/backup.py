"""Encrypted backup and restore of the database and the snapshot folder (F-93):

    uv run python -m app.scripts.backup create --output-dir BACKUP_FOLDER
    uv run python -m app.scripts.backup restore --file F --target-database NAME_restore
    uv run python -m app.scripts.backup restore --file F --target-database NAME_restore --confirm

`create` runs pg_dump (custom format) on the database of DATABASE_URL, adds a copy of the local
snapshot folder (only when STORAGE_BACKEND=local), writes a manifest (migration revision, rows
per table, sha256 of the dump) and encrypts it all with BACKUP_KEY (chunked AES-256-GCM, see
app/core/backup_crypto.py). The backup holds personal data and sealed face templates: keep the
key apart from the backup drive, and never put a backup on GitHub.

`restore` never touches the live database. The target database name must end in `_restore` or
`_drill` (unless --confirm-any-name is given, for a real recovery on a new server), and without
--confirm it only decrypts, checks and shows what it would do. After `pg_restore` it VERIFIES:
row counts equal the manifest, the migration revision is the newest one this code knows, and one
face template opens with FACE_TEMPLATE_KEY.

The laptop has no pg_dump: --via-docker runs pg_dump / pg_restore inside the local Postgres
container (`docker exec`). The schedule (Task Scheduler or cron) is in docs/guides/runbook.md.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL, make_url

from app.core.backup_crypto import (
    BackupDecryptionError,
    BackupFormatError,
    decrypt_file,
    encrypt_file,
    read_key_id,
)
from app.core.config import Settings, load_settings_or_exit
from app.core.crypto import (
    FaceDecryptionError,
    SealedVector,
    decode_key,
    open_vector,
    template_binding,
)

BACKUP_FOLDER_BACKEND = Path(__file__).resolve().parents[2]
DEFAULT_DOCKER_CONTAINER = "upasthiti-postgres-1"
ALLOWED_TARGET_ENDINGS = ("_restore", "_drill")
BACKUP_FILE_SUFFIX = ".upsbak"
DUMP_NAME_IN_ARCHIVE = "dump.pgdump"
MANIFEST_NAME_IN_ARCHIVE = "manifest.json"
SNAPSHOT_FOLDER_IN_ARCHIVE = "snapshots"
MANIFEST_FORMAT_VERSION = 1


class BackupError(Exception):
    """The backup or restore stopped; the message says why (it never holds a secret)."""


# --- Running pg_dump and pg_restore (replaceable in tests) -------------------------------


class CommandRunner(Protocol):
    def __call__(
        self,
        arguments: list[str],
        *,
        environment: dict[str, str],
        stdin_path: Path | None = None,
        stdout_path: Path | None = None,
    ) -> None: ...


def run_command(
    arguments: list[str],
    *,
    environment: dict[str, str],
    stdin_path: Path | None = None,
    stdout_path: Path | None = None,
) -> None:
    """Run a program; its output goes to a file (binary-safe) or is dropped. Raises BackupError."""
    stdin_file = stdin_path.open("rb") if stdin_path else None
    stdout_file = stdout_path.open("wb") if stdout_path else subprocess.DEVNULL
    try:
        result = subprocess.run(  # noqa: S603 (fixed argument list, no shell)
            arguments,
            env={**os.environ, **environment},
            stdin=stdin_file,
            stdout=stdout_file,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        raise BackupError(
            f"{arguments[0]} was not found. Install it, or use --via-docker."
        ) from None
    finally:
        if stdin_file:
            stdin_file.close()
        if stdout_path:
            stdout_file.close()  # type: ignore[union-attr]
    if result.returncode != 0:
        details = result.stderr.decode(errors="replace").strip()[-600:]
        raise BackupError(f"{Path(arguments[0]).name} failed (code {result.returncode}): {details}")


@dataclass(frozen=True)
class DatabaseConnection:
    """Where the database is, taken apart from a DATABASE_URL (the password stays secret)."""

    url: URL

    @property
    def name(self) -> str:
        return self.url.database or ""

    def with_database(self, name: str) -> DatabaseConnection:
        return DatabaseConnection(self.url.set(database=name))

    def environment(self) -> dict[str, str]:
        # The password goes through the environment, so it never shows in a process list.
        return {"PGPASSWORD": self.url.password} if self.url.password else {}

    def client_options(self, *, via_docker: bool) -> list[str]:
        """The connection options of pg_dump / pg_restore. Inside Docker the socket is used."""
        options = ["-U", self.url.username or "postgres"]
        if not via_docker:
            options += ["-h", self.url.host or "localhost", "-p", str(self.url.port or 5432)]
        return options

    def engine(self) -> Engine:
        return create_engine(self.url, hide_parameters=True, isolation_level="AUTOCOMMIT")


def wrap_for_docker(
    arguments: list[str], connection: DatabaseConnection, container: str, *, needs_stdin: bool
) -> list[str]:
    docker = ["docker", "exec"]
    if needs_stdin:
        docker.append("-i")
    if connection.url.password:
        docker += ["-e", "PGPASSWORD"]  # the value is taken from our environment
    return [*docker, container, *arguments]


# --- Facts about a database ---------------------------------------------------------------


def read_row_counts(engine: Engine) -> dict[str, int]:
    """Rows in every table of the public schema (exact counts)."""
    quote = engine.dialect.identifier_preparer.quote
    with engine.connect() as connection:
        names = connection.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
            )
        ).scalars()
        return {
            name: connection.execute(text(f"SELECT count(*) FROM {quote(name)}")).scalar_one()  # noqa: S608
            for name in list(names)
        }


def read_alembic_revision(engine: Engine) -> str | None:
    with engine.connect() as connection:
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()


def newest_alembic_revision() -> str:
    """The migration this code expects (the head of backend/migrations)."""
    config = Config()
    config.set_main_option("script_location", str(BACKUP_FOLDER_BACKEND / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    if head is None:
        raise BackupError("no migrations were found")
    return head


def sha256_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


# --- create ------------------------------------------------------------------------------


def require_backup_key(settings: Settings) -> bytes:
    if settings.backup_key is None:
        raise BackupError(
            "BACKUP_KEY is not set. Make one with `uv run python -m app.scripts.make_backup_key`."
        )
    return decode_key(settings.backup_key.get_secret_value())


def snapshot_folder_to_copy(settings: Settings) -> Path | None:
    """The local snapshot folder, or None (with the reason printed) when storage is not local."""
    if settings.storage_backend != "local":
        print(
            "Snapshots are NOT included: STORAGE_BACKEND is not 'local'. Photos kept in "
            "Supabase Storage (or another store) have to be copied by that store's own tools."
        )
        return None
    if not settings.storage_local_dir.is_dir():
        print(f"Snapshots are NOT included: the folder {settings.storage_local_dir} is missing.")
        return None
    return settings.storage_local_dir


def build_manifest(
    *, engine: Engine, settings: Settings, dump_path: Path, snapshot_file_count: int | None
) -> dict:
    return {
        "format_version": MANIFEST_FORMAT_VERSION,
        "created_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "app_version": settings.app_version,
        "alembic_revision": read_alembic_revision(engine),
        "row_counts": read_row_counts(engine),
        "dump_sha256": sha256_of_file(dump_path),
        "dump_size_bytes": dump_path.stat().st_size,
        "snapshot_files": snapshot_file_count,  # None = snapshots not included
    }


def count_files(folder: Path) -> int:
    return sum(1 for path in folder.rglob("*") if path.is_file())


def write_archive(
    archive_path: Path, dump_path: Path, manifest: dict, snapshot_folder: Path | None
) -> None:
    manifest_path = archive_path.with_name(MANIFEST_NAME_IN_ARCHIVE)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with tarfile.open(archive_path, "w") as archive:  # the dump is already compressed
        archive.add(dump_path, arcname=DUMP_NAME_IN_ARCHIVE)
        archive.add(manifest_path, arcname=MANIFEST_NAME_IN_ARCHIVE)
        if snapshot_folder is not None:
            archive.add(snapshot_folder, arcname=SNAPSHOT_FOLDER_IN_ARCHIVE)


def create_backup(
    output_dir: Path,
    *,
    settings: Settings,
    engine: Engine,
    runner: CommandRunner,
    via_docker: bool = False,
    container: str = DEFAULT_DOCKER_CONTAINER,
) -> Path:
    """Make one encrypted backup file in output_dir and return its path."""
    key = require_backup_key(settings)
    connection = DatabaseConnection(make_url(settings.database_url))
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = output_dir / f"upasthiti-backup-{stamp}{BACKUP_FILE_SUFFIX}"

    with tempfile.TemporaryDirectory(prefix="upasthiti-backup-") as work_folder:
        work = Path(work_folder)
        dump_path = work / DUMP_NAME_IN_ARCHIVE
        arguments = ["pg_dump", "-Fc", *connection.client_options(via_docker=via_docker)]
        arguments += ["-d", connection.name]
        if via_docker:
            arguments = wrap_for_docker(arguments, connection, container, needs_stdin=False)
        runner(arguments, environment=connection.environment(), stdout_path=dump_path)
        if dump_path.stat().st_size == 0:
            raise BackupError("pg_dump wrote nothing")

        snapshot_folder = snapshot_folder_to_copy(settings)
        manifest = build_manifest(
            engine=engine,
            settings=settings,
            dump_path=dump_path,
            snapshot_file_count=count_files(snapshot_folder) if snapshot_folder else None,
        )
        archive_path = work / "bundle.tar"
        write_archive(archive_path, dump_path, manifest, snapshot_folder)
        encrypt_file(archive_path, backup_path, key=key, key_id=settings.backup_key_id)

    # The manifest holds counts and a hash only (no personal data): a readable copy helps people.
    backup_path.with_name(backup_path.name + ".manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return backup_path


# --- restore -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str


def check_target_name(name: str, *, confirm_any_name: bool) -> None:
    if confirm_any_name:
        return
    if not name.endswith(ALLOWED_TARGET_ENDINGS):
        raise BackupError(
            f"Refused: the target database {name!r} does not end in _restore or _drill. "
            "That guard keeps a restore away from a live database. For a real recovery on a "
            "new server add --confirm-any-name."
        )


def open_and_check_backup(file: Path, work: Path, settings: Settings) -> tuple[dict, Path]:
    """Decrypt everything (any change or a wrong key stops here) and return manifest + bundle."""
    key = require_backup_key(settings)
    if not file.is_file():
        raise BackupError(f"The file {file} does not exist.")
    try:
        key_id = read_key_id(file)
        if key_id != settings.backup_key_id:
            raise BackupError(
                f"This backup was made with key {key_id}, but BACKUP_KEY_ID is "
                f"{settings.backup_key_id}. Use the key with that letter."
            )
        bundle = work / "bundle.tar"
        decrypt_file(file, bundle, key=key)
    except (BackupDecryptionError, BackupFormatError) as problem:
        raise BackupError(f"Cannot read the backup: {problem}.") from None
    with tarfile.open(bundle) as archive:
        manifest_file = archive.extractfile(MANIFEST_NAME_IN_ARCHIVE)
        if manifest_file is None:
            raise BackupError("The backup has no manifest.")
        manifest = json.loads(manifest_file.read())
        archive.extract(DUMP_NAME_IN_ARCHIVE, work, filter="data")
    if sha256_of_file(work / DUMP_NAME_IN_ARCHIVE) != manifest["dump_sha256"]:
        raise BackupError("The dump does not match the manifest hash.")
    return manifest, bundle


def describe_plan(manifest: dict, target: str, snapshots_dir: Path | None) -> list[str]:
    tables = manifest["row_counts"]
    lines = [
        f"Backup made {manifest['created_at_utc']} (app {manifest['app_version']}, "
        f"migration {manifest['alembic_revision']}).",
        f"It holds {len(tables)} tables and {sum(tables.values())} rows.",
        f"Will create the database {target!r} (if missing; it must be empty) and restore into it.",
    ]
    if manifest["snapshot_files"] is None:
        lines.append("It holds no snapshot files.")
    elif snapshots_dir is None:
        lines.append(
            f"It holds {manifest['snapshot_files']} snapshot files; they are NOT restored "
            "(add --snapshots-dir FOLDER to restore them)."
        )
    else:
        lines.append(f"Will copy {manifest['snapshot_files']} snapshot files to {snapshots_dir}.")
    return lines


def prepare_empty_target(target: DatabaseConnection) -> None:
    """Create the target database if it is missing; refuse one that already has tables."""
    maintenance = target.with_database("postgres").engine()
    try:
        with maintenance.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.name}
            ).scalar()
            if not exists:
                quoted = maintenance.dialect.identifier_preparer.quote(target.name)
                connection.execute(text(f"CREATE DATABASE {quoted}"))
    finally:
        maintenance.dispose()
    engine = target.engine()
    try:
        if read_row_counts(engine):
            raise BackupError(f"The database {target.name!r} already has tables: use an empty one.")
    finally:
        engine.dispose()


def run_pg_restore(
    dump_path: Path,
    target: DatabaseConnection,
    *,
    runner: CommandRunner,
    via_docker: bool,
    container: str,
) -> None:
    arguments = ["pg_restore", *target.client_options(via_docker=via_docker)]
    # Owners and grants belong to the server the backup came from, not to this one.
    arguments += ["--no-owner", "--no-privileges", "--exit-on-error", "-d", target.name]
    if via_docker:
        arguments = wrap_for_docker(arguments, target, container, needs_stdin=True)
    runner(arguments, environment=target.environment(), stdin_path=dump_path)


def restore_snapshots(bundle: Path, snapshots_dir: Path) -> int:
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    with tarfile.open(bundle) as archive:
        for member in archive.getmembers():
            prefix = SNAPSHOT_FOLDER_IN_ARCHIVE + "/"
            if member.isfile() and member.name.startswith(prefix):
                member.name = member.name[len(prefix) :]
                archive.extract(member, snapshots_dir, filter="data")
                count += 1
    return count


def verify_restored_database(engine: Engine, manifest: dict, settings: Settings) -> list[Check]:
    """The proof that the restore worked: counts, migration head and one readable template."""
    counts = read_row_counts(engine)
    differing = [
        name for name in manifest["row_counts"] if counts.get(name) != manifest["row_counts"][name]
    ]
    extra = sorted(set(counts) - set(manifest["row_counts"]))
    revision = read_alembic_revision(engine)
    newest = newest_alembic_revision()
    return [
        Check(
            "row counts equal the manifest",
            not differing and not extra,
            f"{len(counts)} tables, {sum(counts.values())} rows"
            if not differing and not extra
            else f"different: {differing + extra}",
        ),
        Check(
            "migration revision is the newest",
            revision == newest and revision == manifest["alembic_revision"],
            f"restored {revision}, manifest {manifest['alembic_revision']}, code {newest}"
            + ("" if revision == newest else " (run `alembic upgrade head` after the restore)"),
        ),
        check_one_face_template(engine, settings),
    ]


def check_one_face_template(engine: Engine, settings: Settings) -> Check:
    name = "one face template opens with FACE_TEMPLATE_KEY"
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT employee_id, model_id, key_id, nonce, ciphertext FROM face_templates "
                "WHERE deleted_at IS NULL LIMIT 1"
            )
        ).first()
    if row is None:
        return Check(name, True, "skipped: the backup holds no face template")
    if settings.face_template_key is None:
        return Check(name, True, "skipped: FACE_TEMPLATE_KEY is not set on this machine")
    key = decode_key(settings.face_template_key.get_secret_value())
    sealed = SealedVector(bytes(row.nonce), bytes(row.ciphertext))
    try:
        open_vector(sealed, template_binding(row.employee_id, row.model_id, row.key_id), key)
    except FaceDecryptionError:
        return Check(name, False, "the template does not open: wrong FACE_TEMPLATE_KEY?")
    return Check(name, True, "opened")


def restore_backup(
    file: Path,
    target_database: str,
    *,
    settings: Settings,
    runner: CommandRunner,
    confirm: bool = False,
    confirm_any_name: bool = False,
    via_docker: bool = False,
    container: str = DEFAULT_DOCKER_CONTAINER,
    snapshots_dir: Path | None = None,
    say: Callable[[str], None] = print,
) -> list[Check] | None:
    """Restore into target_database. Returns the checks, or None for a dry run."""
    check_target_name(target_database, confirm_any_name=confirm_any_name)
    with tempfile.TemporaryDirectory(prefix="upasthiti-restore-") as work_folder:
        work = Path(work_folder)
        manifest, bundle = open_and_check_backup(file, work, settings)
        say("The backup is readable and unchanged.")
        for line in describe_plan(manifest, target_database, snapshots_dir):
            say(line)
        if not confirm:
            say("Dry run: nothing was changed. Add --confirm to restore.")
            return None

        target = DatabaseConnection(make_url(settings.database_url)).with_database(target_database)
        prepare_empty_target(target)
        run_pg_restore(
            work / DUMP_NAME_IN_ARCHIVE,
            target,
            runner=runner,
            via_docker=via_docker,
            container=container,
        )
        if snapshots_dir is not None and manifest["snapshot_files"]:
            say(f"Snapshot files restored: {restore_snapshots(bundle, snapshots_dir)}.")
        engine = target.engine()
        try:
            return verify_restored_database(engine, manifest, settings)
        finally:
            engine.dispose()


# --- command line ------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Encrypted backup and restore (F-93).")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="make an encrypted backup file")
    create.add_argument("--output-dir", required=True, type=Path)

    restore = commands.add_parser("restore", help="restore a backup into a throw-away database")
    restore.add_argument("--file", required=True, type=Path)
    restore.add_argument("--target-database", required=True)
    restore.add_argument("--confirm", action="store_true", help="really restore (default: check)")
    restore.add_argument(
        "--confirm-any-name",
        action="store_true",
        help="allow a target name that does not end in _restore or _drill (real recovery)",
    )
    restore.add_argument("--snapshots-dir", type=Path, help="also restore the snapshot files here")

    for command in (create, restore):
        command.add_argument("--via-docker", action="store_true", help="run pg tools in Docker")
        command.add_argument("--container", default=DEFAULT_DOCKER_CONTAINER)
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    settings = load_settings_or_exit()
    try:
        if arguments.command == "create":
            engine = DatabaseConnection(make_url(settings.database_url)).engine()
            path = create_backup(
                arguments.output_dir,
                settings=settings,
                engine=engine,
                runner=run_command,
                via_docker=arguments.via_docker,
                container=arguments.container,
            )
            print(f"Backup written: {path} ({path.stat().st_size} bytes)")
            return 0
        checks = restore_backup(
            arguments.file,
            arguments.target_database,
            settings=settings,
            runner=run_command,
            confirm=arguments.confirm,
            confirm_any_name=arguments.confirm_any_name,
            via_docker=arguments.via_docker,
            container=arguments.container,
            snapshots_dir=arguments.snapshots_dir,
        )
    except BackupError as problem:
        print(f"Stopped: {problem}")
        return 1
    if checks is None:
        return 0
    for check in checks:
        print(f"[{'OK' if check.passed else 'FAIL'}] {check.name}: {check.detail}")
    return 0 if all(check.passed for check in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
