"""Rule: one IN and one OUT per shift, so a punch after the day's OUT is refused (M5 spec §7
rule 24; decision 0034 line 14).

It runs right after the IN/OUT rule (`check_in_out`), which has already decided the direction:
  - the direction is IN,
  - the person's latest counted punch before this one is an OUT,
  - and the counted IN that this OUT closed lies in the SAME attendance day as this punch
      -> SHIFT_ALREADY_CLOSED.

Why "the IN that this OUT closed": a long shift can carry its OUT over to the next morning (05:30
closing yesterday's IN). That OUT lies in today's window, but it closed yesterday's day, so it must
not block today's IN.

The attendance day comes from the same helper the attendance calculation uses
(`AttendanceCalendar`), so the gate and the register can never disagree about where a day ends.
The rule only looks at punches BEFORE its own time, so an offline punch made before a later-stored
OUT keeps the M4 behaviour (OUT with SYNC_ORDER_CONFLICT). A person without a shift is not judged.
"""

from app.antiproxy.context import PunchContext, RuleResult
from app.core.time import to_ist
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.punches.counting import last_counted_before
from app.modules.punches.models import Direction


def check_shift_closed(context: PunchContext) -> RuleResult:
    employee = context.employee
    if employee is None:
        raise RuntimeError("the card or face rule must run before the shift-closed rule")
    if context.direction != Direction.IN:
        return RuleResult.passed()

    session = context.session
    last = last_counted_before(session, employee.id, context.now)
    if last is None or last.direction != Direction.OUT.value:
        return RuleResult.passed()
    opened = last_counted_before(session, employee.id, last.punch_time)
    if opened is None or opened.direction != Direction.IN.value:
        return RuleResult.passed()  # an OUT without an IN closes no day

    calendar = AttendanceCalendar.load(
        session,
        [employee.id],
        to_ist(opened.punch_time).date(),
        to_ist(context.now).date(),
        window_before_hours=context.limits.attendance_window_before_hours,
    )
    this_day = calendar.day_containing(employee.id, context.now)
    closed_day = calendar.day_containing(employee.id, opened.punch_time)
    if this_day is not None and closed_day is not None and this_day.day == closed_day.day:
        context.related_punch_id = last.punch.id  # the OUT that closed the day (review hint)
        return RuleResult.rejected("SHIFT_ALREADY_CLOSED")
    return RuleResult.passed()
