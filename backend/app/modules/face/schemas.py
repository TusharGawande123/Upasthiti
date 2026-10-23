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
