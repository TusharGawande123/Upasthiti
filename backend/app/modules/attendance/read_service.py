"""Reading attendance: the daily list, the monthly register, an employee's month and the
undecided-days count (M5 spec §5.1, §5.6, §7 rules 14 and 15).

Every read first brings the days it shows up to date (`ensure_fresh`), so a screen is never wrong,
only sometimes a little slower. Plant scope is applied inside each query; DEMO plants (code starts
with DEMO) are left out unless the Super Admin asks for them, or the Plant Head's own plant is one.
"""

import uuid
from calendar import monthrange
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams
from app.core.time import to_ist, utc_now
from app.modules.attendance import service
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.schemas import (
    Day,
    PersonSummary,
    RegisterCell,
    RegisterPlant,
    RegisterRow,
    Totals,
    UndecidedPlant,
    UndecidedResponse,
    day_from_row,
    register_code,
)
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import plant_filter
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee, EmployeePlantHistory
from app.modules.holidays.models import Holiday
from app.modules.leave.models import LeaveRecord
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift
from app.modules.regularisations.models import Regularisation, RegularisationDecision

DEMO_PREFIX = "DEMO"
MAX_RANGE_DAYS = 92


# --- Which plants and people ----------------------------------------------------------------


def visible_plant_ids(
    session: Session,
    current_user: CurrentUser,
    *,
    plant_id: uuid.UUID | None = None,
    include_demo: bool = False,
) -> list[uuid.UUID]:
    """The plants the user may read, without DEMO plants unless allowed (decision 0034 line 7)."""
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    statement = select(Plant.id, Plant.code)
    if allowed is not None:
        statement = statement.where(Plant.id.in_(allowed))
    if plant_id is not None:
        statement = statement.where(Plant.id == plant_id)
    show_demo = include_demo and current_user.access(Capability.SHOW_DEMO_PLANTS) is Access.ALL
    rows = session.execute(statement).all()
    own = allowed or frozenset()
    return [
        row[0] for row in rows if show_demo or not row[1].startswith(DEMO_PREFIX) or row[0] in own
    ]


def check_day_not_future(day: date) -> None:
    if day > to_ist(utc_now()).date():
        raise ApiError("ATTENDANCE_DATE_INVALID", "This day has not begun yet.", 422)


