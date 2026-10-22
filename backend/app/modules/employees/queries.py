"""Reading employees: lists with filters, one employee with history, the timeline (F-19)
and quick search (F-6). Every query honours the user's plant scope."""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee, EmployeePlantHistory, ShiftAssignment
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.users.models import User

SEARCH_LIMIT = 8
# An employee card serial: "C" and digits, e.g. C000123 (test cards, "T...", belong to nobody).
CARD_SERIAL_PATTERN = re.compile(r"C[0-9]{1,9}")
# A short start like "C1" would match nobody useful, so a serial is matched by its first
# characters only from this length on (the full serial always works).
MIN_SERIAL_PREFIX_LENGTH = 4


@dataclass(frozen=True)
class EmployeeFilters:
    plant_id: uuid.UUID | None = None
    type: str | None = None
    status: str | None = None
    category_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    shift_id: uuid.UUID | None = None
    contractor_id: uuid.UUID | None = None
    search: str | None = None


def list_employees(
    session: Session,
    params: PageParams,
    filters: EmployeeFilters,
    *,
    only_plant_ids: frozenset[uuid.UUID] | None,
) -> tuple[list[Employee], int]:
    statement = _scoped(select(Employee), only_plant_ids).order_by(Employee.employee_code)
    for column, value in (
        (Employee.plant_id, filters.plant_id),
        (Employee.type, filters.type),
        (Employee.status, filters.status),
        (Employee.category_id, filters.category_id),
        (Employee.department_id, filters.department_id),
        (Employee.contractor_id, filters.contractor_id),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if filters.shift_id is not None:
        statement = statement.where(
            Employee.id.in_(
                select(ShiftAssignment.employee_id).where(
                    ShiftAssignment.shift_id == filters.shift_id,
                    ShiftAssignment.to_date.is_(None),
                )
            )
        )
    if filters.search:
        statement = statement.where(_matches(filters.search))
    return fetch_page(session, statement, params)


def get_employee(
    session: Session, employee_id: uuid.UUID, *, only_plant_ids: frozenset[uuid.UUID] | None
) -> Employee:
    employee = session.get(Employee, employee_id)
    # An employee outside the user's scope looks like it does not exist (no id leaks).
    if employee is None or (only_plant_ids is not None and employee.plant_id not in only_plant_ids):
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee not found.", 404)
    return employee


def get_employees(
    session: Session, employee_ids: list[uuid.UUID], *, only_plant_ids: frozenset[uuid.UUID] | None
) -> list[Employee]:
    """All of them, or FORBIDDEN when any one is unknown or outside the scope (bulk actions)."""
    employees = list(session.scalars(select(Employee).where(Employee.id.in_(employee_ids))))
    in_scope = [
        employee
        for employee in employees
        if only_plant_ids is None or employee.plant_id in only_plant_ids
    ]
    if len(in_scope) != len(set(employee_ids)):
        raise ApiError("FORBIDDEN", "Some employees cannot be changed by you.", 403)
    return in_scope


def shift_history(session: Session, employee_id: uuid.UUID) -> list[ShiftAssignment]:
    return list(
        session.scalars(
            select(ShiftAssignment)
            .where(ShiftAssignment.employee_id == employee_id)
            .order_by(ShiftAssignment.from_date.desc())
        )
    )


def plant_history(session: Session, employee_id: uuid.UUID) -> list[EmployeePlantHistory]:
    return list(
        session.scalars(
            select(EmployeePlantHistory)
            .where(EmployeePlantHistory.employee_id == employee_id)
            .order_by(EmployeePlantHistory.from_date.desc(), EmployeePlantHistory.created_at.desc())
        )
    )


@dataclass(frozen=True)
class TimelineEvent:
    at: object
    action: str
    actor_name: str | None
    approved_through_request: bool
    changed_fields: list[str]
    reason: str | None


def timeline(session: Session, employee_id: uuid.UUID) -> list[TimelineEvent]:
    """Everything that happened to one employee, newest first, from the audit log (F-19)."""
    rows = session.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.entity_type == "employee", AuditLog.entity_id == employee_id)
        .order_by(AuditLog.at.desc(), AuditLog.id)
    ).all()
    return [
        TimelineEvent(
            at=entry.at,
            action=entry.action,
            actor_name=actor_name,
            approved_through_request=entry.change_request_id is not None,
            changed_fields=sorted((entry.after or {}).keys())
            if entry.action != "employee.create"
            else [],
            reason=entry.reason,
        )
        for entry, actor_name in rows
    ]


def search(
    session: Session, text: str, *, only_plant_ids: frozenset[uuid.UUID] | None
) -> list[Employee]:
    condition = _matches(text)
    serial = _card_serial(text)
    if serial is not None:
        # Typing a card serial finds its owner, also when that card was replaced or revoked
        # (someone found an old card and wants to know whose it was).
        owner_ids = select(QrCredential.employee_id).where(_serial_matches(serial))
        condition = or_(condition, Employee.id.in_(owner_ids))
    statement = _scoped(select(Employee), only_plant_ids).where(condition)
    return list(session.scalars(statement.order_by(Employee.employee_code).limit(SEARCH_LIMIT)))


def matching_card_serials(
    session: Session, text: str, employee_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """For a search by card serial: which serial matched, per employee (newest if several)."""
    serial = _card_serial(text)
    if serial is None or not employee_ids:
        return {}
    rows = session.execute(
        select(QrCredential.employee_id, QrCredential.card_serial)
        .where(QrCredential.employee_id.in_(employee_ids), _serial_matches(serial))
        .order_by(QrCredential.card_serial)
    )
    # Oldest serial first, so the newest overwrites.
    return {
        employee_id: card_serial for employee_id, card_serial in rows if employee_id is not None
    }


def _card_serial(text: str) -> str | None:
    """The text in serial form (upper case), or None when it does not look like a serial."""
    candidate = text.strip().upper()
    return candidate if CARD_SERIAL_PATTERN.fullmatch(candidate) else None


def _serial_matches(serial: str) -> ColumnElement[bool]:
    condition = (
        QrCredential.card_serial.startswith(serial)
        if len(serial) >= MIN_SERIAL_PREFIX_LENGTH
        else QrCredential.card_serial == serial
    )
    return condition & (QrCredential.kind == CardKind.EMPLOYEE.value)


def _scoped(
    statement: Select[Employee], only_plant_ids: frozenset[uuid.UUID] | None
) -> Select[Employee]:
    if only_plant_ids is None:
        return statement
    return statement.where(Employee.plant_id.in_(only_plant_ids))


def _matches(text: str):  # noqa: ANN202 (an SQL condition)
    """Code starting with the text, or a name containing it (case-insensitive)."""
    cleaned = text.strip()
    return or_(
        Employee.employee_code.startswith(cleaned.upper()),
        func.lower(Employee.full_name).contains(cleaned.lower()),
    )
