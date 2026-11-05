"""Range reports (M5c spec §5.2, §7.1): the register of a plant for up to a year, and one
employee day by day.

The register Excel has a "Summary" sheet (one row per person for the whole range) and one grid
sheet per calendar month. It is written row by row into a temporary file in batches of 100 people
(see `streaming.py`), so a year of a plant needs little memory. The PDF keeps its pages in
memory, so a PDF above 3,000 rows (people times months) is refused. A file is never built from
half-ready days: while days are still being calculated the answer is `ATTENDANCE_PREPARING`.
"""

import time
import uuid
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from xlsxwriter.worksheet import Worksheet

from app.core.date_range import check_date_range
from app.core.errors import ApiError
from app.core.time import to_ist, utc_now
from app.modules.attendance import detail_service, read_service
from app.modules.attendance import service as attendance_service
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.schemas import Day, Totals, register_code
from app.modules.auth.dependencies import CurrentUser
from app.modules.employees.models import Employee
from app.modules.org.models import Plant
from app.modules.reports import data, service
from app.modules.reports.model import INT, TEXT, Column, Report, Sheet
from app.modules.reports.pdf_writer import MAX_PDF_ROWS, build_pdf
from app.modules.reports.streaming import TempWorkbook, batches, delete_file
from app.modules.reports.xlsx_writer import (
    HEADER_ROWS,
    build_xlsx,
    header_block,
    hhmm,
    make_formats,
    unique_name,
)

MAX_REPORT_RANGE_DAYS = 366
MIN_SECONDS_LEFT = 0.1  # a batch still gets a moment when the time budget is used up
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
SUMMARY_COLUMNS = [
    Column("Code", TEXT, 10),
    Column("Name", TEXT, 24),
    Column("Type", TEXT, 11),
    Column("Present", INT, 8),
    Column("Half-day", INT, 8),
    Column("Short hours", INT, 8),
    Column("Absent", INT, 8),
    Column("Incomplete", INT, 9),
    Column("Paid leave", INT, 8),
    Column("Unpaid leave", INT, 8),
    Column("Weekly off", INT, 8),
    Column("Holiday", INT, 8),
    Column("Worked on off day", INT, 9),
    Column("Hours worked (HH:MM)", TEXT, 12),
    Column("Late days", INT, 8),
    Column("Late minutes", INT, 8),
    Column("Early exits", INT, 8),
]


@dataclass(frozen=True)
class RangeRequest:
    kind: str  # register-range | employee-range
    format: str  # xlsx | pdf
    plant_id: uuid.UUID | None
    employee_id: uuid.UUID | None
    date_from: date | None
    date_to: date | None
    employee_type: str | None
    department_id: uuid.UUID | None
    include_demo: bool


@dataclass(frozen=True)
class RangeFile:
    """A finished file: either bytes, or a temporary file on disk (the caller removes it)."""

    name: str
    media_type: str
    content: bytes | None = None
    path: str | None = None


def build_range_file(
    session: Session, current_user: CurrentUser, request: RangeRequest
) -> RangeFile:
    if request.format not in ("xlsx", "pdf"):
        raise ApiError("VALIDATION_FAILED", "Choose Excel or PDF.", 422, {"field": "format"})
    if request.date_from is None or request.date_to is None:
        raise ApiError("VALIDATION_FAILED", "Choose the dates.", 422, {"field": "date_from"})
    check_date_range(request.date_from, request.date_to, MAX_REPORT_RANGE_DAYS)
    read_service.check_day_not_future(request.date_from)
    last = min(request.date_to, to_ist(utc_now()).date())
    with service.report_slot(current_user):
        if request.kind == "register-range":
            return _register_file(session, current_user, request, request.date_from, last)
        return _employee_file(session, current_user, request, request.date_from, last)


# --- The register of a plant ---------------------------------------------------------------------


