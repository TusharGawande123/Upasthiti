"""The live dashboard, the emergency muster and the punctuality analytics (M5 spec §7 rules 17, 21).

"Inside now" and the muster are computed on read from the counted punches (`counting.py`), because
they must be exact to the second. The other numbers come from the stored attendance days of today
and yesterday, brought up to date first (`fresh_days`). The nightly close and the catch-up job keep
older days right, so the dashboard never recomputes a whole month.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import Select, extract, func, select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist, utc_now
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.read_service import (
    DEMO_PREFIX,
    check_range,
    fresh_days,
    visible_plant_ids,
)
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.contractors.models import Contractor
from app.modules.dashboard.schemas import (
    ContractorCount,
    DashPlant,
    LiveResponse,
    MusterPerson,
    MusterPlant,
    MusterResponse,
    PlantLive,
    PlantNumbers,
    PunctualityGroup,
    PunctualityResponse,
    ShiftLine,
    TopLate,
    Undecided,
    WeekPoint,
)
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift, ShiftRuleVersion
from app.modules.punches.counting import CountedForEmployee, counted_for_employees
from app.modules.regularisations.models import Regularisation, RegularisationDecision
from app.modules.settings.service import get_int_setting


def _dash_plant(plant: Plant) -> DashPlant:
    return DashPlant(
        id=plant.id, code=plant.code, name=plant.name, is_demo=plant.code.startswith(DEMO_PREFIX)
    )


# --- Inside now ---------------------------------------------------------------------------------


def people_inside(
    session: Session, plant_ids: list[uuid.UUID], now: datetime
) -> dict[uuid.UUID, CountedForEmployee]:
    """Employee id -> the IN that keeps them inside: their latest counted punch within the last
    `open_in_max_hours` is an IN, they have not left, and they belong to one of these plants
    (spec §7 rule 17)."""
    employees = {
        employee_id: plant_id
        for employee_id, plant_id in session.execute(
            select(Employee.id, Employee.plant_id).where(
                Employee.plant_id.in_(plant_ids), Employee.status == EmployeeStatus.ACTIVE.value
            )
        )
    }
    since = now - timedelta(hours=get_int_setting(session, "open_in_max_hours"))
    latest: dict[uuid.UUID, CountedForEmployee] = {}
    # Sorted by employee and time, so the last one seen per employee is the latest.
    for item in counted_for_employees(session, list(employees), since, now):
        latest[item.employee_id] = item
    return {employee_id: item for employee_id, item in latest.items() if item.direction == "in"}


# --- Live numbers -------------------------------------------------------------------------------


def live(
    session: Session,
    current_user: CurrentUser,
    *,
    plant_id: uuid.UUID | None,
    include_demo: bool,
    now: datetime,
) -> LiveResponse:
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    today = to_ist(now).date()
    yesterday = today - timedelta(days=1)
    fresh_days(session, plants, yesterday, today)
    plant_rows = {
        plant.id: plant
        for plant in session.scalars(select(Plant).where(Plant.id.in_(plants)).order_by(Plant.code))
    }
    inside = people_inside(session, plants, now)
    types = _people_facts(session, inside)
    sees_flags = current_user.access(Capability.REVIEW_PUNCHES) is Access.ALL
    month_start = today.replace(day=1)
    result = []
    for plant in plant_rows.values():
        result.append(
            _plant_live(
                session, plant, today, yesterday, month_start, now, inside, types, sees_flags
            )
        )
    return LiveResponse(
        generated_at=now, date=today, plants=result, totals=_totals([item for item in result])
    )


def _people_facts(
    session: Session, inside: dict[uuid.UUID, CountedForEmployee]
) -> dict[uuid.UUID, tuple[str, uuid.UUID | None, uuid.UUID]]:
    """Employee id -> (type, contractor id, plant id) for the people inside."""
    return {
        row[0]: (row[1], row[2], row[3])
        for row in session.execute(
            select(Employee.id, Employee.type, Employee.contractor_id, Employee.plant_id).where(
                Employee.id.in_(list(inside))
            )
        )
    }


def _plant_live(
    session: Session,
    plant: Plant,
    today: date,
    yesterday: date,
    month_start: date,
    now: datetime,
    inside: dict[uuid.UUID, CountedForEmployee],
    facts: dict[uuid.UUID, tuple[str, uuid.UUID | None, uuid.UUID]],
    sees_flags: bool,
) -> PlantLive:
    started = plant.attendance_start_date is not None and plant.attendance_start_date <= today
    here = [employee_id for employee_id, fact in facts.items() if fact[2] == plant.id]
    temporary = [employee_id for employee_id in here if facts[employee_id][0] == "temporary"]
    numbers = PlantNumbers(inside_now=len(here), inside_temporary=len(temporary))
    shifts: list[ShiftLine] = []
    if started:
        shifts = _day_numbers(session, plant, today, now, numbers)
        numbers.undecided = _undecided(session, plant, month_start, today)
        numbers.exceptions = _exceptions(session, plant, yesterday, today, numbers, sees_flags)
    return PlantLive(
        **numbers.model_dump(),
        plant=_dash_plant(plant),
        attendance_started=started,
        by_contractor=_by_contractor(session, temporary, facts),
        shifts=shifts,
    )


def _day_numbers(
    session: Session, plant: Plant, today: date, now: datetime, numbers: PlantNumbers
) -> list[ShiftLine]:
    """Expected, arrived, late, not arrived, on leave and off today, from the stored days."""
    rows = session.execute(
        select(AttendanceDay, ShiftRuleVersion, Shift)
        .outerjoin(ShiftRuleVersion, ShiftRuleVersion.id == AttendanceDay.shift_rule_version_id)
        .outerjoin(Shift, Shift.id == AttendanceDay.shift_id)
        .where(
            AttendanceDay.plant_id == plant.id,
            AttendanceDay.attendance_date == today,
            AttendanceDay.status != "not_employed",
        )
    ).all()
    per_shift: dict[uuid.UUID, ShiftLine] = {}
    for day, version, shift in rows:
        if day.status == "leave":
            numbers.on_leave += 1
        if day.day_kind != "working":
            numbers.off_today += 1
        if day.day_kind != "working" or day.status == "leave":
            continue
        numbers.expected += 1
        arrived = day.first_in is not None
        late = arrived and day.employee_type == "permanent" and day.late_min > 0
        if arrived:
            numbers.arrived += 1
        if late:
            numbers.late += 1
        if not arrived and version is not None and _grace_passed(today, version, now):
            numbers.not_arrived += 1
        if shift is not None:
            line = per_shift.setdefault(
                shift.id,
                ShiftLine(
                    shift={
                        "id": shift.id,
                        "name": shift.name,
                        "start_time": shift.start_time.strftime("%H:%M"),
                        "end_time": shift.end_time.strftime("%H:%M"),
                    },
                    expected=0,
                    arrived=0,
                    late=0,
                ),
            )
            line.expected += 1
            line.arrived += int(arrived)
            line.late += int(late)
    return sorted(per_shift.values(), key=lambda line: str(line.shift["start_time"]))


def _grace_passed(today: date, version: ShiftRuleVersion, now: datetime) -> bool:
    """A later shift is "not started" and is not counted as not arrived (spec §7 rule 17)."""
    start = datetime.combine(today, version.start_time, tzinfo=IST)
    return now > start + timedelta(minutes=version.grace_min)


def _undecided(session: Session, plant: Plant, month_start: date, today: date) -> Undecided:
    counts = dict(
        session.execute(
            select(AttendanceDay.status, func.count())
            .where(
                AttendanceDay.plant_id == plant.id,
                AttendanceDay.attendance_date.between(month_start, today),
                AttendanceDay.status.in_(["short_hours", "incomplete"]),
            )
            .group_by(AttendanceDay.status)
        ).all()
    )
    return Undecided(
        short_hours=counts.get("short_hours", 0), incomplete=counts.get("incomplete", 0)
    )


def _exceptions(
    session: Session,
    plant: Plant,
    yesterday: date,
    today: date,
    numbers: PlantNumbers,
    sees_flags: bool,
) -> int:
    """Yesterday's incomplete days + undecided Short-hours days + (Super Admin) days with an
    unchecked flagged punch + pending corrections of the plant (spec §7 rule 17)."""
    incomplete_yesterday = (
        session.scalar(
            select(func.count()).where(
                AttendanceDay.plant_id == plant.id,
                AttendanceDay.attendance_date == yesterday,
                AttendanceDay.status == "incomplete",
            )
        )
        or 0
    )
    unchecked = 0
    if sees_flags:
        unchecked = (
            session.scalar(
                select(func.count()).where(
                    AttendanceDay.plant_id == plant.id,
                    AttendanceDay.attendance_date.between(yesterday, today),
                    AttendanceDay.uses_unchecked_flag.is_(True),
                )
            )
            or 0
        )
    pending = (
        session.scalar(
            select(func.count())
            .select_from(Regularisation)
            .join(Employee, Employee.id == Regularisation.employee_id)
            .outerjoin(
                RegularisationDecision,
                RegularisationDecision.regularisation_id == Regularisation.id,
            )
            .where(RegularisationDecision.id.is_(None), Employee.plant_id == plant.id)
        )
        or 0
    )
    return incomplete_yesterday + numbers.undecided.short_hours + unchecked + pending


def _by_contractor(
    session: Session,
    temporary: list[uuid.UUID],
    facts: dict[uuid.UUID, tuple[str, uuid.UUID | None, uuid.UUID]],
) -> list[ContractorCount]:
    counts: dict[uuid.UUID | None, int] = defaultdict(int)
    for employee_id in temporary:
        counts[facts[employee_id][1]] += 1
    names = dict(
        session.execute(
            select(Contractor.id, Contractor.name).where(
                Contractor.id.in_([key for key in counts if key is not None])
            )
        ).all()
    )
    named = sorted(
        (
            ContractorCount(contractor={"id": key, "name": names.get(key, "")}, inside=count)
            for key, count in counts.items()
            if key is not None
        ),
        key=lambda item: str(item.contractor["name"]).lower() if item.contractor else "",
    )
    without = [ContractorCount(contractor=None, inside=counts[None])] if None in counts else []
    return [*named, *without]  # "No contractor" last


def _totals(plants: list[PlantLive]) -> PlantNumbers:
    totals = PlantNumbers()
    for item in plants:
        for field in (
            "inside_now",
            "inside_temporary",
            "expected",
            "arrived",
            "late",
            "not_arrived",
            "on_leave",
            "off_today",
            "exceptions",
        ):
            setattr(totals, field, getattr(totals, field) + getattr(item, field))
        totals.undecided = Undecided(
            short_hours=totals.undecided.short_hours + item.undecided.short_hours,
            incomplete=totals.undecided.incomplete + item.undecided.incomplete,
        )
    return totals


# --- Muster -------------------------------------------------------------------------------------


def muster(
    session: Session,
    current_user: CurrentUser,
    *,
    plant_id: uuid.UUID | None,
    include_demo: bool,
    now: datetime,
) -> MusterResponse:
    """Who is inside each plant now, with names; by department, then name (spec §4.2)."""
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    inside = people_inside(session, plants, now)
    employees = {
        employee.id: employee
        for employee in session.scalars(select(Employee).where(Employee.id.in_(list(inside))))
    }
    departments = dict(session.execute(select(Department.id, Department.name)).all())
    categories = dict(session.execute(select(EmployeeCategory.id, EmployeeCategory.name)).all())
    contractors = dict(session.execute(select(Contractor.id, Contractor.name)).all())
    kiosks = dict(
        session.execute(
            select(KioskDevice.id, KioskDevice.name).where(
                KioskDevice.id.in_({item.punch.kiosk_id for item in inside.values()})
            )
        ).all()
    )
    by_plant: dict[uuid.UUID, list[tuple[str, str, MusterPerson]]] = defaultdict(list)
    for employee_id, item in inside.items():
        employee = employees[employee_id]
        department = departments.get(employee.department_id) if employee.department_id else None
        person = MusterPerson(
            employee={
                "id": employee.id,
                "code": employee.employee_code,
                "name": employee.full_name,
                "type": employee.type,
                "category": categories.get(employee.category_id),
                "department": department,
                "contractor": contractors.get(employee.contractor_id)
                if employee.contractor_id
                else None,
            },
            in_time=item.punch_time,
            kiosk={"id": item.punch.kiosk_id, "name": kiosks.get(item.punch.kiosk_id, "")}
            if item.punch.kiosk_id
            else None,
        )
        by_plant[employee.plant_id].append(
            ((department or "~").lower(), employee.full_name.lower(), person)
        )
    plant_rows = session.scalars(select(Plant).where(Plant.id.in_(plants)).order_by(Plant.code))
    return MusterResponse(
        generated_at=now,
        plants=[
            MusterPlant(
                plant=_dash_plant(plant),
                count=len(by_plant.get(plant.id, [])),
                people=[person for _, _, person in sorted(by_plant.get(plant.id, []))],
            )
            for plant in plant_rows
        ],
    )


# --- Punctuality (F-9) --------------------------------------------------------------------------


def punctuality(
    session: Session,
    current_user: CurrentUser,
    *,
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None,
    group_by: str,
    include_demo: bool,
) -> PunctualityResponse:
    """From the stored days of permanent employees on working days with an IN (spec §7 rule 21)."""
    check_range(date_from, date_to)
    plants = visible_plant_ids(session, current_user, plant_id=plant_id, include_demo=include_demo)
    fresh_days(session, plants, date_from, min(date_to, to_ist(utc_now()).date()))
    late = AttendanceDay.late_min > 0
    base = (
        AttendanceDay.plant_id.in_(plants),
        AttendanceDay.attendance_date.between(date_from, date_to),
        AttendanceDay.employee_type == "permanent",
        AttendanceDay.day_kind == "working",
        AttendanceDay.first_in.is_not(None),
        AttendanceDay.status != "not_employed",
    )
    arrivals, late_count, late_total, early_exits = session.execute(
        select(
            func.count(),
            func.count().filter(late),
            func.coalesce(func.sum(AttendanceDay.late_min).filter(late), 0),
            func.count().filter(AttendanceDay.early_exit_min > 0),
        ).where(*base)
    ).one()
    weekly = _weekly(session, base)
    return PunctualityResponse(
        on_time_percent=_percent(arrivals - late_count, arrivals),
        arrivals=arrivals,
        late_count=late_count,
        average_late_min=_average(late_total, late_count),
        early_exit_count=early_exits,
        weekly=weekly,
        groups=_groups(session, base, group_by),
        top_late=_top_late(session, base),
    )


def _percent(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def _average(total: int, count: int) -> float:
    return round(total / count, 1) if count else 0.0


def _weekly(session: Session, base: tuple) -> list[WeekPoint]:
    week = func.date_trunc("week", AttendanceDay.attendance_date).label("week")
    rows = session.execute(
        select(week, func.count(), func.count().filter(AttendanceDay.late_min > 0))
        .where(*base)
        .group_by(week)
        .order_by(week)
    ).all()
    return [
        WeekPoint(week_start=row[0].date(), on_time_percent=_percent(row[1] - row[2], row[1]))
        for row in rows
    ]


def _groups(session: Session, base: tuple, group_by: str) -> list[PunctualityGroup]:
    late = AttendanceDay.late_min > 0
    key_column: object
    label_column: object
    statement: Select
    if group_by == "weekday":
        key_column = extract("isodow", AttendanceDay.attendance_date)
        label_column = key_column
        statement = select(key_column, label_column)
    elif group_by == "shift":
        key_column, label_column = AttendanceDay.shift_id, Shift.name
        statement = select(key_column, label_column).outerjoin(
            Shift, Shift.id == AttendanceDay.shift_id
        )
    else:
        statement = select().join(Employee, Employee.id == AttendanceDay.employee_id)
        if group_by == "department":
            key_column, label_column = Employee.department_id, Department.name
            statement = statement.outerjoin(Department, Department.id == Employee.department_id)
        else:
            key_column, label_column = Employee.category_id, EmployeeCategory.name
            statement = statement.outerjoin(
                EmployeeCategory, EmployeeCategory.id == Employee.category_id
            )
        statement = statement.add_columns(key_column, label_column)
    rows = session.execute(
        statement.add_columns(
            func.count(),
            func.count().filter(late),
            func.coalesce(func.sum(AttendanceDay.late_min).filter(late), 0),
        )
        .where(*base)
        .group_by(key_column, label_column)
    ).all()
    groups = [
        PunctualityGroup(
            key=str(row[0]),
            label=str(row[1]) if row[1] is not None else "",
            arrivals=row[2],
            late_count=row[3],
            on_time_percent=_percent(row[2] - row[3], row[2]),
            average_late_min=_average(row[4], row[3]),
        )
        for row in rows
    ]
    return sorted(groups, key=lambda group: (group.label == "", group.label))


def _top_late(session: Session, base: tuple) -> list[TopLate]:
    late = AttendanceDay.late_min > 0
    rows = session.execute(
        select(
            Employee,
            func.count().filter(late).label("late_count"),
            func.coalesce(func.sum(AttendanceDay.late_min).filter(late), 0).label("late_min"),
        )
        .join(Employee, Employee.id == AttendanceDay.employee_id)
        .where(*base)
        .group_by(Employee.id)
        .having(func.count().filter(late) > 0)
        .order_by(func.count().filter(late).desc(), func.sum(AttendanceDay.late_min).desc())
        .limit(10)
    ).all()
    return [
        TopLate(
            employee={"id": row[0].id, "code": row[0].employee_code, "name": row[0].full_name},
            late_count=row[1],
            late_min=row[2],
        )
        for row in rows
    ]
