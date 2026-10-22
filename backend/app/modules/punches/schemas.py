"""Request and response shapes of the kiosk punch endpoint (spec M2 §5.2)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.kiosks.schemas import LocationReport

# The whole request body may not be larger than this (spec §7 rule 5.2).
MAX_BODY_BYTES = 64 * 1024


class KioskPunchRequest(BaseModel):
    client_punch_id: uuid.UUID  # made by the kiosk for each scan; a retry reuses it
    method: Literal["qr"]  # M3 adds "face"
    qr_payload: str = Field(max_length=200)
    # The photo as base64 text. The size limit of the photo itself is checked by the snapshot
    # rule (SNAPSHOT_INVALID); this cap only stops absurd requests early.
    snapshot_jpeg: str | None = Field(default=None, max_length=MAX_BODY_BYTES)
    device_time: datetime | None = None  # what the kiosk's clock says: informational only
    location: LocationReport | None = None  # stored, not checked until M4
    app_version: str | None = Field(default=None, max_length=40)


class PunchEmployee(BaseModel):
    display_name: str
    employee_code: str


class PunchDetails(BaseModel):
    """Extra facts the result screen can show ("Already IN at 07:02; OUT after 07:32")."""

    kiosk_name: str
    last_direction: Literal["in", "out"] | None = None
    last_punch_at: datetime | None = None
    out_allowed_from: datetime | None = None


class KioskPunchResponse(BaseModel):
    punch_id: uuid.UUID | None  # none for a self test: nothing is recorded
    decision: Literal["accepted", "rejected", "self_test"]
    direction: Literal["in", "out"] | None
    employee: PunchEmployee | None
    server_time: datetime
    reason_code: str | None
    message_key: str
    voice_key: str
    details: PunchDetails


# --- The admin punch log (spec M2 §5.3) ---------------------------------------------------------


class PunchLogEmployee(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class PunchLogPlace(BaseModel):
    id: uuid.UUID
    name: str
    code: str | None = None  # plants have a code; kiosks only a name


class PunchLogSnapshot(BaseModel):
    state: Literal["stored", "purged", "upload_failed", "none"]
    is_dark: bool | None = None  # Super Admin only (F-31)
    expires_at: datetime | None = None
    purged_at: datetime | None = None


class PunchLogItem(BaseModel):
    id: uuid.UUID
    server_received_at: datetime
    # None when the card was not identified, or (for a Plant Head) when the person belongs to
    # another plant: then `employee_hidden` is true and the screen says "Card of another plant".
    employee: PunchLogEmployee | None
    employee_hidden: bool
    plant: PunchLogPlace
    kiosk: PunchLogPlace
    method: str
    direction: Literal["in", "out"] | None
    decision: str
    reason_codes: list[str]
    snapshot: PunchLogSnapshot


class PunchLocation(BaseModel):
    lat: float
    lon: float
    accuracy_m: float | None


class PunchDetail(PunchLogItem):
    app_version: str | None
    device_time: datetime | None  # what the kiosk's clock said: never used for a decision
    location: PunchLocation | None


class PunchSummaryResponse(BaseModel):
    accepted_in: int
    accepted_out: int
    rejected: int
    dark_photos: int | None  # Super Admin only
    rejected_by_reason: dict[str, int]


class PunchCompareResponse(BaseModel):
    current: PunchLogItem
    earlier: list[PunchLogItem]  # up to 3, newest first
