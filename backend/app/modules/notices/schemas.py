"""Request and response shapes for gate notices (spec M2 §5.4, F-25)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

NoticeState = Literal["scheduled", "showing", "ended"]


class CreateNoticeRequest(BaseModel):
    plant_id: uuid.UUID | None  # None = every plant (Super Admin only)
    # The exact limits (1-200 after trimming, no control characters) are checked by the service,
    # which answers NOTICE_TEXT_INVALID; this cap only stops absurd requests.
    text: str = Field(max_length=1000)
    level: Literal["normal", "important"] = "normal"
    starts_at: datetime
    ends_at: datetime


class UpdateNoticeRequest(BaseModel):
    """Only the fields that are sent change. The plant of a notice never changes."""

    text: str | None = Field(default=None, max_length=1000)
    level: Literal["normal", "important"] | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class NoticePlant(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class NoticePerson(BaseModel):
    id: uuid.UUID
    name: str


class NoticeResponse(BaseModel):
    id: uuid.UUID
    plant: NoticePlant | None  # None = all plants
    text: str
    level: str
    starts_at: datetime
    ends_at: datetime
    state: NoticeState
    created_by: NoticePerson
    created_at: datetime
    ended_at: datetime | None
    ended_by: NoticePerson | None
    can_change: bool  # whether the viewer may edit or end it
