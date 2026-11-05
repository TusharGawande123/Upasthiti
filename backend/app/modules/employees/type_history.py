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
        created_by=created_by,
    )
    session.add(row)
    return row


def row_covering(session: Session, employee_id: uuid.UUID, day: date) -> EmployeeTypeHistory | None:
    return session.scalar(
        select(EmployeeTypeHistory)
        .where(
            EmployeeTypeHistory.employee_id == employee_id,
            EmployeeTypeHistory.from_date <= day,
            or_(EmployeeTypeHistory.to_date.is_(None), EmployeeTypeHistory.to_date >= day),
        )
        .order_by(EmployeeTypeHistory.from_date.desc())
        .limit(1)
    )


def sync_type_history(
    session: Session, employee: Employee, *, today: date, created_by: uuid.UUID | None
) -> None:
    """After an edit: the row that covers today takes the new contractor and rates.

    The type itself never changes here, only a conversion changes it (and writes its own rows).
    A scheduled conversion (a later row) is left alone.
    """
    row = row_covering(session, employee.id, today)
    if row is None:
        start_type_history(session, employee, created_by)
        return
    row.contractor_id = employee.contractor_id
    row.hourly_rate = employee.hourly_rate
    row.ot_rate_per_hour = employee.ot_rate_per_hour


def scheduled_conversion(
    session: Session, employee_id: uuid.UUID, today: date
) -> EmployeeTypeHistory | None:
    """The open permanent row that starts after today: a conversion waiting for its day."""
    return session.scalar(
        select(EmployeeTypeHistory).where(
            EmployeeTypeHistory.employee_id == employee_id,
            EmployeeTypeHistory.type == "permanent",
            EmployeeTypeHistory.to_date.is_(None),
            EmployeeTypeHistory.from_date > today,
        )
    )


def type_history_rows(session: Session, employee_id: uuid.UUID) -> list[EmployeeTypeHistory]:
    return list(
        session.scalars(
            select(EmployeeTypeHistory)
            .where(EmployeeTypeHistory.employee_id == employee_id)
            .order_by(EmployeeTypeHistory.from_date, EmployeeTypeHistory.created_at)
        )
    )


def add_permanent_row(
    session: Session,
    employee: Employee,
    *,
    from_date: date,
    reason: str,
    created_by: uuid.UUID | None,
) -> EmployeeTypeHistory:
    """Close the open (temporary) row the day before `from_date` and open the permanent one.
    The closed row keeps the contractor and rates of its period. A row that would start before
    its own start day ends up empty and never covers a day."""
    current = open_type_row(session, employee.id)
    if current is not None:
        current.to_date = from_date - timedelta(days=1)
        session.flush()
    row = EmployeeTypeHistory(
        employee_id=employee.id,
        type="permanent",
        from_date=from_date,
        reason=reason,
        created_by=created_by,
    )
    session.add(row)
    session.flush()
    return row


def cancel_scheduled_row(
    session: Session, employee_id: uuid.UUID, scheduled: EmployeeTypeHistory
) -> None:
    """Undo a scheduled conversion: the permanent row is emptied (closed before its own start,
    never deleted) and the temporary row is open again."""
    scheduled.to_date = scheduled.from_date - timedelta(days=1)
    session.flush()
    previous = session.scalar(
        select(EmployeeTypeHistory)
        .where(
            EmployeeTypeHistory.employee_id == employee_id,
            EmployeeTypeHistory.id != scheduled.id,
            EmployeeTypeHistory.to_date == scheduled.from_date - timedelta(days=1),
        )
        .order_by(EmployeeTypeHistory.from_date.desc())
        .limit(1)
    )
    if previous is not None:
        previous.to_date = None
