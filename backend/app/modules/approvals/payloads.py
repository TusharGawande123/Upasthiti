"""Turning employee changes into JSON (to store in a change request) and back.

A change request keeps only plain values; when it is approved they are turned back into the
same arguments the direct (Super Admin) path uses, so both paths run identical code.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from app.modules.employees.rules import EmployeeValues

UUID_FIELDS = {
    "plant_id",
    "to_plant_id",
    "category_id",
    "department_id",
    "shift_id",
    "contractor_id",
}
DECIMAL_FIELDS = {"hourly_rate", "ot_rate_per_hour"}
DATE_FIELDS = {"joined_on", "shift_from", "effective_from", "left_on", "from_date"}


def to_json(values: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in values.items():
        if isinstance(value, uuid.UUID | Decimal):
            result[key] = str(value)
        elif isinstance(value, date):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result


def from_json(values: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            result[key] = None
        elif key in UUID_FIELDS:
            result[key] = uuid.UUID(value)
        elif key in DECIMAL_FIELDS:
            result[key] = Decimal(value)
        elif key in DATE_FIELDS:
            result[key] = date.fromisoformat(value)
        else:
            result[key] = value
    return result


def values_to_json(values: EmployeeValues) -> dict[str, Any]:
    return to_json(values.__dict__)


def values_from_json(data: dict[str, Any]) -> EmployeeValues:
    return EmployeeValues(**from_json(data))
