"""The type of an employee (permanent or temporary) on a date, and how the history is kept (M5c).

`employees.type` is "the type today". Everything about a past day (attendance, reports) asks the
history, so a conversion never changes old months. The history is append-only: a row is closed on
its last day, never deleted.
"""

import uuid
from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee, EmployeeTypeHistory


def open_type_row(session: Session, employee_id: uuid.UUID) -> EmployeeTypeHistory | None:
    return session.scalar(
        select(EmployeeTypeHistory).where(
            EmployeeTypeHistory.employee_id == employee_id, EmployeeTypeHistory.to_date.is_(None)
        )
    )


def employee_type_on(session: Session, employee: Employee, day: date) -> str:
    """The type on `day`. A day before the first row (or a person without a history) uses the
    type of today."""
    row = session.scalar(
        select(EmployeeTypeHistory)
        .where(
            EmployeeTypeHistory.employee_id == employee.id,
            EmployeeTypeHistory.from_date <= day,
            or_(EmployeeTypeHistory.to_date.is_(None), EmployeeTypeHistory.to_date >= day),
        )
        .order_by(EmployeeTypeHistory.from_date.desc())
        .limit(1)
    )
    return row.type if row else employee.type


def start_type_history(
    session: Session, employee: Employee, created_by: uuid.UUID | None
) -> EmployeeTypeHistory:
    """The first row of a new employee: today's type from the joining date."""
    row = EmployeeTypeHistory(
        employee_id=employee.id,
        type=employee.type,
        from_date=employee.joined_on,
        contractor_id=employee.contractor_id,
        hourly_rate=employee.hourly_rate,
        ot_rate_per_hour=employee.ot_rate_per_hour,
        reason="Start of the type history",
        created_by=created_by,
    )
    session.add(row)
    return row


def sync_type_history(
    session: Session,
    employee: Employee,
    *,
    changed_from: date,
    created_by: uuid.UUID | None,
    reason: str | None,
) -> None:
    """Keep the open row in step with the employee after an edit.

    Same type: the open row only takes the new contractor and rates. New type: the open row is
    closed the day before `changed_from` and a new row opens on it (the same day twice: the
    latest save wins, nothing is deleted).
    """
    row = open_type_row(session, employee.id)
    if row is None:
        start_type_history(session, employee, created_by)
        return
    if row.type != employee.type and row.from_date < changed_from:
        row.to_date = changed_from - timedelta(days=1)
        session.flush()
        row = EmployeeTypeHistory(
            employee_id=employee.id, from_date=changed_from, created_by=created_by, reason=reason
        )
        session.add(row)
    row.type = employee.type
    row.contractor_id = employee.contractor_id
    row.hourly_rate = employee.hourly_rate
    row.ot_rate_per_hour = employee.ot_rate_per_hour
