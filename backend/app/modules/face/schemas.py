"""Request and response shapes of the face endpoints (spec M3 §5.3): never a template or vector."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.face.models import ConsentChoice


class PersonRef(BaseModel):
    id: uuid.UUID
    name: str


class ConsentView(BaseModel):
    choice: ConsentChoice
    text_version: str
    language: str
    explained_language: str | None
    given_at: datetime
    recorded_by: PersonRef | None
    withdrawn_at: datetime | None
    withdrawn_by: PersonRef | None
    withdraw_kind: str | None
    withdraw_reason: str | None


class ConsentTextResponse(BaseModel):
    version: str
    language: str
    text: str
    text_sha256: str


class RecordConsentRequest(BaseModel):
    text_version: str = Field(max_length=30)
    language: Literal["en", "mr", "hi"] = "en"
    choice: ConsentChoice
    # Ticked when the Super Admin explained the text in a language other than the one shown.
    explained_language: Literal["mr", "hi", "other"] | None = None


class RecordConsentResponse(BaseModel):
    consent: ConsentView
    punch_method: str


class WithdrawConsentRequest(BaseModel):
    # Optional: withdrawing must be as easy as giving (DPDP); the screen pre-fills a reason.
    reason: str | None = Field(default=None, max_length=300)


class WithdrawConsentResponse(BaseModel):
    consent: ConsentView
    punch_method: Literal["qr"]
    template_deleted: bool


class StartEnrolmentResponse(BaseModel):
    session_id: uuid.UUID
    expires_at: datetime
    model_id: str
    poses: list[str]


class ShotRequest(BaseModel):
    pose: Literal["straight", "left", "right", "up", "down"]
    # base64 JPEG; the decoded size (at most 150 KB) and the width are checked by the server.
    image_jpeg: str = Field(min_length=1, max_length=256 * 1024)


class ShotQualityView(BaseModel):
    face_px: float
    sharpness: float
    brightness: float
    yaw: float
    pitch: float


class ShotResponse(BaseModel):
    accepted: bool
    reason_code: str | None
    shots_done: int
    next_pose: str | None
    quality: ShotQualityView | None


class FinishEnrolmentRequest(BaseModel):
    duplicate_override_reason: str | None = Field(default=None, min_length=10, max_length=300)


class TemplateView(BaseModel):
    enrolled_at: datetime
    enrolled_by: PersonRef | None = None
    model_id: str
    shot_count: int
    duplicate_override: bool = False


class FinishEnrolmentResponse(BaseModel):
    template: TemplateView
    replaced_previous: bool


class DeleteFaceDataRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class DeleteFaceDataResponse(BaseModel):
    template_deleted: Literal[True]


class HistoryItemView(BaseModel):
    kind: str
    at: datetime
    by: PersonRef | None
    detail: str | None


class EmployeeFaceResponse(BaseModel):
    punch_method: str
    face_state: str
    consent: ConsentView | None
    template: TemplateView | None
    reenrol_suggested: bool
    reenrol_reason: str | None
    history: list[HistoryItemView]


class PlantRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class PlantProgressView(BaseModel):
    plant: PlantRef
    face_employees: int
    enrolled: int
    not_enrolled: int
    old_model: int
    reenrol_suggested: int


class ProgressTotals(BaseModel):
    face_employees: int
    enrolled: int
    not_enrolled: int
    old_model: int
    reenrol_suggested: int


class EnrolmentProgressResponse(BaseModel):
    plants: list[PlantProgressView]
    totals: ProgressTotals
