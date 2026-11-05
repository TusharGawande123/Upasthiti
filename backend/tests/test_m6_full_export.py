"""The full data export (M6 spec 7.7, R-13; AC-M6-34, 35, 36). Real PostgreSQL, fake data."""

import csv
import glob
import hashlib
import io
import json
import os
import tempfile
import zipfile
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.db import Base
from app.modules.audit.models import AuditLog
from app.modules.auth.passwords import hash_password
from app.modules.exports import service
from app.modules.exports.csv_safe import safe_text, to_cell
from app.modules.exports.tables import (
    ALLOWED_COLUMNS,
    EXCLUDED_COLUMNS,
    EXCLUDED_TABLES,
)
from app.modules.users.models import Role, User
from tests.clock_helpers import frozen_at, ist
from tests.factories import TEST_PASSWORD
from tests.people_helpers import client_for, create_plant, permanent_body

pytestmark = pytest.mark.time_sensitive

TODAY = date(2026, 11, 5)
URL = "/api/v1/exports/full"
RECENT_URL = "/api/v1/exports/recent"
REASON = "Employee asked to see her data"
FORMULA_NAME = '=HYPERLINK("http://bad.example","click")'


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(TODAY, 10, 0)):
        yield


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def export_body(**extra: object) -> dict:
    return {"reason": REASON, "password": TEST_PASSWORD, **extra}


def open_zip(content: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(content))


def read_rows(archive: zipfile.ZipFile, table: str) -> list[dict[str, str]]:
    text = archive.read(f"{table}.csv").decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def temp_export_files() -> set[str]:
    return set(glob.glob(os.path.join(tempfile.gettempdir(), service.TEMP_PREFIX + "*")))


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


# --- The file ---------------------------------------------------------------------------------


def test_ac_m6_34_the_zip_has_a_readme_a_manifest_and_one_csv_per_table(
    boss: TestClient, db_session: Session
) -> None:
    plant = create_plant(boss, db_session, "DEMO1")
    assert boss.post("/api/v1/employees", json=permanent_body(plant)).status_code == 201

    response = boss.post(URL, json=export_body())

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"] == (
        'attachment; filename="upasthiti-export-2026-11-05.zip"'
    )
    archive = open_zip(response.content)
    assert archive.testzip() is None
    names = set(archive.namelist())
    assert {"README.txt", "manifest.json"} <= names
    assert {f"{table}.csv" for table in ALLOWED_COLUMNS} == {n for n in names if n.endswith(".csv")}
    readme = archive.read("README.txt").decode("utf-8")
    assert REASON in readme
    assert "Test super_admin" in readme


def test_ac_m6_34_manifest_counts_and_sha256_match_the_files(
    boss: TestClient, db_session: Session
) -> None:
    plant = create_plant(boss, db_session, "DEMO1")
    for code in ("1043", "1044"):
        body = permanent_body(plant, code=code, name=f"Person {code}")
        assert boss.post("/api/v1/employees", json=body).status_code == 201

    archive = open_zip(boss.post(URL, json=export_body()).content)

    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["total_rows"] == sum(item["rows"] for item in manifest["files"])
    by_table = {item["table"]: item for item in manifest["files"]}
    assert by_table["employees"]["rows"] == 2
    for item in manifest["files"]:
        raw = archive.read(item["file"])
        assert hashlib.sha256(raw).hexdigest() == item["sha256"]
        assert len(read_rows(archive, item["table"])) == item["rows"]
    assert manifest["tables_not_exported"] == EXCLUDED_TABLES


def test_ac_m6_34_plant_and_employee_codes_sit_next_to_the_ids(
    boss: TestClient, db_session: Session
) -> None:
    plant = create_plant(boss, db_session, "DEMO1")
    assert boss.post("/api/v1/employees", json=permanent_body(plant)).status_code == 201

    archive = open_zip(boss.post(URL, json=export_body()).content)

    employee = read_rows(archive, "employees")[0]
    assert employee["plant_code"] == "DEMO1"
    assert employee["employee_code"] == "1043"
    assert employee["full_name"] == "Ravi Patil"


