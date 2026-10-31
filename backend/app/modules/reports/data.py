"""The rows of the seven reports (M5 spec §7 rule 18, FR-35).

Every attendance report is built from the stored attendance days (brought up to date first, as a
screen does), so a file always agrees with the screens. The punch reports read punches through
`punches/counting.py` and the reviews. Each function answers one report as a list of `Sheet`s,
one per plant; the writers (xlsx_writer, pdf_writer) only draw them.
"""

import uuid
from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.read_service import fresh_days, leave_paid_map, totals_of
from app.modules.attendance.schemas import register_code
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift
from app.modules.punches.counting import latest_reviews, review_state
from app.modules.punches.models import Punch, PunchDecision
from app.modules.punches.reasons import reason_text
from app.modules.regularisations import service as correction_service
from app.modules.regularisations.models import Regularisation
from app.modules.reports.model import DATE, INT, MINUTES, TEXT, Column, Sheet

STATUS_LABELS = {
    "present": "Present",
    "half_day": "Half-day",
    "short_hours": "Short hours",
    "absent": "Absent",
    "incomplete": "Incomplete",
    "leave": "Leave",
    "weekly_off": "Weekly off",
    "holiday": "Holiday",
    "open": "Day not finished",
}
EXCEPTION_TEXTS = {
    "OUT_MISSING": "The OUT is missing: ask for a correction.",
    "OUT_WITHOUT_IN": "There is an OUT but no IN: ask for a correction.",
    "PUNCHES_ON_LEAVE": "The person punched on a day of leave.",
    "SHIFT_CHANGE_SHORT_DAY": "The shift changed: the day is shorter than the shift.",
    "EXTRA_PUNCHES": "An extra punch was not used for the hours.",
    "POSSIBLE_DOUBLE_ENTRY": "A correction and a punch are very close in time.",
}
NOTE_CODES = {"EXTRA_PUNCHES", "POSSIBLE_DOUBLE_ENTRY"}


def status_label(day: AttendanceDay) -> str:
    if day.status == "present" and day.day_kind != "working":
        return "Worked on weekly off" if day.day_kind == "weekly_off" else "Worked on holiday"
    return STATUS_LABELS.get(day.status, day.status)


def clock(moment) -> str:  # noqa: ANN001
    return f"{to_ist(moment):%H:%M}" if moment else ""


class Context:
    """What every report builder needs: the plants, the range and lookup tables."""

    def __init__(
        self,
        session: Session,
        plants: list[Plant],
        date_from: date,
        date_to: date,
        contractor_id: uuid.UUID | None = None,
    ) -> None:
        self.session = session
        self.plants = plants
        self.date_from = date_from
        self.date_to = date_to
        self.contractor_id = contractor_id
        self.departments = dict(session.execute(select(Department.id, Department.name)).all())
        self.categories = dict(
            session.execute(select(EmployeeCategory.id, EmployeeCategory.name)).all()
        )
        self.contractors = dict(session.execute(select(Contractor.id, Contractor.name)).all())
        self.shifts = dict(session.execute(select(Shift.id, Shift.name)).all())
        fresh_days(session, [plant.id for plant in plants], date_from, date_to)

    def days(self, plant: Plant, **filters: Any) -> list[tuple[AttendanceDay, Employee]]:
        statement = (
            select(AttendanceDay, Employee)
            .join(Employee, Employee.id == AttendanceDay.employee_id)
            .where(
                AttendanceDay.plant_id == plant.id,
                AttendanceDay.attendance_date.between(self.date_from, self.date_to),
                AttendanceDay.status != "not_employed",
            )
            .order_by(Employee.employee_code, AttendanceDay.attendance_date)
        )
        for name, value in filters.items():
            statement = statement.where(getattr(AttendanceDay, name) == value)
        return [(row[0], row[1]) for row in self.session.execute(statement).all()]

    def department(self, employee: Employee) -> str:
        return self.departments.get(employee.department_id, "") if employee.department_id else ""

    def contractor(self, employee: Employee) -> str:
        return self.contractors.get(employee.contractor_id, "") if employee.contractor_id else ""


# --- 1. Daily muster ----------------------------------------------------------------------------


