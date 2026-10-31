"""One employee's month and one employee's day with its timeline (M5 spec §5.1, §4.6).

The timeline shows everything that made the day: the punches (with their role in the hours), the
reviews of M4, the corrections of M5, leave, holiday and weekly off. Reasons of reviews are for
the Super Admin only (decision 0028 item 4).
"""

import uuid
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import IST, to_ist, utc_now
from app.modules.attendance import read_service, service
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.schemas import Day
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.leave.models import LeaveRecord
from app.modules.org.models import ShiftRuleVersion
from app.modules.punches.counting import counted_between, latest_reviews
from app.modules.punches.models import Punch
from app.modules.regularisations import service as correction_service
from app.modules.regularisations.models import CorrectionKind, Regularisation
from app.modules.users.models import User


def employee_for_reading(
    session: Session, current_user: CurrentUser, employee_id: uuid.UUID
) -> Employee:
    """The employee, if the user may read attendance of their plant (Plant Head: own plant, or a
    plant where the person worked on a day the screen shows; days are filtered by plant)."""
    employee = session.get(Employee, employee_id)
    if employee is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if allowed is None:
        return employee
    had_days_there = session.scalar(
        select(AttendanceDay.id)
        .where(AttendanceDay.employee_id == employee_id, AttendanceDay.plant_id.in_(allowed))
        .limit(1)
    )
    if employee.plant_id not in allowed and had_days_there is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return employee


def month_of_employee(
    session: Session, current_user: CurrentUser, employee: Employee, month: str
) -> dict[str, Any]:
    first, last = read_service.month_bounds(month)
    last = min(last, to_ist(utc_now()).date())
    if last >= first:
        service.ensure_fresh(session, [employee.id], first, last, utc_now())
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    statement = select(AttendanceDay).where(
        AttendanceDay.employee_id == employee.id,
        AttendanceDay.attendance_date.between(first, read_service.month_bounds(month)[1]),
        AttendanceDay.status != "not_employed",
    )
    if allowed is not None:
        statement = statement.where(AttendanceDay.plant_id.in_(allowed))
    rows = list(session.scalars(statement.order_by(AttendanceDay.attendance_date)))
    leave = list(
        session.scalars(
            select(LeaveRecord)
            .where(
                LeaveRecord.employee_id == employee.id,
                LeaveRecord.from_date <= read_service.month_bounds(month)[1],
                LeaveRecord.to_date >= first,
            )
            .order_by(LeaveRecord.from_date)
        )
    )
    corrections = list(
        session.scalars(
            select(Regularisation)
            .where(
                Regularisation.employee_id == employee.id,
                Regularisation.attendance_date.between(first, read_service.month_bounds(month)[1]),
            )
            .order_by(Regularisation.requested_at)
        )
    )
    show_reasons = current_user.access(Capability.MANAGE_LEAVE) is Access.ALL
    return {
        "employee": read_service.person_summaries(session, [employee.id])[employee.id],
        "days": read_service.present_days(session, rows),
        "totals": read_service.totals_of(rows, read_service.leave_paid_map(session, rows)),
        "leave": [
            {
                "id": item.id,
                "from_date": item.from_date,
                "to_date": item.to_date,
                "is_paid": item.is_paid,
                "reason": item.reason if show_reasons else None,
                "cancelled": item.cancelled_at is not None,
            }
            for item in leave
        ],
        "corrections": correction_service.present(session, corrections),
    }


def day_of_employee(
    session: Session, current_user: CurrentUser, employee: Employee, day: date
) -> dict[str, Any]:
    read_service.check_day_not_future(day)
    now = utc_now()
    service.ensure_fresh(session, [employee.id], day, day, now)
    row = session.scalars(
        select(AttendanceDay).where(
            AttendanceDay.employee_id == employee.id, AttendanceDay.attendance_date == day
        )
    ).first()
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if row is None or (allowed is not None and row.plant_id not in allowed):
        raise ApiError("NOT_FOUND", "Not found.", 404)
    loader = service.load_one_day(session, employee.id, day, now)
    window = loader.calendar.window(employee.id, day)
    shown: Day = read_service.present_days(session, [row])[0]
    rules = _shift_rules(session, window) if window else None
    can_correct = current_user.access(Capability.DECIDE_CORRECTIONS) is Access.ALL
    can_request = current_user.access(Capability.REQUEST_CORRECTIONS) is not None
    kinds = ["add_punch", "add_in_out", "ignore_punch"]
    if employee.type == "permanent":
        kinds.append("set_status")
    return {
        "day": shown,
        "explanation": [],  # F-61 "Explain this day" is built with the day screen (slice 7)
        "shift_swap": None,  # F-58 comes in slice 5
        "shift_rules": rules,
        "window": {"start": window.start, "end": window.end} if window else None,
        "timeline": _timeline(session, current_user, employee, day, row, window, loader),
        "allowed_correction_kinds": kinds if row.status != "not_employed" else [],
        "can_request": can_request and not can_correct,
        "can_correct": can_correct,
    }


def _shift_rules(session: Session, window: Any) -> dict[str, Any]:
    version = session.get(ShiftRuleVersion, window.shift.rule_version_id)
    rules = window.shift.rules
    return {
        "shift_id": window.shift.shift_id,
        "start_time": rules.start_time,
        "end_time": rules.end_time,
        "crosses_midnight": rules.crosses_midnight,
        "shift_length_min": rules.length_min,
        "grace_min": rules.grace_min,
        "half_day_min": rules.half_day_min,
        "overtime_min_minutes": rules.overtime_min_minutes,
        "effective_from": version.effective_from if version else None,
    }


