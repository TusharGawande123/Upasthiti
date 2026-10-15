"""Request and response shapes for employees, bulk actions, import and search."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

Money = Decimal  # sent and received as strings like "150.00"; never a float


class EmployeeResponse(BaseModel):
    id: uuid.UUID
    employee_code: str
    full_name: str
    type: str
    plant_id: uuid.UUID
    plant_code: str
    category_id: uuid.UUID
    category_name: str
    department_id: uuid.UUID | None
    department_name: str | None
    shift_id: uuid.UUID | None
    shift_name: str | None
    contractor_id: uuid.UUID | None
    contractor_name: str | None
    punch_method: str
    hourly_rate: Money | None
    ot_rate_per_hour: Money | None
    status: str
    joined_on: date
    left_on: date | None
    left_reason: str | None
    has_pending_change: bool


class ShiftHistoryItem(BaseModel):
    shift_id: uuid.UUID
    shift_name: str
    from_date: date
    to_date: date | None


class PlantHistoryItem(BaseModel):
    plant_id: uuid.UUID
    plant_code: str
    from_date: date
    to_date: date | None
    reason: str | None


class EmployeeDetailResponse(BaseModel):
    employee: EmployeeResponse
    shift_history: list[ShiftHistoryItem]
    plant_history: list[PlantHistoryItem]


class CreateEmployeeRequest(BaseModel):
    employee_code: str = Field(min_length=1, max_length=12)
    full_name: str = Field(min_length=1, max_length=120)
    type: Literal["permanent", "temporary"]
    plant_id: uuid.UUID
    category_id: uuid.UUID
    department_id: uuid.UUID | None = None
    shift_id: uuid.UUID
    contractor_id: uuid.UUID | None = None
    punch_method: Literal["face", "qr"] | None = None
    hourly_rate: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    ot_rate_per_hour: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    joined_on: date


class UpdateEmployeeRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    type: Literal["permanent", "temporary"] | None = None
    category_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    shift_id: uuid.UUID | None = None
    shift_from: date | None = None
    contractor_id: uuid.UUID | None = None
    punch_method: Literal["face", "qr"] | None = None
    hourly_rate: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    ot_rate_per_hour: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    joined_on: date | None = None
    reason: str | None = Field(default=None, max_length=500)


class TransferRequest(BaseModel):
    to_plant_id: uuid.UUID
    category_id: uuid.UUID
    department_id: uuid.UUID | None = None
    shift_id: uuid.UUID
    effective_from: date
    reason: str = Field(min_length=3, max_length=500)


class MarkLeftRequest(BaseModel):
    left_on: date
    reason: str = Field(min_length=3, max_length=500)


class ReactivateRequest(BaseModel):
    joined_on: date
    reason: str = Field(min_length=3, max_length=500)


class BulkRequest(BaseModel):
    action: Literal["change_shift", "change_department", "change_category", "mark_left"]
    employee_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    params: dict[str, str | None] = Field(default_factory=dict)
    reason: str = Field(min_length=3, max_length=500)


class BulkResponse(BaseModel):
    updated: int


class ChangeRequestCreated(BaseModel):
    """202 answer: the change waits for a Super Admin's approval."""

    change_request_id: uuid.UUID
    status: str
    summary: str


class ImportRowError(BaseModel):
    row: int
    column: str
    code: str
    message: str


class ImportResponse(BaseModel):
    ok_rows: int
    error_rows: int
    errors: list[ImportRowError]
    created: int | None = None


class TimelineEventResponse(BaseModel):
    at: datetime
    action: str
    actor_name: str | None
    approved_through_request: bool
    changed_fields: list[str]
    reason: str | None


class SearchEmployee(BaseModel):
    id: uuid.UUID
    employee_code: str
    full_name: str
    plant_code: str
    status: str


class SearchPlant(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class SearchKiosk(BaseModel):
    id: uuid.UUID
    name: str
    plant_id: uuid.UUID


class SearchResponse(BaseModel):
    employees: list[SearchEmployee]
    plants: list[SearchPlant]
    kiosks: list[SearchKiosk]
