"""Request and response shapes of the notification centre (M5 spec §5.7)."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class NotificationPlant(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class NotificationItem(BaseModel):
    id: uuid.UUID
    kind: str
    severity: Literal["info", "warning", "urgent"]
    plant: NotificationPlant | None
    text_key: str  # the translation key; `params` fill it (counts, plant code; never names)
    params: dict[str, Any]
    link: str
    created_at: datetime
    resolved_at: datetime | None
    read: bool


class UnreadCount(BaseModel):
    unread: int


class PreferencesRequest(BaseModel):
    email_enabled: bool
    email_kinds: list[str] = Field(default_factory=list, max_length=20)


class PreferencesResponse(BaseModel):
    email_enabled: bool
    email_kinds: list[str]
    email_configured: bool  # false: the screens say "Email is not set up on this server"
    has_email: bool
