"""The rules every employee record must follow (spec §7 rule 10, decision 0005).

All ways of changing an employee (form, bulk, Excel import, and a Corporate Head's change
request when it is approved) run these same checks. A broken rule raises an ApiError whose
`details.field` names the field, so the import can show it per row and column.
"""

import re
import uuid
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist
from app.modules.approvals.models import ChangeRequest, RequestKind, RequestStatus
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee, EmployeeType, PunchMethod
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift

CODE_PATTERN = re.compile(r"^[A-Z0-9/-]{1,12}$")
MAX_DAYS_AHEAD = 60  # joining or transfer dates may be at most this far in the future


@dataclass(frozen=True)
class EmployeeValues:
    """All the values of one employee, as they will be after a change."""

    employee_code: str
    full_name: str
    type: str
    plant_id: uuid.UUID
    category_id: uuid.UUID
    department_id: uuid.UUID | None
    shift_id: uuid.UUID
    contractor_id: uuid.UUID | None
    punch_method: str
    hourly_rate: Decimal | None
    ot_rate_per_hour: Decimal | None
    joined_on: date

    def with_changes(self, changes: dict[str, Any]) -> EmployeeValues:
        return replace(self, **changes)


def clean_code(code: str) -> str:
    """The company's existing code, trimmed and in capitals."""
    return code.strip().upper()


def check_new_code(session: Session, code: str) -> None:
    """A new code must have the right form, never have been used, and not be waiting."""
    if not CODE_PATTERN.match(code):
        raise field_error(
            "EMPLOYEE_CODE_INVALID", "Use up to 12 letters, digits, - or /.", "employee_code"
        )
    if session.scalar(select(Employee.id).where(Employee.employee_code == code)):
        # Codes are never reused, not even after the person left.
        raise field_error("EMPLOYEE_CODE_EXISTS", "This code is already used.", "employee_code")
    if code in codes_waiting_for_approval(session):
        raise field_error(
            "EMPLOYEE_CODE_PENDING",
            "This code is waiting for approval in another request.",
            "employee_code",
        )


def check_values(session: Session, values: EmployeeValues) -> EmployeeValues:
    """Check one employee's values; returns them with the type-based defaults filled in."""
    if not values.full_name.strip():
        raise field_error("VALIDATION_FAILED", "A name is needed.", "full_name")
    values = _check_type_rules(values)
    _check_plant_active(session, values.plant_id)
    _check_belongs_to_plant(session, EmployeeCategory, values.category_id, values.plant_id)
    _check_belongs_to_plant(session, Shift, values.shift_id, values.plant_id)
    if values.department_id is not None:
        _check_belongs_to_plant(session, Department, values.department_id, values.plant_id)
    if values.contractor_id is not None:
        contractor = session.get(Contractor, values.contractor_id)
        if contractor is None or not contractor.is_active:
            raise field_error("CONTRACTOR_NOT_FOUND", "Choose an active contractor.", "contractor")
    if values.joined_on > today_ist() + timedelta(days=MAX_DAYS_AHEAD):
        raise field_error("JOINED_DATE_INVALID", "The joining date is too far ahead.", "joined_on")
    return values


def _check_type_rules(values: EmployeeValues) -> EmployeeValues:
    """Temporary workers: hourly rate needed, contractor allowed, QR by default.
    Permanent employees: no hourly rate or contractor, face by default (spec §7 rule 10)."""
    if values.type == EmployeeType.TEMPORARY.value:
        if values.hourly_rate is None or values.hourly_rate <= 0:
            raise field_error(
                "HOURLY_RATE_REQUIRED", "A temporary worker needs an hourly rate.", "hourly_rate"
            )
    elif values.type == EmployeeType.PERMANENT.value:
        if values.hourly_rate is not None:
            raise field_error(
                "NOT_FOR_PERMANENT", "Permanent employees have no hourly rate.", "hourly_rate"
            )
        if values.contractor_id is not None:
            raise field_error(
                "NOT_FOR_PERMANENT", "Permanent employees have no contractor.", "contractor"
            )
    else:
        raise field_error("VALIDATION_FAILED", "Type must be permanent or temporary.", "type")

    if values.punch_method not in (PunchMethod.FACE.value, PunchMethod.QR.value):
        raise field_error("VALIDATION_FAILED", "Punch method must be face or qr.", "punch_method")
    if values.ot_rate_per_hour is not None and values.ot_rate_per_hour < 0:
        raise field_error("VALIDATION_FAILED", "The rate cannot be negative.", "ot_rate_per_hour")
    return values


def default_punch_method(employee_type: str) -> str:
    return (
        PunchMethod.QR.value
        if employee_type == EmployeeType.TEMPORARY.value
        else (PunchMethod.FACE.value)
    )


def check_effective_date(effective_from: date, field: str = "effective_from") -> None:
    today = today_ist()
    if effective_from < today or effective_from > today + timedelta(days=MAX_DAYS_AHEAD):
        raise field_error(
            "TRANSFER_DATE_INVALID", "Choose a date from today up to 60 days ahead.", field
        )


def codes_waiting_for_approval(session: Session) -> set[str]:
    """Employee codes inside pending create/import requests (there are only ever a few)."""
    pending = session.scalars(
        select(ChangeRequest).where(
            ChangeRequest.status == RequestStatus.PENDING.value,
            ChangeRequest.kind.in_([RequestKind.CREATE.value, RequestKind.IMPORT.value]),
        )
    )
    codes: set[str] = set()
    for request in pending:
        rows = request.payload.get("rows") or [request.payload.get("values", {})]
        codes.update(clean_code(str(row.get("employee_code", ""))) for row in rows)
    return codes


def field_error(code: str, message: str, field: str) -> ApiError:
    return ApiError(code, message, 422, {"field": field})


def _check_plant_active(session: Session, plant_id: uuid.UUID) -> None:
    plant = session.get(Plant, plant_id)
    if plant is None:
        raise field_error("PLANT_NOT_FOUND", "This plant does not exist.", "plant")
    if not plant.is_active:
        raise field_error("PLANT_INACTIVE", "This plant is switched off.", "plant")


ITEM_ERRORS = {
    EmployeeCategory: ("CATEGORY_NOT_IN_PLANT", "category"),
    Shift: ("SHIFT_NOT_IN_PLANT", "shift"),
    Department: ("DEPARTMENT_NOT_IN_PLANT", "department"),
}


def _check_belongs_to_plant(
    session: Session,
    model: type[EmployeeCategory] | type[Shift] | type[Department],
    item_id: uuid.UUID,
    plant_id: uuid.UUID,
) -> None:
    item = session.get(model, item_id)
    if item is None or item.plant_id != plant_id or not item.is_active:
        code, field = ITEM_ERRORS[model]
        raise field_error(code, f"Choose an active {field} of this plant.", field)
