"""Building a report file: scope, limits, the file and its audit row (M5 spec §5.5, §7 rule 18).

Scope: the Super Admin and Corporate Head may ask for all plants; a Plant Head only gets the own
plant. DEMO plants are left out unless the Super Admin asks. Limits: one report at a time per
user (`REPORT_BUSY`), 20 files in 10 minutes per user (`TOO_MANY_REQUESTS`), a PDF of at most
3,000 rows (`REPORT_TOO_LARGE`). Every download is audited with kind, format, plant, period and the
number of rows: never a name.
"""

import logging
import threading
import time
import uuid
from dataclasses import dataclass, replace
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.attendance.read_service import check_day_not_future, visible_plant_ids
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.rate_limit import report_file_limiter
from app.modules.org.models import Plant
from app.modules.reports import data
from app.modules.reports.data import Context, month_range
from app.modules.reports.model import INT, TEXT, Column, Report, Sheet
from app.modules.reports.pdf_writer import build_pdf
from app.modules.reports.xlsx_writer import build_xlsx
from app.modules.users.models import Role

logger = logging.getLogger(__name__)

# kind -> (title, A4 landscape in the PDF)
KINDS = {
    "daily-muster": ("Daily muster", False),
    "register": ("Monthly register", True),
    "contractor-hours": ("Contractor hours", True),
    "late-early-overtime": ("Late, early exit and overtime", False),
    "exceptions": ("Exceptions", False),
    "rejected-punches": ("Rejected punches", False),
    "corrections": ("Corrections", False),
}
MONTH_KINDS = ("register", "contractor-hours")
MAX_RANGE_DAYS = 31
ROLE_NAMES = {
    Role.SUPER_ADMIN.value: "Super Admin",
    Role.CORPORATE_HEAD.value: "Corporate Head",
    Role.PLANT_HEAD.value: "Plant Head",
}
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# One report at a time per user: a second request while one is building is refused.
_building: set[uuid.UUID] = set()
_building_lock = threading.Lock()


@dataclass(frozen=True)
class Request:
    kind: str
    format: str  # xlsx | pdf
    plant_id: uuid.UUID | None
    day: date | None
    month: str | None
    date_from: date | None
    date_to: date | None
    contractor_id: uuid.UUID | None
    include_demo: bool


@dataclass(frozen=True)
class File:
    content: bytes
    name: str
    media_type: str


def _period(request: Request) -> tuple[date, date, str]:
    """The dates of the report and how they are written ("October 2026", "30/10/2026")."""
    if request.kind == "daily-muster":
        if request.day is None:
            raise ApiError("VALIDATION_FAILED", "Choose the day.", 422, {"field": "date"})
        check_day_not_future(request.day)
        return request.day, request.day, f"{request.day:%d/%m/%Y}"
    if request.kind in MONTH_KINDS:
        if not request.month:
            raise ApiError("VALIDATION_FAILED", "Choose the month.", 422, {"field": "month"})
        first, last = month_range(request.month)
        check_day_not_future(first)
        return first, last, f"{first:%B %Y}"
    if request.date_from is None or request.date_to is None:
        raise ApiError("VALIDATION_FAILED", "Choose the dates.", 422, {"field": "date_from"})
    if request.date_to < request.date_from:
        raise ApiError("VALIDATION_FAILED", "The end is before the start.", 422)
    if (request.date_to - request.date_from).days + 1 > MAX_RANGE_DAYS:
        raise ApiError("REPORT_RANGE_TOO_LONG", "Choose at most 31 days.", 422)
    check_day_not_future(request.date_from)
    return (
        request.date_from,
        request.date_to,
        f"{request.date_from:%d/%m/%Y} to {request.date_to:%d/%m/%Y}",
    )


def _file_period(request: Request, date_from: date, date_to: date) -> str:
    """The period part of the file name (no names of people anywhere in it)."""
    if request.kind in MONTH_KINDS:
        return f"{date_from:%Y-%m}"
    if date_from == date_to:
        return f"{date_from:%Y%m%d}"
    return f"{date_from:%Y%m%d}-{date_to:%Y%m%d}"