def _register_file(
    session: Session, current_user: CurrentUser, request: RangeRequest, first: date, last: date
) -> RangeFile:
    if request.plant_id is None:
        raise ApiError("VALIDATION_FAILED", "Choose the plant.", 422, {"field": "plant_id"})
    plant_ids = read_service.visible_plant_ids(
        session, current_user, plant_id=request.plant_id, include_demo=request.include_demo
    )
    plant = session.get(Plant, request.plant_id)
    if plant is None or request.plant_id not in plant_ids:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    employee_ids = list(
        session.scalars(
            read_service.register_employees(
                session,
                plant.id,
                first,
                last,
                employee_type=request.employee_type,
                department_id=request.department_id,
                q=None,
            ).with_only_columns(Employee.id)
        )
    )
    months = _months(first, last)
    if request.format == "pdf" and len(employee_ids) * len(months) > MAX_PDF_ROWS:
        raise ApiError(
            "REPORT_TOO_LARGE",
            "This file is too big for PDF. Please choose Excel or fewer months.",
            413,
            {"rows": len(employee_ids) * len(months), "max_rows": MAX_PDF_ROWS},
        )
    _check_days_ready(session, employee_ids, first, last)
    period_text = f"{first:%d/%m/%Y} to {last:%d/%m/%Y}"
    report = _report_header(
        current_user, "register-range", "Register for a period", plant, period_text
    )
    name = f"upasthiti-register-range-{plant.code}-{first:%Y%m%d}-{last:%Y%m%d}"
    if request.format == "pdf":
        content = _register_pdf(session, report, plant, employee_ids, months, first, last)
        file = RangeFile(f"{name}.pdf", "application/pdf", content=content)
    else:
        path = _register_xlsx(session, report, plant, employee_ids, months, first, last)
        file = RangeFile(f"{name}.xlsx", service.XLSX_TYPE, path=path)
    try:
        _audit(session, current_user, request, plant.code, period_text, len(employee_ids))
    except Exception:
        if file.path is not None:
            delete_file(file.path)
        raise
    return file


def _months(first: date, last: date) -> list[tuple[date, date]]:
    """The calendar months the range touches, each cut to the range: (first day, last day)."""
    result = []
    current = first
    while current <= last:
        month_end = current.replace(day=monthrange(current.year, current.month)[1])
        result.append((current, min(month_end, last)))
        current = month_end + timedelta(days=1)
    return result


def _check_days_ready(
    session: Session, employee_ids: list[uuid.UUID], first: date, last: date
) -> None:
    """A file is built only from days that are up to date: otherwise 409 and the days keep being
    calculated in the background (the catch-up job and every next try)."""
    started = time.monotonic()
    pending = 0
    for batch in batches(employee_ids):
        left = max(
            attendance_service.RANGE_RECOMPUTE_SECONDS - (time.monotonic() - started),
            MIN_SECONDS_LEFT,
        )
        pending += attendance_service.ensure_fresh_within_budget(
            session,
            batch,
            first,
            last,
            utc_now(),
            max_days=attendance_service.RANGE_RECOMPUTE_DAYS,
            max_seconds=left,
        )
    raise_if_preparing(pending)


def raise_if_preparing(pending: int) -> None:
    """No file while days of the period are still being calculated (spec rule 9)."""
    if pending:
        raise ApiError(
            "ATTENDANCE_PREPARING",
            "The attendance of this period is still being calculated. "
            "Please try again in a few minutes.",
            409,
            {"pending_days": pending},
        )


@dataclass
class _Person:
    """One person's days of a batch, read from the stored days of this plant."""

    employee: Employee
    days: dict[date, AttendanceDay]


