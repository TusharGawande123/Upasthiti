"""The full data export (M6 spec 7.7, R-13): everything the system holds, as one ZIP of CSV files.

The Super Admin downloads it to his own computer (for example to answer a "show me my data"
request, or as an archive). The guards run in this order: password again, three exports an hour,
one at a time, enough free disk space. Then the file is built in a temporary file on disk, one
table after another and in small batches (nothing is held fully in memory), with a manifest
(row counts and a SHA-256 of every file). The route sends it from disk and removes it.
Which columns are written is decided by the allow-list in `tables.py`, never by `SELECT *`.
"""

import csv
import hashlib
import io
import json
import logging
import os
import shutil
import tempfile
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Connection, Select, Table, desc, select, text
from sqlalchemy.orm import Session

from app.core.db import Base
from app.core.errors import ApiError
from app.core.time import to_ist, utc_now
from app.modules.audit.models import AuditLog
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.rate_limit import full_export_limiter
from app.modules.auth.service import check_password_again
from app.modules.exports.csv_safe import to_cell
from app.modules.exports.schemas import RecentExport
from app.modules.exports.tables import (
    ALLOWED_COLUMNS,
    EXCLUDED_COLUMNS,
    EXCLUDED_TABLES,
    KEY_COLUMN_OF_TABLE,
)
from app.modules.reports.streaming import delete_file
from app.modules.users.models import User

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000
# Any fixed number: "an export is running" is this advisory lock of the database.
EXPORT_LOCK_KEY = 7_340_034_001
# A little free space is always kept for the rest of the server.
DISK_RESERVE_BYTES = 20 * 1024 * 1024
TEMP_PREFIX = "upasthiti-export-"
# Rows of these tables get the plant code and/or the employee code next to the ids, so a reader
# can tell DEMO plants apart and does not have to look an employee up by id.
PLANT_CODE_COLUMN = "plant_code"
EMPLOYEE_CODE_COLUMN = "employee_code"

README_TEXT = """UPASTHITI - FULL DATA EXPORT

Made on {made_ist} IST ({made_utc} UTC) by {actor}.
Reason given: {reason}

WARNING: this file holds personal data of many people. Keep it on an encrypted drive, never send
it through chat, email or GitHub, and delete it when it is no longer needed.

What is inside
- one CSV file per table (UTF-8, comma separated), named after the table
- manifest.json: the rows of every file and a SHA-256 to check that a file is complete
- all times are in UTC (add 5 hours 30 minutes for Indian time)
- rows of a plant also carry its code (plant_code), rows about a person carry the employee code
  (employee_code); plants whose code starts with DEMO are test plants
- a text that starts with = + - or @ is written with a ' in front so that a spreadsheet shows it
  as text and never runs it as a formula

What is never inside
- face templates and enrolment pictures, stored photos
- passwords and password hashes, passkeys
- signing and encryption keys, device keys, session tokens and one-time codes
"""


@dataclass
class BuiltExport:
    path: str
    name: str
    size_bytes: int
    row_count: int


@dataclass
class _TableResult:
    table: str
    file: str
    rows: int
    sha256: str
    columns: list[str]


# --- The guards -----------------------------------------------------------------------------


def free_disk_bytes() -> int:
    """Free space where the temporary file will be made (a test replaces this function)."""
    return shutil.disk_usage(tempfile.gettempdir()).free


def _estimated_bytes(session: Session) -> int:
    """About how much the exported tables weigh in the database; the ZIP is smaller than that."""
    size = session.scalar(
        text(
            "SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(:names)"
        ),
        {"names": list(ALLOWED_COLUMNS)},
    )
    return int(size or 0)


