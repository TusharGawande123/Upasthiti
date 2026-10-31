"""Changes to employees: create, edit, transfer, mark as left, reactivate, bulk change.

None of these functions commits. The caller does, so that:
- a Super Admin's change, its history rows and its audit entry are saved together;
- a Corporate Head's change can be tried inside a savepoint (to show errors at once) and
  applied for real only when a Super Admin approves (approvals/service.py).
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist
from app.modules.approvals.models import ChangeRequest, RequestStatus
from app.modules.attendance.service import mark_days_stale
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import (
    Employee,
    EmployeePlantHistory,
    EmployeeStatus,
    ShiftAssignment,
)
from app.modules.employees.rules import (
    EmployeeValues,
    check_effective_date,
    check_new_code,
    check_values,
    clean_code,
    field_error,
)
from app.modules.face.gallery_cache import invalidate_plant_gallery
from app.modules.face.models import TemplateDeleteKind
from app.modules.face.template_service import (
    cancel_open_session,
    close_consent_of_leaver,
    delete_active_template,
)
from app.modules.qr_cards.service import revoke_card_of_leaver

MAX_LEFT_DAYS_AHEAD = 30
MAX_BULK_SIZE = 500
BULK_ACTIONS = ("change_shift", "change_department", "change_category", "mark_left")


@dataclass(frozen=True)
class AuditContext:
    """Who is changing, and (for an approved request) which request it came from."""

    actor: Actor
    change_request_id: uuid.UUID | None = None


# --- Reading ---------------------------------------------------------------------------------


def current_shift_assignment(session: Session, employee_id: uuid.UUID) -> ShiftAssignment | None:
    return session.scalar(
        select(ShiftAssignment).where(
            ShiftAssignment.employee_id == employee_id, ShiftAssignment.to_date.is_(None)
        )
    )


def values_of(session: Session, employee: Employee) -> EmployeeValues:
    assignment = current_shift_assignment(session, employee.id)
    if assignment is None:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    return EmployeeValues(
        employee_code=employee.employee_code,
        full_name=employee.full_name,
        type=employee.type,
        plant_id=employee.plant_id,
        category_id=employee.category_id,
        department_id=employee.department_id,
        shift_id=assignment.shift_id,
        contractor_id=employee.contractor_id,
        punch_method=employee.punch_method,
        hourly_rate=employee.hourly_rate,
        ot_rate_per_hour=employee.ot_rate_per_hour,
        joined_on=employee.joined_on,
    )


def snapshot(session: Session, employee: Employee) -> dict[str, Any]:
    """The fields shown in the audit log for an employee."""
    assignment = current_shift_assignment(session, employee.id)
    return {
        "employee_code": employee.employee_code,
        "full_name": employee.full_name,
        "type": employee.type,
        "plant_id": employee.plant_id,
        "category_id": employee.category_id,
        "department_id": employee.department_id,
        "shift_id": assignment.shift_id if assignment else None,
        "contractor_id": employee.contractor_id,
        "punch_method": employee.punch_method,
        "hourly_rate": employee.hourly_rate,
        "ot_rate_per_hour": employee.ot_rate_per_hour,
        "status": employee.status,
        "joined_on": employee.joined_on,
        "left_on": employee.left_on,
    }


# --- Create and edit ---------------------------------------------------------------------------


def create_employee(session: Session, context: AuditContext, values: EmployeeValues) -> Employee:
    values = values.with_changes({"employee_code": clean_code(values.employee_code)})
    check_new_code(session, values.employee_code)
    values = check_values(session, values)

    employee = Employee(
        employee_code=values.employee_code,
        full_name=values.full_name.strip(),
        type=values.type,
        plant_id=values.plant_id,
        category_id=values.category_id,
        department_id=values.department_id,
        contractor_id=values.contractor_id,
        punch_method=values.punch_method,
        hourly_rate=values.hourly_rate,
        ot_rate_per_hour=values.ot_rate_per_hour,
        joined_on=values.joined_on,
    )
    session.add(employee)
    session.flush()
    session.add(
        ShiftAssignment(
            employee_id=employee.id, shift_id=values.shift_id, from_date=values.joined_on
        )
    )
    session.add(
        EmployeePlantHistory(
            employee_id=employee.id,
            plant_id=values.plant_id,
            category_id=values.category_id,
            department_id=values.department_id,
            from_date=values.joined_on,
            created_by=context.actor.actor_id,
        )
    )
    session.flush()
    _mark_attendance_stale(session, employee, values.joined_on)
    _audit(session, context, employee, "employee.create", before=None)
    return employee


def update_employee(
    session: Session,
    context: AuditContext,
    employee: Employee,
    changes: dict[str, Any],
    *,
    shift_from: date | None = None,
    reason: str | None = None,
) -> Employee:
    """Change fields of an active employee. The code and the plant never change here."""
    _check_active(employee)
    if "employee_code" in changes or "plant_id" in changes:
        raise ApiError("VALIDATION_FAILED", "Code and plant cannot be edited (use Transfer).", 422)
    before = snapshot(session, employee)
    current = values_of(session, employee)
    new_values = check_values(session, current.with_changes(changes))
    leaves_face = current.punch_method == "face" and new_values.punch_method != "face"

    for field_name in (
        "full_name",
        "type",
        "category_id",
        "department_id",
        "contractor_id",
        "punch_method",
        "hourly_rate",
        "ot_rate_per_hour",
        "joined_on",
    ):
        setattr(employee, field_name, getattr(new_values, field_name))
    if new_values.shift_id != current.shift_id:
        _move_to_shift(session, employee, new_values.shift_id, shift_from or today_ist())
    session.flush()
    changed_from = [today_ist(), current.joined_on, new_values.joined_on]
    if new_values.shift_id != current.shift_id and shift_from:
        changed_from.append(shift_from)
    _mark_attendance_stale(session, employee, min(changed_from))
    _audit(session, context, employee, "employee.update", before=before, reason=reason)
    if leaves_face:
        # Face -> QR by an edit or an approved request: the template is deleted at once; the
        # consent stays recorded (decision 0016 item 13). Switching back means enrolling again.
        cancel_open_session(session, employee, actor=context.actor)
        delete_active_template(
            session,
            employee,
            kind=TemplateDeleteKind.METHOD_CHANGED,
            actor=context.actor,
            reason=reason,
        )
        invalidate_plant_gallery(employee.plant_id)
    return employee


# --- Transfer (F-20) ----------------------------------------------------------------------------


def transfer_employee(
    session: Session,
    context: AuditContext,
    employee: Employee,
    *,
    to_plant_id: uuid.UUID,
    category_id: uuid.UUID,
    department_id: uuid.UUID | None,
    shift_id: uuid.UUID,
    effective_from: date,
    reason: str,
) -> Employee:
    """Move an employee to another plant from a date. Old months stay with the old plant."""
    _check_active(employee)
    if to_plant_id == employee.plant_id:
        raise ApiError("TRANSFER_SAME_PLANT", "The employee is already at this plant.", 422)
    check_effective_date(effective_from)
    before = snapshot(session, employee)
    check_values(
        session,
        values_of(session, employee).with_changes(
            {
                "plant_id": to_plant_id,
                "category_id": category_id,
                "department_id": department_id,
                "shift_id": shift_id,
            }
        ),
    )

    _close_open_plant_row(session, employee.id, effective_from)
    session.add(
        EmployeePlantHistory(
            employee_id=employee.id,
            plant_id=to_plant_id,
            category_id=category_id,
            department_id=department_id,
            from_date=effective_from,
            reason=reason,
            created_by=context.actor.actor_id,
        )
    )
    _move_to_shift(session, employee, shift_id, effective_from)
    # Consent and template stay; the employee moves to the new plant's gallery (spec §7 rule 3).
    invalidate_plant_gallery(employee.plant_id, to_plant_id)
    if effective_from <= today_ist():
        employee.plant_id, employee.category_id, employee.department_id = (
            to_plant_id,
            category_id,
            department_id,
        )
    session.flush()
    _mark_attendance_stale(session, employee, effective_from)
    _audit(
        session,
        context,
        employee,
        "employee.transfer",
        before=before,
        reason=reason,
        extra={"to_plant_id": to_plant_id, "effective_from": effective_from},
    )
    return employee


def apply_due_transfers(session: Session, today: date) -> int:
    """Daily job: future-dated transfers whose day has come take effect. Caller commits."""
    due_rows = session.execute(
        select(EmployeePlantHistory, Employee)
        .join(Employee, Employee.id == EmployeePlantHistory.employee_id)
        .where(
            EmployeePlantHistory.to_date.is_(None),
            EmployeePlantHistory.from_date <= today,
            Employee.plant_id != EmployeePlantHistory.plant_id,
            Employee.status == EmployeeStatus.ACTIVE.value,
        )
    ).all()
    for history_row, employee in due_rows:
        invalidate_plant_gallery(employee.plant_id, history_row.plant_id)
        employee.plant_id = history_row.plant_id
        employee.category_id = history_row.category_id
        employee.department_id = history_row.department_id
        _mark_attendance_stale(session, employee, today)
    return len(due_rows)


# --- Leaving and coming back --------------------------------------------------------------------


def mark_left(
    session: Session, context: AuditContext, employee: Employee, *, left_on: date, reason: str
) -> Employee:
    """Super Admin only (decision 0005). Nothing is deleted; history stays (Labour Codes)."""
    _check_active(employee)
    if left_on < employee.joined_on or left_on > today_ist() + timedelta(days=MAX_LEFT_DAYS_AHEAD):
        raise field_error("LEFT_DATE_INVALID", "Choose a valid leaving date.", "left_on")
    before = snapshot(session, employee)
    employee.status = EmployeeStatus.LEFT.value
    employee.left_on = left_on
    employee.left_reason = reason
    _close_open_rows(session, employee.id, left_on)
    _fail_pending_requests(session, employee.id)
    session.flush()
    _mark_attendance_stale(session, employee, left_on)
    _audit(session, context, employee, "employee.mark_left", before=before, reason=reason)
    # FR-10: the working QR card and the face data stop in the same transaction (AC-19).
    revoke_card_of_leaver(session, context.actor, employee)
    cancel_open_session(session, employee, actor=context.actor)
    delete_active_template(
        session, employee, kind=TemplateDeleteKind.LEFT, actor=context.actor, reason=reason
    )
    close_consent_of_leaver(session, employee)
    invalidate_plant_gallery(employee.plant_id)
    return employee


def reactivate(
    session: Session, context: AuditContext, employee: Employee, *, joined_on: date, reason: str
) -> Employee:
    if employee.status != EmployeeStatus.LEFT.value:
        raise ApiError("EMPLOYEE_NOT_LEFT", "This employee has not left.", 409)
    last_shift = session.scalar(
        select(ShiftAssignment.shift_id)
        .where(ShiftAssignment.employee_id == employee.id)
        .order_by(ShiftAssignment.from_date.desc())
    )
    if last_shift is None:
        raise field_error("SHIFT_NOT_IN_PLANT", "Choose a shift.", "shift")
    before = snapshot(session, employee)
    values = values_for_reactivation(employee, last_shift, joined_on)
    check_values(session, values)

    employee.status = EmployeeStatus.ACTIVE.value
    employee.left_on = None
    employee.left_reason = None
    employee.joined_on = joined_on
    session.add(ShiftAssignment(employee_id=employee.id, shift_id=last_shift, from_date=joined_on))
    session.add(
        EmployeePlantHistory(
            employee_id=employee.id,
            plant_id=employee.plant_id,
            category_id=employee.category_id,
            department_id=employee.department_id,
            from_date=joined_on,
            reason=reason,
            created_by=context.actor.actor_id,
        )
    )
    session.flush()
    _mark_attendance_stale(session, employee, joined_on)
    _audit(session, context, employee, "employee.reactivate", before=before, reason=reason)
    return employee


def values_for_reactivation(
    employee: Employee, shift_id: uuid.UUID, joined_on: date
) -> EmployeeValues:
    return EmployeeValues(
        employee_code=employee.employee_code,
        full_name=employee.full_name,
        type=employee.type,
        plant_id=employee.plant_id,
        category_id=employee.category_id,
        department_id=employee.department_id,
        shift_id=shift_id,
        contractor_id=employee.contractor_id,
        punch_method=employee.punch_method,
        hourly_rate=employee.hourly_rate,
        ot_rate_per_hour=employee.ot_rate_per_hour,
        joined_on=joined_on,
    )


# --- Bulk (F-6) ----------------------------------------------------------------------------------


def bulk_change(
    session: Session,
    context: AuditContext,
    employees: list[Employee],
    *,
    action: str,
    params: dict[str, Any],
    reason: str,
) -> int:
    """Apply one change to many employees. The caller's transaction makes it all-or-nothing."""
    if not employees:
        raise ApiError("VALIDATION_FAILED", "Choose at least one employee.", 422)
    if len(employees) > MAX_BULK_SIZE:
        raise ApiError("BULK_TOO_LARGE", "At most 500 employees at once.", 422)
    try:
        return _apply_bulk(session, context, employees, action, params, reason)
    except KeyError, ValueError:
        raise ApiError("VALIDATION_FAILED", "The bulk change is missing a value.", 422) from None


