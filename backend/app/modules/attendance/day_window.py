"""Which shift a person works on a date, and the window of that attendance day (M5 spec §7 rules
3–5; plan cross-cutting decision 2).

ONE helper for both the attendance calculation and the gate rule `shift_closed`, so the two can
never disagree about where a day starts and ends.

`AttendanceCalendar.load()` reads everything it needs for some employees and dates in a few
queries (plant history, shift assignments, rule versions, weekly offs, holidays, attendance start
dates); the questions after that are answered from memory. A month of a plant (650 people × 31
days) therefore costs a handful of queries, not thousands.

Window of day D (rule 5): from D at S(D) − N up to (not including) D+1 at S(D+1) − N, where S is
the start time of the person's shift on that date and N = `attendance_window_before_hours`.
Windows of one person follow each other without gaps, so every punch belongs to exactly one day.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.time import to_ist
from app.modules.attendance.compute import DayKind, HolidayInfo, shift_moments
from app.modules.employees.models import Employee, EmployeePlantHistory, ShiftAssignment
from app.modules.holidays.models import Holiday, HolidayPlant
from app.modules.org.models import Plant, PlantWeeklyOff, ShiftRuleVersion
from app.modules.org.shift_rules_service import ShiftRules, rules_of_version
from app.modules.shift_swaps.models import ShiftSwap

# A day whose window ends less than this after its shift end gets SHIFT_CHANGE_SHORT_DAY.
SHORT_WINDOW_AFTER_END = timedelta(hours=1)


@dataclass(frozen=True)
class EmployeeFacts:
    employee_id: uuid.UUID
    employee_type: str  # permanent | temporary
    joined_on: date
    left_on: date | None


@dataclass(frozen=True)
class DayShift:
    shift_id: uuid.UUID
    rule_version_id: uuid.UUID
    rules: ShiftRules


@dataclass(frozen=True)
class DayWindow:
    day: date
    plant_id: uuid.UUID
    shift: DayShift
    start: datetime
    end: datetime  # not included
    short: bool  # ends less than 1 hour after the shift end (SHIFT_CHANGE_SHORT_DAY)


@dataclass(frozen=True)
class _Dated[ValueType]:
    """A value that applies from `from_date` up to `to_date` (open when None)."""

    from_date: date
    to_date: date | None
    value: ValueType

    def covers(self, day: date) -> bool:
        return self.from_date <= day and (self.to_date is None or day <= self.to_date)


class AttendanceCalendar:
    def __init__(self, window_before_hours: int) -> None:
        self.window_before = timedelta(hours=window_before_hours)
        self.employees: dict[uuid.UUID, EmployeeFacts] = {}
        self._plants: dict[uuid.UUID, list[_Dated[uuid.UUID]]] = defaultdict(list)
        self._shifts: dict[uuid.UUID, list[_Dated[uuid.UUID]]] = defaultdict(list)
        # A one-day shift swap (F-58) replaces the assignment for that date.
        self._swaps: dict[tuple[uuid.UUID, date], uuid.UUID] = {}
        # Per shift, sorted by (effective_from, created_at): the last one on or before a date wins.
        self._versions: dict[uuid.UUID, list[ShiftRuleVersion]] = defaultdict(list)
        self._weekly_offs: dict[uuid.UUID, list[PlantWeeklyOff]] = defaultdict(list)
        self._attendance_start: dict[uuid.UUID, date | None] = {}
        self._all_plant_holidays: dict[date, Holiday] = {}
        self._plant_holidays: dict[tuple[uuid.UUID, date], Holiday] = {}

    # --- Loading ------------------------------------------------------------------------------

    @classmethod
    def load(
        cls,
        session: Session,
        employee_ids: list[uuid.UUID],
        date_from: date,
        date_to: date,
        *,
        window_before_hours: int,
    ) -> AttendanceCalendar:
        """Everything for these employees between `date_from` and `date_to` (one day more on
        each side, for the windows and the carry-over)."""
        calendar = cls(window_before_hours)
        first, last = date_from - timedelta(days=1), date_to + timedelta(days=1)
        for employee in session.scalars(select(Employee).where(Employee.id.in_(employee_ids))):
            calendar.employees[employee.id] = EmployeeFacts(
                employee.id, employee.type, employee.joined_on, employee.left_on
            )
        for row in session.scalars(
            select(EmployeePlantHistory).where(
                EmployeePlantHistory.employee_id.in_(employee_ids),
                EmployeePlantHistory.from_date <= last,
                or_(EmployeePlantHistory.to_date.is_(None), EmployeePlantHistory.to_date >= first),
            )
        ):
            calendar._plants[row.employee_id].append(
                _Dated(row.from_date, row.to_date, row.plant_id)
            )
        for row in session.scalars(
            select(ShiftAssignment).where(
                ShiftAssignment.employee_id.in_(employee_ids),
                ShiftAssignment.from_date <= last,
                or_(ShiftAssignment.to_date.is_(None), ShiftAssignment.to_date >= first),
            )
        ):
            calendar._shifts[row.employee_id].append(
                _Dated(row.from_date, row.to_date, row.shift_id)
            )
        for swap in session.scalars(
            select(ShiftSwap).where(
                ShiftSwap.employee_id.in_(employee_ids),
                ShiftSwap.swap_date.between(first, last),
                ShiftSwap.cancelled_at.is_(None),
            )
        ):
            calendar._swaps[(swap.employee_id, swap.swap_date)] = swap.shift_id
        calendar._load_rules_and_plants(session, first, last)
        return calendar

    def _load_rules_and_plants(self, session: Session, first: date, last: date) -> None:
        shift_ids = {item.value for rows in self._shifts.values() for item in rows}
        shift_ids |= set(self._swaps.values())
        for version in session.scalars(
            select(ShiftRuleVersion)
            .where(ShiftRuleVersion.shift_id.in_(shift_ids))
            .order_by(ShiftRuleVersion.effective_from, ShiftRuleVersion.created_at)
        ):
            self._versions[version.shift_id].append(version)
        plant_ids = {item.value for rows in self._plants.values() for item in rows}
        for weekly_off in session.scalars(
            select(PlantWeeklyOff)
            .where(PlantWeeklyOff.plant_id.in_(plant_ids))
            .order_by(PlantWeeklyOff.effective_from, PlantWeeklyOff.created_at)
        ):
            self._weekly_offs[weekly_off.plant_id].append(weekly_off)
        for plant_id, start in session.execute(
            select(Plant.id, Plant.attendance_start_date).where(Plant.id.in_(plant_ids))
        ):
            self._attendance_start[plant_id] = start
        holidays = list(
            session.scalars(
                select(Holiday).where(
                    Holiday.date.between(first, last), Holiday.cancelled_at.is_(None)
                )
            )
        )
        for holiday in holidays:
            if holiday.all_plants:
                self._all_plant_holidays[holiday.date] = holiday
        by_id = {holiday.id: holiday for holiday in holidays if not holiday.all_plants}
        for holiday_id, plant_id in session.execute(
            select(HolidayPlant.holiday_id, HolidayPlant.plant_id).where(
                HolidayPlant.holiday_id.in_(by_id)
            )
        ):
            holiday = by_id[holiday_id]
            self._plant_holidays[(plant_id, holiday.date)] = holiday

    # --- Questions ----------------------------------------------------------------------------

    def plant_on(self, employee_id: uuid.UUID, day: date) -> uuid.UUID | None:
        return _value_on(self._plants.get(employee_id, []), day)

    def employed_on(self, employee_id: uuid.UUID, day: date) -> bool:
        """Joined, not left, and on or after the plant's attendance start date (rule 3)."""
        facts = self.employees.get(employee_id)
        plant_id = self.plant_on(employee_id, day)
        if facts is None or plant_id is None:
            return False
        if day < facts.joined_on or (facts.left_on is not None and day > facts.left_on):
            return False
        started = self._attendance_start.get(plant_id)
        return started is not None and day >= started

    def shift_on(self, employee_id: uuid.UUID, day: date) -> DayShift | None:
        """The shift and the rule version in force on `day` (rule 3): the one-day swap of that date
        if there is one (F-58), otherwise the assignment."""
        shift_id = self._swaps.get((employee_id, day)) or _value_on(
            self._shifts.get(employee_id, []), day
        )
        if shift_id is None:
            return None
        versions = self._versions.get(shift_id, [])
        if not versions:
            return None
        in_force = [version for version in versions if version.effective_from <= day]
        # Before the first version (a shift created later than the day): its first rules.
        version = in_force[-1] if in_force else versions[0]
        return DayShift(shift_id, version.id, rules_of_version(version))

    def day_kind(self, plant_id: uuid.UUID, day: date) -> tuple[DayKind, HolidayInfo | None]:
        """Holiday, weekly off or working (rule 4); a holiday on the weekly off is a holiday."""
        holiday = self._all_plant_holidays.get(day) or self._plant_holidays.get((plant_id, day))
        if holiday is not None:
            return "holiday", HolidayInfo(holiday.id, holiday.name, holiday.is_paid)
        in_force = [row for row in self._weekly_offs.get(plant_id, []) if row.effective_from <= day]
        if in_force and in_force[-1].weekday == day.isoweekday():
            return "weekly_off", None
        return "working", None

    def window(self, employee_id: uuid.UUID, day: date) -> DayWindow | None:
        """The window of `day` for this person, or None when there is no shift or plant."""
        shift = self.shift_on(employee_id, day)
        plant_id = self.plant_on(employee_id, day)
        if shift is None or plant_id is None:
            return None
        shift_start, shift_end = shift_moments(day, shift.rules)
        next_shift = self.shift_on(employee_id, day + timedelta(days=1)) or shift
        next_start, _ = shift_moments(day + timedelta(days=1), next_shift.rules)
        start = shift_start - self.window_before
        end = next_start - self.window_before
        return DayWindow(
            day=day,
            plant_id=plant_id,
            shift=shift,
            start=start,
            end=end,
            short=end < shift_end + SHORT_WINDOW_AFTER_END,
        )

    def day_containing(self, employee_id: uuid.UUID, moment: datetime) -> DayWindow | None:
        """The attendance day whose window holds `moment`: the IST date, the day before, or (for a
        shift that starts soon after midnight) the day after."""
        local_day = to_ist(moment).date()
        for day in (local_day, local_day - timedelta(days=1), local_day + timedelta(days=1)):
            found = self.window(employee_id, day)
            if found is not None and found.start <= moment < found.end:
                return found
        return None


def _value_on[ValueType](rows: list[_Dated[ValueType]], day: date) -> ValueType | None:
    covering = [row for row in rows if row.covers(day)]
    return max(covering, key=lambda row: row.from_date).value if covering else None