def test_ac_m6_35_forbidden_data_is_not_in_the_file(boss: TestClient, db_session: Session) -> None:
    secret_hash = hash_password("Another-Secret-77")
    db_session.add(
        User(
            name="Second Head",
            username="second.head",
            password_hash=secret_hash,
            role=Role.CORPORATE_HEAD.value,
        )
    )
    db_session.commit()

    response = boss.post(URL, json=export_body())

    archive = open_zip(response.content)
    everything = b"".join(archive.read(name) for name in archive.namelist())
    assert b"$argon2" not in everything
    assert secret_hash.encode() not in everything
    assert TEST_PASSWORD.encode() not in everything
    users = read_rows(archive, "users")
    assert "password_hash" not in users[0]
    assert {row["username"] for row in users} == {"boss", "second.head"}
    for table in EXCLUDED_TABLES:
        assert f"{table}.csv" not in archive.namelist()
    for table, columns in EXCLUDED_COLUMNS.items():
        header = read_rows(archive, table)[0].keys() if read_rows(archive, table) else None
        written = set(json.loads(archive.read("manifest.json"))["columns_not_exported"][table])
        assert written == set(columns)
        if header is not None:
            assert not set(columns) & set(header)


def test_ac_m6_35_every_database_column_is_listed_or_excluded() -> None:
    """A column added by a later milestone must be decided on (exported or left out)."""
    missing: list[str] = []
    for name, table in Base.metadata.tables.items():
        if name in EXCLUDED_TABLES:
            assert name not in ALLOWED_COLUMNS
            continue
        assert name in ALLOWED_COLUMNS or name == "alembic_version", f"{name} has no allow-list"
        allowed = set(ALLOWED_COLUMNS.get(name, ()))
        left_out = set(EXCLUDED_COLUMNS.get(name, {}))
        assert allowed.isdisjoint(left_out), name
        assert allowed <= set(table.c.keys()), f"{name}: an allowed column does not exist"
        missing += [
            f"{name}.{c}"
            for c in (column.name for column in table.c)
            if c not in allowed | left_out
        ]
    assert missing == []


def test_ac_m6_35_a_formula_text_is_written_with_a_quote_in_front(
    boss: TestClient, db_session: Session
) -> None:
    plant = create_plant(boss, db_session, "DEMO1")
    body = permanent_body(plant, name=FORMULA_NAME)
    assert boss.post("/api/v1/employees", json=body).status_code == 201

    archive = open_zip(boss.post(URL, json=export_body()).content)

    assert read_rows(archive, "employees")[0]["full_name"] == "'" + FORMULA_NAME


def test_csv_safe_quotes_only_text_that_starts_like_a_formula() -> None:
    for text in ("=1+1", "+91", "-5 text", "@sum", "\tx", "\rx"):
        assert safe_text(text) == "'" + text
    assert safe_text("Ravi") == "Ravi"
    assert to_cell(-5) == "-5"  # a number is not text
    assert to_cell(None) == ""
    assert to_cell(True) == "true"
    assert to_cell({"a": "=b"}) == '{"a": "=b"}'
    with pytest.raises(ValueError):
        to_cell(b"secret bytes")


# --- The guards -------------------------------------------------------------------------------


def test_ac_m6_36_a_reason_is_required(boss: TestClient) -> None:
    for reason in ("", "  ", "ab"):
        response = boss.post(URL, json=export_body(reason=reason))
        assert response.status_code == 422
        assert error_code(response) == "VALIDATION_FAILED"
    assert boss.post(URL, json={"password": TEST_PASSWORD}).status_code == 422


def test_ac_m6_36_a_wrong_password_is_refused_and_counts_toward_the_lock(
    boss: TestClient, db_session: Session
) -> None:
    before = temp_export_files()

    first = boss.post(URL, json=export_body(password="Wrong-Password-1"))

    assert first.status_code == 403
    assert error_code(first) == "EXPORT_PASSWORD_WRONG"
    user = db_session.scalars(select(User).where(User.username == "boss")).one()
    assert user.failed_login_count == 1
    codes = [boss.post(URL, json=export_body(password="Wrong-Password-1")) for _ in range(4)]
    assert error_code(codes[-1]) == "ACCOUNT_LOCKED"
    # Even the right password is refused while the account is locked, and nothing was built.
    assert error_code(boss.post(URL, json=export_body())) == "ACCOUNT_LOCKED"
    assert temp_export_files() == before
    started = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "export.full.start")
    ).all()
    assert started == []