def _apply_bulk(
    session: Session,
    context: AuditContext,
    employees: list[Employee],
    action: str,
    params: dict[str, Any],
    reason: str,
) -> int:
    for employee in employees:
        if action == "change_shift":
            update_employee(
                session,
                context,
                employee,
                {"shift_id": uuid.UUID(str(params["shift_id"]))},
                shift_from=_optional_date(params.get("from_date")),
                reason=reason,
            )
        elif action == "change_department":
            department = params.get("department_id")
            update_employee(
                session,
                context,
                employee,
                {"department_id": uuid.UUID(str(department)) if department else None},
                reason=reason,
            )
        elif action == "change_category":
            update_employee(
                session,
                context,
                employee,
                {"category_id": uuid.UUID(str(params["category_id"]))},
                reason=reason,
            )
        elif action == "mark_left":
            mark_left(
                session,
                context,
                employee,
                left_on=_optional_date(params.get("left_on")) or today_ist(),
                reason=reason,
            )
        else:
            raise ApiError("VALIDATION_FAILED", "Unknown bulk action.", 422)
    return len(employees)


# --- Helpers ---


def _mark_attendance_stale(session: Session, employee: Employee, from_date: date) -> None:
    """Joining, leaving, a shift or plant change: the stored days from that date on are
    recomputed (M5 spec §7 rule 14). The caller's transaction commits it."""
    mark_days_stale(session, [employee.id], from_date, today_ist())


