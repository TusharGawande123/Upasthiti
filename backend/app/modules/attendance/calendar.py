"""Which plant a person belongs to on a date, and whether that date is a working day there.

Small single-date questions (M5 spec §7 rules 3–4), used by the leave list ("2 working days") and
the holiday checks. The attendance calculation asks the same questions for many people and days
at once through the day-window loader, which follows the same rules.
"""

import uuid
from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.employees.models import EmployeePlantHistory
from app.modules.holidays.models import Holiday, HolidayPlant
from app.modules.org.shift_rules_service import weekly_off_on


def employee_plant_on(session: Session, employee_id: uuid.UUID, day: date) -> uuid.UUID | None:
    """The plant from the employee's plant history on `day`, or None outside it."""
    return session.scalar(
        select(EmployeePlantHistory.plant_id)
        .where(
            EmployeePlantHistory.employee_id == employee_id,
            EmployeePlantHistory.from_date <= day,
            or_(EmployeePlantHistory.to_date.is_(None), EmployeePlantHistory.to_date >= day),
        )
        .order_by(EmployeePlantHistory.from_date.desc())
        .limit(1)
    )


def active_holiday_on(session: Session, plant_id: uuid.UUID, day: date) -> Holiday | None:
    """An active holiday on `day` for all plants or listing this plant."""
    listed = select(HolidayPlant.holiday_id).where(HolidayPlant.plant_id == plant_id)
    return session.scalars(
        select(Holiday)
        .where(
            Holiday.date == day,
            Holiday.cancelled_at.is_(None),
            or_(Holiday.all_plants.is_(True), Holiday.id.in_(listed)),
        )
        .limit(1)
    ).first()


def is_working_day(session: Session, plant_id: uuid.UUID, day: date) -> bool:
    """Not a holiday and not the plant's weekly off on that date (spec §7 rule 4)."""
    if active_holiday_on(session, plant_id, day) is not None:
        return False
    weekly_off = weekly_off_on(session, plant_id, day)
    return weekly_off is None or day.isoweekday() != weekly_off.weekday


def count_working_days(
    session: Session, employee_id: uuid.UUID, from_date: date, to_date: date
) -> int:
    """Working days of the employee's plant (on each date) inside the range, both ends included.

    Weekly offs and holidays inside a leave are not leave days (spec §7 rule 12).
    """
    working = 0
    day = from_date
    while day <= to_date:
        plant_id = employee_plant_on(session, employee_id, day)
        if plant_id is not None and is_working_day(session, plant_id, day):
            working += 1
        day += timedelta(days=1)
    return working