def test_ac_m6_36_the_fourth_export_in_an_hour_is_refused(boss: TestClient) -> None:
    for _ in range(3):
        assert boss.post(URL, json=export_body()).status_code == 200

    response = boss.post(URL, json=export_body())

    assert response.status_code == 429
    assert error_code(response) == "TOO_MANY_REQUESTS"


def test_ac_m6_36_a_second_export_while_one_runs_is_refused_and_not_counted(
    boss: TestClient, migrated_engine: Engine
) -> None:
    with migrated_engine.connect() as other_connection:
        from sqlalchemy import text

        other_connection.execute(
            text("SELECT pg_advisory_lock(:key)"), {"key": service.EXPORT_LOCK_KEY}
        )
        try:
            response = boss.post(URL, json=export_body())
        finally:
            other_connection.execute(
                text("SELECT pg_advisory_unlock(:key)"), {"key": service.EXPORT_LOCK_KEY}
            )
            other_connection.commit()

    assert response.status_code == 409
    assert error_code(response) == "EXPORT_IN_PROGRESS"
    # The refused try did not use one of the three exports of the hour.
    for _ in range(3):
        assert boss.post(URL, json=export_body()).status_code == 200


def test_ac_m6_36_too_little_disk_space_is_refused_before_anything_starts(
    boss: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "free_disk_bytes", lambda: 0)
    before = temp_export_files()

    response = boss.post(URL, json=export_body())

    assert response.status_code == 503
    assert error_code(response) == "EXPORT_NO_SPACE"
    assert temp_export_files() == before
    assert (
        db_session.scalars(select(AuditLog).where(AuditLog.action.like("export.full%"))).all() == []
    )


@pytest.mark.parametrize("role", [Role.CORPORATE_HEAD, Role.PLANT_HEAD])
def test_ac_m6_36_only_the_super_admin_may_export(
    db_app: FastAPI, db_session: Session, role: Role
) -> None:
    other = client_for(db_app, db_session, role, "other.head")

    assert other.post(URL, json=export_body()).status_code == 403
    assert other.get(RECENT_URL).status_code == 403


def test_ac_m6_36_without_login_the_export_is_refused(db_client: TestClient) -> None:
    assert db_client.post(URL, json=export_body()).status_code == 401
    assert db_client.get(RECENT_URL).status_code == 401


# --- Audit and clean-up -----------------------------------------------------------------------


def test_ac_m6_34_the_start_and_the_end_are_audited_and_no_temp_file_stays(
    boss: TestClient, db_session: Session
) -> None:
    before = temp_export_files()

    response = boss.post(URL, json=export_body())

    assert response.status_code == 200
    assert temp_export_files() == before
    entries = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action.like("export.full%"))
        .order_by(AuditLog.at, AuditLog.id)
    ).all()
    assert {entry.action for entry in entries} == {"export.full.start", "export.full"}
    assert all(entry.reason == REASON for entry in entries)
    end = next(entry for entry in entries if entry.action == "export.full")
    assert end.after is not None
    assert end.after["status"] == "done"
    assert end.after["size_bytes"] == len(response.content)
    assert TEST_PASSWORD not in str(end.after)


def test_ac_m6_34_a_failed_build_leaves_no_file_and_is_audited_as_interrupted(
    boss: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_write(*_arguments: object) -> None:
        raise RuntimeError("disk problem")

    monkeypatch.setattr(service, "_write_table", broken_write)
    before = temp_export_files()

    response = boss.post(URL, json=export_body())

    assert response.status_code == 500
    assert temp_export_files() == before
    end = db_session.scalars(select(AuditLog).where(AuditLog.action == "export.full")).one()
    assert end.after is not None
    assert end.after["status"] == "interrupted"


def test_the_recent_list_shows_the_last_exports_newest_first(boss: TestClient) -> None:
    for _ in range(2):
        assert boss.post(URL, json=export_body()).status_code == 200

    response = boss.get(RECENT_URL)

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 2
    assert items[0]["status"] == "done"
    assert items[0]["actor_name"] == "Test super_admin"
    assert items[0]["reason"] == REASON
    assert items[0]["size_bytes"] > 0