def daily_muster(ctx: Context) -> list[Sheet]:
    columns = [
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Type", TEXT, 11),
        Column("Department", TEXT, 16),
        Column("Category", TEXT, 12),
        Column("Contractor", TEXT, 18),
        Column("Shift", TEXT, 12),
        Column("Status", TEXT, 18),
        Column("IN", TEXT, 7),
        Column("OUT", TEXT, 7),
        Column("Worked", MINUTES, 9),
        Column("Worked for status", MINUTES, 9),
        Column("Late", MINUTES, 8),
        Column("Early exit", MINUTES, 8),
        Column("Overtime", MINUTES, 8),
        Column("Extra punches", INT, 8),
        Column("Marks", TEXT, 22),
    ]
    sheets = []
    for plant in ctx.plants:
        rows = []
        for day, employee in ctx.days(plant):
            marks = ["Corrected"] if day.is_corrected else []
            marks += ["Unchecked flag"] if day.uses_unchecked_flag else []
            rows.append(
                [
                    employee.employee_code,
                    employee.full_name,
                    employee.type.capitalize(),
                    ctx.department(employee),
                    ctx.categories.get(employee.category_id, ""),
                    ctx.contractor(employee),
                    ctx.shifts.get(day.shift_id, "") if day.shift_id else "",
                    status_label(day),
                    clock(day.first_in),
                    clock(day.last_out),
                    day.worked_min,
                    day.status_min,
                    day.late_min,
                    day.early_exit_min,
                    day.overtime_min,
                    day.extra_punch_count,
                    ", ".join(marks),
                ]
            )
        sheets.append(Sheet(plant.code, columns, rows, heading=f"{plant.code} · {plant.name}"))
    return sheets


# --- 2. Register --------------------------------------------------------------------------------


def register(ctx: Context) -> list[Sheet]:
    days_in_month = monthrange(ctx.date_from.year, ctx.date_from.month)[1]
    columns = [Column("Code", TEXT, 10), Column("Name", TEXT, 24), Column("Type", TEXT, 11)]
    columns += [Column(str(day), TEXT, 5) for day in range(1, days_in_month + 1)]
    totals_headers = [
        ("Present", INT),
        ("Half-day", INT),
        ("Short hours", INT),
        ("Absent", INT),
        ("Incomplete", INT),
        ("Paid leave", INT),
        ("Unpaid leave", INT),
        ("Weekly off", INT),
        ("Holiday", INT),
        ("Worked on off day", INT),
        ("Worked", MINUTES),
        ("Overtime", MINUTES),
        ("Late (count)", INT),
        ("Early exit (count)", INT),
    ]
    columns += [Column(header, kind, 9) for header, kind in totals_headers]
    sheets = []
    for plant in ctx.plants:
        by_employee: dict[uuid.UUID, tuple[Employee, dict[date, AttendanceDay]]] = {}
        pairs = ctx.days(plant)
        leave_paid = leave_paid_map(ctx.session, [pair[0] for pair in pairs])
        for day, employee in pairs:
            by_employee.setdefault(employee.id, (employee, {}))[1][day.attendance_date] = day
        rows = []
        for employee, days in by_employee.values():
            cells = []
            for number in range(1, days_in_month + 1):
                row = days.get(date(ctx.date_from.year, ctx.date_from.month, number))
                paid = leave_paid.get(row.leave_record_id) if row and row.leave_record_id else None
                code = register_code(row.status, row.day_kind, None, paid) if row else "–"
                cells.append(code + ("*" if row and row.is_corrected else ""))
            totals = totals_of(days.values(), leave_paid)
            rows.append(
                [employee.employee_code, employee.full_name, employee.type.capitalize(), *cells]
                + [
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
                    totals.worked_min,
                    totals.overtime_min,
                    totals.late_count,
                    totals.early_exit_count,
                ]
            )
        sheets.append(Sheet(plant.code, columns, rows, heading=f"{plant.code} · {plant.name}"))
    return sheets


REGISTER_LEGEND = [
    "P present · HD half-day · SH short hours · A absent · INC incomplete · PL paid leave",
    "UL unpaid leave · WO weekly off · H holiday · WO-W / H-W worked on weekly off / holiday",
    "* corrected: see the corrections log · – not employed or not yet stored",
]


# --- 3. Contractor hours ------------------------------------------------------------------------