def build_file(session: Session, current_user: CurrentUser, request: Request) -> File:
    if request.kind not in KINDS:
        raise ApiError("REPORT_KIND_UNKNOWN", "This report does not exist.", 404)
    if request.format not in ("xlsx", "pdf"):
        raise ApiError("VALIDATION_FAILED", "Choose Excel or PDF.", 422, {"field": "format"})
    date_from, date_to, period_text = _period(request)
    if not report_file_limiter.allow(str(current_user.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many files. Try again in a few minutes.", 429)
    with _building_lock:
        if current_user.id in _building:
            raise ApiError("REPORT_BUSY", "Wait for your other report to finish.", 429)
        _building.add(current_user.id)
    started = time.monotonic()
    try:
        report = _report(session, current_user, request, date_from, date_to, period_text)
        if request.format == "pdf":
            content = build_pdf(report)
        else:
            content = build_xlsx(_with_summary(report))
    finally:
        with _building_lock:
            _building.discard(current_user.id)
    logger.info(
        "report built",
        extra={
            "fields": {
                "kind": request.kind,
                "format": request.format,
                "rows": report.row_count,
                "seconds": round(time.monotonic() - started, 1),
            }
        },
    )
    plant_code = _plant_code(session, request, report)
    _audit(session, current_user, request, plant_code, period_text, report.row_count)
    period = _file_period(request, date_from, date_to)
    media_type = "application/pdf" if request.format == "pdf" else XLSX_TYPE
    name = f"upasthiti-{request.kind}-{plant_code}-{period}.{request.format}"
    return File(content, name, media_type)


def _plant_code(session: Session, request: Request, report: Report) -> str:
    """The plant code in the file name and the audit row, or ALL."""
    if request.plant_id is None:
        return "ALL"
    plant = session.get(Plant, request.plant_id)
    return plant.code if plant else "ALL"


def _report(
    session: Session,
    current_user: CurrentUser,
    request: Request,
    date_from: date,
    date_to: date,
    period_text: str,
) -> Report:
    plant_ids = visible_plant_ids(
        session, current_user, plant_id=request.plant_id, include_demo=request.include_demo
    )
    if request.plant_id is not None and not plant_ids:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    plants = list(
        session.scalars(select(Plant).where(Plant.id.in_(plant_ids)).order_by(Plant.code))
    )
    context = Context(session, plants, date_from, date_to, request.contractor_id)
    sheets = _sheets(context, current_user, request)
    title, landscape = KINDS[request.kind]
    shown = plants[0] if len(plants) == 1 else None
    return Report(
        kind=request.kind,
        title=title,
        plant_text=f"{shown.code} · {shown.name}" if shown else "All plants",
        period_text=period_text,
        generated_at=utc_now(),
        generated_by=f"{current_user.user.name} ({ROLE_NAMES.get(current_user.role, '')})",
        sheets=sheets,
        landscape=landscape,
        demo_included=any(plant.code.startswith("DEMO") for plant in plants),
        filters=_filters(context, request),
        legend=data.REGISTER_LEGEND if request.kind == "register" else [],
    )


def _sheets(context: Context, current_user: CurrentUser, request: Request) -> list[Sheet]:
    if request.kind == "corrections":
        # Review reasons only in the Super Admin's file (decision 0028 item 4).
        sees = current_user.access(Capability.REVIEW_PUNCHES) is Access.ALL
        return data.corrections(context, sees_review_reasons=sees)
    builders = {
        "daily-muster": data.daily_muster,
        "register": data.register,
        "contractor-hours": data.contractor_hours,
        "late-early-overtime": data.late_early_overtime,
        "exceptions": data.exceptions,
        "rejected-punches": data.rejected_punches,
    }
    return builders[request.kind](context)


def _filters(context: Context, request: Request) -> str:
    if request.contractor_id:
        return f"Contractor: {context.contractors.get(request.contractor_id, '')}"
    return ""


def _with_summary(report: Report) -> Report:
    """An "all plants" Excel file also gets a Summary sheet: one row per plant."""
    if len(report.sheets) < 2:
        return report
    summary = Sheet(
        "Summary",
        [Column("Plant", TEXT, 30), Column("Rows", INT, 10)],
        [[sheet.heading or sheet.name, len(sheet.rows)] for sheet in report.sheets],
        heading="All plants",
    )
    return replace(report, sheets=[summary, *report.sheets])


def _audit(
    session: Session,
    current_user: CurrentUser,
    request: Request,
    plant_code: str,
    period_text: str,
    rows: int,
) -> None:
    record_audit(
        session,
        actor=current_user.actor,
        action="report.download",
        entity_type="report",
        after={
            "kind": request.kind,
            "format": request.format,
            "plant": plant_code,
            "period": period_text,
            "rows": rows,
        },
    )
    session.commit()
