"""Request and response shapes for the holiday calendar (M5 spec §5.3)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.modules.notices.schemas import NoticePerson as Person


class ReasonBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class CreateHolidayRequest(BaseModel):
    date: date
    name: str = Field(min_length=2, max_length=80)
    is_paid: bool = True
    all_plants: bool
    plant_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class HolidayPlantItem(BaseModel):
    id: uuid.UUID
    code: str


class Cancellation(BaseModel):
    by: Person
    at: datetime
    reason: str


class HolidayResponse(BaseModel):
    id: uuid.UUID
    date: date
    name: str
    is_paid: bool
    all_plants: bool
    plants: list[HolidayPlantItem]
    created_by: Person
    created_at: datetime
    cancelled: Cancellation | None


class HolidayCreated(BaseModel):
    holiday: HolidayResponse
