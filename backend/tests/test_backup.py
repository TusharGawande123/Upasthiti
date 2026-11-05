"""Tests for the encrypted backup and restore (F-93): the file format, the manifest, the guards.

pg_dump and pg_restore are replaced by a fake runner, so no PostgreSQL tools are needed; the
real run with real tools is the drill (docs/reports/M6-backup-drill.md).
"""

import json
import tarfile
from pathlib import Path

import pytest
from sqlalchemy import Engine

from app.core.backup_crypto import (
    CHUNK_SIZE_BYTES,
    BackupDecryptionError,
    BackupFormatError,
    decrypt_file,
    encrypt_file,
    read_key_id,
)
from app.core.config import Settings
from app.core.crypto import generate_key_text
from app.scripts import backup
from app.scripts.backup import BackupError, create_backup, restore_backup

KEY_TEXT = generate_key_text()
KEY = backup.decode_key(KEY_TEXT)
FAKE_DUMP = b"PGDMP-fake-dump-bytes" * 1000
FAKE_PASSWORD = "not-a-real-password"
SOURCE_URL = f"postgresql://upasthiti:{FAKE_PASSWORD}@localhost:5432/source_db"  # gitleaks:allow


# --- The encrypted file format -------------------------------------------------------------


def encrypted_copy(tmp_path: Path, plain: bytes, name: str = "a.upsbak") -> Path:
    source = tmp_path / "plain.bin"
    source.write_bytes(plain)
    target = tmp_path / name
    encrypt_file(source, target, key=KEY, key_id="A")
    return target