@contextmanager
def _one_export_at_a_time(session: Session) -> Iterator[None]:
    """Hold a database lock while an export is built; a second export is refused at once.

    The lock lives on its own connection, so it stays valid while the session commits (a commit
    may move the session to another pooled connection) and is let go in every case."""
    connection: Connection = session.get_bind().engine.connect()
    try:
        got_it = connection.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": EXPORT_LOCK_KEY}
        ).scalar()
        connection.commit()
        if not got_it:
            raise ApiError(
                "EXPORT_IN_PROGRESS",
                "An export is already being prepared. Please try again in a few minutes.",
                409,
            )
        try:
            yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": EXPORT_LOCK_KEY})
            connection.commit()
    finally:
        connection.close()


# --- Building the file ----------------------------------------------------------------------


def _select_for(table_name: str) -> tuple[Select[Any], list[str]]:
    """The query for one table: the allowed columns, plus the plant and employee code."""
    table: Table = Base.metadata.tables[table_name]
    names = list(ALLOWED_COLUMNS[table_name])
    selected: list[Any] = [table.c[name] for name in names]
    source: Any = table
    if "plant_id" in table.c and table_name != "plants":
        plants = Base.metadata.tables["plants"].alias("export_plants")
        source = source.outerjoin(plants, plants.c.id == table.c.plant_id)
        selected.append(plants.c.code.label(PLANT_CODE_COLUMN))
        names.append(PLANT_CODE_COLUMN)
    if "employee_id" in table.c:
        employees = Base.metadata.tables["employees"].alias("export_employees")
        source = source.outerjoin(employees, employees.c.id == table.c.employee_id)
        selected.append(employees.c.employee_code.label(EMPLOYEE_CODE_COLUMN))
        names.append(EMPLOYEE_CODE_COLUMN)
    statement: Select[Any] = select(*selected).select_from(source)
    return statement, names


