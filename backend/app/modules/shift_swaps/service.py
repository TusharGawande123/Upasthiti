"""One-day shift swap: add, cancel and list (M5 spec §5.3, §7 rule 26; F-58).

The Super Admin moves one employee to another ACTIVE shift of the SAME plant for one date (today or
later), with a reason. For that date the swap replaces the shift assignment everywhere, because
the attendance calendar (`AttendanceCalendar`) is used by the day calculation, the gate rule and
the dashboard alike. One active swap per person per date. A swap can be cancelled (with a reason)
only before its day's window starts. Cancelled, never deleted; every change is audited.
"""

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.attendance.service import mark_days_stale
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.org.models import Shift
from app.modules.settings.service import get_int_setting
from app.modules.shift_swaps.models import ShiftSwap
from app.modules.shift_swaps.schemas import SwapCancellation, SwapResponse, SwapShift
from app.modules.users.models import User


def _invalid(reason: str) -> ApiError:
    return ApiError(
        "SHIFT_SWAP_INVALID", "This shift cannot be used for this day.", 422, {"reason": reason}
    )


def _calendar(session: Session, employee_id: uuid.UUID, day: date) -> AttendanceCalendar:
    return AttendanceCalendar.load(
        session,
        [employee_id],
        day,
        day,
        window_before_hours=get_int_setting(session, "attendance_window_before_hours"),
    )


def create_swap(
    session: Session,
    current_user: CurrentUser,
    employee_id: uuid.UUID,
    *,
    swap_date: date,
    shift_id: uuid.UUID,
    reason: str,
) -> ShiftSwap:
    employee = session.get(Employee, employee_id, with_for_update=True)
    if employee is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if swap_date < today_ist():
        raise _invalid("past_date")
    if employee.status != EmployeeStatus.ACTIVE.value or swap_date < employee.joined_on:
        raise _invalid("employee_not_active")
    if employee.left_on is not None and swap_date > employee.left_on:
        raise _invalid("employee_not_active")
    shift = session.get(Shift, shift_id)
    if shift is None or shift.plant_id != employee.plant_id:
        raise _invalid("other_plant")
    if not shift.is_active:
        raise _invalid("inactive_shift")
    already = session.scalar(
        select(ShiftSwap.id).where(
            ShiftSwap.employee_id == employee.id,
            ShiftSwap.swap_date == swap_date,
            ShiftSwap.cancelled_at.is_(None),
        )
    )
    if already is not None:
        raise ApiError(
            "SHIFT_SWAP_EXISTS",
            "This person already has a swap on this date.",
            409,
            {"swap_id": str(already)},
        )
    calendar = _calendar(session, employee.id, swap_date)
    assigned = calendar.shift_on(employee.id, swap_date)
    if assigned is not None and assigned.shift_id == shift.id:
        raise _invalid("same_shift")
    swap = ShiftSwap(
        employee_id=employee.id,
        swap_date=swap_date,
        shift_id=shift.id,
        reason=reason.strip(),
        created_by=current_user.id,
        created_at=utc_now(),
    )
    session.add(swap)
    session.flush()
    record_audit(
        session,
        actor=current_user.actor,
        action="shift_swap.create",
        entity_type="shift_swap",
        entity_id=swap.id,
        after={"employee_id": employee.id, "swap_date": swap_date, "shift_id": shift.id},
        reason=swap.reason,
        plant_id=employee.plant_id,
    )
    # The windows of the day before and the day itself change (rule 26).
    mark_days_stale(session, [employee.id], swap_date - timedelta(days=1), swap_date)
    session.commit()
    return swap


def cancel_swap(
    session: Session, current_user: CurrentUser, swap_id: uuid.UUID, reason: str
) -> ShiftSwap:
    swap = session.get(ShiftSwap, swap_id, with_for_update=True)
    if swap is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if not swap.is_active:
        raise ApiError("SHIFT_SWAP_NOT_ACTIVE", "This swap is already cancelled.", 409)
    window = _calendar(session, swap.employee_id, swap.swap_date).window(
        swap.employee_id, swap.swap_date
    )
    now = utc_now()
    if window is not None and now >= window.start:
        raise ApiError("SHIFT_SWAP_STARTED", "The day of this swap has already begun.", 409)
    swap.cancelled_at = now
    swap.cancelled_by = current_user.id
    swap.cancel_reason = reason.strip()
    employee = session.get(Employee, swap.employee_id)
    record_audit(
        session,
        actor=current_user.actor,
        action="shift_swap.cancel",
        entity_type="shift_swap",
        entity_id=swap.id,
        before={"swap_date": swap.swap_date, "shift_id": swap.shift_id},
        reason=swap.cancel_reason,
        plant_id=employee.plant_id if employee else None,
    )
    mark_days_stale(session, [swap.employee_id], swap.swap_date - timedelta(days=1), swap.swap_date)
    session.commit()
    return swap


def swaps_of(
    session: Session,
    current_user: CurrentUser,
    employee_id: uuid.UUID,
    *,
    date_from: date | None,
    date_to: date | None,
) -> list[ShiftSwap]:
    employee = session.get(Employee, employee_id)
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if employee is None or (allowed is not None and employee.plant_id not in allowed):
        raise ApiError("NOT_FOUND", "Not found.", 404)
    statement = select(ShiftSwap).where(ShiftSwap.employee_id == employee_id)
    if date_from:
        statement = statement.where(ShiftSwap.swap_date >= date_from)
    if date_to:
        statement = statement.where(ShiftSwap.swap_date <= date_to)
    return list(session.scalars(statement.order_by(ShiftSwap.swap_date.desc())))


def present(session: Session, swaps: list[ShiftSwap]) -> list[SwapResponse]:
    shifts = {
        shift.id: shift
        for shift in session.scalars(select(Shift).where(Shift.id.in_({s.shift_id for s in swaps})))
    }
    user_ids = {s.created_by for s in swaps} | {s.cancelled_by for s in swaps if s.cancelled_by}
    names = dict(session.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())

    def cancelled(swap: ShiftSwap) -> SwapCancellation | None:
        if swap.cancelled_at is None or swap.cancelled_by is None:
            return None
        return SwapCancellation(
            by=names.get(swap.cancelled_by, ""), at=swap.cancelled_at, reason=swap.cancel_reason
        )

    return [
        SwapResponse(
            id=swap.id,
            date=swap.swap_date,
            shift=SwapShift(id=swap.shift_id, name=shifts[swap.shift_id].name),
            reason=swap.reason,
            created_by=names.get(swap.created_by, ""),
            created_at=swap.created_at,
            cancelled=cancelled(swap),
        )
        for swap in swaps
    ]


def window_start_of(session: Session, swap: ShiftSwap) -> datetime | None:
    """When the day of this swap begins (its window start), or None without a shift."""
    window = _calendar(session, swap.employee_id, swap.swap_date).window(
        swap.employee_id, swap.swap_date
    )
    return window.start if window else None
