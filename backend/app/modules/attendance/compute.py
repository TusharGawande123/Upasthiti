"""The attendance calculation for ONE employee and ONE day: a pure function, no database
(M5 spec §7 rules 5–12 and 14; decision 0034).

The loader (service.py) gathers the inputs: the shift rules in force on the date, the day window,
the counted punches inside it (already without ignored punches, with added correction times and a
carried-over OUT), leave, holiday, weekly off and the latest `set_status` correction. This module
turns them into the stored day. Tests call it directly with fixed dates (golden table, Hypothesis).

Words used below (rule 9): S = shift start, E = shift end (next day for a night shift), g = grace,
L = shift length (the full day), H = half-day limit, m = smallest overtime.

Grace is at the START only (decision 0036 line 8, Anuradha 2026-10-31, to confirm with Tushar and
the client): IN until S+g is on time; an OUT before E is an early exit, and there is no grace
before the shift end. The time after E up to E+30 min is just a normal OUT: nothing is counted
there (overtime starts at E and counts only from m).

Minutes: every punch time is cut down to its whole minute before a duration is measured, so
"OUT 16:29:59" leaves 31 minutes early and "IN 09:30:01" is 30 minutes late. Whether a time is
inside grace is decided to the second (IN 09:30:00 is on time, 09:30:01 is late). Decision 0036.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal

from app.core.time import IST
from app.modules.org.shift_rules_service import ShiftRules

# Bump when the rules below change: the catch-up job then recomputes every stored day.
ATTENDANCE_CALC_VERSION = 1

Direction = Literal["in", "out"]
DayKind = Literal["working", "weekly_off", "holiday"]
EmployeeType = Literal["permanent", "temporary"]
StatusOverride = Literal["present", "half_day", "absent"]


@dataclass(frozen=True)
class DayEvent:
    """One counted IN or OUT of the day: a punch, or a time added by an approved correction."""

    time: datetime  # timezone-aware
    direction: Direction
    from_correction: bool = False
    unchecked_flag: bool = False  # a flagged punch the Super Admin has not checked yet


@dataclass(frozen=True)
class LeaveInfo:
    leave_id: object
    is_paid: bool


@dataclass(frozen=True)
class HolidayInfo:
    holiday_id: object
    name: str
    is_paid: bool


@dataclass(frozen=True)
class DayInputs:
    day: date
    employed: bool  # joined, not left, and on or after the plant's attendance start date
    employee_type: EmployeeType
    day_kind: DayKind
    rules: ShiftRules | None  # None only when the person is not employed that day
    window_start: datetime
    window_end: datetime  # not included
    events: tuple[DayEvent, ...] = ()
    leave: LeaveInfo | None = None
    holiday: HolidayInfo | None = None
    status_override: StatusOverride | None = None  # the latest approved `set_status`
    corrected: bool = False  # an approved correction touched the day (added, ignored, status)
    open_in_max_hours: int = 20
    cooldown_minutes: int = 2
    short_window: bool = False  # the window ends less than 1 hour after the shift end


@dataclass
class DayResult:
    status: str
    day_kind: DayKind
    open_state: str | None = None
    first_in: datetime | None = None
    last_out: datetime | None = None
    extra_punch_count: int = 0
    worked_min: int = 0
    payable_min: int = 0
    status_min: int | None = None
    shift_length_min: int | None = None
    late_min: int = 0
    early_exit_min: int = 0
    overtime_min: int = 0
    exceptions: list[str] = field(default_factory=list)
    is_corrected: bool = False
    uses_unchecked_flag: bool = False


def compute_day(inputs: DayInputs, now: datetime) -> DayResult:
    """The day of one employee (rules 3–12). `now` decides whether the day is still open."""
    if not inputs.employed or inputs.rules is None:
        return DayResult(status="not_employed", day_kind=inputs.day_kind)

    rules = inputs.rules
    events = sorted(inputs.events, key=lambda event: (event.time, event.direction != "in"))
    result = DayResult(
        status="",
        day_kind=inputs.day_kind,
        shift_length_min=rules.length_min,
        is_corrected=inputs.corrected,
        uses_unchecked_flag=any(event.unchecked_flag for event in events),
    )
    first_in, last_out = _first_in_and_last_out(events)
    result.first_in = first_in.time if first_in else None
    result.last_out = last_out.time if last_out else None
    # With only OUTs (IN missing) the latest OUT is the day's one event, not an extra punch.
    main_events = (first_in, last_out) if first_in else (events[-1] if events else None,)
    used = {id(event) for event in main_events if event is not None}
    result.extra_punch_count = sum(1 for event in events if id(event) not in used)
    _add_notes(result, inputs, events)

    if not events:
        result.status = _status_without_events(inputs, now)
        if result.status == "open":
            result.open_state = "not_arrived"
        return result

    latest = events[-1]
    if _is_open(inputs, latest, now):
        # Shown live ("inside", "left") with what is known so far; never Absent or Incomplete yet.
        if first_in is not None and last_out is not None:
            _measure_complete_day(result, inputs, rules, first_in.time, last_out.time)
        elif first_in is not None:
            _measure_late(result, inputs, rules, first_in.time)
        result.status = "open"
        result.status_min = None
        result.open_state = "inside" if latest.direction == "in" else "left"
        return result

    if first_in is None or last_out is None:
        # The latest event is an IN (OUT missing) or there are only OUTs (IN missing): the day
        # waits for a correction. Worked, payable and overtime stay 0 (rule 8, lead decision 3).
        result.status = "incomplete"
        result.exceptions.append("OUT_WITHOUT_IN" if first_in is None else "OUT_MISSING")
        if first_in is not None:
            _measure_late(result, inputs, rules, first_in.time)
    else:
        _measure_complete_day(result, inputs, rules, first_in.time, last_out.time)

    _apply_status_override(result, inputs)
    return result


# --- Steps --------------------------------------------------------------------------------------


def _first_in_and_last_out(
    events: list[DayEvent],
) -> tuple[DayEvent | None, DayEvent | None]:
    """First IN = the earliest IN; last OUT = the latest event, when it is an OUT after the first IN
    (rule 7: one IN and one OUT per shift, no summing of pairs)."""
    first_in = next((event for event in events if event.direction == "in"), None)
    latest = events[-1] if events else None
    if latest is None or latest.direction != "out" or first_in is None:
        return first_in, None
    if latest.time <= first_in.time:
        return first_in, None
    return first_in, latest


def _status_without_events(inputs: DayInputs, now: datetime) -> str:
    if inputs.day_kind == "holiday":
        return "holiday"
    if inputs.day_kind == "weekly_off":
        return "weekly_off"
    if inputs.leave is not None:
        return "leave"
    if now < inputs.window_end:
        return "open"
    # A `set_status` decision (e.g. official duty outside the plant) replaces "absent" (rule 12).
    if inputs.employee_type == "permanent" and inputs.status_override is not None:
        return inputs.status_override
    return "absent"


def _is_open(inputs: DayInputs, latest: DayEvent, now: datetime) -> bool:
    """Open while now is before the window end, or while an open IN may still get its OUT
    carried over from the next window (rule 8)."""
    if now < inputs.window_end:
        return True
    carry_over_until = latest.time + timedelta(hours=inputs.open_in_max_hours)
    return latest.direction == "in" and now < carry_over_until


def _measure_late(result: DayResult, inputs: DayInputs, rules: ShiftRules, first_in: datetime):
    if inputs.employee_type != "permanent" or inputs.day_kind != "working":
        return
    start, _end = shift_moments(inputs.day, rules)
    if first_in > start + timedelta(minutes=rules.grace_min):
        result.late_min = _minutes_between(start, first_in)


def _measure_complete_day(
    result: DayResult,
    inputs: DayInputs,
    rules: ShiftRules,
    first_in: datetime,
    last_out: datetime,
) -> None:
    start, end = shift_moments(inputs.day, rules)
    result.worked_min = _minutes_between(first_in, last_out)
    result.overtime_min = _overtime(rules, end, first_in, last_out)
    result.payable_min = _payable(start, end, first_in, last_out, result.overtime_min > 0)

    if inputs.day_kind != "working":
        # Worked on a weekly off or holiday: hours and the normal overtime rule only (rule 11).
        result.status = "present"
        return
    if inputs.employee_type == "temporary":
        result.status = "present"  # hours only: no grace, late, early exit or half day (rule 10)
        return

    grace = timedelta(minutes=rules.grace_min)
    if first_in > start + grace:
        result.late_min = _minutes_between(start, first_in)
    if last_out < end:
        result.early_exit_min = _minutes_between(last_out, end)
    # Worked for status (rule 9): an IN inside grace counts as the shift start; arriving early or
    # staying late never adds to it. The end counts only when the person stays until E.
    status_from = start if first_in <= start + grace else first_in
    status_to = end if last_out >= end else last_out
    status_min = max(0, min(_minutes_between(status_from, status_to), rules.length_min))
    result.status_min = status_min
    if status_min == rules.length_min:
        result.status = "present"
    elif status_min >= rules.half_day_min:
        result.status = "half_day"
    else:
        result.status = "short_hours"


def _overtime(rules: ShiftRules, end: datetime, first_in: datetime, last_out: datetime) -> int:
    """Overtime starts at the shift end, without grace, and counts only from m minutes; once
    reached, the whole time after the shift end counts (rule 11)."""
    if last_out <= end:
        return 0
    after_end = _minutes_between(max(end, first_in), last_out)
    return after_end if after_end >= rules.overtime_min_minutes else 0


def _payable(
    start: datetime, end: datetime, first_in: datetime, last_out: datetime, has_overtime: bool
) -> int:
    """Paid time (rule 10): from the shift start or the later IN, to the shift end, or to the last
    OUT when overtime counts. Early arrival and short overtime are not paid."""
    paid_from = max(first_in, start)
    paid_to = last_out if has_overtime else min(last_out, end)
    return max(0, _minutes_between(paid_from, paid_to))


def _apply_status_override(result: DayResult, inputs: DayInputs) -> None:
    """The Super Admin's `set_status` decides the day last; minutes stay as they are (rule 12)."""
    permanent_working_day = inputs.employee_type == "permanent" and inputs.day_kind == "working"
    if permanent_working_day and inputs.status_override is not None:
        result.status = inputs.status_override