def _people_of_batch(
    session: Session, plant_id: uuid.UUID, ids: list[uuid.UUID], first: date, last: date
) -> tuple[list[_Person], dict[uuid.UUID, bool]]:
    employees = {
        employee.id: employee
        for employee in session.scalars(select(Employee).where(Employee.id.in_(ids)))
    }
    by_person: dict[uuid.UUID, dict[date, AttendanceDay]] = defaultdict(dict)
    rows = list(
        session.scalars(
            select(AttendanceDay).where(
                AttendanceDay.employee_id.in_(ids),
                AttendanceDay.attendance_date.between(first, last),
                AttendanceDay.plant_id == plant_id,
            )
        )
    )
    for row in rows:
        by_person[row.employee_id][row.attendance_date] = row
    leave_paid = read_service.leave_paid_map(session, rows)
    ordered = sorted(ids, key=lambda employee_id: employees[employee_id].employee_code)
    return [_Person(employees[i], by_person.get(i, {})) for i in ordered], leave_paid


def _month_columns(month_first: date, month_last: date) -> list[Column]:
    day_columns = [
        Column(f"{day:%d}", TEXT, 5)
        for day in (
            month_first + timedelta(days=n) for n in range((month_last - month_first).days + 1)
        )
    ]
    return [
        Column("Code", TEXT, 9),
        Column("Name", TEXT, 22),
        Column("Type", TEXT, 10),
        *day_columns,
        Column("P", INT, 4),
        Column("HD", INT, 4),
        Column("SH", INT, 4),
        Column("A", INT, 4),
        Column("INC", INT, 4),
        Column("Leave", INT, 5),
        Column("WO", INT, 4),
        Column("H", INT, 4),
        Column("Hours (HH:MM)", TEXT, 10),
    ]


def _month_row(
    person: _Person,
    month_first: date,
    month_last: date,
    leave_paid: dict[uuid.UUID, bool],
) -> list[Any]:
    cells = []
    days_in_month = []
    current = month_first
    while current <= month_last:
        row = person.days.get(current)
        if row is None:
            cells.append("–")
        else:
            paid = leave_paid.get(row.leave_record_id) if row.leave_record_id else None
            code = register_code(row.status, row.day_kind, read_service.open_state_of(row), paid)
            cells.append(code + ("*" if row.is_corrected else ""))
            days_in_month.append(row)
        current += timedelta(days=1)
    totals = read_service.totals_of(days_in_month, leave_paid)
    kind = days_in_month[-1].employee_type if days_in_month else person.employee.type
    return [
        person.employee.employee_code,
        person.employee.full_name,
        kind.capitalize(),
        *cells,
        totals.present,
        totals.half_day,
        totals.short_hours,
        totals.absent,
        totals.incomplete,
        totals.leave_paid + totals.leave_unpaid,
        totals.weekly_off,
        totals.holiday,
        hhmm(totals.worked_min),
    ]


def _summary_row(person: _Person, leave_paid: dict[uuid.UUID, bool]) -> list[Any]:
    rows = [row for row in person.days.values() if row.status != "not_employed"]
    totals = read_service.totals_of(rows, leave_paid)
    kind = rows[-1].employee_type if rows else person.employee.type
    return [
        person.employee.employee_code,
        person.employee.full_name,
        kind.capitalize(),
        totals.present,
        totals.half_day,
        totals.short_hours,
        totals.absent,
        totals.incomplete,
        totals.leave_paid,
        totals.leave_unpaid,
        totals.weekly_off,
        totals.holiday,
        totals.worked_on_off_day,
        hhmm(totals.worked_min),
        totals.late_count,
        totals.late_min,
        totals.early_exit_count,
    ]


def _month_title(month_first: date) -> str:
    return f"{month_first:%b %Y}"


def _register_pdf(
    session: Session,
    report: Report,
    plant: Plant,
    employee_ids: list[uuid.UUID],
    months: list[tuple[date, date]],
    first: date,
    last: date,
) -> bytes:
    rows_by_month: dict[date, list[list[Any]]] = {month[0]: [] for month in months}
    for batch in batches(employee_ids):
        people, leave_paid = _people_of_batch(session, plant.id, batch, first, last)
        for person in people:
            for month_first, month_last in months:
                rows_by_month[month_first].append(
                    _month_row(person, month_first, month_last, leave_paid)
                )
    report.sheets = [
        Sheet(
            _month_title(month_first),
            _month_columns(month_first, month_last),
            rows_by_month[month_first],
            heading=f"{plant.code} · {plant.name} · {_month_title(month_first)}",
        )
        for month_first, month_last in months
    ]
    return build_pdf(report)


