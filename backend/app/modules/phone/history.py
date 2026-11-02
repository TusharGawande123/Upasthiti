"""What an employee sees of their own attendance on the phone (M4b spec §5.1, F-73).

Two small read-only answers, always about the signed-in employee only (the endpoints have no id
parameter): today's counted punches, and the last 31 days from the stored M5 attendance days.
No flag, reason or review mark is ever shown to the employee.
"""

from datetime import datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist
from app.modules.attendance import service as attendance_service
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.attendance.models import AttendanceDay
from app.modules.employees.models import Employee
from app.modules.phone.schemas import (
    AttendanceDayView,
    MyAttendanceResponse,
    TodayPunch,
    TodayPunchesResponse,
)
from app.modules.punches.counting import CountedPunch, counted_between
from app.modules.settings.service import get_int_setting

HISTORY_DAYS = 31  # the last 31 days ending today (spec §5.1)


def today_punches(session: Session, employee: Employee, now: datetime) -> TodayPunchesResponse:
    """The employee's own counted punches of today's attendance day (gate and phone), oldest
    first. "Today's attendance day" starts a few hours before the shift (M5 day window)."""
    start = _today_window_start(session, employee, now)
    return TodayPunchesResponse(
        items=[
            TodayPunch(
                time=counted.punch_time,
                direction=counted.direction,  # type: ignore[arg-type]
                channel=counted.punch.channel,  # type: ignore[arg-type]
                decision_text_key=f"phone.punch.accepted.{counted.direction}",
            )
            for counted in counted_between(session, employee.id, start, now)
        ]
    )


def _today_window_start(session: Session, employee: Employee, now: datetime) -> datetime:
    calendar = AttendanceCalendar.load(
        session,
        [employee.id],
        to_ist(now).date(),
        to_ist(now).date(),
        window_before_hours=get_int_setting(session, "attendance_window_before_hours"),
    )
    window = calendar.day_containing(employee.id, now)
    if window is not None:
        return window.start
    return datetime.combine(to_ist(now).date(), time.min, tzinfo=IST)  # no shift: midnight IST


def my_attendance(session: Session, employee: Employee, now: datetime) -> MyAttendanceResponse:
    """The last 31 days ending today (IST), from the stored attendance days, brought up to date
    first. `channels` says where the counted punches of the day were made."""
    today = to_ist(now).date()
    first_day = today - timedelta(days=HISTORY_DAYS - 1)
    attendance_service.ensure_fresh(session, [employee.id], first_day, today, now)
    rows = session.scalars(
        select(AttendanceDay)
        .where(
            AttendanceDay.employee_id == employee.id,
            AttendanceDay.attendance_date.between(first_day, today),
            AttendanceDay.status != "not_employed",
        )
        .order_by(AttendanceDay.attendance_date)
    ).all()
    starts = [row.first_in for row in rows if row.first_in is not None]
    ends = [row.last_out or now for row in rows if row.first_in is not None]
    counted = (
        counted_between(session, employee.id, min(starts), max(ends)) if starts and ends else []
    )
    return MyAttendanceResponse(
        days=[
            AttendanceDayView(
                date=row.attendance_date,
                status=row.status,
                first_in=row.first_in,
                last_out=row.last_out,
                worked_min=row.worked_min,
                channels=_channels_of(row, counted, now),  # type: ignore[arg-type]
            )
            for row in rows
        ]
    )


def _channels_of(
    row: AttendanceDay, counted: list[CountedPunch], now: datetime
) -> list[str]:  # "phone" and / or "kiosk"
    """The channels of the counted punches between the day's first IN and last OUT."""
    if row.first_in is None:
        return []
    end = row.last_out or now
    found = {item.punch.channel for item in counted if row.first_in <= item.punch_time <= end}
    return sorted(found, reverse=True)  # "phone" before "kiosk", as the spec lists them
