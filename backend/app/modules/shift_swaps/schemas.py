"""Request and response shapes of the one-day shift swap (M5 spec §5.3, F-58)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class CreateSwapRequest(BaseModel):
    date: date
    shift_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=300)


class CancelSwapRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class SwapShift(BaseModel):
    id: uuid.UUID
    name: str


class SwapCancellation(BaseModel):
    by: str
    at: datetime
    reason: str | None


class SwapResponse(BaseModel):
    id: uuid.UUID
    date: date
    shift: SwapShift
    reason: str
    created_by: str
    created_at: datetime
    cancelled: SwapCancellation | None


class SwapCreated(BaseModel):
    swap: SwapResponse