def contractor_hours(ctx: Context) -> list[Sheet]:
    """Temporary workers by contractor: days present, incomplete days, hours (first IN to last
    OUT) and overtime hours. No rates, no money."""
    days_in_month = monthrange(ctx.date_from.year, ctx.date_from.month)[1]
    columns = [
        Column("Contractor", TEXT, 22),
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Days present", INT, 9),
        Column("Incomplete days", INT, 9),
        Column("Hours", MINUTES, 9),
        Column("Overtime", MINUTES, 9),
    ]
    columns += [Column(str(day), MINUTES, 6) for day in range(1, days_in_month + 1)]
    sheets = []
    for plant in ctx.plants:
        groups: dict[str | None, dict[uuid.UUID, list]] = defaultdict(dict)
        for day, employee in ctx.days(plant, employee_type="temporary"):
            if ctx.contractor_id and employee.contractor_id != ctx.contractor_id:
                continue
            name = ctx.contractor(employee) or None
            entry = groups[name].setdefault(employee.id, [employee, {}])
            entry[1][day.attendance_date] = day
        rows: list[list[Any]] = []
        bold: set[int] = set()
        ordered = sorted(groups, key=lambda key: (key is None, (key or "").lower()))
        for name in ordered:
            sub = [0, 0, 0, 0]
            for employee, days in sorted(
                groups[name].values(), key=lambda item: item[0].employee_code
            ):
                present = sum(1 for d in days.values() if d.status == "present")
                incomplete = sum(1 for d in days.values() if d.status == "incomplete")
                hours = sum(d.worked_min for d in days.values())
                overtime = sum(d.overtime_min for d in days.values())
                per_day = [
                    days[date(ctx.date_from.year, ctx.date_from.month, n)].worked_min
                    if date(ctx.date_from.year, ctx.date_from.month, n) in days
                    and days[date(ctx.date_from.year, ctx.date_from.month, n)].worked_min
                    else None
                    for n in range(1, days_in_month + 1)
                ]
                rows.append(
                    [name or "No contractor", employee.employee_code, employee.full_name]
                    + [present, incomplete, hours, overtime]
                    + per_day
                )
                sub = [sub[0] + present, sub[1] + incomplete, sub[2] + hours, sub[3] + overtime]
            bold.add(len(rows))
            rows.append(
                [f"Subtotal {name or 'No contractor'}", "", ""] + sub + [None] * days_in_month
            )
        sheets.append(
            Sheet(plant.code, columns, rows, bold_rows=bold, heading=f"{plant.code} · {plant.name}")
        )
    return sheets


# --- 4. Late, early and overtime ----------------------------------------------------------------


def late_early_overtime(ctx: Context) -> list[Sheet]:
    columns = [
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Date", DATE, 12),
        Column("Shift", TEXT, 12),
        Column("IN", TEXT, 7),
        Column("OUT", TEXT, 7),
        Column("Late", MINUTES, 8),
        Column("Early exit", MINUTES, 8),
        Column("Overtime", MINUTES, 8),
    ]
    sheets = []
    for plant in ctx.plants:
        per_person: dict[uuid.UUID, list[Any]] = {}
        rows: list[list[Any]] = []
        bold: set[int] = set()
        for day, employee in ctx.days(plant):
            temporary = employee.type == "temporary"
            late = 0 if temporary else day.late_min
            early = 0 if temporary else day.early_exit_min
            if not (late or early or day.overtime_min):
                continue
            rows.append(
                [
                    employee.employee_code,
                    employee.full_name,
                    day.attendance_date,
                    ctx.shifts.get(day.shift_id, "") if day.shift_id else "",
                    clock(day.first_in),
                    clock(day.last_out),
                    late,
                    early,
                    day.overtime_min,
                ]
            )
            total = per_person.setdefault(employee.id, [employee, 0, 0, 0, len(rows) - 1])
            total[1] += late
            total[2] += early
            total[3] += day.overtime_min
        by_position = sorted(per_person.values(), key=lambda item: item[4], reverse=True)
        # A total goes after that person's last row, from the bottom up so positions hold.
        for employee, late, early, overtime, last_index in by_position:
            rows.insert(
                last_index + 1,
                [
                    employee.employee_code,
                    f"Total {employee.full_name}",
                    None,
                    "",
                    "",
                    "",
                    late,
                    early,
                    overtime,
                ],
            )
        for index, row in enumerate(rows):
            if str(row[1]).startswith("Total "):
                bold.add(index)
        sheets.append(
            Sheet(plant.code, columns, rows, bold_rows=bold, heading=f"{plant.code} · {plant.name}")
        )
    return sheets