def check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise ApiError("VALIDATION_FAILED", "The end is before the start.", 422)
    if (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise ApiError("REPORT_RANGE_TOO_LONG", "Choose at most 92 days.", 422)


def _employees_in(
    session: Session, plant_ids: list[uuid.UUID], date_from: date, date_to: date
) -> Select[Employee]:
    """Employees employed at any time in the range, by their plant today (history is applied
    through the stored days, which carry the plant of each date)."""
    return select(Employee).where(
        or_(Employee.plant_id.in_(plant_ids), Employee.id.in_(_moved_in(plant_ids))),
        Employee.joined_on <= date_to,
        or_(Employee.left_on.is_(None), Employee.left_on >= date_from),
    )


def _moved_in(plant_ids: list[uuid.UUID]):
    return select(EmployeePlantHistory.employee_id).where(
        EmployeePlantHistory.plant_id.in_(plant_ids)
    )


def fresh_days(
    session: Session,
    plant_ids: list[uuid.UUID],
    date_from: date,
    date_to: date,
) -> list[uuid.UUID]:
    """Bring the days of everyone in these plants up to date; returns their employee ids."""
    ids = list(
        session.scalars(
            _employees_in(session, plant_ids, date_from, date_to).with_only_columns(Employee.id)
        )
    )
    now = utc_now()
    for start in range(0, len(ids), service.CATCH_UP_BATCH):
        service.ensure_fresh(
            session, ids[start : start + service.CATCH_UP_BATCH], date_from, date_to, now
        )
    return ids


# --- Presenting days in bulk -------------------------------------------------------------------


def present_days(session: Session, rows: Sequence[AttendanceDay]) -> list[Day]:
    """`Day` objects for stored rows, with the names and counts they need, in a few queries."""
    plant_codes = dict(
        session.execute(
            select(Plant.id, Plant.code).where(Plant.id.in_({row.plant_id for row in rows}))
        ).all()
    )
    shift_names = dict(
        session.execute(
            select(Shift.id, Shift.name).where(
                Shift.id.in_({row.shift_id for row in rows if row.shift_id})
            )
        ).all()
    )
    leave_paid = leave_paid_map(session, rows)
    holidays = {
        holiday.id: holiday
        for holiday in session.scalars(
            select(Holiday).where(
                Holiday.id.in_({row.holiday_id for row in rows if row.holiday_id})
            )
        )
    }
    pending = _pending_counts(session, rows)
    answers = []
    for row in rows:
        holiday = holidays.get(row.holiday_id) if row.holiday_id else None
        answers.append(
            day_from_row(
                row,
                plant_code=plant_codes.get(row.plant_id, ""),
                shift_name=shift_names.get(row.shift_id) if row.shift_id else None,
                leave_paid=leave_paid.get(row.leave_record_id) if row.leave_record_id else None,
                holiday_name=holiday.name if holiday else None,
                holiday_paid=holiday.is_paid if holiday else None,
                pending_corrections=pending.get((row.employee_id, row.attendance_date), 0),
                open_state=_open_state(row),
            )
        )
    return answers


def _open_state(row: AttendanceDay) -> str | None:
    """Open days show who is inside (rule 8): derived from the stored first IN and last OUT."""
    if row.status != "open":
        return None
    if row.first_in is None:
        return "not_arrived"
    return "left" if row.last_out is not None else "inside"


def _pending_counts(
    session: Session, rows: Sequence[AttendanceDay]
) -> dict[tuple[uuid.UUID, date], int]:
    if not rows:
        return {}
    counts = session.execute(
        select(Regularisation.employee_id, Regularisation.attendance_date, func.count())
        .outerjoin(
            RegularisationDecision, RegularisationDecision.regularisation_id == Regularisation.id
        )
        .where(
            RegularisationDecision.id.is_(None),
            Regularisation.employee_id.in_({row.employee_id for row in rows}),
            Regularisation.attendance_date.between(
                min(row.attendance_date for row in rows), max(row.attendance_date for row in rows)
            ),
        )
        .group_by(Regularisation.employee_id, Regularisation.attendance_date)
    ).all()
    return {(employee_id, day): count for employee_id, day, count in counts}


def person_summaries(
    session: Session, employee_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, PersonSummary]:
    employees = list(session.scalars(select(Employee).where(Employee.id.in_(set(employee_ids)))))
    departments = dict(
        session.execute(
            select(Department.id, Department.name).where(
                Department.id.in_({e.department_id for e in employees if e.department_id})
            )
        ).all()
    )
    categories = dict(
        session.execute(
            select(EmployeeCategory.id, EmployeeCategory.name).where(
                EmployeeCategory.id.in_({e.category_id for e in employees})
            )
        ).all()
    )
    contractors = dict(
        session.execute(
            select(Contractor.id, Contractor.name).where(
                Contractor.id.in_({e.contractor_id for e in employees if e.contractor_id})
            )
        ).all()
    )
    return {
        employee.id: PersonSummary(
            id=employee.id,
            code=employee.employee_code,
            name=employee.full_name,
            type=employee.type,
            department=departments.get(employee.department_id) if employee.department_id else None,
            category=categories.get(employee.category_id),
            contractor=contractors.get(employee.contractor_id) if employee.contractor_id else None,
        )
        for employee in employees
    }


# --- Totals -------------------------------------------------------------------------------------


def totals_of(rows: Iterable[AttendanceDay], leave_paid: dict[uuid.UUID, bool]) -> Totals:
    """The month numbers of one person (spec §5.6): counted from the stored days."""
    totals = Totals()
    for row in rows:
        status = row.status
        if status in ("present", "half_day", "short_hours", "absent", "incomplete"):
            setattr(totals, status, getattr(totals, status) + 1)
        elif status == "leave":
            if row.leave_record_id and leave_paid.get(row.leave_record_id, True):
                totals.leave_paid += 1
            else:
                totals.leave_unpaid += 1
        elif status in ("weekly_off", "holiday"):
            setattr(totals, status, getattr(totals, status) + 1)
        if status == "present" and row.day_kind != "working":
            totals.worked_on_off_day += 1
        totals.worked_min += row.worked_min
        totals.overtime_min += row.overtime_min
        if row.late_min:
            totals.late_count += 1
            totals.late_min += row.late_min
        if row.early_exit_min:
            totals.early_exit_count += 1
    return totals


def leave_paid_map(session: Session, rows: Sequence[AttendanceDay]) -> dict[uuid.UUID, bool]:
    """Whether each leave record of these days is paid."""
    return dict(
        session.execute(
            select(LeaveRecord.id, LeaveRecord.is_paid).where(
                LeaveRecord.id.in_({row.leave_record_id for row in rows if row.leave_record_id})
            )
        ).all()
    )


# --- Daily list ---------------------------------------------------------------------------------


def daily(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    day: date,
    plant_id: uuid.UUID | None,
    status: str | None,
    employee_type: str | None,
    department_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    contractor_id: uuid.UUID | None,
    shift_id: uuid.UUID | None,
    has_exceptions: bool | None,
    corrected: bool | None,
    q: str | None,
    include_demo: bool,
) -> tuple[list[tuple[Employee, Day]], int]:
    check_day_not_future(day)
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    fresh_days(session, plants, day, day)
    statement = (
        select(AttendanceDay, Employee)
        .join(Employee, Employee.id == AttendanceDay.employee_id)
        .where(
            AttendanceDay.attendance_date == day,
            AttendanceDay.plant_id.in_(plants),
            AttendanceDay.status != "not_employed",
        )
        .order_by(Employee.employee_code)
    )
    if status:
        statement = statement.where(AttendanceDay.status == status)
    if employee_type:
        statement = statement.where(AttendanceDay.employee_type == employee_type)
    if department_id:
        statement = statement.where(Employee.department_id == department_id)
    if category_id:
        statement = statement.where(Employee.category_id == category_id)
    if contractor_id:
        statement = statement.where(Employee.contractor_id == contractor_id)
    if shift_id:
        statement = statement.where(AttendanceDay.shift_id == shift_id)
    if has_exceptions is not None:
        has = func.cardinality(AttendanceDay.exceptions) > 0
        statement = statement.where(has if has_exceptions else ~has)
    if corrected is not None:
        statement = statement.where(AttendanceDay.is_corrected.is_(corrected))
    if q:
        pattern = f"%{q.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(Employee.full_name).like(pattern),
                func.lower(Employee.employee_code).like(pattern),
            )
        )
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = session.execute(statement.offset(params.offset).limit(params.page_size)).all()
    days = present_days(session, [row[0] for row in rows])
    return [(row[1], day_) for row, day_ in zip(rows, days, strict=True)], total or 0


