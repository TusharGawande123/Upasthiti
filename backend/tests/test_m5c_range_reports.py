# ruff: noqa: F811  (the `world` fixture is imported from the other attendance test)
"""The range reports: the register of a plant and one employee, as Excel and PDF
(M5c spec §5.2, §7.1; AC-4, AC-5, AC-6, AC-8, AC-12; plan slice E). Real PostgreSQL, the clock
pinned to Mon 02/11/2026 12:00 IST. Files are read back with openpyxl and pypdfium2."""

import io
import tempfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import openpyxl
import pypdfium2 as pdfium
import pytest
from sqlalchemy import select, update

from app.modules.attendance import service as attendance_service
from app.modules.attendance.models import AttendanceDay
from app.modules.audit.models import AuditLog
from app.modules.reports import range_reports
from app.modules.reports.streaming import batches
from tests.clock_helpers import frozen_at
from tests.test_m5_attendance_api import (  # noqa: F401
    FRIDAY,
    MONDAY,
    NOW,
    work_a_day,
    world,
)

PLANT_WIDE = "/api/v1/reports/register-range"
ONE_PERSON = "/api/v1/reports/employee-range"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


def register_file(world: dict, who: str, file_format: str, date_from: str, date_to: str):
    return world[who].get(
        f"{PLANT_WIDE}.{file_format}",
        params={"plant_id": world["plant"].id, "date_from": date_from, "date_to": date_to},
    )


def person_file(world: dict, who: str, code: str, file_format: str, date_from: str, date_to: str):
    return world[who].get(
        f"{ONE_PERSON}.{file_format}",
        params={
            "employee_id": str(world["people"][code]),
            "date_from": date_from,
            "date_to": date_to,
        },
    )


def leftover_files() -> list[Path]:
    return list(Path(tempfile.gettempdir()).glob("upasthiti-report-*.xlsx"))


def test_the_register_excel_has_a_summary_and_one_grid_per_month(world: dict) -> None:
    """AC-4."""
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))

    response = register_file(world, "corporate", "xlsx", "2026-09-04", "2026-11-02")

    assert response.status_code == 200, response.text
    assert "register-range-K134-20260904-20261102.xlsx" in response.headers["content-disposition"]
    workbook = openpyxl.load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["Summary", "Sep 2026", "Oct 2026", "Nov 2026"]
    october = workbook["Oct 2026"]
    header_row = [cell.value for cell in october[9]]
    assert header_row[:3] == ["Code", "Name", "Type"]
    assert header_row[3:6] == ["01", "02", "03"]
    people = {row[0].value: row for row in october.iter_rows(min_row=10)}
    assert set(people) == {"P-1", "P-2", "T-1"}
    friday_column = 3 + 29  # day 30 is the 30th day column
    assert people["P-1"][friday_column].value == "P"
    summary = {row[0].value: row for row in workbook["Summary"].iter_rows(min_row=10)}
    assert summary["P-1"][3].value == 1  # present days of the whole period
    assert leftover_files() == []  # the temporary file is removed after sending


def test_one_year_and_one_day_more(world: dict) -> None:
    """AC-4: 366 days work, 367 are refused."""
    ok = register_file(world, "corporate", "xlsx", "2025-11-02", "2026-11-02")
    too_long = register_file(world, "corporate", "xlsx", "2025-11-01", "2026-11-02")

    assert ok.status_code == 200, ok.text
    workbook = openpyxl.load_workbook(io.BytesIO(ok.content))
    assert len(workbook.sheetnames) == 1 + 13  # Summary + Nov 2025 to Nov 2026
    assert too_long.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"


def test_a_plant_head_cannot_download_another_plants_register(world: dict) -> None:
    """AC-3."""
    own = register_file(world, "head", "xlsx", "2026-10-26", "2026-11-02")
    stranger = register_file(world, "other_head", "xlsx", "2026-10-26", "2026-11-02")
    stranger_person = person_file(world, "other_head", "P-1", "xlsx", "2026-10-26", "2026-11-02")

    assert own.status_code == 200
    assert stranger.status_code == 404
    assert stranger_person.status_code == 404
    assert leftover_files() == []