# --- 5. Exceptions ------------------------------------------------------------------------------


def exceptions(ctx: Context) -> list[Sheet]:
    columns = [
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Date", DATE, 12),
        Column("Status", TEXT, 16),
        Column("What needs a look", TEXT, 60),
    ]
    sheets = []
    for plant in ctx.plants:
        problems: list[list[Any]] = []
        notes: list[list[Any]] = []
        for day, employee in ctx.days(plant):
            texts = [
                EXCEPTION_TEXTS[c]
                for c in day.exceptions
                if c in EXCEPTION_TEXTS and c not in NOTE_CODES
            ]
            if day.status == "short_hours":
                texts.insert(0, "Short hours: the Super Admin decides this day with a correction.")
            if day.uses_unchecked_flag:
                texts.append("A flagged punch is used and nobody has checked it yet.")
            base = [
                employee.employee_code,
                employee.full_name,
                day.attendance_date,
                status_label(day),
            ]
            if texts:
                problems.append([*base, " ".join(texts)])
            note_texts = [EXCEPTION_TEXTS[c] for c in day.exceptions if c in NOTE_CODES]
            if note_texts:
                notes.append([*base, " ".join(note_texts)])
        rows = list(problems)
        bold: set[int] = set()
        if notes:
            bold.add(len(rows))
            rows.append(["Notes (not problems)", "", None, "", ""])
            rows.extend(notes)
        sheets.append(
            Sheet(plant.code, columns, rows, bold_rows=bold, heading=f"{plant.code} · {plant.name}")
        )
    return sheets


# --- 6. Rejected punches ------------------------------------------------------------------------


REVIEW_TEXTS = {"approved": "Approved", "not_accepted": "Not accepted", None: "Not reviewed"}


def rejected_punches(ctx: Context) -> list[Sheet]:
    """Refused punches with their reason text, device and method. No photos, no coordinates, no
    scores (spec §7 rule 18)."""
    from app.modules.kiosks.models import KioskDevice

    columns = [
        Column("Time (IST)", TEXT, 17),
        Column("Plant", TEXT, 8),
        Column("Attendance device", TEXT, 20),
        Column("Method", TEXT, 8),
        Column("Reason", TEXT, 40),
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Review", TEXT, 14),
    ]
    start = _day_start(ctx.date_from)
    end = _day_start(ctx.date_to + timedelta(days=1))
    devices = dict(ctx.session.execute(select(KioskDevice.id, KioskDevice.name)).all())
    sheets = []
    for plant in ctx.plants:
        punches = list(
            ctx.session.scalars(
                select(Punch)
                .where(
                    Punch.plant_id == plant.id,
                    Punch.decision == PunchDecision.REJECTED.value,
                    Punch.punch_time >= start,
                    Punch.punch_time < end,
                )
                .order_by(Punch.punch_time)
            )
        )
        reviews = latest_reviews(ctx.session, [punch.id for punch in punches])
        names = {
            employee.id: employee
            for employee in ctx.session.scalars(
                select(Employee).where(
                    Employee.id.in_({p.employee_id or p.claimed_employee_id for p in punches})
                )
            )
        }
        rows = []
        for punch in punches:
            person_id = punch.employee_id or punch.claimed_employee_id
            employee = names.get(person_id) if person_id else None
            rows.append(
                [
                    f"{to_ist(punch.punch_time):%d/%m/%Y %H:%M}",
                    plant.code,
                    devices.get(punch.kiosk_id, "") if punch.kiosk_id else "",
                    punch.method.capitalize(),
                    reason_text(punch.reason_codes[0]) if punch.reason_codes else "",
                    employee.employee_code if employee else "",
                    employee.full_name if employee else "",
                    REVIEW_TEXTS.get(review_state(punch, reviews.get(punch.id)), "Not reviewed"),
                ]
            )
        sheets.append(Sheet(plant.code, columns, rows, heading=f"{plant.code} · {plant.name}"))
    return sheets