def _register_xlsx(
    session: Session,
    report: Report,
    plant: Plant,
    employee_ids: list[uuid.UUID],
    months: list[tuple[date, date]],
    first: date,
    last: date,
) -> str:
    """The grid goes into a temporary file batch by batch; returns its path."""
    book = TempWorkbook.create()
    try:
        formats = make_formats(book.workbook)
        used: set[str] = set()
        sheets: list[tuple[Any, list[Column], Sheet]] = []
        definitions = [("Summary", SUMMARY_COLUMNS, "Summary of the whole period")] + [
            (_month_title(a), _month_columns(a, b), _month_title(a)) for a, b in months
        ]
        for title, columns, heading in definitions:
            worksheet = book.workbook.add_worksheet(unique_name(title, used))
            sheet = Sheet(title, columns, [], heading=f"{plant.code} · {plant.name} · {heading}")
            header_block(worksheet, report, sheet, formats)
            for index, column in enumerate(columns):
                worksheet.write_string(HEADER_ROWS, index, column.header, formats["head"])
                worksheet.set_column(index, index, column.width)
            worksheet.freeze_panes(HEADER_ROWS + 1, 3)
            sheets.append((worksheet, columns, sheet))
        next_row = HEADER_ROWS + 1
        for batch in batches(employee_ids):
            people, leave_paid = _people_of_batch(session, plant.id, batch, first, last)
            for person in people:
                summary_sheet = sheets[0][0]
                _write_row(summary_sheet, next_row, _summary_row(person, leave_paid))
                for (worksheet, _, _), (month_first, month_last) in zip(
                    sheets[1:], months, strict=True
                ):
                    _write_row(
                        worksheet, next_row, _month_row(person, month_first, month_last, leave_paid)
                    )
                next_row += 1
        return book.finish()
    except Exception:
        book.discard()
        raise


def _write_row(worksheet: Worksheet, row: int, values: list[Any]) -> None:
    for column, value in enumerate(values):
        if isinstance(value, int) and not isinstance(value, bool):
            worksheet.write_number(row, column, value)
        else:
            worksheet.write_string(row, column, str(value))


# --- One employee ---------------------------------------------------------------------------------


def _employee_file(
    session: Session, current_user: CurrentUser, request: RangeRequest, first: date, last: date
) -> RangeFile:
    if request.employee_id is None:
        raise ApiError("VALIDATION_FAILED", "Choose the employee.", 422, {"field": "employee_id"})
    employee = detail_service.employee_for_reading(session, current_user, request.employee_id)
    answer = detail_service.range_of_employee(session, current_user, employee, first, last)
    raise_if_preparing(answer["preparing"]["pending_days"])
    first_day = answer["days"][0] if answer["days"] else None
    shown_plant_id = first_day.plant.id if first_day and first_day.plant else employee.plant_id
    plant = session.get(Plant, shown_plant_id)
    period_text = f"{first:%d/%m/%Y} to {answer['date_to']:%d/%m/%Y}"
    report = _report_header(
        current_user, "employee-range", "Attendance of one employee", plant, period_text
    )
    report.filters = f"Employee: {employee.employee_code} {employee.full_name}"
    report.sheets = [_employee_sheet(answer)]
    safe_code = employee.employee_code.replace("/", "-")
    name = f"upasthiti-employee-range-{safe_code}-{first:%Y%m%d}-{answer['date_to']:%Y%m%d}"
    if request.format == "pdf":
        file = RangeFile(f"{name}.pdf", "application/pdf", content=build_pdf(report))
    else:
        file = RangeFile(f"{name}.xlsx", service.XLSX_TYPE, content=build_xlsx(report))
    _audit(
        session,
        current_user,
        request,
        plant.code if plant else "",
        period_text,
        len(answer["days"]),
        extra={"employee_code": employee.employee_code},
    )
    return file


