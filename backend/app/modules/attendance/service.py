"""Keeping `attendance_days` right: marking days stale and recomputing them (M5 spec §7 rule 14).

- **Mark stale** in the same transaction as the cause (a punch, a review, a correction, leave, a
  holiday, a weekly off or shift rule change, an employee change): one cheap upsert per day.
- **Recompute**: right after the response (background task), every 5 minutes (catch-up job), at
  00:05 IST (nightly close) and before every read. A read is never wrong, only slower.

The loader gathers the inputs of many days in a few queries (AttendanceCalendar, bulk counting,
corrections, leave) and hands each day to the pure `compute_day()`.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.core.time import IST, to_ist, utc_now
from app.modules.attendance.compute import (
    ATTENDANCE_CALC_VERSION,
    DayEvent,
    DayInputs,
    DayResult,
    LeaveInfo,
    compute_day,
)
from app.modules.attendance.day_window import AttendanceCalendar, DayWindow
from app.modules.attendance.models import AttendanceDay
from app.modules.employees.models import Employee
from app.modules.leave.models import LeaveRecord
from app.modules.punches.counting import counted_for_employees, latest_reviews
from app.modules.punches.models import Punch, PunchDecision
from app.modules.regularisations.models import (
    CorrectionKind,
    DecisionAction,
    Regularisation,
    RegularisationDecision,
)
from app.modules.settings.service import get_int_setting

CATCH_UP_BATCH = 500
# The nightly close looks back this far, so days missed while the free server slept are closed.
NIGHTLY_LOOK_BACK_DAYS = 7

DayKey = tuple[uuid.UUID, date]


# --- Marking stale ------------------------------------------------------------------------------


def mark_days_stale(
    session: Session, employee_ids: Iterable[uuid.UUID], date_from: date, date_to: date
) -> None:
    """Mark the days of these employees from `date_from` to `date_to` stale (the caller commits).

    Rows that do not exist yet are created as placeholders: only for days the person was
    employed (joined, not left, on or after the plant's attendance start date) and never in the
    future (rule 3). Existing rows of other days are only marked. The next recompute fills them.
    """
    ids = list(dict.fromkeys(employee_ids))
    today = to_ist(utc_now()).date()
    date_to = min(date_to, today)
    if not ids or date_to < date_from:
        return
    # Existing rows first: also those outside the employment now (they become not_employed).
    session.execute(
        update(AttendanceDay)
        .where(
            AttendanceDay.employee_id.in_(ids),
            AttendanceDay.attendance_date.between(date_from, date_to),
        )
        .values(stale=True)
    )
    session.execute(
        text(
            """
            INSERT INTO attendance_days (id, employee_id, attendance_date, plant_id, employee_type,
                                         day_kind, status, stale)
            SELECT gen_random_uuid(), e.id, d::date, e.plant_id, e.type, 'working', 'open', true
            FROM employees e
            JOIN plants p ON p.id = e.plant_id
            CROSS JOIN generate_series(CAST(:date_from AS date), CAST(:date_to AS date),
                                       interval '1 day') AS d
            WHERE e.id = ANY(:ids)
              AND d::date >= e.joined_on
              AND (e.left_on IS NULL OR d::date <= e.left_on)
              AND d::date >= p.attendance_start_date
            ON CONFLICT (employee_id, attendance_date) DO NOTHING
            """
        ),
        {"ids": ids, "date_from": date_from, "date_to": date_to},
    )


def mark_punch_days_stale(
    session: Session, employee_ids: Iterable[uuid.UUID | None], punch_time: datetime
) -> None:
    """A counted punch or a review changes the day of its time and the day before (a night shift
    or a carried-over OUT belongs to the previous date)."""
    day = to_ist(punch_time).date()
    mark_days_stale(
        session,
        [employee_id for employee_id in employee_ids if employee_id is not None],
        day - timedelta(days=1),
        day + timedelta(days=1),
    )


def mark_plant_days_stale(
    session: Session, plant_ids: Iterable[uuid.UUID] | None, date_from: date, date_to: date
) -> None:
    """All active employees of these plants (None = every plant), e.g. after a holiday, a weekly
    off or shift rule change, or the day-window setting."""
    statement = select(Employee.id)
    if plant_ids is not None:
        statement = statement.where(Employee.plant_id.in_(list(plant_ids)))
    mark_days_stale(session, session.scalars(statement), date_from, date_to)


def plant_has_attendance_days(session: Session, plant_id: uuid.UUID) -> bool:
    """Whether the plant already has computed days (for the attendance start date rule)."""
    return (
        session.scalar(
            select(AttendanceDay.id)
            .where(AttendanceDay.plant_id == plant_id, AttendanceDay.status != "not_employed")
            .limit(1)
        )
        is not None
    )


# --- Recomputing --------------------------------------------------------------------------------


def recompute_days(session: Session, keys: Iterable[DayKey], now: datetime) -> int:
    """Compute and store these days (the caller commits). Returns how many were stored."""
    by_employee: dict[uuid.UUID, set[date]] = defaultdict(set)
    for employee_id, day in keys:
        by_employee[employee_id].add(day)
    if not by_employee:
        return 0
    all_days = [day for days in by_employee.values() for day in days]
    loader = _Loader.load(session, list(by_employee), min(all_days), max(all_days), now)
    stored = 0
    for employee_id, days in by_employee.items():
        for day in sorted(days):
            _store(session, employee_id, day, loader.result_for(employee_id, day), loader, now)
            stored += 1
    return stored


def recompute_stale(session: Session, now: datetime, limit: int = CATCH_UP_BATCH) -> int:
    """One batch of stale or old-version days, newest first (the catch-up job and the background
    task after a change). Commits. Returns how many were recomputed."""
    rows = session.execute(
        select(AttendanceDay.employee_id, AttendanceDay.attendance_date)
        .where(or_(AttendanceDay.stale, AttendanceDay.calc_version != ATTENDANCE_CALC_VERSION))
        .order_by(AttendanceDay.attendance_date.desc())
        .limit(limit)
    ).all()
    stored = recompute_days(session, [(row[0], row[1]) for row in rows], now)
    session.commit()
    return stored


def ensure_fresh(
    session: Session,
    employee_ids: list[uuid.UUID],
    date_from: date,
    date_to: date,
    now: datetime,
) -> None:
    """Before a read (rule 14 d): create missing days and recompute stale or old ones. Commits
    only when it changed something."""
    missing = _create_missing_rows(session, employee_ids, date_from, date_to, now)
    keys = session.execute(
        select(AttendanceDay.employee_id, AttendanceDay.attendance_date).where(
            AttendanceDay.employee_id.in_(employee_ids),
            AttendanceDay.attendance_date.between(date_from, date_to),
            or_(
                AttendanceDay.stale,
                AttendanceDay.calc_version != ATTENDANCE_CALC_VERSION,
                AttendanceDay.status == "open",
            ),
        )
    ).all()
    if keys or missing:
        recompute_days(session, [(row[0], row[1]) for row in keys], now)
        session.commit()


def close_recent_days(session: Session, now: datetime) -> int:
    """The nightly close (00:05 IST): every active employee gets a stored day for each of the
    last days, and those days are recomputed. Safe to repeat. Commits."""
    today = to_ist(now).date()
    employee_ids = list(session.scalars(select(Employee.id).where(Employee.status == "active")))
    stored = 0
    for start in range(0, len(employee_ids), CATCH_UP_BATCH):
        batch = employee_ids[start : start + CATCH_UP_BATCH]
        mark_days_stale(session, batch, today - timedelta(days=NIGHTLY_LOOK_BACK_DAYS), today)
        session.flush()
        keys = session.execute(
            select(AttendanceDay.employee_id, AttendanceDay.attendance_date).where(
                AttendanceDay.employee_id.in_(batch), AttendanceDay.stale
            )
        ).all()
        stored += recompute_days(session, [(row[0], row[1]) for row in keys], now)
        session.commit()
    return stored


def _create_missing_rows(
    session: Session,
    employee_ids: list[uuid.UUID],
    date_from: date,
    date_to: date,
    now: datetime,
) -> bool:
    today = to_ist(now).date()
    date_to = min(date_to, today)
    if not employee_ids or date_to < date_from:
        return False
    existing = session.scalar(
        select(func.count())
        .select_from(AttendanceDay)
        .where(
            AttendanceDay.employee_id.in_(employee_ids),
            AttendanceDay.attendance_date.between(date_from, date_to),
        )
    )
    expected = session.scalar(
        text(
            """
            SELECT count(*) FROM employees e
            JOIN plants p ON p.id = e.plant_id
            CROSS JOIN generate_series(CAST(:date_from AS date), CAST(:date_to AS date),
                                       interval '1 day') AS d
            WHERE e.id = ANY(:ids) AND d::date >= e.joined_on
              AND (e.left_on IS NULL OR d::date <= e.left_on)
              AND d::date >= p.attendance_start_date
            """
        ),
        {"ids": employee_ids, "date_from": date_from, "date_to": date_to},
    )
    if (existing or 0) >= (expected or 0):
        return False
    mark_days_stale(session, employee_ids, date_from, date_to)
    session.flush()
    return True


# --- Loading the inputs -------------------------------------------------------------------------


@dataclass
class _Correction:
    row: Regularisation
    decided_at: datetime


class _Loader:
    """The inputs of many days of many employees, read in a few queries."""

    def __init__(self) -> None:
        self.calendar: AttendanceCalendar
        self.settings: dict[str, int] = {}
        self.events: dict[uuid.UUID, list[DayEvent]] = defaultdict(list)
        self.punch_ids: dict[int, uuid.UUID] = {}
        self.corrections: dict[DayKey, list[_Correction]] = defaultdict(list)
        self.leave: dict[uuid.UUID, list[LeaveRecord]] = defaultdict(list)
        self.now: datetime

    @classmethod
    def load(
        cls,
        session: Session,
        employee_ids: list[uuid.UUID],
        date_from: date,
        date_to: date,
        now: datetime,
    ) -> _Loader:
        loader = cls()
        loader.now = now
        for key in (
            "attendance_window_before_hours",
            "open_in_max_hours",
            "punch_cooldown_minutes",
        ):
            loader.settings[key] = get_int_setting(session, key)
        loader.calendar = AttendanceCalendar.load(
            session,
            employee_ids,
            date_from - timedelta(days=1),
            date_to + timedelta(days=1),
            window_before_hours=loader.settings["attendance_window_before_hours"],
        )
        loader._load_punches(session, employee_ids, date_from, date_to)
        loader._load_corrections(session, employee_ids, date_from, date_to)
        for leave in session.scalars(
            select(LeaveRecord).where(
                LeaveRecord.employee_id.in_(employee_ids),
                LeaveRecord.cancelled_at.is_(None),
                LeaveRecord.from_date <= date_to,
                LeaveRecord.to_date >= date_from,
            )
        ):
            loader.leave[leave.employee_id].append(leave)
        return loader

    def _load_punches(
        self, session: Session, employee_ids: list[uuid.UUID], date_from: date, date_to: date
    ) -> None:
        # Two days on each side: windows start up to a day early and the carry-over looks ahead.
        start = datetime.combine(date_from - timedelta(days=2), datetime.min.time(), tzinfo=IST)
        end = datetime.combine(date_to + timedelta(days=3), datetime.min.time(), tzinfo=IST)
        counted = counted_for_employees(session, employee_ids, start, end)
        reviews = latest_reviews(session, [item.punch.id for item in counted])
        for item in counted:
            unchecked = (
                item.punch.decision == PunchDecision.FLAGGED.value and item.punch.id not in reviews
            )
            event = DayEvent(
                time=item.punch_time,
                direction=item.direction,  # type: ignore[arg-type]
                unchecked_flag=unchecked,
            )
            self.events[item.employee_id].append(event)
            self.punch_ids[id(event)] = item.punch.id

    def _load_corrections(
        self, session: Session, employee_ids: list[uuid.UUID], date_from: date, date_to: date
    ) -> None:
        """Approved corrections that are not reversed, for the days and one day around them."""
        reverse = aliased(Regularisation, name="reversal")
        reversal_decision = aliased(RegularisationDecision, name="reversal_decision")
        reversed_already = exists().where(
            reverse.reverses_id == Regularisation.id,
            reversal_decision.regularisation_id == reverse.id,
            reversal_decision.action == DecisionAction.APPROVED.value,
        )
        rows = session.execute(
            select(Regularisation, RegularisationDecision.decided_at)
            .join(
                RegularisationDecision,
                and_(
                    RegularisationDecision.regularisation_id == Regularisation.id,
                    RegularisationDecision.action == DecisionAction.APPROVED.value,
                ),
            )
            .where(
                Regularisation.employee_id.in_(employee_ids),
                Regularisation.attendance_date.between(
                    date_from - timedelta(days=1), date_to + timedelta(days=1)
                ),
                Regularisation.kind != CorrectionKind.REVERSE.value,
                ~reversed_already,
            )
            .order_by(RegularisationDecision.decided_at)
        ).all()
        for correction, decided_at in rows:
            key = (correction.employee_id, correction.attendance_date)
            self.corrections[key].append(_Correction(correction, decided_at))

    # --- One day ----------------------------------------------------------------------------

    def raw_events(self, employee_id: uuid.UUID, window: DayWindow) -> list[DayEvent]:
        """Rule 6 steps 1–3: counted punches in the window, minus ignored ones, plus added times."""
        corrections = self.corrections.get((employee_id, window.day), [])
        ignored = {
            item.row.punch_id
            for item in corrections
            if item.row.kind == CorrectionKind.IGNORE_PUNCH.value
        }
        events = [
            event
            for event in self.events.get(employee_id, [])
            if window.start <= event.time < window.end
            and self.punch_ids.get(id(event)) not in ignored
        ]
        for item in corrections:
            row = item.row
            if row.in_time is not None and row.kind in _ADDING_KINDS:
                events.append(DayEvent(time=row.in_time, direction="in", from_correction=True))
            if row.out_time is not None and row.kind in _ADDING_KINDS:
                events.append(DayEvent(time=row.out_time, direction="out", from_correction=True))
        return sorted(events, key=lambda event: (event.time, event.direction != "in"))

    def carried_over(
        self, employee_id: uuid.UUID, day: date, events: list[DayEvent]
    ) -> DayEvent | None:
        """Rule 6 step 4: the next window's first event, when it is an OUT soon after this day's
        open IN, belongs to this day."""
        if not events or events[-1].direction != "in":
            return None
        next_window = self.calendar.window(employee_id, day + timedelta(days=1))
        if next_window is None:
            return None
        following = self.raw_events(employee_id, next_window)
        if not following or following[0].direction != "out":
            return None
        limit = timedelta(hours=self.settings["open_in_max_hours"])
        return following[0] if following[0].time - events[-1].time < limit else None

    def result_for(self, employee_id: uuid.UUID, day: date) -> DayResult:
        return compute_day(self.inputs_for(employee_id, day), self.now)

    def inputs_for(self, employee_id: uuid.UUID, day: date) -> DayInputs:
        calendar = self.calendar
        facts = calendar.employees.get(employee_id)
        window = calendar.window(employee_id, day)
        employed = calendar.employed_on(employee_id, day) and window is not None
        plant_id = calendar.plant_on(employee_id, day)
        day_kind, holiday = calendar.day_kind(plant_id, day) if plant_id else ("working", None)
        if not employed or window is None or facts is None:
            return DayInputs(
                day=day,
                employed=False,
                employee_type=facts.employee_type if facts else "permanent",  # type: ignore[arg-type]
                day_kind=day_kind,
                rules=None,
                window_start=self.now,
                window_end=self.now,
            )
        events = self.raw_events(employee_id, window)
        previous_window = calendar.window(employee_id, day - timedelta(days=1))
        if previous_window is not None and events:
            given_back = self.carried_over(
                employee_id, previous_window.day, self.raw_events(employee_id, previous_window)
            )
            if given_back is not None:
                events = [event for event in events if event != given_back]
        carried = self.carried_over(employee_id, day, events)
        if carried is not None:
            events.append(carried)
        corrections = self.corrections.get((employee_id, day), [])
        overrides = [
            item.row.status_value
            for item in corrections
            if item.row.kind == CorrectionKind.SET_STATUS.value
        ]
        leave = next(
            (row for row in self.leave.get(employee_id, []) if row.from_date <= day <= row.to_date),
            None,
        )
        return DayInputs(
            day=day,
            employed=True,
            employee_type=facts.employee_type,  # type: ignore[arg-type]
            day_kind=day_kind,
            rules=window.shift.rules,
            window_start=window.start,
            window_end=window.end,
            events=tuple(events),
            leave=LeaveInfo(leave.id, leave.is_paid) if leave else None,
            holiday=holiday,
            status_override=overrides[-1] if overrides else None,  # type: ignore[arg-type]
            corrected=bool(corrections),
            open_in_max_hours=self.settings["open_in_max_hours"],
            cooldown_minutes=self.settings["punch_cooldown_minutes"],
            short_window=window.short,
        )


_ADDING_KINDS = {CorrectionKind.ADD_PUNCH.value, CorrectionKind.ADD_IN_OUT.value}


def _store(
    session: Session,
    employee_id: uuid.UUID,
    day: date,
    result: DayResult,
    loader: _Loader,
    now: datetime,
) -> None:
    calendar = loader.calendar
    window = calendar.window(employee_id, day)
    facts = calendar.employees.get(employee_id)
    plant_id = calendar.plant_on(employee_id, day) or session.scalar(
        select(Employee.plant_id).where(Employee.id == employee_id)
    )
    inputs = loader.inputs_for(employee_id, day)
    values = {
        "plant_id": plant_id,
        "shift_id": window.shift.shift_id if window else None,
        "shift_rule_version_id": window.shift.rule_version_id if window else None,
        "employee_type": facts.employee_type if facts else "permanent",
        "day_kind": result.day_kind,
        "status": result.status,
        "leave_record_id": inputs.leave.leave_id if inputs.leave else None,
        "holiday_id": inputs.holiday.holiday_id if inputs.holiday else None,
        "first_in": result.first_in,
        "last_out": result.last_out,
        "extra_punch_count": result.extra_punch_count,
        "worked_min": result.worked_min,
        "payable_min": result.payable_min,
        "status_min": result.status_min,
        "shift_length_min": result.shift_length_min,
        "late_min": result.late_min,
        "early_exit_min": result.early_exit_min,
        "overtime_min": result.overtime_min,
        "exceptions": result.exceptions,
        "is_corrected": result.is_corrected,
        "uses_unchecked_flag": result.uses_unchecked_flag,
        "calc_version": ATTENDANCE_CALC_VERSION,
        "stale": False,
        "computed_at": now,
    }
    statement = insert(AttendanceDay).values(
        id=uuid.uuid4(), employee_id=employee_id, attendance_date=day, **values
    )
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[AttendanceDay.employee_id, AttendanceDay.attendance_date],
            set_=values,
        )
    )


def mark_punch_stale(
    session: Session, punch: Punch, also_for: Iterable[uuid.UUID | None] = ()
) -> None:
    """Called by every path that stores a punch or a review, before its commit (plan decision 5).

    A rejected or needs-code punch does not count, so it changes no day, unless a review is
    involved (`also_for` then names the employees of the old and new review).
    """
    employees = list(also_for)
    if punch.decision in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value) or employees:
        employees.append(punch.employee_id)
        moment = punch.offline_punch_time or punch.server_received_at
        mark_punch_days_stale(session, employees, moment)


# --- For one day: validation and preview of a correction ----------------------------------------


def load_one_day(session: Session, employee_id: uuid.UUID, day: date, now: datetime) -> _Loader:
    """The inputs of one employee's day (and the days around it), for a correction check."""
    return _Loader.load(session, [employee_id], day, day, now)


def add_hypothetical_correction(loader: _Loader, correction: Regularisation, now: datetime) -> None:
    """Treat a not yet approved correction as approved, in memory only (the correction preview)."""
    key = (correction.employee_id, correction.attendance_date)
    loader.corrections[key].append(_Correction(correction, now))


def mark_days_stale_counted(
    session: Session, employee_ids: list[uuid.UUID], date_from: date, date_to: date
) -> int:
    """Like `mark_days_stale`, and says how many stored days are now stale (the recompute tool)."""
    mark_days_stale(session, employee_ids, date_from, date_to)
    session.flush()
    return (
        session.scalar(
            select(func.count())
            .select_from(AttendanceDay)
            .where(
                AttendanceDay.employee_id.in_(employee_ids),
                AttendanceDay.attendance_date.between(date_from, date_to),
                AttendanceDay.stale.is_(True),
            )
        )
        or 0
    )
