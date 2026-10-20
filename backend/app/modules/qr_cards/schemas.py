"""Request and response shapes for QR cards (spec §5.1)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.kiosks.schemas import PlantSummary
from app.modules.qr_cards.states import CardState

# "replaced" is set only by the server when a new card is issued; an admin cannot pick it.
AdminRevokeKind = Literal["lost", "damaged", "left", "other"]


class NamedItem(BaseModel):
    id: uuid.UUID
    name: str


class CardResponse(BaseModel):
    id: uuid.UUID
    kind: str
    serial: str
    label: str | None  # test cards only
    state: CardState
    valid_from: date
    valid_until: date
    issued_at: datetime
    issued_by: str  # the user's name
    note: str | None
    print_count: int
    last_printed_at: datetime | None
    printed_plant: PlantSummary | None
    # The employee has moved to another plant since the card was printed: reprint advised.
    reprint_needed: bool
    revoked_at: datetime | None
    revoked_by: str | None
    revoke_kind: str | None
    revoke_reason: str | None
    last_used_at: datetime | None  # test cards: the last time a kiosk scanned it


class EmployeeBrief(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    type: str
    plant: PlantSummary
    contractor: NamedItem | None
    category: NamedItem
    punch_method: str


class CardListItem(BaseModel):
    employee: EmployeeBrief
    card: CardResponse | None


class EmployeeCardsResponse(BaseModel):
    cards: list[CardResponse]  # newest first


class ExpiringCountResponse(BaseModel):
    count: int
    days: int


class IssueCardRequest(BaseModel):
    valid_from: date | None = None
    valid_until: date | None = None
    note: str | None = Field(default=None, max_length=300)


class IssueCardResponse(BaseModel):
    card: CardResponse
    replaced_card: CardResponse | None


class ChangeValidityRequest(BaseModel):
    valid_until: date
    reason: str = Field(min_length=3, max_length=500)


class RevokeCardRequest(BaseModel):
    kind: AdminRevokeKind
    reason: str = Field(min_length=3, max_length=500)


class BulkCardsRequest(BaseModel):
    action: Literal["issue", "revoke"]
    employee_ids: list[uuid.UUID] = Field(default_factory=list)  # for "issue"
    card_ids: list[uuid.UUID] = Field(default_factory=list)  # for "revoke"
    valid_until: date | None = None  # for "issue"
    kind: AdminRevokeKind | None = None  # for "revoke"
    reason: str = Field(min_length=3, max_length=500)


class SkippedItem(BaseModel):
    code: str  # why: EMPLOYEE_NOT_QR, QR_CARD_EXISTS, EMPLOYEE_LEFT, ...
    employee_code: str | None
    card_serial: str | None


class BulkCardsResponse(BaseModel):
    done: int
    skipped: list[SkippedItem]


class CreateTestCardRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)  # e.g. "Gate test K134"


class RevokeTestCardRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class TestCardResponse(BaseModel):
    card: CardResponse
