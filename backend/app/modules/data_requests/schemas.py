"""Request and response shapes of the data-request register (M6 spec section 5)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

RequestKind = Literal["access", "correction", "erasure", "consent_withdrawal", "complaint", "other"]
Channel = Literal["in_person", "email", "phone_call", "letter"]
EventType = Literal["identity_checked", "action_taken", "answer_sent", "closed"]
Outcome = Literal["done", "partly_done", "refused"]
# What the request is now: no step yet, or the last step taken (spec 7.7 rule 2).
RequestStatus = Literal["open", "identity_checked", "in_progress", "answered", "closed"]


class CreateDataRequest(BaseModel):
    kind: RequestKind
    employee_id: uuid.UUID | None = None
    channel: Channel
    received_on: date
    # Health details do not belong here; the screen says so (the server cannot check it).
    note: str | None = Field(default=None, max_length=300)


class AddEventRequest(BaseModel):
    event_type: EventType
    detail: str = Field(min_length=1, max_length=300)
    audit_entry_id: uuid.UUID | None = None
    outcome: Outcome | None = None


class EventResponse(BaseModel):
    id: uuid.UUID
    event_type: EventType
    detail: str
    outcome: Outcome | None
    audit_entry_id: uuid.UUID | None
    created_by: uuid.UUID
    created_by_name: str | None
    created_at: datetime


class DataRequestResponse(BaseModel):
    id: uuid.UUID
    kind: RequestKind
    channel: Channel
    received_on: date
    due_on: date
    note: str | None
    status: RequestStatus
    outcome: Outcome | None
    # Negative when overdue; None once the request is closed (nothing is due any more).
    days_left: int | None
    employee_id: uuid.UUID | None
    employee_code: str | None
    employee_name: str | None
    employee_left: bool
    created_at: datetime


class DataRequestDetailResponse(DataRequestResponse):
    events: list[EventResponse]