# --- Register -----------------------------------------------------------------------------------


def month_bounds(month: str) -> tuple[date, date]:
    start = date.fromisoformat(f"{month}-01")
    return start, start.replace(day=monthrange(start.year, start.month)[1])


def register(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    month: str,
    plant_id: uuid.UUID,
    employee_type: str | None,
    department_id: uuid.UUID | None,
    q: str | None,
    include_demo: bool,
) -> tuple[Plant, int, list[RegisterRow], int]:
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    plant = session.get(Plant, plant_id)
    if plant is None or plant_id not in plants:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    first, last = month_bounds(month)
    last = min(last, to_ist(utc_now()).date())
    employees = _employees_in(session, [plant_id], first, last)
    if employee_type:
        employees = employees.where(Employee.type == employee_type)
    if department_id:
        employees = employees.where(Employee.department_id == department_id)
    if q:
        pattern = f"%{q.strip().lower()}%"
        employees = employees.where(
            or_(
                func.lower(Employee.full_name).like(pattern),
                func.lower(Employee.employee_code).like(pattern),
            )
        )
    employees = employees.order_by(Employee.employee_code)
    total = session.scalar(select(func.count()).select_from(employees.order_by(None).subquery()))
    page = list(session.scalars(employees.offset(params.offset).limit(params.page_size)))
    ids = [employee.id for employee in page]
    if last >= first:
        service.ensure_fresh(session, ids, first, last, utc_now())
    rows = list(
        session.scalars(
            select(AttendanceDay).where(
                AttendanceDay.employee_id.in_(ids),
                AttendanceDay.attendance_date.between(first, last),
                AttendanceDay.plant_id == plant_id,
            )
        )
    )
    leave_paid = leave_paid_map(session, rows)
    by_employee: dict[uuid.UUID, dict[date, AttendanceDay]] = defaultdict(dict)
    for row in rows:
        by_employee[row.employee_id][row.attendance_date] = row
    people = person_summaries(session, ids)
    items = []
    month_end = month_bounds(month)[1]
    for employee in page:
        cells = []
        days = by_employee.get(employee.id, {})
        current = first
        while current <= month_end:
            row = days.get(current)
            cells.append(_cell(current, row, leave_paid))
            current += timedelta(days=1)
        items.append(
            RegisterRow(
                employee=people[employee.id],
                days=cells,
                totals=totals_of(days.values(), leave_paid),
            )
        )
    return plant, month_end.day, items, total or 0