@pytest.mark.parametrize(
    "size", [0, 1, CHUNK_SIZE_BYTES - 1, CHUNK_SIZE_BYTES, CHUNK_SIZE_BYTES * 2 + 5]
)
def test_encrypt_then_decrypt_gives_the_same_bytes(tmp_path: Path, size: int) -> None:
    plain = bytes(range(256)) * (size // 256 + 1)
    plain = plain[:size]
    encrypted = encrypted_copy(tmp_path, plain)

    decrypt_file(encrypted, tmp_path / "out.bin", key=KEY)

    assert (tmp_path / "out.bin").read_bytes() == plain
    assert plain[:16] not in encrypted.read_bytes() or size < 16
    assert read_key_id(encrypted) == "A"


def test_wrong_key_fails_and_leaves_no_output(tmp_path: Path) -> None:
    encrypted = encrypted_copy(tmp_path, FAKE_DUMP)
    other_key = backup.decode_key(generate_key_text())

    with pytest.raises(BackupDecryptionError):
        decrypt_file(encrypted, tmp_path / "out.bin", key=other_key)
    assert not (tmp_path / "out.bin").exists()


def test_a_changed_byte_fails_and_leaves_no_output(tmp_path: Path) -> None:
    encrypted = encrypted_copy(tmp_path, FAKE_DUMP)
    damaged = bytearray(encrypted.read_bytes())
    damaged[-20] ^= 0x01
    encrypted.write_bytes(bytes(damaged))

    with pytest.raises(BackupDecryptionError):
        decrypt_file(encrypted, tmp_path / "out.bin", key=KEY)
    assert not (tmp_path / "out.bin").exists()


def test_a_renamed_file_is_refused(tmp_path: Path) -> None:
    encrypted = encrypted_copy(tmp_path, FAKE_DUMP, name="first.upsbak")
    renamed = encrypted.rename(tmp_path / "second.upsbak")

    with pytest.raises(BackupDecryptionError):
        decrypt_file(renamed, tmp_path / "out.bin", key=KEY)


def test_a_file_cut_at_a_chunk_border_is_refused(tmp_path: Path) -> None:
    plain = b"x" * (CHUNK_SIZE_BYTES * 2 + 10)
    encrypted = encrypted_copy(tmp_path, plain)
    # Header (13) + first chunk (4 + 12 + 1 MB + 16): keep only that, a clean cut.
    first_chunk_end = 13 + 4 + 12 + CHUNK_SIZE_BYTES + 16
    encrypted.write_bytes(encrypted.read_bytes()[:first_chunk_end])

    with pytest.raises(BackupDecryptionError):
        decrypt_file(encrypted, tmp_path / "out.bin", key=KEY)


def test_a_file_that_is_not_a_backup_is_refused(tmp_path: Path) -> None:
    stranger = tmp_path / "stranger.upsbak"
    stranger.write_bytes(b"this is just a text file, not a backup at all")

    with pytest.raises(BackupFormatError):
        decrypt_file(stranger, tmp_path / "out.bin", key=KEY)


# --- create and restore with a fake runner ---------------------------------------------------


class FakeRunner:
    """Stands in for pg_dump and pg_restore and remembers how it was called."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(
        self,
        arguments: list[str],
        *,
        environment: dict[str, str],
        stdin_path: Path | None = None,
        stdout_path: Path | None = None,
    ) -> None:
        self.calls.append({"arguments": arguments, "environment": environment})
        if stdout_path is not None:
            stdout_path.write_bytes(FAKE_DUMP)
        if stdin_path is not None:
            assert stdin_path.read_bytes() == FAKE_DUMP


def make_settings(
    tmp_path: Path, *, storage: str = "local", key: str | None = KEY_TEXT
) -> Settings:
    snapshot_folder = tmp_path / "store"
    snapshot_folder.mkdir(exist_ok=True)
    (snapshot_folder / "punches").mkdir(exist_ok=True)
    (snapshot_folder / "punches" / "one.bin").write_bytes(b"snapshot")
    return Settings(  # type: ignore[call-arg]
        _env_file=None,  # pyright: ignore[reportCallIssue]
        app_env="test",
        app_version="9.9.9",
        database_url=SOURCE_URL,
        app_secret_key="k" * 32,
        backup_key=key,
        storage_backend=storage,
        storage_local_dir=snapshot_folder,
    )


def test_create_writes_an_encrypted_file_and_a_manifest(
    tmp_path: Path, migrated_engine: Engine
) -> None:
    runner = FakeRunner()
    output = tmp_path / "out"

    path = create_backup(
        output, settings=make_settings(tmp_path), engine=migrated_engine, runner=runner
    )

    assert path.suffix == ".upsbak"
    assert FAKE_DUMP[:20] not in path.read_bytes()
    pg_dump_call = runner.calls[0]
    assert pg_dump_call["arguments"][:2] == ["pg_dump", "-Fc"]
    assert "-d" in pg_dump_call["arguments"]
    assert "source_db" in pg_dump_call["arguments"]
    # The password travels in the environment, never in the arguments (a process list shows them).
    assert FAKE_PASSWORD not in " ".join(pg_dump_call["arguments"])
    assert pg_dump_call["environment"] == {"PGPASSWORD": FAKE_PASSWORD}

    sidecar = json.loads(path.with_name(path.name + ".manifest.json").read_text())
    assert sidecar["alembic_revision"] == backup.newest_alembic_revision()
    assert sidecar["app_version"] == "9.9.9"
    assert sidecar["dump_sha256"] == backup.hashlib.sha256(FAKE_DUMP).hexdigest()
    assert sidecar["snapshot_files"] == 1
    assert "employees" in sidecar["row_counts"]
    assert sidecar["created_at_utc"].endswith("+00:00")

    bundle = tmp_path / "bundle.tar"
    decrypt_file(path, bundle, key=KEY)
    with tarfile.open(bundle) as archive:
        assert sorted(archive.getnames()) == [
            "dump.pgdump",
            "manifest.json",
            "snapshots",
            "snapshots/punches",
            "snapshots/punches/one.bin",
        ]


def test_create_runs_pg_dump_inside_docker_when_asked(
    tmp_path: Path, migrated_engine: Engine
) -> None:
    runner = FakeRunner()

    create_backup(
        tmp_path / "out",
        settings=make_settings(tmp_path),
        engine=migrated_engine,
        runner=runner,
        via_docker=True,
        container="my-postgres",
    )

    arguments = runner.calls[0]["arguments"]
    assert arguments[:6] == ["docker", "exec", "-e", "PGPASSWORD", "my-postgres", "pg_dump"]
    assert "-h" not in arguments  # inside the container the socket is used


def test_create_skips_snapshots_when_storage_is_not_local(
    tmp_path: Path, migrated_engine: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = make_settings(tmp_path, storage="supabase")

    path = create_backup(
        tmp_path / "out", settings=settings, engine=migrated_engine, runner=FakeRunner()
    )

    assert "Snapshots are NOT included" in capsys.readouterr().out
    assert (
        json.loads(path.with_name(path.name + ".manifest.json").read_text())["snapshot_files"]
        is None
    )


def test_create_needs_a_backup_key(tmp_path: Path, migrated_engine: Engine) -> None:
    with pytest.raises(BackupError, match="BACKUP_KEY is not set"):
        create_backup(
            tmp_path / "out",
            settings=make_settings(tmp_path, key=None),
            engine=migrated_engine,
            runner=FakeRunner(),
        )


@pytest.fixture
def made_backup(tmp_path: Path, migrated_engine: Engine) -> Path:
    return create_backup(
        tmp_path / "out",
        settings=make_settings(tmp_path),
        engine=migrated_engine,
        runner=FakeRunner(),
    )


@pytest.mark.parametrize("name", ["upasthiti", "upasthiti_test", "upasthiti_e2e", "restore_not"])
def test_restore_refuses_a_target_name_without_the_safe_ending(
    tmp_path: Path, made_backup: Path, name: str
) -> None:
    runner = FakeRunner()

    with pytest.raises(BackupError, match="does not end in _restore or _drill"):
        restore_backup(
            made_backup, name, settings=make_settings(tmp_path), runner=runner, confirm=True
        )
    assert runner.calls == []


def test_restore_is_a_dry_run_without_confirm(
    tmp_path: Path, made_backup: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    runner = FakeRunner()

    result = restore_backup(made_backup, "x_drill", settings=make_settings(tmp_path), runner=runner)

    assert result is None
    assert runner.calls == []
    output = capsys.readouterr().out
    assert "unchanged" in output and "Dry run" in output and "'x_drill'" in output


def test_restore_with_the_wrong_key_stops_before_anything_is_written(
    tmp_path: Path, made_backup: Path
) -> None:
    runner = FakeRunner()
    wrong = make_settings(tmp_path, key=generate_key_text())

    with pytest.raises(BackupError, match="Cannot read the backup"):
        restore_backup(made_backup, "x_drill", settings=wrong, runner=runner, confirm=True)
    assert runner.calls == []


def test_restore_of_a_modified_file_stops_before_anything_is_written(
    tmp_path: Path, made_backup: Path
) -> None:
    runner = FakeRunner()
    damaged = bytearray(made_backup.read_bytes())
    damaged[len(damaged) // 2] ^= 0xFF
    made_backup.write_bytes(bytes(damaged))

    with pytest.raises(BackupError, match="Cannot read the backup"):
        restore_backup(
            made_backup,
            "x_drill",
            settings=make_settings(tmp_path),
            runner=runner,
            confirm=True,
        )
    assert runner.calls == []


def test_confirmed_restore_runs_pg_restore_and_verifies(
    tmp_path: Path, made_backup: Path, migrated_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fake runner cannot fill a database, so the "restored" database is the test database
    # itself (it holds exactly what the backup's manifest counted).
    runner = FakeRunner()
    monkeypatch.setattr(backup, "prepare_empty_target", lambda target: None)
    monkeypatch.setattr(backup.DatabaseConnection, "engine", lambda self: migrated_engine)
    monkeypatch.setattr(migrated_engine, "dispose", lambda *args, **kwargs: None)
    snapshots = tmp_path / "restored_snapshots"

    checks = restore_backup(
        made_backup,
        "x_restore",
        settings=make_settings(tmp_path),
        runner=runner,
        confirm=True,
        snapshots_dir=snapshots,
    )

    assert checks is not None and all(check.passed for check in checks), checks
    restore_call = runner.calls[0]["arguments"]
    assert restore_call[0] == "pg_restore" and restore_call[-1] == "x_restore"
    assert "--no-owner" in restore_call
    assert (snapshots / "punches" / "one.bin").read_bytes() == b"snapshot"
    assert any("face template" in check.name and "skipped" in check.detail for check in checks)


def test_verification_fails_when_a_row_count_differs(
    tmp_path: Path, migrated_engine: Engine
) -> None:
    counts = backup.read_row_counts(migrated_engine)
    counts["employees"] += 1
    manifest = {
        "row_counts": counts,
        "alembic_revision": backup.read_alembic_revision(migrated_engine),
    }

    checks = backup.verify_restored_database(migrated_engine, manifest, make_settings(tmp_path))

    assert not checks[0].passed and "employees" in checks[0].detail