def test_the_register_pdf_is_a_real_pdf_and_too_many_rows_are_refused(
    world: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))

    pdf = register_file(world, "corporate", "pdf", "2026-10-26", "2026-11-02")

    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF")
    text = "".join(page.get_textpage().get_text_range() for page in pdfium.PdfDocument(pdf.content))
    assert "P-1" in text and "Register for a period" in text

    monkeypatch.setattr(range_reports, "MAX_PDF_ROWS", 2)
    too_big = register_file(world, "corporate", "pdf", "2026-10-26", "2026-11-02")
    assert too_big.status_code == 413
    assert too_big.json()["error"]["code"] == "REPORT_TOO_LARGE"


def test_days_still_being_calculated_give_409_and_no_file_until_ready(
    world: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-6: never a half-ready file."""
    session = world["session"]
    ids = list(world["people"].values())
    attendance_service.ensure_fresh(session, ids, date(2026, 10, 26), MONDAY, NOW)
    session.execute(
        update(AttendanceDay).where(AttendanceDay.employee_id.in_(ids)).values(stale=True)
    )
    session.commit()
    monkeypatch.setattr(attendance_service, "RANGE_RECOMPUTE_DAYS", 1)

    waiting = register_file(world, "corporate", "xlsx", "2026-10-26", "2026-11-02")

    assert waiting.status_code == 409
    assert waiting.json()["error"]["code"] == "ATTENDANCE_PREPARING"
    assert waiting.json()["error"]["details"]["pending_days"] > 0
    assert leftover_files() == []

    monkeypatch.setattr(attendance_service, "RANGE_RECOMPUTE_DAYS", 3000)
    ready = register_file(world, "corporate", "xlsx", "2026-10-26", "2026-11-02")
    assert ready.status_code == 200


def test_one_employee_excel_and_pdf_with_totals_and_no_name_in_the_file_name(world: dict) -> None:
    """AC-7, AC-8, AC-12."""
    work_a_day(world, "P-1", date(2026, 10, 27), (9, 0), (17, 0))
    work_a_day(world, "T-1", date(2026, 10, 27), (9, 0), (20, 0))

    excel = person_file(world, "head", "P-1", "xlsx", "2026-10-26", "2026-11-02")
    pdf = person_file(world, "head", "T-1", "pdf", "2026-10-26", "2026-11-02")

    assert excel.status_code == 200, excel.text
    disposition = excel.headers["content-disposition"]
    assert "employee-range-P-1-20261026-20261102.xlsx" in disposition
    assert "Person" not in disposition  # no name in the file name
    sheet = openpyxl.load_workbook(io.BytesIO(excel.content))["Attendance"]
    rows = [[cell.value for cell in row] for row in sheet.iter_rows(min_row=10)]
    assert rows[0][0] == "26/10/2026"
    assert rows[-1][0] == "Total"
    assert "Present 1" in str(rows[-1][7])
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_every_range_download_writes_an_audit_row_without_a_name(world: dict) -> None:
    """AC-12."""
    register_file(world, "boss", "xlsx", "2026-10-26", "2026-11-02")
    person_file(world, "boss", "P-1", "xlsx", "2026-10-26", "2026-11-02")

    session = world["session"]
    session.expire_all()
    rows = session.scalars(select(AuditLog).where(AuditLog.action == "report.download")).all()

    assert sorted(row.after["kind"] for row in rows) == ["employee-range", "register-range"]
    for row in rows:
        assert row.after["plant"] == "K134"
        assert "Person" not in str(row.after)
        assert "2026" in row.after["period"]


def test_the_batches_never_hold_more_than_a_hundred_people() -> None:
    """AC-5: the people are read in lists of at most 100."""
    sizes = [len(batch) for batch in batches(list(range(250)))]

    assert sizes == [100, 100, 50]
    assert list(batches([])) == []