def _check_active(employee: Employee) -> None:
    if employee.status != EmployeeStatus.ACTIVE.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left; reactivate them first.", 409)


def _move_to_shift(session: Session, employee: Employee, shift_id: uuid.UUID, start: date) -> None:
    """Close the current shift on the day before `start` and open the new one from `start`.

    If the current shift itself only starts on or after `start` (for example it was set
    today), it is simply replaced, so no row ever ends before it begins.
    """
    if start < today_ist():
        raise field_error("SHIFT_DATE_INVALID", "A shift change cannot start in the past.", "shift")
    current = current_shift_assignment(session, employee.id)
    if current is not None and current.from_date >= start:
        current.shift_id = shift_id
        return
    if current is not None:
        current.to_date = start - timedelta(days=1)
        session.flush()
    session.add(ShiftAssignment(employee_id=employee.id, shift_id=shift_id, from_date=start))


def _close_open_plant_row(session: Session, employee_id: uuid.UUID, start: date) -> None:
    open_row = session.scalar(
        select(EmployeePlantHistory).where(
            EmployeePlantHistory.employee_id == employee_id,
            EmployeePlantHistory.to_date.is_(None),
        )
    )
    if open_row is None:
        return
    if open_row.from_date >= start:
        # The open row starts on or after the new date: it never took effect, end it at once.
        open_row.to_date = open_row.from_date
    else:
        open_row.to_date = start - timedelta(days=1)
    session.flush()


