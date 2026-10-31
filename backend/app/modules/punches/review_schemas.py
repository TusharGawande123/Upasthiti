"""Request and response shapes of the Super Admin's "Needs review" endpoints (spec M4 §5.3)."""

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.punches.schemas import PunchDetail, PunchLogEmployee, PunchLogItem, PunchReviewOut

REASON_MIN_CHARACTERS = 3
REASON_MAX_CHARACTERS = 300


class ReviewPunch(PunchLogItem):
    """A punch log row plus what the review list needs on top."""

    time_proof: Literal["anchored", "unproven"] | None = None
    # The employee whose code was typed (face code path) when the face did not match: a rejected
    # punch "names" this person even though `employee` is empty.
    claimed_employee: PunchLogEmployee | None = None


class ReviewListItem(BaseModel):
    punch: ReviewPunch
    latest_review: PunchReviewOut | None
    approvable: bool  # a rejected punch the Super Admin may approve (spec §7 rule 7)


class ReviewSummary(BaseModel):
    to_check: int
    rejected_last_7_days: int
    by_code: dict[str, int]  # flag code -> punches still to check


class DigestPlace(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class DigestPlant(BaseModel):
    plant: DigestPlace
    flagged: int
    rejected_with_employee: int
    to_check: int
    device_offline_minutes_in_shifts: int


class ReviewDigest(BaseModel):
    date: date
    plants: list[DigestPlant]


class ContextFence(BaseModel):
    version_id: uuid.UUID
    version: int
    shape: str
    geojson: dict[str, Any]
    radius_m: float | None
    buffer_m: int
    was_current_at_punch_time: bool = True


class RelatedPunch(BaseModel):
    punch: PunchDetail
    relation: Literal["travel", "two_devices", "order", "closing_out"]
    distance_m: float | None
    minutes_apart: float
    speed_kmh: float | None


class Suggestion(BaseModel):
    direction: Literal["in", "out"]


class NearbyCounted(BaseModel):
    punch_id: uuid.UUID
    punch_time: datetime
    direction: Literal["in", "out"]


class ReviewHint(BaseModel):
    kind: Literal["employee_rejections", "device_edge_flags", "card_two_devices"]
    count: int
    days: int = 7
    filter: dict[str, str]  # query of the linked "Needs review" list


class ReviewContext(BaseModel):
    punch: PunchDetail
    claimed_employee: PunchLogEmployee | None
    geofence: ContextFence | None
    distance_m: float | None
    margin_m: int | None
    related: list[RelatedPunch]
    suggestion: Suggestion | None
    nearby_counted: list[NearbyCounted]
    reviews: list[PunchReviewOut]
    hints: list[ReviewHint]
    approvable: bool
    limits: dict[str, int]  # the settings the screen explains with (travel limit, cool-down)


class ReviewRequest(BaseModel):
    action: Literal["confirm", "not_accepted", "approve"]
    reason: str | None = Field(default=None, max_length=2_000)  # length checked after trimming
    direction: Literal["in", "out"] | None = None
    # The latest review the screen showed (null when it showed none): a mismatch means another
    # Super Admin reviewed the punch meanwhile (REVIEW_CHANGED).
    expected_latest_review_id: uuid.UUID | None = None

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @model_validator(mode="after")
    def check_reason_and_direction(self) -> ReviewRequest:
        reason_needed = self.action in ("not_accepted", "approve")
        length = len(self.reason or "")
        if reason_needed and length < REASON_MIN_CHARACTERS:
            raise ValueError("reason: at least 3 characters")
        if length > REASON_MAX_CHARACTERS:
            raise ValueError("reason: at most 300 characters")
        if self.action == "approve" and self.direction is None:
            raise ValueError("direction is required to approve")
        if self.action != "approve":
            self.direction = None  # only an approval gives a direction
        return self


class ReviewCreated(BaseModel):
    review: PunchReviewOut