def _day_start(day: date):  # noqa: ANN202
    from datetime import datetime

    return datetime.combine(day, datetime.min.time(), tzinfo=IST)


# --- 7. Corrections -----------------------------------------------------------------------------


def corrections(ctx: Context, *, sees_review_reasons: bool) -> list[Sheet]:
    """Correction requests and decisions, reversals, and the M4 punch approvals / not-accepted
    reviews. Review reasons only in the Super Admin's file."""
    from app.modules.punches.models import PunchReview
    from app.modules.users.models import User

    columns = [
        Column("Kind", TEXT, 16),
        Column("Code", TEXT, 10),
        Column("Name", TEXT, 24),
        Column("Day", DATE, 12),
        Column("What changed", TEXT, 34),
        Column("Reason", TEXT, 36),
        Column("State", TEXT, 12),
        Column("Asked by", TEXT, 20),
        Column("Decided by", TEXT, 20),
        Column("Decided at", TEXT, 17),
    ]
    users = dict(ctx.session.execute(select(User.id, User.name)).all())
    sheets = []
    for plant in ctx.plants:
        employees = {
            e.id: e
            for e in ctx.session.scalars(select(Employee).where(Employee.plant_id == plant.id))
        }
        rows: list[list[Any]] = []
        found = list(
            ctx.session.scalars(
                select(Regularisation)
                .where(
                    Regularisation.employee_id.in_(list(employees)),
                    Regularisation.attendance_date.between(ctx.date_from, ctx.date_to),
                )
                .order_by(Regularisation.attendance_date, Regularisation.requested_at)
            )
        )
        for item in correction_service.present(ctx.session, found):
            employee = employees[item.employee.id]
            rows.append(
                [
                    "Correction",
                    employee.employee_code,
                    employee.full_name,
                    item.attendance_date,
                    _correction_text(item),
                    item.reason,
                    item.state.capitalize(),
                    item.requested_by.name,
                    item.decision.decided_by.name if item.decision else "",
                    f"{to_ist(item.decision.decided_at):%d/%m/%Y %H:%M}" if item.decision else "",
                ]
            )
        start, end = _day_start(ctx.date_from), _day_start(ctx.date_to + timedelta(days=1))
        approvals = ctx.session.execute(
            select(PunchReview, Punch)
            .join(Punch, Punch.id == PunchReview.punch_id)
            .where(
                Punch.plant_id == plant.id,
                PunchReview.action.in_(["approved", "not_accepted"]),
                Punch.punch_time >= start,
                Punch.punch_time < end,
            )
            .order_by(Punch.punch_time)
        ).all()
        for review, punch in approvals:
            employee = employees.get(review.employee_id or punch.employee_id)  # type: ignore[arg-type]
            rows.append(
                [
                    "Punch review",
                    employee.employee_code if employee else "",
                    employee.full_name if employee else "",
                    to_ist(punch.punch_time).date(),
                    f"Punch at {to_ist(punch.punch_time):%H:%M}: "
                    + (
                        "approved as " + (review.direction or "").upper()
                        if review.action == "approved"
                        else "not accepted"
                    ),
                    review.reason if sees_review_reasons and review.reason else "",
                    "Approved" if review.action == "approved" else "Not accepted",
                    "",
                    users.get(review.reviewed_by, ""),
                    f"{to_ist(review.reviewed_at):%d/%m/%Y %H:%M}",
                ]
            )
        sheets.append(Sheet(plant.code, columns, rows, heading=f"{plant.code} · {plant.name}"))
    return sheets


def _correction_text(item: Any) -> str:
    kinds = {
        "add_punch": f"Add {item.direction} at {clock(item.in_time or item.out_time)}",
        "add_in_out": f"Add IN {clock(item.in_time)} and OUT {clock(item.out_time)}",
        "ignore_punch": "Ignore a punch",
        "set_status": f"Set the status: {str(item.status_value).replace('_', '-')}",
        "reverse": "Reverses an earlier correction",
    }
    return str(kinds.get(item.kind, item.kind))


def month_range(month: str) -> tuple[date, date]:
    first = date.fromisoformat(f"{month}-01")
    return first, first.replace(day=monthrange(first.year, first.month)[1])
