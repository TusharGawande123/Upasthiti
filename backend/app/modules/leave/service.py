"""Leave entry: add, cancel and list paid / unpaid leave (M5 spec §5.3, §7 rule 12; decision 0034).

Only the Super Admin enters leave: no balances, no approval workflow, employees never log in. A
leave may be for future dates, is at most 92 days, inside the employment dates, and never overlaps
another active leave of the same person (checked with the employee row locked, so two saves at the
same moment cannot both pass). Cancelled, never deleted; every change is audited.
"""

import uuid
from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.core.time import utc_now
from app.modules.attendance.calendar import count_working_days
from app.modules.attendance.service import mark_days_stale
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.leave.models import MAX_LEAVE_DAYS, LeaveRecord
from app.modules.leave.schemas import (
    CreateLeaveRequest,
    LeaveCancellation,
    LeaveEmployee,
    LeaveResponse,
)
from app.modules.notices.schemas import NoticePerson as Person
from app.modules.users.models import User


def create_leave(
    session: Session, current_user: CurrentUser, body: CreateLeaveRequest
) -> LeaveRecord:
    # Lock the employee row: a second leave saved at the same moment waits here, then sees this one.
    employee = session.get(Employee, body.employee_id, with_for_update=True)
    if employee is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    _check_range(employee, body.from_date, body.to_date)
    _check_no_overlap(session, employee.id, body.from_date, body.to_date)
    leave = LeaveRecord(
        employee_id=employee.id,
        from_date=body.from_date,
        to_date=body.to_date,
        is_paid=body.is_paid,
        reason=body.reason.strip(),
        created_by=current_user.user.id,
        created_at=utc_now(),
    )
    session.add(leave)
    session.flush()
    record_audit(
        session,
        actor=current_user.actor,
        action="leave.create",
        entity_type="leave",
        entity_id=leave.id,
        after={
            "employee_id": employee.id,
            "from_date": leave.from_date,
            "to_date": leave.to_date,
            "is_paid": leave.is_paid,
        },
        reason=leave.reason,
        plant_id=employee.plant_id,
    )
    mark_days_stale(session, [employee.id], leave.from_date, leave.to_date)
    session.commit()
    return leave


def cancel_leave(
    session: Session, current_user: CurrentUser, leave_id: uuid.UUID, reason: str
) -> LeaveRecord:
    leave = session.get(LeaveRecord, leave_id, with_for_update=True)
    if leave is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if not leave.is_active:
        raise ApiError("LEAVE_NOT_ACTIVE", "This leave is already cancelled.", 409)
    leave.cancelled_at = utc_now()
    leave.cancelled_by = current_user.user.id
    leave.cancel_reason = reason.strip()
    employee = session.get(Employee, leave.employee_id)
    record_audit(
        session,
        actor=current_user.actor,
        action="leave.cancel",
        entity_type="leave",
        entity_id=leave.id,
        before={"cancelled": False},
        after={"cancelled": True, "from_date": leave.from_date, "to_date": leave.to_date},
        reason=leave.cancel_reason,
        plant_id=employee.plant_id if employee else None,
    )
    mark_days_stale(session, [leave.employee_id], leave.from_date, leave.to_date)
    session.commit()
    return leave


def list_leave(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    plant_id: uuid.UUID | None,
    employee_id: uuid.UUID | None,
    month: date | None,
    is_paid: bool | None,
    state: str | None,
) -> tuple[list[LeaveRecord], int]:
    """Newest first. A Plant Head sees the leave of the own plant's employees."""
    statement: Select[LeaveRecord] = (
        select(LeaveRecord)
        .join(Employee, Employee.id == LeaveRecord.employee_id)
        .order_by(LeaveRecord.from_date.desc(), LeaveRecord.created_at.desc())
    )
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if allowed is not None:
        statement = statement.where(Employee.plant_id.in_(allowed))
    if plant_id is not None:
        statement = statement.where(Employee.plant_id == plant_id)
    if employee_id is not None:
        statement = statement.where(LeaveRecord.employee_id == employee_id)
    if month is not None:
        month_end = (month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        statement = statement.where(
            LeaveRecord.from_date <= month_end, LeaveRecord.to_date >= month
        )
    if is_paid is not None:
        statement = statement.where(LeaveRecord.is_paid.is_(is_paid))
    if state == "active":
        statement = statement.where(LeaveRecord.cancelled_at.is_(None))
    elif state == "cancelled":
        statement = statement.where(LeaveRecord.cancelled_at.is_not(None))
    return fetch_page(session, statement, params)


def present(
    session: Session, current_user: CurrentUser, records: Iterable[LeaveRecord]
) -> list[LeaveResponse]:
    records = list(records)
    # Leave reasons can be personal (illness, family): only the Super Admin sees them.
    show_reasons = current_user.access(Capability.MANAGE_LEAVE) is Access.ALL
    employees = {
        employee.id: employee
        for employee in session.scalars(
            select(Employee).where(Employee.id.in_({record.employee_id for record in records}))
        )
    }
    user_ids = {record.created_by for record in records} | {
        record.cancelled_by for record in records if record.cancelled_by
    }
    names = dict(session.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())

    def person(user_id: uuid.UUID) -> Person:
        return Person(id=user_id, name=names.get(user_id, ""))

    answers = []
    for record in records:
        employee = employees[record.employee_id]
        answers.append(
            LeaveResponse(
                id=record.id,
                employee=LeaveEmployee(
                    id=employee.id, code=employee.employee_code, name=employee.full_name
                ),
                from_date=record.from_date,
                to_date=record.to_date,
                working_days=count_working_days(
                    session, record.employee_id, record.from_date, record.to_date
                ),
                is_paid=record.is_paid,
                reason=record.reason if show_reasons else None,
                created_by=person(record.created_by),
                created_at=record.created_at,
                cancelled=LeaveCancellation(
                    by=person(record.cancelled_by),
                    at=record.cancelled_at,
                    reason=record.cancel_reason if show_reasons else None,
                )
                if record.cancelled_at and record.cancelled_by
                else None,
            )
        )
    return answers


# --- Checks -------------------------------------------------------------------------------------


def _check_range(employee: Employee, from_date: date, to_date: date) -> None:
    too_long = (to_date - from_date).days + 1 > MAX_LEAVE_DAYS
    outside_employment = from_date < employee.joined_on or (
        employee.left_on is not None and to_date > employee.left_on
    )
    if to_date < from_date or too_long or outside_employment:
        raise ApiError(
            "LEAVE_RANGE_INVALID",
            "Leave can be up to 92 days, inside the employment dates.",
            422,
            {"max_days": MAX_LEAVE_DAYS},
        )


def _check_no_overlap(
    session: Session, employee_id: uuid.UUID, from_date: date, to_date: date
) -> None:
    overlapping = session.scalar(
        select(LeaveRecord.id).where(
            LeaveRecord.employee_id == employee_id,
            LeaveRecord.cancelled_at.is_(None),
            LeaveRecord.from_date <= to_date,
            LeaveRecord.to_date >= from_date,
        )
    )
    if overlapping is not None:
        raise ApiError(
            "LEAVE_OVERLAPS",
            "Leave already exists for part of these dates.",
            409,
            {"leave_id": str(overlapping)},
        )