def _employee_sheet(answer: dict[str, Any]) -> Sheet:
    columns = [
        Column("Date", TEXT, 12),
        Column("Day", TEXT, 6),
        Column("Type", TEXT, 10),
        Column("Plant", TEXT, 8),
        Column("IN", TEXT, 7),
        Column("OUT", TEXT, 7),
        Column("Hours (HH:MM)", TEXT, 11),
        Column("Status", TEXT, 18),
        Column("Late (min)", INT, 9),
        Column("Early exit (min)", INT, 11),
        Column("Overtime (HH:MM)", TEXT, 12),
        Column("Corrected", TEXT, 9),
    ]
    rows: list[list[Any]] = []
    days: list[Day] = answer["days"]
    for day in days:
        rows.append(
            [
                f"{day.date:%d/%m/%Y}",
                WEEKDAYS[day.date.weekday()],
                day.employee_type.capitalize(),
                day.plant.code if day.plant else "",
                data.clock(day.first_in),
                data.clock(day.last_out),
                hhmm(day.worked_min) if day.worked_min else "",
                _status_text(day),
                day.late_min,
                day.early_exit_min,
                hhmm(day.overtime_min) if day.overtime_min else "",
                "Yes" if day.is_corrected else "",
            ]
        )
    totals: Totals = answer["totals"]
    summary = (
        f"Present {totals.present} · Half-day {totals.half_day} · Short hours {totals.short_hours}"
        f" · Absent {totals.absent} · Incomplete {totals.incomplete}"
        f" · Leave {totals.leave_paid + totals.leave_unpaid}"
        f" · Weekly off {totals.weekly_off} · Holiday {totals.holiday}"
        f" · Early exits {totals.early_exit_count}"
    )
    rows.append(
        [
            "Total",
            "",
            "",
            "",
            "",
            "",
            hhmm(totals.worked_min),
            summary,
            totals.late_min,
            "",
            hhmm(totals.overtime_min),
            "",
        ]
    )
    return Sheet(
        "Attendance",
        columns,
        rows,
        bold_rows={len(rows) - 1},
        heading=f"{answer['employee'].code} · {answer['employee'].name}",
    )


def _status_text(day: Day) -> str:
    if day.status == "present" and day.day_kind != "working":
        return "Worked on weekly off" if day.day_kind == "weekly_off" else "Worked on holiday"
    return data.STATUS_LABELS.get(day.status, day.status)


# --- Shared ---------------------------------------------------------------------------------------


def _report_header(
    current_user: CurrentUser, kind: str, title: str, plant: Plant | None, period_text: str
) -> Report:
    return Report(
        kind=kind,
        title=title,
        plant_text=f"{plant.code} · {plant.name}" if plant else "",
        period_text=period_text,
        generated_at=utc_now(),
        generated_by=f"{current_user.user.name} ({service.ROLE_NAMES.get(current_user.role, '')})",
        sheets=[],
        landscape=kind == "register-range",
        legend=data.REGISTER_LEGEND if kind == "register-range" else [],
    )


def _audit(
    session: Session,
    current_user: CurrentUser,
    request: RangeRequest,
    plant_code: str,
    period_text: str,
    rows: int,
    extra: dict[str, str] | None = None,
) -> None:
    """The same audit row as every report: kind, format, plant, period, number of rows, no name
    (a one-employee file also names the employee by code)."""
    as_report_request = service.Request(
        kind=request.kind,
        format=request.format,
        plant_id=request.plant_id,
        day=None,
        month=None,
        date_from=request.date_from,
        date_to=request.date_to,
        contractor_id=None,
        include_demo=request.include_demo,
    )
    service.audit_download(
        session, current_user, as_report_request, plant_code, period_text, rows, extra
    )
