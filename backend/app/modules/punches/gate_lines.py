"""The small server-made lines on the gate result screen (M5 spec §4.16, §7 rule 29).

- F-37 `late_minutes`: the person's first IN of the day is later than the shift start plus the grace
  (permanent employee, working day, only when `kiosk_late_hint` is on; off by default);
- F-2 `month_days_present`: the number of IST dates in this month with a counted IN of the person,
  today included (only when `kiosk_show_month_line` is on; off by default).
The gate never computes them. Neither goes with a rejected punch, a self-test or an offline
punch, neither carries a name, and the gate does not speak or store them.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.time import IST, to_ist
from app.modules.attendance.compute import shift_moments
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.employees.models import Employee
from app.modules.punches.counting import counted_between
from app.modules.punches.models import Direction, Punch, PunchDecision
from app.modules.punches.schemas import GateLines, KioskPunchResponse
from app.modules.settings.service import get_int_setting, get_text_setting


def attach_gate_lines(session: Session, answer: KioskPunchResponse) -> KioskPunchResponse:
    """Add `gate_lines` to an accepted, online punch answer when the settings ask for them."""
    if answer.decision != "accepted" or answer.punch_id is None:
        return answer
    punch = session.get(Punch, answer.punch_id)
    if punch is None or punch.was_offline or punch.employee_id is None:
        return answer
    employee = session.get(Employee, punch.employee_id)
    if employee is None:
        return answer
    lines = GateLines(
        late_minutes=_late_minutes(session, employee, punch),
        month_days_present=_month_days(session, employee, punch),
    )
    if lines.late_minutes is not None or lines.month_days_present is not None:
        answer.gate_lines = lines
    return answer


def _late_minutes(session: Session, employee: Employee, punch: Punch) -> int | None:
    if (
        get_text_setting(session, "kiosk_late_hint") != "on"
        or punch.direction != Direction.IN.value
        or employee.type != "permanent"
        or punch.decision not in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value)
    ):
        return None
    moment = punch.punch_time
    calendar = AttendanceCalendar.load(
        session,
        [employee.id],
        to_ist(moment).date(),
        to_ist(moment).date(),
        window_before_hours=get_int_setting(session, "attendance_window_before_hours"),
    )
    window = calendar.day_containing(employee.id, moment)
    if window is None or calendar.day_kind(window.plant_id, window.day)[0] != "working":
        return None
    earlier_in = [
        item
        for item in counted_between(session, employee.id, window.start, moment)
        if item.direction == "in" and item.punch.id != punch.id
    ]
    if earlier_in:
        return None  # only the first IN of the day is late
    rules = window.shift.rules
    start, _ = shift_moments(window.day, rules)
    if moment <= start + timedelta(minutes=rules.grace_min):
        return None
    # Whole minutes from the shift start, each time cut down to its minute (decision 0036 line 6).
    late = moment.replace(second=0, microsecond=0) - start.replace(second=0, microsecond=0)
    return int(late.total_seconds() // 60)


def _month_days(session: Session, employee: Employee, punch: Punch) -> int | None:
    if get_text_setting(session, "kiosk_show_month_line") != "on":
        return None
    moment = to_ist(punch.punch_time)
    first = datetime(moment.year, moment.month, 1, tzinfo=IST)
    days = {
        to_ist(item.punch_time).date()
        for item in counted_between(session, employee.id, first, punch.punch_time)
        if item.direction == "in"
    }
    return len(days)