def _timeline(
    session: Session,
    current_user: CurrentUser,
    employee: Employee,
    day: date,
    row: AttendanceDay,
    window: Any,
    loader: service._Loader,
) -> list[dict[str, Any]]:
    items: list[tuple[datetime, dict[str, Any]]] = []
    if window is not None:
        items += _punch_and_review_items(session, current_user, employee, row, window, loader)
    corrections = list(
        session.scalars(
            select(Regularisation)
            .where(Regularisation.employee_id == employee.id, Regularisation.attendance_date == day)
            .order_by(Regularisation.requested_at)
        )
    )
    for answer in correction_service.present(session, corrections):
        items.append(
            (
                answer.requested_at,
                {
                    "kind": "correction",
                    "correction_id": answer.id,
                    "correction_kind": answer.kind,
                    "direction": answer.direction,
                    "in_time": answer.in_time,
                    "out_time": answer.out_time,
                    "status_value": answer.status_value,
                    "punch_id": answer.punch_id,
                    "state": answer.state,
                    "reason": answer.reason,
                    "requested_by": answer.requested_by.name,
                    "requested_at": answer.requested_at,
                    "decided_by": answer.decision.decided_by.name if answer.decision else None,
                    "decided_at": answer.decision.decided_at if answer.decision else None,
                    "decision_reason": answer.decision.reason if answer.decision else None,
                },
            )
        )
    start_of_day = window.start if window else datetime.combine(day, time.min, tzinfo=IST)
    if row.leave_record_id:
        leave = session.get(LeaveRecord, row.leave_record_id)
        shows_reason = current_user.access(Capability.MANAGE_LEAVE) is Access.ALL
        items.append(
            (
                start_of_day,
                {
                    "kind": "leave",
                    "leave_id": row.leave_record_id,
                    "is_paid": bool(leave and leave.is_paid),
                    "reason": leave.reason if leave and shows_reason else None,
                },
            )
        )
    if row.holiday_id:
        items.append((start_of_day, {"kind": "holiday", "holiday_id": row.holiday_id}))
    if row.day_kind == "weekly_off":
        items.append((start_of_day, {"kind": "weekly_off"}))
    return [item for _, item in sorted(items, key=lambda pair: pair[0])]


def _punch_and_review_items(
    session: Session,
    current_user: CurrentUser,
    employee: Employee,
    row: AttendanceDay,
    window: Any,
    loader: service._Loader,
) -> list[tuple[datetime, dict[str, Any]]]:
    carry_limit = window.end + timedelta(hours=loader.settings["open_in_max_hours"])
    punches = list(
        session.scalars(
            select(Punch)
            .where(
                Punch.employee_id == employee.id,
                Punch.punch_time >= window.start,
                Punch.punch_time < carry_limit,
            )
            .order_by(Punch.punch_time)
        )
    )
    counted = {
        item.punch.id: item.direction
        for item in counted_between(session, employee.id, window.start, carry_limit)
    }
    ignored = {
        item.row.punch_id: item.row.id
        for item in loader.corrections.get((employee.id, row.attendance_date), [])
        if item.row.kind == CorrectionKind.IGNORE_PUNCH.value
    }
    kiosks = {
        kiosk.id: kiosk.name
        for kiosk in session.scalars(
            select(KioskDevice).where(
                KioskDevice.id.in_({p.kiosk_id for p in punches if p.kiosk_id})
            )
        )
    }
    reviews = latest_reviews(session, [punch.id for punch in punches])
    reviewers = dict(
        session.execute(
            select(User.id, User.name).where(User.id.in_({r.reviewed_by for r in reviews.values()}))
        ).all()
    )
    shows_reasons = current_user.access(Capability.REVIEW_PUNCHES) is Access.ALL
    items: list[tuple[datetime, dict[str, Any]]] = []
    for punch in punches:
        carried = punch.punch_time >= window.end
        if carried and not (row.last_out is not None and punch.punch_time == row.last_out):
            continue  # a punch of the next day's window
        role = None
        if punch.id in counted:
            if row.first_in == punch.punch_time:
                role = "first_in"
            elif row.last_out == punch.punch_time:
                role = "last_out"
            else:
                role = "extra"
        items.append(
            (
                punch.punch_time,
                {
                    "kind": "punch",
                    "punch_id": punch.id,
                    "punch_time": punch.punch_time,
                    "direction": counted.get(punch.id) or punch.direction,
                    "decision": punch.decision,
                    "counts": punch.id in counted,
                    "role": role,
                    "ignored_by_correction_id": ignored.get(punch.id),
                    "kiosk": {"id": punch.kiosk_id, "name": kiosks.get(punch.kiosk_id, "")}
                    if punch.kiosk_id
                    else None,
                    "method": punch.method,
                    "was_offline": punch.was_offline,
                    "carry_over": carried,
                },
            )
        )
        review = reviews.get(punch.id)
        if review is not None:
            items.append(
                (
                    review.reviewed_at,
                    {
                        "kind": "review",
                        "punch_id": punch.id,
                        "action": review.action,
                        "direction": review.direction,
                        "reviewed_by": {
                            "id": review.reviewed_by,
                            "name": reviewers.get(review.reviewed_by, ""),
                        },
                        "reviewed_at": review.reviewed_at,
                        "reason": review.reason if shows_reasons else None,
                    },
                )
            )
    return items