def _write_table(session: Session, archive: zipfile.ZipFile, table_name: str) -> _TableResult:
    """Write one table as a CSV file into the ZIP, batch after batch (keyset paging by id)."""
    table = Base.metadata.tables[table_name]
    key = table.c[KEY_COLUMN_OF_TABLE.get(table_name, "id")]
    statement, column_names = _select_for(table_name)
    file_name = f"{table_name}.csv"
    digest = hashlib.sha256()
    rows_written = 0
    info = zipfile.ZipInfo(file_name, date_time=utc_now().timetuple()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    with archive.open(info, "w", force_zip64=True) as target:
        # The byte order mark lets Excel open the file as UTF-8 (names in Devanagari stay right).
        first_chunk = b"\xef\xbb\xbf" + _csv_bytes([column_names])
        target.write(first_chunk)
        digest.update(first_chunk)
        last_key = None
        while True:
            page = statement.order_by(key).limit(BATCH_SIZE)
            if last_key is not None:
                page = page.where(key > last_key)
            rows = session.execute(page).all()
            if not rows:
                break
            chunk = _csv_bytes([[to_cell(value) for value in row] for row in rows])
            target.write(chunk)
            digest.update(chunk)
            rows_written += len(rows)
            last_key = rows[-1][0]  # the key is always the first column
            if len(rows) < BATCH_SIZE:
                break
    return _TableResult(table_name, file_name, rows_written, digest.hexdigest(), column_names)


def _csv_bytes(rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows(rows)
    return buffer.getvalue().encode("utf-8")


def _manifest(results: list[_TableResult], moment: datetime) -> bytes:
    manifest = {
        "made_at_utc": moment.astimezone(UTC).isoformat(),
        "total_rows": sum(result.rows for result in results),
        "files": [
            {
                "file": result.file,
                "table": result.table,
                "rows": result.rows,
                "sha256": result.sha256,
                "columns": result.columns,
            }
            for result in results
        ],
        "tables_not_exported": EXCLUDED_TABLES,
        "columns_not_exported": EXCLUDED_COLUMNS,
    }
    return json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")


def _build_zip(session: Session, path: str, actor_name: str, reason: str) -> int:
    """Fill the ZIP file at `path`; returns the number of rows written."""
    moment = utc_now()
    readme = README_TEXT.format(
        made_ist=to_ist(moment).strftime("%d/%m/%Y %H:%M"),
        made_utc=moment.astimezone(UTC).strftime("%d/%m/%Y %H:%M"),
        actor=actor_name,
        reason=reason,
    )
    results: list[_TableResult] = []
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", readme.encode("utf-8"))
        for table_name in sorted(ALLOWED_COLUMNS):
            results.append(_write_table(session, archive, table_name))
        archive.writestr("manifest.json", _manifest(results, moment))
    return sum(result.rows for result in results)


# --- The whole export -----------------------------------------------------------------------


def create_full_export(
    session: Session, current_user: CurrentUser, *, reason: str, password: str
) -> BuiltExport:
    """Check the guards, build the ZIP in a temporary file and audit it. The caller sends the file
    and then removes it (`delete_file`)."""
    reason = reason.strip()
    if len(reason) < 3:
        raise ApiError("VALIDATION_FAILED", "Please give a reason.", 422, {"field": "reason"})
    if not check_password_again(
        session, user=current_user.user, password=password, ip=current_user.ip
    ):
        raise ApiError(
            "EXPORT_PASSWORD_WRONG", "The password is not correct. This was NOT downloaded.", 403
        )
    limiter_key = str(current_user.id)
    if not full_export_limiter.allow(limiter_key):
        raise ApiError(
            "TOO_MANY_REQUESTS", "Only 3 exports can be made in an hour. Please wait.", 429
        )
    try:
        with _one_export_at_a_time(session):
            return _build_guarded(session, current_user, reason)
    except ApiError as error:
        # An export that was refused before it started does not use up one of the three.
        if error.code in ("EXPORT_IN_PROGRESS", "EXPORT_NO_SPACE"):
            full_export_limiter.refund(limiter_key)
        raise


def _build_guarded(session: Session, current_user: CurrentUser, reason: str) -> BuiltExport:
    needed = _estimated_bytes(session) // 2 + DISK_RESERVE_BYTES
    if free_disk_bytes() < needed:
        raise ApiError(
            "EXPORT_NO_SPACE",
            "There is not enough space to prepare the export. Please free some space and try "
            "again.",
            503,
        )
    record_audit(
        session,
        actor=current_user.actor,
        action="export.full.start",
        entity_type="export",
        reason=reason,
    )
    session.commit()

    handle, path = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=".zip")
    os.close(handle)
    try:
        row_count = _build_zip(session, path, current_user.user.name, reason)
    except BaseException:
        # A failure, or a stop while the file was made: no half file stays, and the log says so.
        delete_file(path)
        session.rollback()
        _audit_end(session, current_user, reason, status="interrupted")
        logger.exception("The full export was interrupted")
        raise
    size = os.path.getsize(path)
    _audit_end(session, current_user, reason, status="done", size=size, rows=row_count)
    day = to_ist(utc_now()).date().isoformat()  # the date only, never a name (spec 7.7 rule 9)
    return BuiltExport(path, f"upasthiti-export-{day}.zip", size, row_count)


def _audit_end(
    session: Session,
    current_user: CurrentUser,
    reason: str,
    *,
    status: str,
    size: int | None = None,
    rows: int | None = None,
) -> None:
    record_audit(
        session,
        actor=current_user.actor,
        action="export.full",
        entity_type="export",
        reason=reason,
        after={"status": status, "size_bytes": size, "row_count": rows},
    )
    session.commit()


# --- The last exports -----------------------------------------------------------------------


def recent_exports(session: Session, limit: int = 5) -> list[RecentExport]:
    rows = session.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.action == "export.full")
        .order_by(desc(AuditLog.at), desc(AuditLog.id))
        .limit(limit)
    ).all()
    items = []
    for entry, actor_name in rows:
        after = entry.after or {}
        items.append(
            RecentExport(
                at=entry.at,
                actor_name=actor_name,
                status=after.get("status", "done"),
                size_bytes=after.get("size_bytes"),
                row_count=after.get("row_count"),
                reason=entry.reason,
            )
        )
    return items
