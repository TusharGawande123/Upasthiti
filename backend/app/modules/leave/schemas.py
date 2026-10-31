"""Request and response shapes for leave entry (M5 spec §5.3)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.modules.notices.schemas import NoticePerson as Person


class CreateLeaveRequest(BaseModel):
    employee_id: uuid.UUID
    from_date: date
    to_date: date
    is_paid: bool
    reason: str = Field(min_length=3, max_length=300)


class LeaveEmployee(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class LeaveCancellation(BaseModel):
    by: Person
    at: datetime
    reason: str | None  # only the Super Admin sees leave reasons (decision 0036)


class LeaveResponse(BaseModel):
    id: uuid.UUID
    employee: LeaveEmployee
    from_date: date
    to_date: date
    working_days: int  # weekly offs and holidays inside the range are not leave days
    is_paid: bool
    reason: str | None  # only the Super Admin sees leave reasons (decision 0036)
    created_by: Person
    created_at: datetime
    cancelled: LeaveCancellation | None


class LeaveCreated(BaseModel):
    leave: LeaveResponse