def _add_notes(result: DayResult, inputs: DayInputs, events: list[DayEvent]) -> None:
    if result.extra_punch_count:
        result.exceptions.append("EXTRA_PUNCHES")
    if events and inputs.leave is not None and inputs.day_kind == "working":
        result.exceptions.append("PUNCHES_ON_LEAVE")
    if inputs.short_window:
        result.exceptions.append("SHIFT_CHANGE_SHORT_DAY")
    if _possible_double_entry(events, inputs.cooldown_minutes):
        result.exceptions.append("POSSIBLE_DOUBLE_ENTRY")


def _possible_double_entry(events: list[DayEvent], cooldown_minutes: int) -> bool:
    """A punch and a correction time closer than the cool-down: probably the same moment twice
    (rule 12 "never double"). The hours still use first IN and last OUT, so nothing doubles."""
    window = timedelta(minutes=cooldown_minutes)
    punches = [event.time for event in events if not event.from_correction]
    added = [event.time for event in events if event.from_correction]
    return any(abs(punch - extra) < window for punch in punches for extra in added)


# --- Helpers ------------------------------------------------------------------------------------


def shift_moments(day: date, rules: ShiftRules) -> tuple[datetime, datetime]:
    """S and E of the shift starting on `day`, in IST (E is on the next day for a night shift)."""
    start = datetime.combine(day, rules.start_time, tzinfo=IST)
    end_day = day + timedelta(days=1) if rules.crosses_midnight else day
    return start, datetime.combine(end_day, rules.end_time, tzinfo=IST)


def _minutes_between(earlier: datetime, later: datetime) -> int:
    """Whole minutes between two moments, both cut down to the minute first (decision 0036)."""
    earlier_minute = earlier.replace(second=0, microsecond=0)
    later_minute = later.replace(second=0, microsecond=0)
    return int((later_minute - earlier_minute).total_seconds() // 60)