def _cell(day: date, row: AttendanceDay | None, leave_paid: dict[uuid.UUID, bool]) -> RegisterCell:
    if row is None:
        return RegisterCell(date=day, code="–", is_corrected=False, has_exceptions=False)
    paid = leave_paid.get(row.leave_record_id) if row.leave_record_id else None
    return RegisterCell(
        date=day,
        code=register_code(row.status, row.day_kind, _open_state(row), paid),
        is_corrected=row.is_corrected,
        has_exceptions=bool(row.exceptions),
    )


# --- Undecided days (hand-over to M7) -----------------------------------------------------------


def undecided(
    session: Session,
    current_user: CurrentUser,
    *,
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None,
    include_demo: bool,
) -> UndecidedResponse:
    """Closed days whose status is still Short hours or Incomplete (spec §7 rule 23)."""
    check_range(date_from, date_to)
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    fresh_days(session, plants, date_from, min(date_to, to_ist(utc_now()).date()))
    rows = session.execute(
        select(AttendanceDay.plant_id, AttendanceDay.status, func.count())
        .where(
            AttendanceDay.plant_id.in_(plants),
            AttendanceDay.attendance_date.between(date_from, date_to),
            AttendanceDay.status.in_(["short_hours", "incomplete"]),
        )
        .group_by(AttendanceDay.plant_id, AttendanceDay.status)
    ).all()
    per_plant: dict[uuid.UUID, dict[str, int]] = defaultdict(
        lambda: {"short_hours": 0, "incomplete": 0}
    )
    for found_plant, found_status, count in rows:
        per_plant[found_plant][found_status] = count
    plant_rows = {
        plant.id: plant for plant in session.scalars(select(Plant).where(Plant.id.in_(per_plant)))
    }
    return UndecidedResponse(
        short_hours=sum(item["short_hours"] for item in per_plant.values()),
        incomplete=sum(item["incomplete"] for item in per_plant.values()),
        plants=[
            UndecidedPlant(
                plant=RegisterPlant(
                    id=plant_id_, code=plant_rows[plant_id_].code, name=plant_rows[plant_id_].name
                ),
                short_hours=counts["short_hours"],
                incomplete=counts["incomplete"],
            )
            for plant_id_, counts in sorted(
                per_plant.items(), key=lambda item: plant_rows[item[0]].code
            )
        ],
    )
