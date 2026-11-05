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


def test_a_file_that_is_still_being_prepared_does_not_use_up_the_twenty_files(
    world: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reports page asks again by itself, so a 409 must not end in a 429 (review fix)."""
    session = world["session"]
    ids = list(world["people"].values())
    attendance_service.ensure_fresh(session, ids, date(2026, 10, 26), MONDAY, NOW)
    session.execute(
        update(AttendanceDay).where(AttendanceDay.employee_id.in_(ids)).values(stale=True)
    )
    session.commit()
    monkeypatch.setattr(attendance_service, "RANGE_RECOMPUTE_DAYS", 0)  # nothing ever gets ready

    codes = {
        register_file(world, "corporate", "xlsx", "2026-10-26", "2026-11-02").status_code
        for _ in range(22)
    }

    assert codes == {409}


def test_the_one_employee_audit_row_holds_the_employee_code(world: dict) -> None:
    person_file(world, "boss", "P-1", "xlsx", "2026-10-26", "2026-11-02")

    session = world["session"]
    session.expire_all()
    row = session.scalars(select(AuditLog).where(AuditLog.action == "report.download")).one()

    assert row.after["employee_code"] == "P-1"
    assert "Person" not in str(row.after)


def test_the_total_row_has_no_count_under_the_early_exit_minutes(world: dict) -> None:
    work_a_day(world, "P-1", date(2026, 10, 27), (9, 0), (15, 0))  # leaves early

    excel = person_file(world, "boss", "P-1", "xlsx", "2026-10-26", "2026-11-02")

    sheet = openpyxl.load_workbook(io.BytesIO(excel.content))["Attendance"]
    rows = [[cell.value for cell in row] for row in sheet.iter_rows(min_row=10)]
    total = rows[-1]
    assert total[0] == "Total"
    assert total[9] is None  # "Early exit (min)": minutes only, never a count
    assert "Early exits" in str(total[7])


def test_old_report_files_are_swept_and_fresh_ones_stay() -> None:
    import os
    import time

    from app.modules.reports.streaming import sweep_old_files

    folder = Path(tempfile.gettempdir())
    old = folder / "upasthiti-report-sweep-old.xlsx"
    fresh = folder / "upasthiti-report-sweep-fresh.xlsx"
    old.write_bytes(b"x")
    fresh.write_bytes(b"x")
    long_ago = time.time() - 3600
    os.utime(old, (long_ago, long_ago))
    try:
        removed = sweep_old_files(max_age_seconds=900)

        assert removed >= 1
        assert not old.exists()
        assert fresh.exists()
    finally:
        fresh.unlink(missing_ok=True)
        old.unlink(missing_ok=True)


def test_when_all_places_are_taken_a_read_recomputes_nothing_and_says_what_is_left(
    world: dict,
) -> None:
    """Review fix: only a few long reads recompute at once; the others answer with `pending`."""
    session = world["session"]
    ids = list(world["people"].values())
    attendance_service.ensure_fresh(session, ids, date(2026, 10, 26), MONDAY, NOW)
    session.execute(
        update(AttendanceDay).where(AttendanceDay.employee_id.in_(ids)).values(stale=True)
    )
    session.commit()
    places = attendance_service.RANGE_RECOMPUTE_PLACES
    taken = 0
    while places.acquire(blocking=False):
        taken += 1
    try:
        waiting = attendance_service.ensure_fresh_within_budget(
            session, ids, date(2026, 10, 26), MONDAY, NOW
        )
    finally:
        for _ in range(taken):
            places.release()

    assert waiting == 24  # 3 people x 8 days: nothing was recomputed
    done = attendance_service.ensure_fresh_within_budget(
        session, ids, date(2026, 10, 26), MONDAY, NOW
    )
    assert done == 0


# --- F-91: the conversion history report --------------------------------------------------------


def conversions_file(world: dict, who: str, date_from: str, date_to: str, plant: bool = True):
    params = {"date_from": date_from, "date_to": date_to}
    if plant:
        params["plant_id"] = world["plant"].id
    return world[who].get("/api/v1/reports/conversions.xlsx", params=params)


def convert_in_world(client, world: dict, code: str, day: str):  # noqa: ANN001, ANN201
    return client.post(
        f"/api/v1/employees/{world['people'][code]}/convert-to-permanent",
        json={"effective_from": day, "reason": "Permanent offer"},
    )


def first_sheet(content: bytes):  # noqa: ANN201
    return openpyxl.load_workbook(io.BytesIO(content)).worksheets[0]


def test_the_conversion_report_lists_a_direct_conversion(world: dict) -> None:
    assert convert_in_world(world["boss"], world, "T-1", "2026-10-29").status_code == 200

    excel = conversions_file(world, "boss", "2026-10-01", "2026-11-02")

    assert excel.status_code == 200, excel.text
    assert "conversions-K134-" in excel.headers["content-disposition"]
    rows = [
        [cell.value for cell in row] for row in first_sheet(excel.content).iter_rows(min_row=10)
    ]
    assert [row[0] for row in rows] == ["T-1"]
    assert rows[0][2] is not None  # the day it starts
    assert rows[0][4] and not rows[0][5]  # done by the Super Admin, nobody asked
    assert rows[0][6] == "Permanent offer"


def test_the_conversion_report_names_who_asked_when_a_corporate_head_asked(world: dict) -> None:
    asked = convert_in_world(world["corporate"], world, "T-1", "2026-10-29")
    assert asked.status_code == 202, asked.text
    request_id = asked.json()["change_request_id"]
    approved = world["boss"].post(f"/api/v1/change-requests/{request_id}/approve", json={})
    assert approved.status_code == 200, approved.text

    excel = conversions_file(world, "boss", "2026-10-01", "2026-11-02")

    rows = [
        [cell.value for cell in row] for row in first_sheet(excel.content).iter_rows(min_row=10)
    ]
    assert [row[0] for row in rows] == ["T-1"]
    assert rows[0][4] != rows[0][5] and rows[0][5]  # approved by one person, asked by another


def test_the_conversion_report_only_covers_the_chosen_days_and_allows_a_year(
    world: dict,
) -> None:
    assert convert_in_world(world["boss"], world, "T-1", "2026-10-29").status_code == 200

    outside = conversions_file(world, "boss", "2026-10-01", "2026-10-28")
    a_year = conversions_file(world, "boss", "2025-11-03", "2026-11-02", plant=False)
    too_long = conversions_file(world, "boss", "2025-11-01", "2026-11-02", plant=False)

    rows = [
        [cell.value for cell in row] for row in first_sheet(outside.content).iter_rows(min_row=10)
    ]
    assert rows == []
    assert a_year.status_code == 200, a_year.text
    assert too_long.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"


def test_a_plant_head_gets_only_the_conversions_of_the_own_plant(world: dict) -> None:
    assert convert_in_world(world["boss"], world, "T-1", "2026-10-29").status_code == 200

    own = conversions_file(world, "head", "2026-10-01", "2026-11-02")
    stranger = conversions_file(world, "other_head", "2026-10-01", "2026-11-02")

    own_rows = list(first_sheet(own.content).iter_rows(min_row=10))
    assert [row[0].value for row in own_rows] == ["T-1"]
    assert stranger.status_code == 404