def _close_open_rows(session: Session, employee_id: uuid.UUID, last_day: date) -> None:
    for model in (ShiftAssignment, EmployeePlantHistory):
        session.execute(
            update(model)
            .where(model.employee_id == employee_id, model.to_date.is_(None))
            .values(to_date=last_day)
        )


def _fail_pending_requests(session: Session, employee_id: uuid.UUID) -> None:
    session.execute(
        update(ChangeRequest)
        .where(
            ChangeRequest.employee_id == employee_id,
            ChangeRequest.status == RequestStatus.PENDING.value,
        )
        .values(
            status=RequestStatus.FAILED.value,
            result={"errors": [{"code": "EMPLOYEE_LEFT", "message": "Employee has left."}]},
        )
    )


def _optional_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    return value if isinstance(value, date) else date.fromisoformat(str(value))


def _audit(
    session: Session,
    context: AuditContext,
    employee: Employee,
    action: str,
    *,
    before: dict[str, Any] | None,
    reason: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    after = snapshot(session, employee) | (extra or {})
    record_audit(
        session,
        actor=context.actor,
        action=action,
        entity_type="employee",
        entity_id=employee.id,
        before=before,
        after=after,
        reason=reason,
        plant_id=employee.plant_id,
        change_request_id=context.change_request_id,
    )
