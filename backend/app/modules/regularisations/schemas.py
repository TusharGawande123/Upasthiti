"""Request and response shapes for attendance corrections (M5 spec §5.2)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.modules.attendance.schemas import Day
from app.modules.notices.schemas import NoticePerson as Person

CorrectionKindName = Literal["add_punch", "add_in_out", "ignore_punch", "set_status"]


class CreateCorrectionRequest(BaseModel):
    employee_id: uuid.UUID
    attendance_date: date
    kind: CorrectionKindName
    direction: Literal["in", "out"] | None = None  # add_punch
    in_time: datetime | None = None  # add_punch (in) and add_in_out; UTC ISO
    out_time: datetime | None = None  # add_punch (out) and add_in_out
    punch_id: uuid.UUID | None = None  # ignore_punch
    status_value: Literal["present", "half_day", "absent"] | None = None  # set_status
    reason: str = Field(min_length=3, max_length=300)

    @model_validator(mode="after")
    def check_shape(self) -> CreateCorrectionRequest:
        """Each kind needs exactly its own fields (the database checks the same)."""
        shapes = {
            "add_punch": (
                self.direction is not None
                and ((self.direction == "in") == (self.in_time is not None))
                and ((self.direction == "out") == (self.out_time is not None))
                and self.punch_id is None
                and self.status_value is None
            ),
            "add_in_out": (
                self.in_time is not None
                and self.out_time is not None
                and self.out_time > self.in_time
                and self.direction is None
                and self.punch_id is None
                and self.status_value is None
            ),
            "ignore_punch": (
                self.punch_id is not None
                and self.direction is None
                and self.in_time is None
                and self.out_time is None
                and self.status_value is None
            ),
            "set_status": (
                self.status_value is not None
                and self.direction is None
                and self.in_time is None
                and self.out_time is None
                and self.punch_id is None
            ),
        }
        if not shapes[self.kind]:
            raise ValueError("The fields do not fit this kind of correction.")
        for moment in (self.in_time, self.out_time):
            if moment is not None and moment.tzinfo is None:
                raise ValueError("Times need a time zone.")
        return self


class ReasonBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class NoteBody(BaseModel):
    note: str | None = Field(default=None, max_length=300)


class CorrectionEmployee(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class CorrectionDecision(BaseModel):
    action: str
    reason: str | None
    decided_by: Person
    decided_at: datetime


class CorrectionResponse(BaseModel):
    id: uuid.UUID
    employee: CorrectionEmployee
    attendance_date: date
    kind: str
    direction: str | None
    in_time: datetime | None
    out_time: datetime | None
    status_value: str | None
    punch_id: uuid.UUID | None
    reverses_id: uuid.UUID | None
    reason: str
    requested_by: Person
    requested_at: datetime
    is_direct: bool
    batch_id: uuid.UUID | None
    state: Literal["pending", "approved", "rejected", "withdrawn", "reversed"]
    decision: CorrectionDecision | None


class CorrectionCreated(BaseModel):
    correction: CorrectionResponse


class Warning(BaseModel):
    code: str
    details: dict[str, object] = {}


class PreviewResponse(BaseModel):
    before: Day
    after: Day
    warnings: list[Warning]


class PunchApprovalItem(BaseModel):
    """A read-only line of M4 data: a punch the Super Admin approved or did not accept."""

    punch_id: uuid.UUID
    punch_time: datetime
    employee: CorrectionEmployee | None
    action: str
    direction: str | None
    reviewed_by: Person
    reviewed_at: datetime
    reason: str | None  # the Super Admin only (decision 0028 item 4)


class SummaryResponse(BaseModel):
    pending: int
    mine_pending: int
